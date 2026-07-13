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

from intent_detector import detect_intent, get_template, TEMPLATES
from sql_executor import execute_template, format_for_display, health_check
from qwen_manager import qwen_manager

app = Flask(__name__)
CORS(app, origins=["*"])

# ── Cache simple en mémoire (questions fréquentes) ───────────────────────────
_cache: dict = {}
CACHE_TTL = int(os.getenv("CACHE_TTL", "600"))  # 10 min

DISABLE_LLM = os.getenv("DISABLE_LLM", "false").lower() == "true"


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
    # Nettoyer le cache si > 200 entrées
    if len(_cache) > 200:
        oldest = sorted(_cache.items(), key=lambda x: x[1]["ts"])[:50]
        for k, _ in oldest:
            del _cache[k]


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
        prix = row.get("prix_m2")
        score = row.get("score_global") or row.get("score_invest") or row.get("qualite_vie")
        rendement = row.get("rendement_pct")

        parts = [f"**{commune}** ({dept})"]
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

    # Cache hit
    cached = get_cached(question)
    if cached:
        logger.info("⚡ Cache hit")
        return jsonify({**cached, "cached": True})

    # 1. Détection d'intent (hybride MiniLM + regex)
    intent, params = detect_intent(question)
    logger.info(f"🎯 Intent: {intent} | params: {list(params.keys())}")

    # 2. Exécution SQL
    if intent == "multi_criteria":
        # SQL construit dynamiquement par build_multi_criteria_sql()
        custom_sql = params.pop("_sql")
        rows = execute_template(custom_sql, params)
    else:
        template = get_template(intent)
        merged_params = {**template["params"], **params}
        if "cities" in merged_params and isinstance(merged_params["cities"], list):
            merged_params["cities"] = [c.lower() for c in merged_params["cities"]]
        rows = execute_template(template["sql"], merged_params)

    logger.info(f"📊 SQL retourné {len(rows)} ligne(s)")

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

    response = {
        "answer": llm_response,
        "intent": intent,
        "nb_results": len(rows),
        "data": rows[:8],
        "latency_ms": round((time.time() - start) * 1000),
        "cached": False,
    }

    set_cached(question, response)
    logger.info(f"✅ Réponse en {response['latency_ms']}ms")
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

    if intent == "multi_criteria":
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


if __name__ == "__main__":
    init_app()
    port = int(os.getenv("PORT", "5001"))
    app.run(host="0.0.0.0", port=port, debug=False)
