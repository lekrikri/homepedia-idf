"""
Moteur de recherche dans la knowledge base immobilière HomePedia.
Matching par triggers (mots-clés) — pas de dépendance externe.
"""

import json
import re
import os
import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

_KB = None
_KB_PATH = os.path.join(os.path.dirname(__file__), "knowledge_base.json")


def _load_kb():
    global _KB
    if _KB is None:
        with open(_KB_PATH, encoding="utf-8") as f:
            _KB = json.load(f)
        logger.info(f"📚 KB chargée: {len(_KB)} entrées")
    return _KB


def _normalize(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[àâä]", "a", text)
    text = re.sub(r"[éèêë]", "e", text)
    text = re.sub(r"[îï]", "i", text)
    text = re.sub(r"[ôö]", "o", text)
    text = re.sub(r"[ùûü]", "u", text)
    text = re.sub(r"[ç]", "c", text)
    text = re.sub(r"[^\w\s]", " ", text)
    return text


# Si la question contient ces mots → probablement une demande de données SQL, pas théorique
# → score minimum 2 requis pour éviter les faux positifs KB
_SQL_DEMAND = re.compile(
    r"\b(communes?|villes?|top|classement|liste|meilleure?s?|trouver|secteurs?|"
    r"investir|acheter|o[uù] |o[uù]$|quelle?s? communes?)\b",
    re.I,
)


def search_kb(question: str, min_score: int = 1) -> Optional[Tuple[str, int]]:
    """
    Cherche la meilleure réponse dans la KB pour une question.

    Retourne (answer, score) si au moins `min_score` trigger(s) matchent.
    Retourne None sinon.

    Si la question contient des mots SQL (communes, top, meilleur…), le seuil
    passe à 2 pour éviter d'intercepter des demandes de données.
    """
    kb = _load_kb()
    q = _normalize(question)

    # Heuristique : question "SQL" nécessite un match plus fort pour activer la KB
    if _SQL_DEMAND.search(q):
        min_score = max(min_score, 2)

    best_score = 0
    best_specificity = 0
    best_answer = None
    best_id = None

    for entry in kb:
        score = 0
        for trigger in entry["triggers"]:
            t = _normalize(trigger)
            if re.search(r"\b" + re.escape(t) + r"\b", q):
                score += 1

        if score > best_score or (score == best_score and score > 0 and len(entry["triggers"]) > best_specificity):
            best_score = score
            best_specificity = len(entry["triggers"])
            best_answer = entry["answer"]
            best_id = entry["id"]

    if best_score >= min_score:
        logger.info(f"📚 KB match: {best_id} (score={best_score})")
        return best_answer, best_score

    return None
