#!/usr/bin/env python3
"""
Benchmark HomePedia Chatbot — tests automatisés sur tous les intents.
Usage :
  python benchmark_chatbot.py                        # → API prod (Cloud Run)
  python benchmark_chatbot.py --url http://localhost:8002   # → local
  python benchmark_chatbot.py --verbose              # → affiche les réponses complètes
  python benchmark_chatbot.py --filter rendement     # → filtre par mot-clé label
"""

import argparse
import json
import re
import sys
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

import requests

# ── Configuration ─────────────────────────────────────────────────────────────

DEFAULT_URL = "https://homepedia-chat-714876351060.europe-west1.run.app"

RESET   = "\033[0m"
GREEN   = "\033[92m"
RED     = "\033[91m"
YELLOW  = "\033[93m"
CYAN    = "\033[96m"
BOLD    = "\033[1m"
DIM     = "\033[2m"

# Plages de valeurs réalistes pour l'IDF (validation RAG anti-hallucination)
PRIX_MIN_IDF = 800    # €/m²  — zones très rurales 77
PRIX_MAX_IDF = 16_000  # €/m²  — Paris 6e
RENDEMENT_MIN = 1.0    # %
RENDEMENT_MAX = 9.0    # %

COMMUNES_IDF_SAMPLE = [
    "versailles", "montreuil", "nanterre", "créteil", "creteil",
    "massy", "palaiseau", "cergy", "saint-denis", "argenteuil",
    "aubervilliers", "drancy", "noisy", "pantin", "ivry", "vitry",
    "clamart", "issy", "levallois", "neuilly", "puteaux", "courbevoie",
    "boulogne", "vincennes", "antony", "fontenay", "choisy", "orly",
    "villejuif", "arcueil", "colombes", "rueil", "suresnes", "montrouge",
    "vanves", "malakoff", "fontenay", "charenton", "alfortville",
    "melun", "meaux", "pontoise", "poissy", "trappes", "guyancourt",
    "meudon", "sèvres", "versailles",
]

# ── Fonctions de vérification ─────────────────────────────────────────────────

def _not_empty(text: str) -> bool:
    return len(text.strip()) > 20

def _has_numbers(text: str) -> bool:
    return bool(re.search(r'\d{3,}', text))

def _mentions_commune(text: str, commune: str) -> bool:
    return commune.lower() in text.lower()

def _no_sql_leak(text: str) -> bool:
    return "SELECT" not in text.upper() and "FROM communes" not in text

def _is_hors_scope(text: str) -> bool:
    return any(w in text.lower() for w in ["île-de-france", "idf", "spécialisé", "périmètre", "uniquement"])

def _has_valid_prix_idf(text: str) -> bool:
    """Prix IDF plausibles : 800-16000 euros/m2 (gère espaces insécables milliers)."""
    t = re.sub(r"[  ]", " ", text)
    raw = re.findall(r"(\d{1,2} \d{3})|(\d{4,5})", t)
    numbers = [int(re.sub(r"[^\d]", "", n)) for grp in raw for n in grp if n]
    return any(PRIX_MIN_IDF <= n <= PRIX_MAX_IDF for n in numbers)

def _has_rendement_realistic(text: str) -> bool:
    """Vérifie que le rendement cité est réaliste (1–9%)."""
    matches = re.findall(r'(\d+[\.,]\d+)\s*%', text)
    if not matches:
        return False
    for m in matches:
        val = float(m.replace(",", "."))
        if RENDEMENT_MIN <= val <= RENDEMENT_MAX:
            return True
    return False

def _mentions_idf_commune(text: str) -> bool:
    """Au moins une commune IDF mentionnée (dept entre parenthèses ou nom connu)."""
    # Cherche un numéro de département IDF entre parenthèses : (75), (77)...(95)
    if re.search(r'\((7[5-9]|9[1-5])\)', text):
        return True
    return any(c in text.lower() for c in COMMUNES_IDF_SAMPLE)

def _no_generic_error(text: str) -> bool:
    """Vérifie qu'il n'y a pas de message d'erreur générique."""
    bad = ["aucune donnée", "erreur", "indisponible", "pas de données", "données: []"]
    return not any(b in text.lower() for b in bad)

def _min_length(n: int) -> Callable[[str], bool]:
    def _check(text: str) -> bool:
        return len(text.strip()) >= n
    _check.__name__ = f"min_length_{n}"
    return _check

def _mentions_multiple_communes(text: str, n: int = 3) -> bool:
    """Vérifie que plusieurs communes IDF sont mentionnées (pour les top_*)."""
    text_low = text.lower()
    found = sum(1 for c in COMMUNES_IDF_SAMPLE if c in text_low)
    return found >= n

# ── Cas de test ───────────────────────────────────────────────────────────────
# Format :
#   question           : texte envoyé au chatbot
#   expected_intent    : intent attendu (None = pas vérifié)
#   min_results        : nb minimum de lignes SQL attendues (0 si pas de SQL)
#   min_confidence     : score de confiance minimum attendu (0 = pas vérifié)
#   checks             : liste de fonctions (réponse_str → bool)
#   label              : description courte pour le rapport

TESTS: List[Dict[str, Any]] = [

    # ── Salutations ────────────────────────────────────────────────────────────
    {
        "label": "Salutation simple",
        "question": "bonjour",
        "expected_intent": "salutation",
        "min_results": 0,
        "min_confidence": 0,
        "checks": [_not_empty, _no_sql_leak, _no_generic_error],
    },
    {
        "label": "Salutation + aide",
        "question": "salut, tu peux m'aider ?",
        "expected_intent": "salutation",
        "min_results": 0,
        "min_confidence": 0,
        "checks": [_not_empty, _no_sql_leak],
    },

    # ── Hors scope ─────────────────────────────────────────────────────────────
    {
        "label": "Hors scope — ville hors IDF (Lyon)",
        "question": "donne moi les prix à Lyon stp",
        "expected_intent": "hors_scope",
        "min_results": 0,
        "min_confidence": 80,
        "checks": [_is_hors_scope, _no_sql_leak],
    },
    {
        "label": "Hors scope — météo",
        "question": "quel temps fait-il aujourd'hui ?",
        "expected_intent": "hors_scope",
        "min_results": 0,
        "min_confidence": 80,
        "checks": [_is_hors_scope],
    },
    {
        "label": "Hors scope — football",
        "question": "qui a gagné le match ce soir ?",
        "expected_intent": "hors_scope",
        "min_results": 0,
        "min_confidence": 80,
        "checks": [_is_hors_scope],
    },
    {
        "label": "Hors scope — immobilier Bordeaux",
        "question": "quels sont les prix immobiliers à Bordeaux ?",
        "expected_intent": "hors_scope",
        "min_results": 0,
        "min_confidence": 80,
        "checks": [_is_hors_scope, _no_sql_leak],
    },

    # ── Questions encyclopédiques (general) ────────────────────────────────────
    {
        "label": "General — c'est quoi le DPE",
        "question": "c'est quoi le DPE ?",
        "expected_intent": "general",
        "min_results": 0,
        "min_confidence": 50,
        "checks": [_not_empty, _no_sql_leak, _no_generic_error],
    },
    {
        "label": "General — comment calculer le rendement",
        "question": "comment calculer le rendement locatif brut ?",
        "expected_intent": "general",
        "min_results": 0,
        "min_confidence": 50,
        "checks": [_not_empty, _no_sql_leak, _no_generic_error],
    },
    {
        "label": "General — c'est quoi l'IPS",
        "question": "qu'est-ce que l'IPS ?",
        "expected_intent": "general",
        "min_results": 0,
        "min_confidence": 50,
        "checks": [_not_empty, _no_sql_leak],
    },

    # ── Prix commune ───────────────────────────────────────────────────────────
    {
        "label": "Prix — Montreuil",
        "question": "quel est le prix au m2 à Montreuil ?",
        "expected_intent": "commune_detail",
        "min_results": 1,
        "min_confidence": 60,
        "checks": [_has_numbers, _has_valid_prix_idf, lambda t: _mentions_commune(t, "Montreuil"), _no_sql_leak],
    },
    {
        "label": "Prix — Versailles (décontracté)",
        "question": "prix immo versailles stp",
        "expected_intent": "commune_detail",
        "min_results": 1,
        "min_confidence": 60,
        "checks": [_has_numbers, _has_valid_prix_idf, _no_sql_leak],
    },
    {
        "label": "Prix — Aubervilliers",
        "question": "salut donne moi les prix immo sur aubervilliers stp",
        "expected_intent": "commune_detail",
        "min_results": 1,
        "min_confidence": 60,
        "checks": [_has_numbers, _has_valid_prix_idf, lambda t: _mentions_commune(t, "Aubervilliers"), _no_sql_leak],
    },
    {
        "label": "Prix — Palaiseau",
        "question": "c'est combien le m2 à Palaiseau ?",
        "expected_intent": "commune_detail",
        "min_results": 1,
        "min_confidence": 60,
        "checks": [_has_numbers, _has_valid_prix_idf, _no_sql_leak],
    },

    # ── Classements ────────────────────────────────────────────────────────────
    {
        "label": "Top investissement",
        "question": "quelles sont les meilleures communes pour investir en IDF ?",
        "expected_intent": "top_investissement",
        "min_results": 3,
        "min_confidence": 60,
        "checks": [_has_numbers, _not_empty, _no_sql_leak, _mentions_idf_commune],
    },
    {
        "label": "Top qualité de vie",
        "question": "où vivre agréablement en banlieue parisienne ?",
        "expected_intent": "top_qualite_vie",
        "min_results": 3,
        "min_confidence": 50,
        "checks": [_not_empty, _no_sql_leak, _mentions_idf_commune],
    },
    {
        "label": "Top prix — moins chers",
        "question": "quelles sont les 5 communes les moins chères d'IDF ?",
        "expected_intent": None,
        "min_results": 3,
        "min_confidence": 60,
        "checks": [_has_numbers, _has_valid_prix_idf, _no_sql_leak, _mentions_idf_commune],
    },
    {
        "label": "Top prix — plus chers",
        "question": "top 10 des villes les plus chères en IDF",
        "expected_intent": "top_prix",
        "min_results": 3,
        "min_confidence": 60,
        "checks": [_has_numbers, _has_valid_prix_idf, _no_sql_leak, _mentions_idf_commune],
    },
    {
        "label": "Rendement locatif",
        "question": "où investir avec le meilleur rendement locatif ?",
        "expected_intent": "rendement",
        "min_results": 3,
        "min_confidence": 60,
        "checks": [_has_numbers, _has_rendement_realistic, _no_sql_leak, _mentions_idf_commune],
    },
    {
        "label": "Rendement — cash flow",
        "question": "communes avec le meilleur rendement locatif brut IDF",
        "expected_intent": "rendement",
        "min_results": 1,
        "min_confidence": 50,
        "checks": [_has_numbers, _no_sql_leak],
    },
    {
        "label": "Sécurité",
        "question": "communes les plus sûres d'IDF",
        "expected_intent": "securite",
        "min_results": 3,
        "min_confidence": 60,
        "checks": [_not_empty, _no_sql_leak, _mentions_idf_commune],
    },
    {
        "label": "DPE / énergie",
        "question": "communes avec le meilleur DPE en Île-de-France",
        "expected_intent": "dpe",
        "min_results": 3,
        "min_confidence": 60,
        "checks": [_not_empty, _no_sql_leak, _mentions_idf_commune],
    },
    {
        "label": "Écoles / IPS",
        "question": "communes avec les meilleures écoles pour mes enfants",
        "expected_intent": "ecoles_ips",
        "min_results": 3,
        "min_confidence": 60,
        "checks": [_has_numbers, _no_sql_leak, _mentions_idf_commune],
    },

    # ── Comparaison ────────────────────────────────────────────────────────────
    {
        "label": "Comparaison — Massy vs Palaiseau",
        "question": "compare Massy et Palaiseau",
        "expected_intent": "comparaison",
        "min_results": 2,
        "min_confidence": 60,
        "checks": [_has_numbers, _has_valid_prix_idf, _no_sql_leak],
    },
    {
        "label": "Comparaison — Créteil ou Vitry",
        "question": "Créteil ou Vitry, laquelle est moins chère ?",
        "expected_intent": "comparaison",
        "min_results": 2,
        "min_confidence": 60,
        "checks": [_has_numbers, _has_valid_prix_idf, _no_sql_leak],
    },
    {
        "label": "Comparaison — Neuilly vs Aubervilliers",
        "question": "compare les prix entre Neuilly et Aubervilliers",
        "expected_intent": "comparaison",
        "min_results": 2,
        "min_confidence": 60,
        "checks": [_has_numbers, _has_valid_prix_idf, _no_sql_leak],
    },

    # ── Département ────────────────────────────────────────────────────────────
    {
        "label": "Département — Val-de-Marne",
        "question": "communes abordables dans le Val-de-Marne",
        "expected_intent": "departement",
        "min_results": 3,
        "min_confidence": 50,
        "checks": [_has_numbers, _no_sql_leak],
    },
    {
        "label": "Département — 93",
        "question": "meilleures communes du département 93",
        "expected_intent": "departement",
        "min_results": 1,
        "min_confidence": 50,
        "checks": [_not_empty, _no_sql_leak],
    },
    {
        "label": "Département — Essonne (91)",
        "question": "investir en Essonne, quelles communes ?",
        "expected_intent": "departement",
        "min_results": 1,
        "min_confidence": 50,
        "checks": [_not_empty, _no_sql_leak],
    },

    # ── Prix max ───────────────────────────────────────────────────────────────
    {
        "label": "Prix max — budget 4000€",
        "question": "villes avec prix sous 4000 euros le m2",
        "expected_intent": "prix_max",
        "min_results": 3,
        "min_confidence": 50,
        "checks": [_has_numbers, _has_valid_prix_idf, _no_sql_leak],
    },
    {
        "label": "Prix max — budget 3500€",
        "question": "je cherche à acheter avec un budget de 3500€ le m2 maximum",
        "expected_intent": "prix_max",
        "min_results": 1,
        "min_confidence": 50,
        "checks": [_has_numbers, _no_sql_leak],
    },

    # ── Multi-critères ─────────────────────────────────────────────────────────
    {
        "label": "Multi-critères — sécurité + DPE",
        "question": "commune sûre avec bon DPE",
        "expected_intent": "multi_criteria",
        "min_results": 1,
        "min_confidence": 50,
        "checks": [_not_empty, _no_sql_leak, _no_generic_error],
    },
    {
        "label": "Multi-critères — budget + famille",
        "question": "moins de 5000€ le m2 avec de bonnes écoles",
        "expected_intent": "multi_criteria",
        "min_results": 1,
        "min_confidence": 50,
        "checks": [_has_numbers, _has_valid_prix_idf, _no_sql_leak],
    },
    {
        "label": "Multi-critères — prix + sécurité",
        "question": "quartier pas cher et tranquille en IDF",
        "expected_intent": "multi_criteria",
        "min_results": 1,
        "min_confidence": 50,
        "checks": [_not_empty, _no_sql_leak],
    },
]

# ── Runner ────────────────────────────────────────────────────────────────────

def run_test(test: Dict, api_url: str, verbose: bool) -> Tuple[bool, Dict]:
    url = f"{api_url}/chat"
    payload = {"question": test["question"], "history": []}
    t0 = time.time()
    try:
        r = requests.post(url, json=payload, timeout=45)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        return False, {
            "error": str(e),
            "latency_ms": round((time.time() - t0) * 1000),
            "failures": [f"exception: {e}"],
            "intent": "ERROR",
            "nb_results": 0,
            "confidence": 0,
            "answer": "",
        }

    latency = round((time.time() - t0) * 1000)
    answer = data.get("answer", "")
    intent = data.get("intent", "")
    nb_results = data.get("nb_results", 0)
    confidence = data.get("confidence_score")  # None si champ absent
    conf_display = confidence if confidence is not None else "-"

    failures = []

    # Vérif intent
    if test.get("expected_intent") and intent != test["expected_intent"]:
        failures.append(f"intent={intent!r} (attendu {test['expected_intent']!r})")

    # Vérif nb résultats
    if nb_results < test.get("min_results", 0):
        failures.append(f"nb_results={nb_results} < {test['min_results']}")

    # Vérif score de confiance
    min_conf = test.get("min_confidence", 0)
    if min_conf > 0 and confidence is not None and confidence < min_conf:
        failures.append(f"confidence={confidence}% < {min_conf}%")

    # Vérif checks qualité réponse
    for check_fn in test.get("checks", []):
        if not check_fn(answer):
            failures.append(f"check `{check_fn.__name__}` échoué")

    passed = len(failures) == 0
    result = {
        "intent": intent,
        "nb_results": nb_results,
        "confidence": confidence,  # peut être None
        "latency_ms": latency,
        "answer": answer[:300] if not verbose else answer,
        "failures": failures,
    }
    return passed, result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--filter", default="", help="Filtrer par mot-clé dans le label")
    parser.add_argument("--no-confidence", action="store_true", help="Ignorer les checks de confiance")
    args = parser.parse_args()

    tests = TESTS
    if args.filter:
        tests = [t for t in TESTS if args.filter.lower() in t["label"].lower()]

    # Désactiver les checks confidence si demandé
    if args.no_confidence:
        for t in tests:
            t["min_confidence"] = 0

    print(f"\n{BOLD}HomePedia Chatbot Benchmark{RESET} — {len(tests)} tests")
    print(f"{DIM}API : {args.url}{RESET}\n")
    print(f"{'#':<3} {'Label':<44} {'Intent':<18} {'Res':>3} {'Conf':>4} {'ms':>5}  {'Statut'}")
    print("─" * 105)

    passed_total = 0
    latencies = []
    all_results = []

    # Statistiques par catégorie
    intent_stats: Dict[str, Dict] = {}

    for i, test in enumerate(tests, 1):
        passed, result = run_test(test, args.url, args.verbose)
        latencies.append(result["latency_ms"])
        if passed:
            passed_total += 1

        # Stats par intent attendu
        exp = test.get("expected_intent", "unknown")
        if exp not in intent_stats:
            intent_stats[exp] = {"pass": 0, "total": 0}
        intent_stats[exp]["total"] += 1
        if passed:
            intent_stats[exp]["pass"] += 1

        status = f"{GREEN}✅ PASS{RESET}" if passed else f"{RED}❌ FAIL{RESET}"
        intent_disp = result.get("intent", "?")[:17]
        nb = result.get("nb_results", 0)
        _raw_conf = result.get("confidence")
        conf = _raw_conf if _raw_conf is not None else "-"
        ms = result.get("latency_ms", 0)

        conf_str = f"{conf:>4}%" if isinstance(conf, int) else f"  {conf:>2} "
        print(f"{i:<3} {test['label']:<44} {intent_disp:<18} {nb:>3} {conf_str} {ms:>5}ms  {status}")

        if not passed:
            for f in result["failures"]:
                print(f"    {YELLOW}→ {f}{RESET}")

        if args.verbose and result.get("answer"):
            print(f"    {DIM}{result['answer'][:400]}{RESET}\n")

        all_results.append({"test": test["label"], "passed": passed, **result})

    # ── Résumé global ─────────────────────────────────────────────────────────
    print("─" * 105)
    pct = round(passed_total / len(tests) * 100) if tests else 0
    color = GREEN if pct >= 80 else YELLOW if pct >= 60 else RED
    avg_lat = round(sum(latencies) / len(latencies)) if latencies else 0
    sorted_lats = sorted(latencies)
    p95_lat = sorted_lats[int(len(sorted_lats) * 0.95)] if sorted_lats else 0
    p99_lat = sorted_lats[int(len(sorted_lats) * 0.99)] if sorted_lats else 0

    print(f"\n{BOLD}Score global : {color}{passed_total}/{len(tests)} ({pct}%){RESET}")
    print(f"Latence  avg={avg_lat}ms | p95={p95_lat}ms | p99={p99_lat}ms")

    # Détail par catégorie
    print(f"\n{BOLD}Détail par intent :{RESET}")
    for intent_name, st in sorted(intent_stats.items(), key=lambda x: x[0] or "_"):
        p = st["pass"]
        t = st["total"]
        pct_i = round(p / t * 100) if t else 0
        c = GREEN if pct_i == 100 else YELLOW if pct_i >= 50 else RED
        bar = "█" * p + "░" * (t - p)
        print(f"  {(intent_name or "None"):<20} {c}{p}/{t} ({pct_i:>3}%) {bar}{RESET}")

    # Sauvegarder le rapport JSON
    report = {
        "date": time.strftime("%Y-%m-%d %H:%M:%S"),
        "api_url": args.url,
        "score": f"{passed_total}/{len(tests)}",
        "pct": pct,
        "avg_latency_ms": avg_lat,
        "p95_latency_ms": p95_lat,
        "p99_latency_ms": p99_lat,
        "by_intent": intent_stats,
        "results": all_results,
    }
    with open("benchmark_chatbot_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\nRapport → {CYAN}benchmark_chatbot_report.json{RESET}\n")

    sys.exit(0 if pct >= 70 else 1)


if __name__ == "__main__":
    main()
