"""Mesure de bout en bout sur le service RAG déployé : les fiches juridiques renvoyées
en sources par l'API contiennent-elles la bonne ? Sert à comparer la production avant
et après un déploiement, avec les mêmes 73 questions que benchmark_reranker.py.

Lancement (depuis eval/reranker/) :
    .venv/bin/python mesure_prod.py avant
    .venv/bin/python mesure_prod.py apres
"""
import json
import statistics
import sys
import time
from pathlib import Path

import requests

from benchmark_reranker import charger_questions

DOSSIER = Path(__file__).resolve().parent
URL = "https://homepedia-rag-714876351060.europe-west1.run.app/rag/query"
CORPUS = DOSSIER.parent.parent / "rag"
PAUSE_S = 4          # la génération passe par l'offre gratuite de Gemini, limitée en débit
ESSAIS = 4


def interroger(question):
    """Appelle l'API ; sur une erreur 503 (quota Gemini dépassé), attend puis réessaie."""
    for essai in range(1, ESSAIS + 1):
        reponse = requests.post(URL, json={"question": question}, timeout=300)
        if reponse.status_code != 503 or essai == ESSAIS:
            reponse.raise_for_status()
            return reponse.json()
        time.sleep(20 * essai)


def index_fiches():
    """Associe le début du texte de chaque fiche (renvoyé en source par l'API) à son identifiant."""
    fiches = []
    for nom in ("legal_corpus.json", "methode_corpus.json"):
        fiches += json.loads((CORPUS / nom).read_text(encoding="utf-8"))
    return {f["text"][:120]: f["id"] for f in fiches}


def main(etiquette):
    index = index_fiches()
    lignes = []
    for item in charger_questions():
        debut = time.perf_counter()
        resultat = interroger(item["question"])
        latence = (time.perf_counter() - debut) * 1000
        sources = [s for s in resultat["sources"] if s.get("type") == "legal"]
        ids = [index.get(s["text"][:120], "?") for s in sources]
        lignes.append({**item, "ids": ids, "ok": any(i in item["attendus"] for i in ids[:3]),
                       "latence_ms": latence})
        print(f"{'✓' if lignes[-1]['ok'] else '✗'} {latence:6.0f} ms  {item['question'][:70]}", flush=True)
        time.sleep(PAUSE_S)

    for jeu in ("benchmark", "langage_courant", None):
        sel = [l for l in lignes if jeu is None or l["jeu"] == jeu]
        print(f"{jeu or 'global':<16} rappel@3 {100 * sum(l['ok'] for l in sel) / len(sel):5.1f} %  "
              f"latence médiane {statistics.median(l['latence_ms'] for l in sel):.0f} ms")
    (DOSSIER / f"mesure_prod_{etiquette}.json").write_text(
        json.dumps(lignes, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "mesure")
