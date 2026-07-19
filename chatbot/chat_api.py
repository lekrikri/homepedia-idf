#!/usr/bin/env python3
"""
HomePedia Chat API — Flask
Architecture : Intent detection → SQL template → Qwen2.5-0.5B → réponse FR
Porté depuis virida-eve/flask_rag_api.py
"""

import os
import json
import time
import logging
import hashlib
from datetime import datetime
from decimal import Decimal
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

from intent_detector import detect_intent, get_template, TEMPLATES, _get_embedder, extract_communes
from sql_executor import execute_template, format_for_display, health_check
from qwen_manager import qwen_manager
from kb_search import search_kb

app = Flask(__name__)
CORS(app, origins=["*"])

DISABLE_LLM = os.getenv("DISABLE_LLM", "false").lower() == "true"

# ── Cache Redis (persistant entre redémarrages Cloud Run) ────────────────────
CACHE_TTL = int(os.getenv("CACHE_TTL", "600"))  # 10 min
_redis_client = None

try:
    import redis as _redis_lib
    _REDIS_URL = os.getenv("REDIS_URL")
    if _REDIS_URL:
        _redis_client = _redis_lib.from_url(_REDIS_URL, decode_responses=True, socket_connect_timeout=2)
        _redis_client.ping()
        logger.info("✅ Redis Upstash connecté")
    else:
        logger.info("⚠️ REDIS_URL non définie — cache in-memory uniquement")
except Exception as _e:
    logger.warning(f"⚠️ Redis indisponible ({_e}) — fallback in-memory")
    _redis_client = None

# Fallback in-memory si Redis indisponible
_mem_cache: dict = {}


def cache_key(question: str) -> str:
    return f"hp:chat:{hashlib.md5(question.strip().lower().encode()).hexdigest()}"


def get_cached(question: str):
    k = cache_key(question)
    # Tenter Redis d'abord
    if _redis_client:
        try:
            raw = _redis_client.get(k)
            if raw:
                return json.loads(raw)
        except Exception:
            pass
    # Fallback in-memory
    entry = _mem_cache.get(k)
    if entry and (time.time() - entry["ts"]) < CACHE_TTL:
        return entry["response"]
    return None


def set_cached(question: str, response: dict):
    k = cache_key(question)
    # Redis avec TTL
    if _redis_client:
        try:
            _redis_client.setex(k, CACHE_TTL, json.dumps(response, default=str))
            return
        except Exception:
            pass
    # Fallback in-memory (LRU basique)
    _mem_cache[k] = {"response": response, "ts": time.time()}
    if len(_mem_cache) > 200:
        oldest = sorted(_mem_cache.items(), key=lambda x: x[1]["ts"])[:50]
        for old_k, _ in oldest:
            del _mem_cache[old_k]


# ── Cache sémantique (MiniLM partagé avec intent_detector) ───────────────────
try:
    import numpy as np
    _NP_OK = True
except ImportError:
    _NP_OK = False

_sem_cache: list = []  # liste de (embedding, response_dict)
_SEM_THRESHOLD = float(os.getenv("SEM_CACHE_THRESHOLD", "0.92"))
_SEM_MAX = 100


def _sem_get(question: str):
    if not _NP_OK or not _sem_cache:
        return None
    embedder = _get_embedder()
    if embedder is None:
        return None
    q_vec = embedder.encode([question], show_progress_bar=False)[0]
    best_sim, best_resp = 0.0, None
    for entry_vec, entry_resp in _sem_cache[-60:]:
        sim = float(np.dot(q_vec, entry_vec) /
                    (np.linalg.norm(q_vec) * np.linalg.norm(entry_vec) + 1e-9))
        if sim > best_sim:
            best_sim, best_resp = sim, entry_resp
    if best_sim >= _SEM_THRESHOLD:
        logger.info(f"🧠 Semantic cache hit (sim={best_sim:.3f})")
        return best_resp
    return None


def _sem_set(question: str, response: dict):
    if not _NP_OK:
        return
    embedder = _get_embedder()
    if embedder is None:
        return
    q_vec = embedder.encode([question], show_progress_bar=False)[0]
    _sem_cache.append((q_vec, response))
    if len(_sem_cache) > _SEM_MAX:
        _sem_cache.pop(0)


# ── Score de confiance de la réponse ─────────────────────────────────────────

def _confidence(intent: str, nb_results: int, llm_used: bool) -> int:
    score = 0
    if intent not in ("unknown", "general", "salutation"):
        score += 30
    if nb_results > 0:
        score += 35
    if nb_results >= 3:
        score += 15
    if llm_used:
        score += 20
    return min(score, 100)


# ── Fallback textuel sans LLM ────────────────────────────────────────────────

def _commune_detail_card(rows: list) -> str:
    """Fiche commune structurée — remplace Qwen pour commune_detail."""
    if not rows:
        return "Aucune donnée trouvée pour cette commune. Vérifiez le nom ou précisez le département."
    r = rows[0]
    nom = r.get("commune", "?")
    dept = r.get("dept", "")
    prix = r.get("prix_m2")
    nb_tx = r.get("nb_transactions")
    score = r.get("score_global")
    qv = r.get("qualite_vie")
    invest = r.get("investissement")
    rdt = r.get("rendement_pct")
    loyer = r.get("loyer_m2")
    dpe = r.get("dpe_score")
    ips = r.get("ips_ecoles")
    cam = r.get("cambriolages_pour_mille")

    lines = [f"**{nom}** (département {dept})\n"]
    if prix:
        lines.append(f"**Prix médian** : **{int(float(prix)):,} €/m²**".replace(",", " "))
    if rdt:
        lines.append(f"**Rendement locatif brut** : **{float(rdt):.2f}%**")
    if loyer:
        lines.append(f"**Loyer médian** : {float(loyer):.0f} €/m²/mois")
    if qv:
        lines.append(f"**Qualité de vie** : **{float(qv):.1f}/100**")
    if invest:
        lines.append(f"**Score investissement** : **{float(invest):.1f}/100**")
    if dpe:
        lines.append(f"**Score DPE** : {float(dpe):.2f}")
    if ips:
        lines.append(f"**IPS écoles** : {float(ips):.1f}")
    if cam is not None:
        lines.append(f"**Cambriolages** : {float(cam):.1f} pour mille")
    if score:
        lines.append(f"\n**Score global** : **{float(score):.1f}/100**")
    if nb_tx:
        lines.append(f"{int(nb_tx):,} transactions DVF 2020-2024".replace(",", " "))
    return "\n".join(lines)


def _forecast_fallback(rows: list) -> str:
    """Réponse structurée pour les prévisions Prophet."""
    if not rows:
        return "Aucune prévision disponible pour cette commune. Les données Prophet sont générées pour les communes avec au moins 3 années de transactions DVF."
    commune = rows[0].get("commune", "?")
    hist = [r for r in rows if not r.get("is_forecast")]
    fcst = [r for r in rows if r.get("is_forecast")]
    lines = [f"**Prévisions Prophet pour {commune}** (modèle Meta, intervalles de confiance 80%) :"]
    if hist:
        last = hist[-1]
        lines.append(f"\n**Historique** — dernier point connu : **{int(last['prix_m2_pred']):,} €/m²** ({last['annee']})".replace(",", " "))
    for r in fcst:
        lower = f"{int(r['prix_m2_lower']):,}".replace(",", " ") if r.get("prix_m2_lower") else "?"
        upper = f"{int(r['prix_m2_upper']):,}".replace(",", " ") if r.get("prix_m2_upper") else "?"
        lines.append(f"**{r['annee']}** : ~**{int(r['prix_m2_pred']):,} €/m²**".replace(",", " ") +
                     f" (fourchette 80% : {lower}–{upper} €/m²)")
    if hist and fcst:
        last_known = hist[-1]["prix_m2_pred"]
        last_fcst = fcst[-1]["prix_m2_pred"]
        trend = (last_fcst - last_known) / last_known * 100
        lines.append(f"\nTendance prévue : **{'+' if trend >= 0 else ''}{trend:.1f}%** sur la période")
    lines.append("\n*Prévision statistique basée sur les transactions DVF 2019-2024. Pas un conseil en investissement.*")
    return "\n".join(lines)


def _comparaison_table(rows: list) -> str:
    """Comparaison structurée emoji-table entre 2 communes."""
    if len(rows) < 2:
        return "Données insuffisantes pour comparer. Précisez deux communes d'Île-de-France (ex: 'compare Versailles et Vincennes')."
    a, b = rows[0], rows[1]
    na, nb = a.get("commune", "?"), b.get("commune", "?")

    def fmt_prix(v): return f"{int(float(v)):,} €/m²".replace(",", " ") if v else "N/A"
    def fmt_pct(v):  return f"{float(v):.1f}%" if v else "N/A"
    def fmt_score(v): return f"{float(v):.0f}/100" if v else "N/A"
    def fmt_raw(v):  return f"{float(v):.1f}" if v else "N/A"

    ROWS = [
        ("💰", "Prix au m²",        "prix_m2",               fmt_prix,  False),
        ("📈", "Rendement locatif", "rendement_pct",         fmt_pct,   True),
        ("🌳", "Qualité de vie",    "qualite_vie",           fmt_score, True),
        ("📊", "Score investissement","investissement",      fmt_score, True),
        ("🌿", "Score DPE",         "dpe_score",             fmt_raw,   True),
        ("🏫", "IPS écoles",        "ips_ecoles",            fmt_raw,   True),
        ("🛡️", "Cambriolages",     "cambriolages_pour_mille", lambda v: f"{float(v):.1f}‰", False),
    ]

    lines = [f"**{na} vs {nb}** — Comparaison détaillée\n"]
    pts_a = pts_b = 0

    for icon, label, key, formatter, higher_is_better in ROWS:
        va, vb = a.get(key), b.get(key)
        if va is None and vb is None:
            continue
        fa = formatter(va)
        fb = formatter(vb)
        mark_a = mark_b = ""
        if va is not None and vb is not None:
            fa_f, fb_f = float(va), float(vb)
            if higher_is_better:
                if fa_f > fb_f: mark_a, pts_a = " ✅", pts_a + 1
                elif fb_f > fa_f: mark_b, pts_b = " ✅", pts_b + 1
            else:  # lower is better (cambriolages, prix)
                if key != "prix_m2":  # prix : neutre
                    if fa_f < fb_f: mark_a, pts_a = " ✅", pts_a + 1
                    elif fb_f < fa_f: mark_b, pts_b = " ✅", pts_b + 1
        lines.append(f"{icon} **{label}** : {fa}{mark_a} · {fb}{mark_b}")

    winner = na if pts_a >= pts_b else nb
    loser  = nb if pts_a >= pts_b else na
    lines.append(f"\n🏆 **Bilan ({pts_a}-{pts_b})** : **{winner}** l'emporte sur la majorité des critères.")
    lines.append(f"💡 **{loser}** peut rester intéressant selon vos priorités (prix, proximité, etc.).")
    return "\n".join(lines)


def _fmt_prix(v):
    return f"{int(float(v)):,} €/m²".replace(",", " ") if v else None

def _fmt_pct(v, suffix="%"):
    return f"{float(v):.1f}{suffix}" if v else None

def _fmt_score(v, max_val=100):
    return f"{float(v):.0f}/{max_val}" if v else None


def _short_intro(rows: list, intent: str) -> str:
    """Une phrase d'intro pour présenter les cards — pas de reformulation Qwen."""
    n = len(rows)
    if not rows:
        return "Aucun résultat trouvé pour votre recherche."
    top = rows[0]
    commune = top.get("commune", "")
    dept = top.get("dept", "")
    label = f"{commune} ({dept})" if dept else commune

    if intent == "rendement":
        rdt = top.get("rendement_pct")
        if rdt:
            return f"{n} communes classées par rendement. Meilleur : {label} à {float(rdt):.1f}% (moyenne IDF : 4,2%)."
    if intent == "prix":
        prix = top.get("prix_m2")
        if prix:
            return f"{n} communes classées par prix au m². La plus accessible : {label} à {int(float(prix)):,} €/m².".replace(",", " ")
    if intent == "ecoles_ips":
        ips = top.get("ips_moyen")
        if ips:
            return f"{n} communes avec les meilleurs IPS scolaires. En tête : {label} (IPS {float(ips):.0f})."
    if intent == "dpe":
        pct = top.get("pct_bon_dpe")
        if pct:
            return f"{n} communes avec les meilleurs DPE. En tête : {label} ({float(pct):.0f}% bons DPE)."
    if intent == "securite":
        return f"{n} communes les plus sûres. En tête : {label}."
    if intent == "isochrone_paris":
        t = top.get("temps_paris_min") or top.get("temps_paris")
        return f"{n} communes accessibles depuis Paris{f' (moins de {int(float(t))} min)' if t else ''}, classées par score. En tête : {label}."
    if intent == "transport":
        return f"{n} communes bien desservies par les transports. En tête : {label}."
    if intent == "qualite_vie":
        qv = top.get("qualite_vie")
        if qv:
            return f"{n} communes classées par qualité de vie. En tête : {label} (score {float(qv):.0f}/100)."
    # departement, multi_criteria, budget_achat, commune_similaire
    score = top.get("score_global") or top.get("score_invest")
    prix = top.get("prix_m2")
    if score and prix:
        return f"{n} communes trouvées. Meilleure option : {label} (score {float(score):.0f}/100, {int(float(prix)):,} €/m²).".replace(",", " ")
    return f"Voici les {n} communes correspondant à votre recherche, classées par pertinence."


def fallback_response(rows: list, intent: str, question: str) -> str:
    """Réponse structurée enrichie sans LLM."""
    if intent == "forecast_prix":
        return _forecast_fallback(rows)
    if intent == "comparaison":
        return _comparaison_table(rows)
    if intent == "commune_detail":
        return _commune_detail_card(rows)

    hint = TEMPLATES.get(intent, {}).get("response_hint", "résultats")
    if not rows:
        return f"Aucune donnée trouvée pour votre question sur {hint}. Précisez une commune ou un département IDF."

    IDF_REF = {"prix_m2": 4300, "rendement_pct": 4.2, "score_global": 55}

    lines = [f"Voici les résultats pour **{hint}** :"]
    for i, row in enumerate(rows[:7], 1):
        commune = row.get("commune", "?")
        dept = row.get("dept", "")
        label = f"**{commune}** ({dept})" if dept else f"**{commune}**"
        parts = [label]

        if intent == "ecoles_ips":
            ips = row.get("ips_moyen")
            pct = row.get("pct_ecoles_favorisees")
            prix = row.get("prix_m2")
            if ips:
                ref = " (bon)" if float(ips) > 103 else ""
                parts.append(f"IPS {float(ips):.0f}{ref}")
            if pct:
                parts.append(f"{float(pct):.0f}% écoles favorisées")
            if prix:
                parts.append(_fmt_prix(prix))

        elif intent == "rendement":
            rdt = row.get("rendement_pct")
            loyer = row.get("loyer_m2")
            prix = row.get("prix_m2")
            if rdt:
                ref = " (+)" if float(rdt) > IDF_REF["rendement_pct"] else ""
                parts.append(f"{float(rdt):.1f}% rdt brut{ref}")
            if loyer:
                parts.append(f"loyer {float(loyer):.0f} €/m²/mois")
            if prix:
                parts.append(_fmt_prix(prix))

        elif intent == "dpe":
            dpe = row.get("score_dpe")
            pct_dpe = row.get("pct_bon_dpe")
            prix = row.get("prix_m2")
            if dpe:
                parts.append(f"DPE {float(dpe):.1f}")
            if pct_dpe:
                parts.append(f"{float(pct_dpe):.0f}% bons DPE")
            if prix:
                parts.append(_fmt_prix(prix))

        elif intent == "securite":
            cam = row.get("cambriolages_pour_mille")
            sc = row.get("score_securite")
            prix = row.get("prix_m2")
            if cam is not None:
                ref = " (faible)" if float(cam) < 5.5 else " (elevé)"
                parts.append(f"{float(cam):.1f} pour mille cambriolages{ref}")
            if sc:
                parts.append(f"sécurité {float(sc):.0f}/100")
            if prix:
                parts.append(_fmt_prix(prix))

        elif intent in ("top_investissement",):
            sc = row.get("score_invest")
            rdt = row.get("rendement_pct")
            prix = row.get("prix_m2")
            if sc:
                parts.append(f"score investissement {float(sc):.0f}/100")
            if rdt:
                parts.append(f"rendement {float(rdt):.1f}%")
            if prix:
                parts.append(_fmt_prix(prix))

        elif intent == "tendance_prix":
            evol = row.get("evolution_pct")
            prix_debut = row.get("prix_2021")
            prix_fin = row.get("prix_2024")
            if evol is not None:
                arrow = "📈" if float(evol) >= 0 else "📉"
                parts.append(f"{arrow} {float(evol):+.1f}% (2021→2024)")
            if prix_debut and prix_fin:
                parts.append(f"{_fmt_prix(prix_debut)} → {_fmt_prix(prix_fin)}")

        elif intent in ("budget_achat", "multi_criteria", "commune_similaire", "isochrone_paris"):
            prix = row.get("prix_m2")
            rdt = row.get("rendement_pct")
            qv = row.get("qualite_vie") or row.get("score_qualite_vie")
            sc = row.get("score_global") or row.get("score_invest")
            dist = row.get("distance_km") or row.get("dist_gare_km")
            if prix:
                ref = " (abordable)" if float(prix) < IDF_REF["prix_m2"] else ""
                parts.append(f"{_fmt_prix(prix)}{ref}")
            if rdt:
                parts.append(f"rdt {float(rdt):.1f}%")
            if qv:
                parts.append(f"qualité vie {float(qv):.0f}/100")
            if sc:
                parts.append(f"score {float(sc):.0f}/100")
            if dist:
                parts.append(f"{float(dist):.1f} km de Paris")

        else:
            prix = row.get("prix_m2")
            rendement = row.get("rendement_pct")
            score = row.get("score_global") or row.get("score_invest") or row.get("qualite_vie")
            if prix:
                parts.append(_fmt_prix(prix))
            if rendement:
                parts.append(f"rdt {float(rendement):.1f}%")
            if score:
                parts.append(f"score {float(score):.0f}/100")

        lines.append(f"{i}. {' — '.join(p for p in parts if p)}")

    # Résumé contextuel en fin de liste
    if intent == "rendement" and rows:
        best = max(rows[:7], key=lambda r: float(r.get("rendement_pct") or 0))
        lines.append(f"\nMeilleur rendement : **{best.get('commune')}** à {float(best.get('rendement_pct', 0)):.1f}% (vs moyenne IDF ~4,2%)")
    elif intent == "top_investissement" and rows:
        lines.append(f"\nCes communes offrent le meilleur ratio rendement/risque en IDF.")
    elif intent in ("budget_achat", "multi_criteria") and rows:
        lines.append(f"\nRésultats triés par score global décroissant. Prix moyen IDF : 4 300 €/m².")

    return "\n".join(lines)


# ── Routes ───────────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    db_ok = health_check()
    redis_ok = False
    if _redis_client:
        try:
            _redis_client.ping()
            redis_ok = True
        except Exception:
            pass
    return jsonify({
        "status": "ok" if db_ok else "degraded",
        "db": db_ok,
        "llm": qwen_manager.get_stats(),
        "redis": redis_ok,
        "cache_size": len(_mem_cache),
        "sem_cache_size": len(_sem_cache),
        "timestamp": datetime.utcnow().isoformat(),
    })


@app.route("/chat", methods=["POST"])
def chat():
    start = time.time()

    data = request.get_json(silent=True)
    if not data or "question" not in data:
        return jsonify({"error": "Champ 'question' requis"}), 400

    question = str(data["question"]).strip()[:500]
    if not question:
        return jsonify({"error": "Question vide"}), 400

    logger.info(f"💬 Question: {question[:80]}")

    # Ticket 3 — historique conversationnel (3 derniers messages user)
    history = data.get("history", [])
    context_summary = " | ".join(
        h["content"][:120] for h in history[-3:]
        if isinstance(h, dict) and h.get("role") == "user"
    )

    # Cache exact hit
    cached = get_cached(question)
    if cached:
        logger.info("⚡ Cache hit")
        return jsonify({**cached, "cached": True})

    # Cache sémantique
    sem = _sem_get(question)
    if sem:
        return jsonify({**sem, "cached": True, "semantic_cache": True})

    # Knowledge Base — court-circuit avant intent detection
    # Intercepte les questions théoriques quel que soit l'intent qui serait détecté
    kb_result = search_kb(question)
    if kb_result:
        kb_answer, kb_score = kb_result
        logger.info(f"📚 KB match (score={kb_score}) — bypass intent detection")
        response = {
            "answer": kb_answer,
            "intent": "general",
            "nb_results": 0,
            "data": [],
            "latency_ms": round((time.time() - start) * 1000),
            "cached": False,
            "confidence_score": 90,
            "source": "knowledge_base",
        }
        set_cached(question, response)
        return jsonify(response)

    # 1. Détection d'intent (hybride MiniLM + regex)
    intent, params = detect_intent(question)
    logger.info(f"🎯 Intent: {intent} | params: {list(params.keys())}")

    # Co-référence commune : injecter la dernière commune mentionnée dans l'historique
    if intent in ("commune_detail", "forecast_prix") and not extract_communes(question):
        for msg in reversed(history):
            if not (isinstance(msg, dict) and msg.get("role") == "user"):
                continue
            communes_hist = extract_communes(msg.get("content", ""))
            if communes_hist:
                params["city"] = communes_hist[0]
                logger.info(f"🔗 Co-référence commune injectée: {communes_hist[0]}")
                break

    # Court-circuit hors_scope — réponse fixe sans SQL
    if intent == "hors_scope":
        response = {
            "answer": "Je suis spécialisé dans l'immobilier en Île-de-France uniquement. "
                      "Pour cette question, je ne peux pas vous aider, mais posez-moi une question "
                      "sur les prix, les communes, le DPE ou les rendements locatifs en IDF !",
            "intent": intent, "nb_results": 0, "data": [],
            "latency_ms": round((time.time() - start) * 1000), "cached": False,
            "confidence_score": 95,
        }
        return jsonify(response)

    # Court-circuit general — question encyclopédique, Qwen répond sans données SQL
    if intent == "general":
        if not DISABLE_LLM and qwen_manager.initialized:
            answer = qwen_manager.generate_response([], question, intent, context=context_summary)
        else:
            answer = None
        if not answer:
            answer = ("Je suis HomePedia IA, spécialisé dans les données immobilières IDF. "
                      "Pour des explications détaillées sur ce concept, consultez notre guide ou "
                      "reformulez votre question avec une commune spécifique.")
        response = {
            "answer": answer, "intent": intent, "nb_results": 0, "data": [],
            "latency_ms": round((time.time() - start) * 1000), "cached": False,
            "confidence_score": 70,
        }
        set_cached(question, response)
        return jsonify(response)

    # Court-circuit salutation — pas de SQL, réponse fixe immédiate
    if intent == "salutation":
        greeting = (
            "Bonjour ! Je suis HomePedia IA, votre assistant immobilier en Île-de-France.\n\n"
            "Je peux vous aider à :\n"
            "• Trouver les meilleures communes pour investir ou vivre\n"
            "• Comparer deux communes (prix, rendement, DPE, sécurité...)\n"
            "• Analyser prix au m², rendements locatifs, performance énergétique\n"
            "• Rechercher selon plusieurs critères combinés\n\n"
            "Posez-moi une question sur l'immobilier IDF !"
        )
        response = {
            "answer": greeting,
            "intent": intent,
            "nb_results": 0,
            "data": [],
            "latency_ms": round((time.time() - start) * 1000),
            "cached": False,
        }
        set_cached(question, response)
        return jsonify(response)

    # 2. Exécution SQL
    if "_sql" in params or intent == "multi_criteria":
        # SQL construit dynamiquement (multi_criteria, top_prix, tendance_prix, isochrone, etc.)
        custom_sql = params.pop("_sql")
        rows = execute_template(custom_sql, params)

        # Fallback haversine si isochrone_paris retourne 0 lignes (table rer_stations vide)
        if intent == "isochrone_paris" and len(rows) == 0:
            logger.info("🔄 isochrone_paris: rer_stations vide → fallback haversine")
            fallback_sql = """
                SELECT city AS commune, TRIM(code_departement) AS dept,
                       ROUND(prix_median_m2::numeric, 0) AS prix_m2,
                       ROUND(score_qualite_vie::numeric, 1) AS qualite_vie,
                       ROUND(rendement_locatif_brut::numeric, 2) AS rendement_pct,
                       ROUND((2 * 6371 * ASIN(SQRT(
                           POWER(SIN(RADIANS((centroid_lat - 48.8566)/2)), 2) +
                           COS(RADIANS(48.8566)) * COS(RADIANS(centroid_lat)) *
                           POWER(SIN(RADIANS((centroid_lon - 2.3488)/2)), 2)
                       )))::numeric, 1)::float AS distance_km
                FROM communes_agregat
                WHERE centroid_lon IS NOT NULL AND centroid_lat IS NOT NULL
                  AND prix_median_m2 IS NOT NULL
                  AND 2 * 6371 * ASIN(SQRT(
                      POWER(SIN(RADIANS((centroid_lat - 48.8566)/2)), 2) +
                      COS(RADIANS(48.8566)) * COS(RADIANS(centroid_lat)) *
                      POWER(SIN(RADIANS((centroid_lon - 2.3488)/2)), 2)
                  )) <= %(rayon_km)s
                ORDER BY score_qualite_vie DESC NULLS LAST
                LIMIT %(limit)s
            """
            rows = execute_template(fallback_sql, {
                "rayon_km": params.get("rayon_km", 21.0),
                "limit": params.get("limit", 8),
            })
    else:
        template = get_template(intent)
        merged_params = {**template["params"], **params}
        if "cities" in merged_params and isinstance(merged_params["cities"], list):
            merged_params["cities"] = [c.lower() for c in merged_params["cities"]]
        rows = execute_template(template["sql"], merged_params)

    logger.info(f"📊 SQL retourné {len(rows)} ligne(s)")

    # Anti-hallucination : si aucune donnée pour un intent SQL, réponse fixe sans LLM
    NO_SQL_INTENTS = {"salutation", "general", "hors_scope"}
    if len(rows) == 0 and intent not in NO_SQL_INTENTS:
        hint = TEMPLATES.get(intent, {}).get("response_hint", "résultats")
        no_data_msg = (
            f"Je n'ai pas trouvé de données pour '{hint}' correspondant à votre demande. "
            "Essayez de reformuler ou précisez une commune ou département d'Île-de-France."
        )
        response = {
            "answer": no_data_msg, "intent": intent, "nb_results": 0, "data": [],
            "latency_ms": round((time.time() - start) * 1000), "cached": False,
            "confidence_score": _confidence(intent, 0, False),
        }
        return jsonify(response)

    # 3. Génération réponse — intro courte pour les intents avec cards
    if intent in ("comparaison", "forecast_prix", "commune_detail"):
        llm_response = fallback_response(rows, intent, question)
    else:
        llm_response = _short_intro(rows, intent)

    llm_used = False
    response = {
        "answer": llm_response,
        "intent": intent,
        "nb_results": len(rows),
        "data": rows[:8],
        "latency_ms": round((time.time() - start) * 1000),
        "cached": False,
        "confidence_score": _confidence(intent, len(rows), llm_used),
    }

    set_cached(question, response)
    _sem_set(question, response)
    logger.info(f"✅ Réponse en {response['latency_ms']}ms (confiance {response['confidence_score']}%)")
    return jsonify(response)


@app.route("/chat/stream", methods=["POST"])
def chat_stream():
    """SSE streaming — retourne les chunks de réponse au fur et à mesure."""
    data = request.get_json(silent=True)
    if not data or "question" not in data:
        return jsonify({"error": "Champ 'question' requis"}), 400

    question = str(data["question"]).strip()[:500]
    history = data.get("history", [])
    context_summary = " | ".join(
        h["content"][:120] for h in history[-3:]
        if isinstance(h, dict) and h.get("role") == "user"
    )

    def _sse_fixed(text: str, intent_name: str):
        """SSE helper pour les réponses sans SQL."""
        def gen():
            meta = json.dumps({"intent": intent_name, "nb_results": 0, "data": []})
            yield f"data: {meta}\n\n"
            for word in text.split(" "):
                yield f"data: {json.dumps({'chunk': word + ' '})}\n\n"
            yield "data: [DONE]\n\n"
        return Response(gen(), mimetype="text/event-stream",
                        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # Cache exact (réponse déjà calculée)
    cached = get_cached(question)
    if cached:
        return _sse_fixed(cached.get("answer", ""), cached.get("intent", "general"))

    # Knowledge Base — court-circuit avant intent detection
    kb_result = search_kb(question)
    if kb_result:
        kb_answer, _ = kb_result
        return _sse_fixed(kb_answer, "general")

    intent, params = detect_intent(question)

    # Résolution contextuelle : "et Bagnolet ?" seul détecté comme salutation/general
    # → on réessaie avec le contexte conversationnel pour trouver le vrai intent
    if intent in ("salutation", "general") and context_summary and len(question.split()) <= 6:
        last_ctx = context_summary.split("|")[-1].strip()
        expanded = f"{last_ctx} {question}"
        exp_intent, exp_params = detect_intent(expanded)
        if exp_intent not in ("salutation", "general", "hors_scope"):
            intent, params = exp_intent, exp_params
            logger.info(f"🔗 Co-référence résolue: '{question}' → intent={intent}")

    # Co-référence commune : si l'intent nécessite une commune mais la question courante n'en cite pas,
    # on extrait la dernière commune mentionnée dans l'historique et on l'injecte dans les params
    if intent in ("commune_detail", "forecast_prix") and not extract_communes(question):
        for msg in reversed(history):
            if not (isinstance(msg, dict) and msg.get("role") == "user"):
                continue
            communes_hist = extract_communes(msg.get("content", ""))
            if communes_hist:
                params["city"] = communes_hist[0]
                logger.info(f"🔗 Co-référence commune injectée: {communes_hist[0]}")
                break

    if intent == "hors_scope":
        return _sse_fixed(
            "Je suis spécialisé dans l'immobilier en Île-de-France uniquement. "
            "Pour cette question, je ne peux pas vous aider, mais posez-moi une question "
            "sur les prix, les communes, le DPE ou les rendements locatifs en IDF !",
            "hors_scope"
        )

    if intent == "general":
        if not DISABLE_LLM and qwen_manager.initialized:
            def gen_general():
                meta = json.dumps({"intent": "general", "nb_results": 0, "data": []})
                yield f"data: {meta}\n\n"
                # Bufferiser les tokens pour envoyer des mots complets avec espaces
                buf = ""
                for chunk in qwen_manager.generate_stream([], question, intent, context=context_summary):
                    buf += chunk
                    while " " in buf:
                        word, buf = buf.split(" ", 1)
                        if word:
                            yield f"data: {json.dumps({'chunk': word + ' '})}\n\n"
                if buf.strip():
                    yield f"data: {json.dumps({'chunk': buf})}\n\n"
                yield "data: [DONE]\n\n"
            return Response(gen_general(), mimetype="text/event-stream",
                            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
        return _sse_fixed(
            "Je suis HomePedia IA, spécialisé dans les données immobilières IDF. "
            "Reformulez votre question avec une commune spécifique pour obtenir des données précises.",
            "general"
        )

    if intent == "salutation":
        greeting = (
            "Bonjour ! Je suis HomePedia IA, votre assistant immobilier en Île-de-France.\n\n"
            "Posez-moi une question sur les prix, investissements, DPE ou la sécurité en IDF !"
        )
        def generate_greeting():
            meta = json.dumps({"intent": "salutation", "nb_results": 0, "data": []})
            yield f"data: {meta}\n\n"
            for word in greeting.split(" "):
                yield f"data: {json.dumps({'chunk': word + ' '})}\n\n"
            yield "data: [DONE]\n\n"
        return Response(generate_greeting(), mimetype="text/event-stream",
                        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    if "_sql" in params or intent == "multi_criteria":
        custom_sql = params.pop("_sql")
        rows = execute_template(custom_sql, params)
        # Fallback haversine si isochrone_paris retourne 0 lignes (rer_stations vide)
        if intent == "isochrone_paris" and len(rows) == 0:
            logger.info("🔄 stream isochrone_paris: rer_stations vide → fallback haversine")
            fallback_sql = """
                SELECT city AS commune, TRIM(code_departement) AS dept,
                       ROUND(prix_median_m2::numeric, 0) AS prix_m2,
                       ROUND(score_qualite_vie::numeric, 1) AS qualite_vie,
                       ROUND(rendement_locatif_brut::numeric, 2) AS rendement_pct,
                       ROUND((2 * 6371 * ASIN(SQRT(
                           POWER(SIN(RADIANS((centroid_lat - 48.8566)/2)), 2) +
                           COS(RADIANS(48.8566)) * COS(RADIANS(centroid_lat)) *
                           POWER(SIN(RADIANS((centroid_lon - 2.3488)/2)), 2)
                       )))::numeric, 1)::float AS distance_km
                FROM communes_agregat
                WHERE centroid_lon IS NOT NULL AND centroid_lat IS NOT NULL
                  AND prix_median_m2 IS NOT NULL
                  AND 2 * 6371 * ASIN(SQRT(
                      POWER(SIN(RADIANS((centroid_lat - 48.8566)/2)), 2) +
                      COS(RADIANS(48.8566)) * COS(RADIANS(centroid_lat)) *
                      POWER(SIN(RADIANS((centroid_lon - 2.3488)/2)), 2)
                  )) <= %(rayon_km)s
                ORDER BY score_qualite_vie DESC NULLS LAST
                LIMIT %(limit)s
            """
            rows = execute_template(fallback_sql, {
                "rayon_km": params.get("rayon_km", 21.0),
                "limit": params.get("limit", 8),
            })
    else:
        template = get_template(intent)
        merged_params = {**template["params"], **params}
        if "cities" in merged_params and isinstance(merged_params["cities"], list):
            merged_params["cities"] = [c.lower() for c in merged_params["cities"]]
        rows = execute_template(template["sql"], merged_params)

    def _json(obj):
        return float(obj) if isinstance(obj, Decimal) else str(obj)

    def generate():
        # Envoyer d'abord les metadata (tableau affiché avant les tokens)
        meta = json.dumps({"intent": intent, "nb_results": len(rows), "data": rows[:8]}, default=_json)
        yield f"data: {meta}\n\n"

        # Réponses formatées complètes (comparaison, fiches, prévisions)
        if intent in ("comparaison", "forecast_prix", "commune_detail"):
            if intent == "comparaison":       answer = _comparaison_table(rows)
            elif intent == "forecast_prix":   answer = _forecast_fallback(rows)
            else:                             answer = _commune_detail_card(rows)
            for word in answer.split(" "):
                yield f"data: {json.dumps({'chunk': word + ' '})}\n\n"
        else:
            # Intro courte déterministe — les cards affichent déjà les données
            intro = _short_intro(rows, intent)
            for word in intro.split(" "):
                yield f"data: {json.dumps({'chunk': word + ' '})}\n\n"

        yield "data: [DONE]\n\n"

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/intents", methods=["GET"])
def list_intents():
    """Liste les intents disponibles (debug)."""
    return jsonify({k: v["response_hint"] for k, v in TEMPLATES.items()})


# ── Démarrage ────────────────────────────────────────────────────────────────

def init_app():
    if not DISABLE_LLM:
        logger.info("🔄 Initialisation Qwen2.5-0.5B...")
        qwen_manager.initialize()
    else:
        logger.info("⚠️ LLM désactivé (DISABLE_LLM=true)")


# Appelé ici pour gunicorn --preload (le bloc __main__ n'est jamais exécuté avec gunicorn)
init_app()

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5001"))
    app.run(host="0.0.0.0", port=port, debug=False)
