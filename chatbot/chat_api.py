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
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

from intent_detector import detect_intent, get_template, TEMPLATES, _get_embedder
from sql_executor import execute_template, format_for_display, health_check
from qwen_manager import qwen_manager

app = Flask(__name__)
CORS(app, origins=["*"])

DISABLE_LLM = os.getenv("DISABLE_LLM", "false").lower() == "true"

# ── Cache exact en mémoire (questions identiques) ────────────────────────────
_cache: dict = {}
CACHE_TTL = int(os.getenv("CACHE_TTL", "600"))  # 10 min


def cache_key(question: str) -> str:
    return hashlib.md5(question.strip().lower().encode()).hexdigest()


def get_cached(question: str):
    k = cache_key(question)
    entry = _cache.get(k)
    if entry and (time.time() - entry["ts"]) < CACHE_TTL:
        return entry["response"]
    return None


def set_cached(question: str, response: dict):
    _cache[cache_key(question)] = {"response": response, "ts": time.time()}
    if len(_cache) > 200:
        oldest = sorted(_cache.items(), key=lambda x: x[1]["ts"])[:50]
        for k, _ in oldest:
            del _cache[k]


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

def fallback_response(rows: list, intent: str, question: str) -> str:
    """Réponse structurée sans LLM si Qwen non disponible."""
    hint = TEMPLATES.get(intent, {}).get("response_hint", "résultats")
    if not rows:
        return f"Aucune donnée trouvée pour votre question sur {hint}."

    lines = [f"Voici les résultats pour **{hint}** :"]
    for i, row in enumerate(rows[:6], 1):
        commune = row.get("commune", "?")
        dept = row.get("dept", "")
        parts = [f"**{commune}** ({dept})"]

        if intent == "ecoles_ips":
            ips = row.get("ips_moyen")
            pct = row.get("pct_ecoles_favorisees")
            prix = row.get("prix_m2")
            if ips:
                parts.append(f"IPS {ips}")
            if pct:
                parts.append(f"{pct}% écoles favorisées")
            if prix:
                parts.append(f"{int(prix):,} €/m²".replace(",", " "))
        elif intent == "rendement":
            rdt = row.get("rendement_pct")
            loyer = row.get("loyer_m2")
            prix = row.get("prix_m2")
            if rdt:
                parts.append(f"{rdt}% rendement brut")
            if loyer:
                parts.append(f"{loyer} €/m² loyer")
            if prix:
                parts.append(f"{int(prix):,} €/m²".replace(",", " "))
        elif intent == "dpe":
            dpe = row.get("score_dpe")
            pct_dpe = row.get("pct_bon_dpe")
            prix = row.get("prix_m2")
            if dpe:
                parts.append(f"DPE score {dpe}")
            if pct_dpe:
                parts.append(f"{pct_dpe}% bons DPE")
            if prix:
                parts.append(f"{int(prix):,} €/m²".replace(",", " "))
        elif intent == "securite":
            cam = row.get("cambriolages_pour_mille")
            sc = row.get("score_securite")
            prix = row.get("prix_m2")
            if cam is not None:
                parts.append(f"{cam}‰ cambriolages")
            if sc:
                parts.append(f"sécurité {sc}/100")
            if prix:
                parts.append(f"{int(prix):,} €/m²".replace(",", " "))
        else:
            prix = row.get("prix_m2")
            rendement = row.get("rendement_pct")
            score = row.get("score_global") or row.get("score_invest") or row.get("qualite_vie")
            if prix:
                parts.append(f"{int(prix):,} €/m²".replace(",", " "))
            if rendement:
                parts.append(f"rendement {rendement}%")
            if score:
                parts.append(f"score {score}/100")

        lines.append(f"{i}. {' — '.join(parts)}")

    return "\n".join(lines)


# ── Routes ───────────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    db_ok = health_check()
    return jsonify({
        "status": "ok" if db_ok else "degraded",
        "db": db_ok,
        "llm": qwen_manager.get_stats(),
        "cache_size": len(_cache),
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

    # 1. Détection d'intent (hybride MiniLM + regex)
    intent, params = detect_intent(question)
    logger.info(f"🎯 Intent: {intent} | params: {list(params.keys())}")

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
        # SQL construit dynamiquement (multi_criteria, top_prix, etc.)
        custom_sql = params.pop("_sql")
        rows = execute_template(custom_sql, params)
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

    # 3. Génération réponse — on passe rows directement (pas format_for_display)
    if not DISABLE_LLM and qwen_manager.initialized:
        llm_response = qwen_manager.generate_response(
            rows,
            question,
            intent,
            context=context_summary,  # Ticket 3
        )
    else:
        llm_response = None

    # Fallback si LLM absent ou réponse vide
    if not llm_response:
        llm_response = fallback_response(rows, intent, question)

    llm_used = bool(not DISABLE_LLM and qwen_manager.initialized and llm_response and llm_response != fallback_response(rows, intent, question))
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

    intent, params = detect_intent(question)

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
                for chunk in qwen_manager.generate_stream([], question, intent, context=context_summary):
                    yield f"data: {json.dumps({'chunk': chunk})}\n\n"
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
    else:
        template = get_template(intent)
        merged_params = {**template["params"], **params}
        if "cities" in merged_params and isinstance(merged_params["cities"], list):
            merged_params["cities"] = [c.lower() for c in merged_params["cities"]]
        rows = execute_template(template["sql"], merged_params)

    def generate():
        # Envoyer d'abord les metadata (tableau affiché avant les tokens)
        meta = json.dumps({"intent": intent, "nb_results": len(rows), "data": rows[:8]})
        yield f"data: {meta}\n\n"

        # Générer la réponse avec rows directs + context Ticket 3
        if not DISABLE_LLM and qwen_manager.initialized:
            answer = qwen_manager.generate_response(
                rows, question, intent, context=context_summary
            )
        else:
            answer = None

        if not answer:
            answer = fallback_response(rows, intent, question)

        # Streamer mot par mot
        for word in answer.split(" "):
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
