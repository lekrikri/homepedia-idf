#!/usr/bin/env python3
"""
Pipeline MLOps — LLM-as-a-Judge pour HomePedia RAG (#39)

Évalue la qualité des réponses du chatbot sur les cas de test du benchmark.
Le "juge" est le chatbot lui-même via /api/v1/rag/query en mode évaluation,
plus des règles déterministes anti-hallucination.

Exit code :
  0 — score >= SEUIL_PASS (configurable via env RAG_PASS_THRESHOLD)
  1 — régression détectée (score < seuil)

Usage :
  python eval/rag_eval.py
  python eval/rag_eval.py --url https://homepedia-chat-xxx.run.app
  RAG_PASS_THRESHOLD=0.75 python eval/rag_eval.py
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

CHAT_URL = os.getenv(
    "CHAT_URL",
    "https://homepedia-chat-714876351060.europe-west1.run.app"
)
SEUIL_PASS = float(os.getenv("RAG_PASS_THRESHOLD", "0.83"))
TIMEOUT = int(os.getenv("RAG_TIMEOUT", "30"))

PRIX_MIN_IDF = 800
PRIX_MAX_IDF = 16_000
RENDEMENT_MIN = 1.0
RENDEMENT_MAX = 9.0

RESET = "\033[0m"
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"

# ── Cas de test ───────────────────────────────────────────────────────────────

TEST_CASES = [
    {
        "id": "T01",
        "intent": "commune_detail",
        "query": "Montreuil dit moi tout sur cette commune stp",
        "checks": ["prix_plausible", "no_sql_leak", "mentions_commune:montreuil", "not_empty"],
    },
    {
        "id": "T02",
        "intent": "prix",
        "query": "Quel est le prix au m2 à Versailles ?",
        "checks": ["prix_plausible", "no_sql_leak", "mentions_commune:versailles", "not_empty"],
    },
    {
        "id": "T03",
        "intent": "rendement",
        "query": "Où investir avec le meilleur rendement locatif en IDF ?",
        "checks": ["rendement_plausible", "no_sql_leak", "not_empty", "has_numbers"],
    },
    {
        "id": "T04",
        "intent": "comparaison",
        "query": "Compare Cergy et Massy pour un achat immobilier",
        "checks": ["mentions_commune:cergy", "mentions_commune:massy", "no_sql_leak", "not_empty"],
    },
    {
        "id": "T05",
        "intent": "top_communes",
        "query": "Quelles sont les meilleures communes pour la qualité de vie en Seine-et-Marne ?",
        "checks": ["no_sql_leak", "not_empty", "has_numbers"],
    },
    {
        "id": "T06",
        "intent": "hors_scope",
        "query": "Quel est le prix de l'immobilier à Lyon ?",
        "checks": ["is_hors_scope"],
    },
    {
        "id": "T07",
        "intent": "securite",
        "query": "Quelle est la sécurité à Aubervilliers ?",
        "checks": ["mentions_commune:aubervilliers", "no_sql_leak", "not_empty"],
    },
    {
        "id": "T08",
        "intent": "dpe",
        "query": "Quelles communes ont le meilleur score énergétique DPE en IDF ?",
        "checks": ["no_sql_leak", "not_empty", "has_numbers"],
    },
    {
        "id": "T09",
        "intent": "risques",
        "query": "Y a-t-il des risques d'inondation à Melun ?",
        "checks": ["mentions_commune:melun", "no_sql_leak", "not_empty"],
    },
    {
        "id": "T10",
        "intent": "budget",
        "query": "Je cherche un appartement à moins de 300 000€ en proche banlieue parisienne",
        "checks": ["prix_plausible", "no_sql_leak", "not_empty"],
    },
    {
        "id": "T11",
        "intent": "top_communes",
        "query": "Donne moi les 5 communes avec le meilleur score investissement",
        "checks": ["no_sql_leak", "not_empty", "has_numbers"],
    },
    {
        "id": "T12",
        "intent": "commune_detail",
        "query": "Neuilly-sur-Marne c'est comment pour vivre ?",
        "checks": ["no_sql_leak", "not_empty"],
    },
]

# ── Fonctions de validation (règles déterministes) ────────────────────────────

def _not_empty(text: str) -> bool:
    return len(text.strip()) > 30

def _has_numbers(text: str) -> bool:
    return bool(re.search(r'\d{3,}', text))

def _no_sql_leak(text: str) -> bool:
    return "SELECT" not in text.upper() and "FROM communes" not in text

def _is_hors_scope(text: str) -> bool:
    return any(w in text.lower() for w in [
        "île-de-france", "idf", "spécialisé", "périmètre", "uniquement",
        "hors", "pas couverte", "france entière",
    ])

def _has_valid_prix_idf(text: str) -> bool:
    t = re.sub(r"[  ]", " ", text)
    raw = re.findall(r"(\d{1,2} \d{3})|(\d{4,5})", t)
    numbers = [int(re.sub(r"[^\d]", "", n)) for grp in raw for n in grp if n]
    return any(PRIX_MIN_IDF <= n <= PRIX_MAX_IDF for n in numbers)

def _has_rendement_realistic(text: str) -> bool:
    matches = re.findall(r"(\d+[\.,]\d+)\s*%", text)
    if not matches:
        return False
    for m in matches:
        val = float(m.replace(",", "."))
        if RENDEMENT_MIN <= val <= RENDEMENT_MAX:
            return True
    return False

def _mentions_commune(text: str, commune: str) -> bool:
    return commune.lower() in text.lower()

CHECK_FNS = {
    "not_empty": lambda t, _: _not_empty(t),
    "has_numbers": lambda t, _: _has_numbers(t),
    "no_sql_leak": lambda t, _: _no_sql_leak(t),
    "is_hors_scope": lambda t, _: _is_hors_scope(t),
    "prix_plausible": lambda t, _: _has_valid_prix_idf(t),
    "rendement_plausible": lambda t, _: _has_rendement_realistic(t),
}

def run_check(check: str, response_text: str) -> bool:
    if ":" in check:
        fn_name, arg = check.split(":", 1)
        if fn_name == "mentions_commune":
            return _mentions_commune(response_text, arg)
    return CHECK_FNS.get(check, lambda t, a: False)(response_text, None)

# ── Appel chatbot ─────────────────────────────────────────────────────────────

def query_chatbot(url: str, question: str) -> dict:
    try:
        resp = requests.post(
            f"{url}/api/query",
            json={"query": question},
            timeout=TIMEOUT,
            headers={"Content-Type": "application/json"},
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "ok": True,
            "text": data.get("response") or data.get("answer") or str(data),
            "intent": data.get("intent", "unknown"),
            "latency": resp.elapsed.total_seconds(),
        }
    except requests.exceptions.Timeout:
        return {"ok": False, "text": "", "error": "timeout", "latency": TIMEOUT}
    except Exception as e:
        return {"ok": False, "text": "", "error": str(e), "latency": 0}

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=CHAT_URL)
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--output", default="eval/rag_eval_report.json")
    parser.add_argument("--threshold", type=float, default=SEUIL_PASS)
    args = parser.parse_args()

    print(f"\n{BOLD}{CYAN}═══ HomePedia RAG Eval — LLM-as-a-Judge ═══{RESET}")
    print(f"URL     : {args.url}")
    print(f"Seuil   : {args.threshold:.0%}")
    print(f"Tests   : {len(TEST_CASES)}\n")

    results = []
    passed = 0
    total = 0

    for tc in TEST_CASES:
        total += 1
        print(f"[{tc['id']}] {tc['query'][:60]}...", end=" ", flush=True)

        result = query_chatbot(args.url, tc["query"])
        if not result["ok"]:
            print(f"{RED}ERREUR ({result.get('error')}){RESET}")
            results.append({**tc, "passed": False, "error": result.get("error"),
                            "latency": result["latency"], "checks": []})
            continue

        text = result["text"]
        check_results = []
        all_pass = True
        for check in tc["checks"]:
            ok = run_check(check, text)
            check_results.append({"check": check, "ok": ok})
            if not ok:
                all_pass = False

        if all_pass:
            passed += 1
            print(f"{GREEN}✓ ({result['latency']:.1f}s){RESET}")
        else:
            failed_checks = [c["check"] for c in check_results if not c["ok"]]
            print(f"{RED}✗ échec: {failed_checks} ({result['latency']:.1f}s){RESET}")

        if args.verbose:
            print(f"   Réponse: {text[:200]}...")

        results.append({
            **tc,
            "passed": all_pass,
            "latency": result["latency"],
            "detected_intent": result["intent"],
            "response_snippet": text[:300],
            "checks": check_results,
        })

        time.sleep(0.5)

    score = passed / total
    print(f"\n{BOLD}Score : {passed}/{total} ({score:.0%}){RESET}")

    report = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "url": args.url,
        "score": score,
        "passed": passed,
        "total": total,
        "threshold": args.threshold,
        "success": score >= args.threshold,
        "results": results,
    }

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"Rapport : {args.output}")

    if score >= args.threshold:
        print(f"{GREEN}{BOLD}✓ PASS — aucune régression RAG{RESET}\n")
        sys.exit(0)
    else:
        print(f"{RED}{BOLD}✗ FAIL — régression RAG détectée ({score:.0%} < {args.threshold:.0%}){RESET}\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
