#!/usr/bin/env python3
"""
Détecteur d'intent + SQL templates pour HomePedia Chat
Pas de Text-to-SQL avec un petit modèle → SQL templates prédéfinis activés par regex/keywords
"""

import re
from typing import Dict, Tuple, Any

# ── SQL Templates ────────────────────────────────────────────────────────────
# Chaque template a : sql, params par défaut, extracteurs regex pour les params

TEMPLATES = {

    "top_investissement": {
        "sql": """
            SELECT city AS commune, TRIM(code_departement) AS dept,
                   ROUND(prix_median_m2::numeric, 0) AS prix_m2,
                   ROUND(rendement_locatif_brut::numeric, 2) AS rendement_pct,
                   ROUND(score_investissement::numeric, 1) AS score_invest
            FROM communes_agregat
            WHERE rendement_locatif_brut IS NOT NULL
              AND prix_median_m2 IS NOT NULL
            ORDER BY score_investissement DESC NULLS LAST
            LIMIT %(limit)s
        """,
        "params": {"limit": 5},
        "response_hint": "top communes pour investissement locatif",
    },

    "top_qualite_vie": {
        "sql": """
            SELECT city AS commune, TRIM(code_departement) AS dept,
                   ROUND(prix_median_m2::numeric, 0) AS prix_m2,
                   ROUND(score_qualite_vie::numeric, 1) AS qualite_vie,
                   ROUND(ips_moyen::numeric, 1) AS ips_ecoles,
                   ROUND(taux_cambriolages::numeric, 2) AS cambriolages_pour_mille
            FROM communes_agregat
            WHERE score_qualite_vie IS NOT NULL
            ORDER BY score_qualite_vie DESC NULLS LAST
            LIMIT %(limit)s
        """,
        "params": {"limit": 5},
        "response_hint": "meilleures communes qualité de vie",
    },

    "prix_max": {
        "sql": """
            SELECT city AS commune, TRIM(code_departement) AS dept,
                   ROUND(prix_median_m2::numeric, 0) AS prix_m2,
                   ROUND(score_global::numeric, 1) AS score_global,
                   ROUND(rendement_locatif_brut::numeric, 2) AS rendement_pct
            FROM communes_agregat
            WHERE prix_median_m2 <= %(max_price)s
              AND prix_median_m2 IS NOT NULL
            ORDER BY score_global DESC NULLS LAST
            LIMIT %(limit)s
        """,
        "params": {"max_price": 5000, "limit": 6},
        "response_hint": "communes avec prix au m² inférieur au budget",
    },

    "comparaison": {
        "sql": """
            SELECT city AS commune, TRIM(code_departement) AS dept,
                   ROUND(prix_median_m2::numeric, 0) AS prix_m2,
                   ROUND(score_qualite_vie::numeric, 1) AS qualite_vie,
                   ROUND(score_investissement::numeric, 1) AS investissement,
                   ROUND(ips_moyen::numeric, 1) AS ips_ecoles,
                   ROUND(taux_cambriolages::numeric, 2) AS cambriolages_pour_mille,
                   ROUND(score_dpe_moyen::numeric, 2) AS dpe_score,
                   ROUND(rendement_locatif_brut::numeric, 2) AS rendement_pct
            FROM communes_agregat
            WHERE LOWER(city) = ANY(%(cities)s)
        """,
        "params": {"cities": []},
        "response_hint": "comparaison entre communes",
    },

    "departement": {
        "sql": """
            SELECT city AS commune,
                   ROUND(prix_median_m2::numeric, 0) AS prix_m2,
                   ROUND(score_global::numeric, 1) AS score_global,
                   ROUND(rendement_locatif_brut::numeric, 2) AS rendement_pct,
                   ROUND(score_qualite_vie::numeric, 1) AS qualite_vie
            FROM communes_agregat
            WHERE TRIM(code_departement) = %(dept)s
              AND prix_median_m2 IS NOT NULL
            ORDER BY score_global DESC NULLS LAST
            LIMIT %(limit)s
        """,
        "params": {"dept": "75", "limit": 5},
        "response_hint": "meilleures communes d'un département",
    },

    "dpe": {
        "sql": """
            SELECT city AS commune, TRIM(code_departement) AS dept,
                   ROUND(prix_median_m2::numeric, 0) AS prix_m2,
                   ROUND(score_dpe_moyen::numeric, 2) AS score_dpe,
                   ROUND(pct_dpe_bon::numeric * 100, 1) AS pct_bon_dpe
            FROM communes_agregat
            WHERE score_dpe_moyen IS NOT NULL
            ORDER BY score_dpe_moyen ASC
            LIMIT %(limit)s
        """,
        "params": {"limit": 6},
        "response_hint": "communes avec meilleure performance énergétique (DPE)",
    },

    "securite": {
        "sql": """
            SELECT city AS commune, TRIM(code_departement) AS dept,
                   ROUND(prix_median_m2::numeric, 0) AS prix_m2,
                   ROUND(taux_cambriolages::numeric, 3) AS cambriolages_pour_mille,
                   ROUND(score_securite::numeric, 1) AS score_securite
            FROM communes_agregat
            WHERE taux_cambriolages IS NOT NULL
            ORDER BY taux_cambriolages ASC
            LIMIT %(limit)s
        """,
        "params": {"limit": 6},
        "response_hint": "communes les plus sûres (faible taux de cambriolages)",
    },

    "rendement": {
        "sql": """
            SELECT city AS commune, TRIM(code_departement) AS dept,
                   ROUND(prix_median_m2::numeric, 0) AS prix_m2,
                   ROUND(loyer_median_m2::numeric, 1) AS loyer_m2,
                   ROUND(rendement_locatif_brut::numeric, 2) AS rendement_pct
            FROM communes_agregat
            WHERE rendement_locatif_brut IS NOT NULL
              AND loyer_median_m2 IS NOT NULL
            ORDER BY rendement_locatif_brut DESC
            LIMIT %(limit)s
        """,
        "params": {"limit": 6},
        "response_hint": "communes avec meilleur rendement locatif brut",
    },

    "commune_detail": {
        "sql": """
            SELECT city AS commune, TRIM(code_departement) AS dept,
                   ROUND(prix_median_m2::numeric, 0) AS prix_m2,
                   nb_transactions,
                   ROUND(score_global::numeric, 1) AS score_global,
                   ROUND(score_qualite_vie::numeric, 1) AS qualite_vie,
                   ROUND(score_investissement::numeric, 1) AS investissement,
                   ROUND(rendement_locatif_brut::numeric, 2) AS rendement_pct,
                   ROUND(loyer_median_m2::numeric, 1) AS loyer_m2,
                   ROUND(score_dpe_moyen::numeric, 2) AS dpe_score,
                   ROUND(ips_moyen::numeric, 1) AS ips_ecoles,
                   ROUND(taux_cambriolages::numeric, 3) AS cambriolages_pour_mille
            FROM communes_agregat
            WHERE LOWER(city) = LOWER(%(city)s)
            LIMIT 1
        """,
        "params": {"city": ""},
        "response_hint": "fiche détaillée d'une commune",
    },

    "top_prix": {
        "sql": """
            SELECT city AS commune, TRIM(code_departement) AS dept,
                   ROUND(prix_median_m2::numeric, 0) AS prix_m2,
                   nb_transactions
            FROM communes_agregat
            WHERE prix_median_m2 IS NOT NULL
            ORDER BY prix_median_m2 %(order)s
            LIMIT %(limit)s
        """,
        "params": {"order": "DESC", "limit": 5},
        "response_hint": "communes classées par prix au m²",
    },

    "ecoles_ips": {
        "sql": """
            SELECT city AS commune, TRIM(code_departement) AS dept,
                   ROUND(prix_median_m2::numeric, 0) AS prix_m2,
                   ROUND(ips_moyen::numeric, 1) AS ips_moyen,
                   ROUND(pct_ecoles_favorisees::numeric, 1) AS pct_ecoles_favorisees
            FROM communes_agregat
            WHERE ips_moyen IS NOT NULL
            ORDER BY ips_moyen DESC
            LIMIT %(limit)s
        """,
        "params": {"limit": 6},
        "response_hint": "communes avec meilleures écoles (IPS élevé)",
    },
}

# ── Patterns d'intent ────────────────────────────────────────────────────────

INTENT_PATTERNS = [
    # Comparaison explicite entre communes
    ("comparaison", re.compile(
        r"compar|versus|vs\.?|diff[eé]rence|entre .+ et .+|.+ ou .+",
        re.I
    )),
    # Détail d'une commune spécifique
    ("commune_detail", re.compile(
        r"(qu'est[- ]ce que|parle[- ]moi de|fiche|d[eé]tail|tout sur|"
        r"inform.+ sur|c'est comment|comment est|portrait de)\s+\w+",
        re.I
    )),
    # Rendement locatif
    ("rendement", re.compile(
        r"rendement|locatif|loyer|rentab|rapport locatif",
        re.I
    )),
    # Prix max / budget
    ("prix_max", re.compile(
        r"moins de \d|moins cher|budget|pas cher|abordable|accessible|"
        r"€/m²|euros?/m|inférieur",
        re.I
    )),
    # Département
    ("departement", re.compile(
        r"\b(75|77|78|91|92|93|94|95)\b|paris|seine.?et.?marne|yvelines|"
        r"essonne|hauts.?de.?seine|seine.?saint.?denis|val.?de.?marne|"
        r"val.?d.?oise",
        re.I
    )),
    # DPE / énergie
    ("dpe", re.compile(
        r"dpe|[eé]nergie|[eé]cologique|[eé]co|passoire|thermique|consommation",
        re.I
    )),
    # Sécurité
    ("securite", re.compile(
        r"s[eé]curit|cambriolage|crime|d[eé]linquance|s[uû]r|tranquille",
        re.I
    )),
    # Écoles / familles
    ("ecoles_ips", re.compile(
        r"[eé]cole|famille|enfant|ips|[eé]ducation|scolaire|primaire|coll[eè]ge",
        re.I
    )),
    # Investissement
    ("top_investissement", re.compile(
        r"investir|investissement|investisseur|placer|placement|acheter pour louer",
        re.I
    )),
    # Prix les plus chers / moins chers
    ("top_prix", re.compile(
        r"plus cher|plus [eé]lev[eé]|le moins cher|les moins cher|top prix|"
        r"classement prix|rang.*prix|cher.*idf|idf.*cher",
        re.I
    )),
    # Qualité de vie (fallback)
    ("top_qualite_vie", re.compile(
        r"qualit[eé] de vie|vivre|habiter|meilleur endroit|o[uù] vivre|"
        r"recommand|bien vivre|agr[eé]able",
        re.I
    )),
]

# Communes connues pour la détection dans la question
KNOWN_COMMUNES = [
    "paris", "versailles", "vincennes", "montreuil", "nanterre", "boulogne",
    "saint-denis", "saint denis", "argenteuil", "créteil", "creteil",
    "evry", "évry", "massy", "palaiseau", "antony", "châtenay", "chatou",
    "pontoise", "cergy", "poissy", "saint-germain", "melun", "fontainebleau",
    "meaux", "chelles", "noisy", "pantin", "aubervilliers", "drancy",
    "ivry", "vitry", "clamart", "issy", "levallois", "neuilly", "puteaux",
    "courbevoie", "asnières", "asnieres", "colombes", "rueil", "suresnes",
    "montrouge", "vanves", "malakoff", "châtillon", "chatillon", "fontenay",
    "vincennes", "charenton", "maisons-alfort", "alfortville", "choisy",
    "rungis", "orly", "villejuif", "arcueil", "cachan", "l'haÿ", "hay",
    "gif-sur-yvette", "gif", "orsay", "savigny", "juvisy", "viry",
    "corbeil", "etampes", "étampes", "dourdan", "rambouillet", "trappes",
    "guyancourt", "montigny", "velizy", "vélizy", "meudon", "sèvres",
]

DEPT_MAP = {
    "paris": "75", "seine-et-marne": "77", "yvelines": "78",
    "essonne": "91", "hauts-de-seine": "92", "seine-saint-denis": "93",
    "val-de-marne": "94", "val-d'oise": "95",
    "92": "92", "93": "93", "94": "94", "95": "95",
    "77": "77", "78": "78", "91": "91", "75": "75",
}


def extract_price(text: str) -> int:
    """Extrait un prix max depuis la question"""
    m = re.search(r"(\d[\d\s]*)\s*(?:€|euros?|k€?|000)?\s*/?\s*m[²2]?", text, re.I)
    if m:
        val = int(re.sub(r'\s', '', m.group(1)))
        if val < 100:
            val *= 1000  # "5k€" → 5000
        return val
    m = re.search(r"moins de\s+(\d[\d\s]+)", text, re.I)
    if m:
        val = int(re.sub(r'\s', '', m.group(1)))
        if val > 100000:  # budget total → estimer surface 50m²
            val = val // 50
        return val
    return 5000  # défaut


def extract_communes(text: str) -> list:
    """Extrait les noms de communes depuis la question"""
    found = []
    text_low = text.lower()
    for c in KNOWN_COMMUNES:
        if c in text_low and c not in found:
            found.append(c)
    return found[:4]


def extract_departement(text: str) -> str:
    """Extrait le numéro de département"""
    m = re.search(r'\b(75|77|78|91|92|93|94|95)\b', text)
    if m:
        return m.group(1)
    for name, code in DEPT_MAP.items():
        if name in text.lower():
            return code
    return None


def detect_intent(question: str) -> Tuple[str, Dict[str, Any]]:
    """
    Retourne (intent_name, params) pour une question donnée.
    Priorité : comparaison > commune_detail > patterns spécifiques > fallback
    """
    q = question.strip()

    # 1. Comparaison entre communes nommées
    communes = extract_communes(q)
    if len(communes) >= 2:
        return "comparaison", {"cities": communes}

    # 2. Commune spécifique nommée sans comparaison
    if len(communes) == 1:
        return "commune_detail", {"city": communes[0]}

    # 3. Patterns ordonnés
    for intent_name, pattern in INTENT_PATTERNS:
        if pattern.search(q):
            params = dict(TEMPLATES[intent_name]["params"])

            if intent_name == "prix_max":
                params["max_price"] = extract_price(q)

            elif intent_name == "departement":
                dept = extract_departement(q)
                if dept:
                    params["dept"] = dept

            elif intent_name == "top_prix":
                if re.search(r"moins cher|moins [eé]lev[eé]|pas cher|abordable", q, re.I):
                    params["order"] = "ASC"
                else:
                    params["order"] = "DESC"

            return intent_name, params

    # 4. Fallback
    return "top_qualite_vie", dict(TEMPLATES["top_qualite_vie"]["params"])


def get_template(intent: str) -> Dict:
    return TEMPLATES.get(intent, TEMPLATES["top_qualite_vie"])
