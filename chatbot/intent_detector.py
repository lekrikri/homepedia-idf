#!/usr/bin/env python3
"""
Détecteur d'intent hybride pour HomePedia Chat.
Ticket 1 : Embeddings MiniLM-L12-v2 (sémantique) + fallback regex + multi-critères.
"""

import re
import logging
from typing import Dict, Tuple, Any, List, Optional

logger = logging.getLogger(__name__)

# ── Chargement lazy MiniLM (singleton global) ─────────────────────────────────

try:
    from sentence_transformers import SentenceTransformer
    import numpy as np
    ST_AVAILABLE = True
except ImportError:
    ST_AVAILABLE = False
    logger.warning("sentence-transformers absent — fallback regex uniquement")

_embedder: Optional[Any] = None
_intent_emb_cache: Optional[Dict[str, Any]] = None


def _get_embedder():
    global _embedder, _intent_emb_cache
    if not ST_AVAILABLE:
        return None
    if _embedder is None:
        logger.info("⏳ Chargement MiniLM-L12-v2...")
        _embedder = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
        _intent_emb_cache = {
            intent: np.mean(_embedder.encode(phrases, show_progress_bar=False), axis=0)
            for intent, phrases in INTENT_EXAMPLES.items()
        }
        logger.info("✅ Embedder MiniLM prêt")
    return _embedder


# ── Exemples sémantiques par intent ──────────────────────────────────────────
# Ces phrases sont encodées une seule fois au démarrage.
# Plus d'exemples = meilleure robustesse, même reformulation.

INTENT_EXAMPLES: Dict[str, List[str]] = {
    "salutation": [
        "salut", "bonjour", "bonsoir", "hello", "coucou", "hey", "hi",
        "bonne journée", "bonne soirée", "bonne nuit", "au revoir", "bye",
        "merci", "merci beaucoup", "ok merci", "super merci", "merci bien", "c'est bon merci",
        "tu fais quoi", "tu es qui", "qui es-tu", "comment tu t'appelles",
        "c'est quoi homepedia", "qu'est-ce que tu sais faire",
        "aide-moi", "comment ça marche", "je voudrais de l'aide", "c'est quoi ce chatbot",
        "tu peux m'aider", "vous pouvez m'aider", "pouvez-vous m'aider", "j'ai besoin d'aide",
        "aidez-moi", "tu m'aides", "vous m'aidez", "aide moi stp",
        "à bientôt", "cool", "ok", "super", "génial", "parfait",
    ],
    "top_investissement": [
        "où investir en Île-de-France",
        "meilleur investissement locatif IDF",
        "acheter pour louer en banlieue parisienne",
        "placement immobilier rentable",
        "je veux investir dans l'immobilier",
        "quelle ville pour un bon investissement",
        "commune avec fort potentiel locatif",
    ],
    "top_qualite_vie": [
        "où vivre agréablement en IDF",
        "meilleure qualité de vie",
        "ville agréable pour s'installer",
        "endroit sympa en banlieue",
        "recommandation pour bien vivre",
        "communes les plus plaisantes",
        "un coin agréable pour habiter",
    ],
    "prix_max": [
        "communes avec un prix abordable",
        "moins de 5000 euros le m2",
        "budget limité pour acheter",
        "immobilier accessible en IDF",
        "je cherche pas cher",
        "prix raisonnable banlieue parisienne",
        "trouver moins de 4000 euros le mètre carré",
    ],
    "comparaison": [
        "compare Versailles et Vincennes",
        "différence entre Montreuil et Pantin",
        "quelle ville choisir entre les deux",
        "Cergy ou Pontoise lequel est mieux",
        "mettre en face deux villes",
        "comparer deux communes d'IDF",
    ],
    "departement": [
        "meilleures communes du 92",
        "villes du Val de Marne",
        "que valent les hauts de seine",
        "Seine-Saint-Denis immobilier",
        "investir dans le 91",
        "prix en Essonne",
        "communes de Seine-et-Marne",
    ],
    "dpe": [
        "meilleur DPE en IDF",
        "communes avec le meilleur DPE",
        "logements les moins énergivores",
        "bonne performance énergétique",
        "éviter les passoires thermiques",
        "communes écologiques",
        "bilan thermique des logements",
        "classe énergie A ou B",
        "meilleures notes énergétiques",
        "communes bien notées en énergie",
        "faible consommation d'énergie",
        "diagnostic de performance énergétique",
        "quel est le meilleur bilan DPE",
        "communes avec le meilleur DPE en Île-de-France",
        "où les logements consomment le moins d'énergie",
        "performance énergétique des communes IDF",
        "communes classe A ou B en énergie en Île-de-France",
    ],
    "securite": [
        "communes les plus sûres",
        "peu de cambriolages en IDF",
        "coin calme et tranquille",
        "zone résidentielle sécurisée",
        "faible criminalité en banlieue",
        "ville où on se sent en sécurité",
        "endroit calme pour famille",
    ],
    "rendement": [
        "meilleur rendement locatif brut",
        "loyer vs prix le plus avantageux",
        "rentabilité locative en IDF",
        "rapport loyer sur prix d'achat",
        "investissement à forte rentabilité",
        "cash flow positif immobilier",
        "où investir avec le meilleur rendement locatif",
        "communes avec le meilleur rendement locatif brut IDF",
        "rendement locatif le plus élevé en banlieue",
        "ratio loyer prix le plus intéressant",
        "taux de rendement brut le plus élevé",
        "loyer rapporté au prix d'achat",
        "meilleur cash flow en IDF",
        "communes avec fort rendement en banlieue parisienne",
        "rentabilité locative brute la plus élevée",
        "où le loyer ramené au prix est le plus intéressant",
        "communes avec le meilleur ratio loyer sur prix",
        "fort rendement locatif banlieue",
    ],
    "commune_detail": [
        "parle-moi de Versailles",
        "fiche détaillée sur Montreuil",
        "tout sur la commune de Créteil",
        "informations sur Cergy",
        "présente-moi cette ville",
        "données sur cette commune",
        "qu'est-ce que tu sais sur cette ville",
    ],
    "top_prix": [
        "villes les plus chères d'IDF",
        "classement par prix au m2",
        "communes les plus accessibles en prix",
        "top des prix immobiliers",
        "où les prix sont les plus élevés",
        "palmarès des prix IDF",
        "les plus chères c'est où",
        "où c'est le plus cher en IDF",
        "c'est où les villes les moins chères",
        "communes les moins chères d'IDF",
    ],
    "ecoles_ips": [
        "meilleures écoles en IDF",
        "communes avec bon IPS",
        "communes avec un IPS élevé",
        "communes avec un bon indice de position sociale",
        "bon IPS en banlieue parisienne",
        "éducation de qualité pour mes enfants",
        "écoles favorisées en banlieue",
        "bon niveau scolaire",
        "communes avec de bonnes écoles primaires",
        "pour les familles avec des enfants scolarisés",
        "où les enfants sont bien scolarisés",
        "meilleures communes pour les familles avec enfants",
    ],
    "forecast_prix": [
        "quel sera le prix à Montreuil en 2026",
        "prévision des prix immobiliers à Versailles",
        "évolution des prix attendue à Créteil",
        "combien vaudra le m2 à Vincennes dans 2 ans",
        "forecast immobilier Nanterre",
        "tendance prix Boulogne-Billancourt 2025 2026",
        "projection prix immobilier commune IDF",
        "estimation prix futur commune banlieue",
        "dans combien de temps les prix vont monter",
        "quelle commune va le plus augmenter",
        "prévision hausse prix immobilier IDF",
    ],
    "general": [
        "qu'est-ce que le DPE",
        "comment fonctionne l'IPS",
        "c'est quoi le rendement locatif",
        "comment calculer le rendement brut",
        "qu'est-ce que la zone tendue",
        "comment choisir une commune pour investir",
        "différence entre rendement brut et net",
        "c'est quoi les scores composites",
        "explique-moi le marché immobilier IDF",
        "comment interpréter le score investissement",
        "qu'est-ce que le DVF",
        "comment fonctionne la loi Pinel",
        "c'est quoi le prix médian au m2",
        "comment lire un diagnostic DPE",
    ],
    "hors_scope": [
        "quel temps fait-il aujourd'hui",
        "qui a gagné le match",
        "donne-moi une recette de cuisine",
        "comment s'appelle le président",
        "tu connais les prix à Lyon",
        "immobilier à Marseille",
        "prix à Bordeaux",
        "hors de l'île-de-france",
        "paris ville lumière histoire",
        "actualité politique",
        "bourse et marchés financiers",
    ],
}


# ── SQL Templates ─────────────────────────────────────────────────────────────

TEMPLATES: Dict[str, Dict] = {

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
        # SQL construit dynamiquement dans _build_params (ORDER BY non interpolable par psycopg2)
        "sql": None,
        "params": {"limit": 5},
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

    # SQL construit dynamiquement par build_multi_criteria_sql()
    "multi_criteria": {
        "sql": None,
        "params": {},
        "response_hint": "communes correspondant à plusieurs critères combinés",
    },

    # Prévision Prophet — SQL sur prix_forecast
    "forecast_prix": {
        "sql": """
            SELECT pf.annee, ROUND(pf.prix_m2_pred::numeric, 0) AS prix_m2_pred,
                   ROUND(pf.prix_m2_lower::numeric, 0) AS prix_m2_lower,
                   ROUND(pf.prix_m2_upper::numeric, 0) AS prix_m2_upper,
                   pf.is_forecast, ca.city AS commune
            FROM prix_forecast pf
            JOIN communes_agregat ca ON ca.code_commune = pf.code_commune
            WHERE LOWER(ca.city) = LOWER(%(city)s)
            ORDER BY pf.annee
        """,
        "params": {"city": ""},
        "response_hint": "prévision Prophet des prix immobiliers",
    },

    # Pas de SQL — réponse gérée directement dans chat_api.py
    "salutation": {
        "sql": None,
        "params": {},
        "response_hint": "salutation",
    },

    # Question encyclopédique immobilière — Qwen répond directement sans SQL
    "general": {
        "sql": None,
        "params": {},
        "response_hint": "explication concept immobilier IDF",
    },

    # Question hors périmètre IDF — réponse fixe sans SQL
    "hors_scope": {
        "sql": None,
        "params": {},
        "response_hint": "hors périmètre",
    },
}


# ── Patterns regex (fallback si score sémantique < 0.45) ─────────────────────

INTENT_PATTERNS = [
    # Salutation en priorité absolue — évite les faux positifs (merci → commune_detail)
    ("salutation", re.compile(
        r"^(salut|bonjour|bonsoir|hello|coucou|hey|hi|ok|merci|super|g[eé]nial|"
        r"parfait|cool|bravo|au revoir|bye|à bient[oô]t|bonne\s+\w+)[\s!.?]*$|"
        r"^(tu peux m.aider|vous pouvez m.aider|aide[z-]?[- ]moi|j.ai besoin d.aide|"
        r"aide moi|peux[- ]tu m.aider|help me)[\s?!.]*$", re.I
    )),
    # Hors périmètre — villes hors IDF ou sujets non-immobiliers
    ("hors_scope", re.compile(
        r"\b(lyon|marseille|bordeaux|toulouse|nantes|lille|nice|strasbourg|"
        r"rennes|montpellier|nancy|metz|reims|tours|dijon)\b|"
        r"(m[eé]t[eé]o|temps.{0,6}fait.il|quel temps|qu.il fait dehors|"
        r"recette|cuisine|football|match|"
        r"politique|[eé]lection|bourse|crypto|bitcoin|action en bourse)", re.I
    )),
    # Questions encyclopédiques immobilier
    ("general", re.compile(
        r"(qu'est[- ]ce que|c'est quoi|comment (fonctionne|calculer|interpr[eé]ter|lire)|"
        r"explique[- ]moi|d[eé]finition|comment (choisir|[eé]valuer)|"
        r"que veut dire|que signifie)\s+"
        r"(le |la |les |un |une |l'|d'|du |loi\s+)?"
        r"(dpe|ips|rendement|loyer|zone tendue|score|dvf|pinel|m[eé]dian|"
        r"investissement|immobilier|march[eé]\s+immobilier|prix au m|diagnostic)|"
        # "Différence entre X et Y" où X/Y contient un mot-clé immobilier
        r"diff[eé]rence entre\s+.{0,60}(m[eé]dian|moyen|rendement|dpe|ips|net|brut|prix\s+au)|"
        # Loi Pinel et dispositifs fiscaux directs
        r"\b(loi\s+)?(pinel|scpi|ptz|robien|borloo|duflot|malraux)\b|"
        # Termes financiers immobiliers toujours encyclopédiques
        r"\b(frais (de )?notaire|droits? (de )?mutation|taxe fonci[eè]re|"
        r"plus[- ]value\s+immobili|vacance\s+locative|\blmnp\b)\b|"
        # Taux de cambriolage encyclopédique
        r"qu.est.ce que.{0,20}taux.{0,10}(cambriolage|criminalit|d[eé]linquance)|"
        # Score composite
        r"(score|indice)\s+composite", re.I
    )),
    ("forecast_prix", re.compile(
        r"pr[eé]vision|pr[eé]voir|forecast|[eé]volution.{0,20}attendue|"
        r"combien.{0,20}vaudra|dans .{0,10}ans|en 202[5-9]|"
        r"hausse.{0,20}attendue|projection.{0,15}prix|tendance.{0,15}prix|"
        r"va .{0,10}(augmenter|baisser|monter)", re.I
    )),
    ("comparaison", re.compile(
        r"compar|versus|vs\.?|diff[eé]rence|entre .+ et .+|.+ ou .+", re.I
    )),
    ("commune_detail", re.compile(
        r"(qu'est[- ]ce que|parle[- ]moi de|fiche|d[eé]tail|tout sur|"
        r"inform.+ sur|c'est comment|comment est|portrait de)\s+\w+", re.I
    )),
    # top_prix avant prix_max : "les moins chères" doit être un classement (ASC), pas un filtre budget
    ("top_prix", re.compile(
        r"plus ch[eè]r|plus [eé]lev[eé]|moins ch[eè]r|top prix|"
        r"classement prix|rang.*prix|cher.*idf|idf.*cher|les? moins ch|les? plus ch", re.I
    )),
    # rendement avant top_investissement : "meilleur rendement locatif" ne doit pas matcher investir
    ("rendement", re.compile(
        r"rendement|rentab(ilit[eé])?|rapport locatif|cash.?flow", re.I
    )),
    ("prix_max", re.compile(
        r"moins de \d|budget|pas ch[eè]r|abordable|accessible|"
        r"€/m²|euros?/m|inférieur", re.I
    )),
    ("departement", re.compile(
        r"\b(75|77|78|91|92|93|94|95|paris)\b|seine.?et.?marne|yvelines|"
        r"essonne|hauts.?de.?seine|seine.?saint.?denis|val.?de.?marne|"
        r"val.?d.?oise", re.I
    )),
    ("dpe", re.compile(
        r"\bdpe\b|[eé]nerg|[eé]cologique|passoire|thermique|consommation.?[eé]nerg", re.I
    )),
    ("securite", re.compile(
        r"s[eé]curit|cambriolage|crime|d[eé]linquance|\bs[uû]re\b|tranquille", re.I
    )),
    ("ecoles_ips", re.compile(
        r"[eé]cole|famille|enfant|\bips\b|[eé]ducation|scolaire|primaire|coll[eè]ge", re.I
    )),
    ("top_investissement", re.compile(
        r"investir|investissement|investisseur|placer|placement|acheter pour louer", re.I
    )),
    ("top_qualite_vie", re.compile(
        r"qualit[eé] de vie|vivre|habiter|meilleur endroit|o[uù] vivre|"
        r"recommand|bien vivre|agr[eé]able", re.I
    )),
]

# ── Entités connues ───────────────────────────────────────────────────────────

KNOWN_COMMUNES = [
    "paris", "versailles", "vincennes", "montreuil", "nanterre", "boulogne",
    "saint-denis", "saint denis", "argenteuil", "créteil", "creteil",
    "evry", "évry", "massy", "palaiseau", "antony", "châtenay", "chatou",
    "pontoise", "cergy", "poissy", "saint-germain", "melun", "fontainebleau",
    "meaux", "chelles", "noisy", "pantin", "aubervilliers", "drancy",
    "ivry", "vitry", "clamart", "issy", "levallois", "neuilly", "puteaux",
    "courbevoie", "asnières", "asnieres", "colombes", "rueil", "suresnes",
    "montrouge", "vanves", "malakoff", "châtillon", "chatillon", "fontenay",
    "charenton", "maisons-alfort", "alfortville", "choisy",
    "rungis", "orly", "villejuif", "arcueil", "cachan", "l'haÿ", "hay",
    "gif-sur-yvette", "gif", "orsay", "savigny", "juvisy", "viry",
    "corbeil", "etampes", "étampes", "dourdan", "rambouillet", "trappes",
    "guyancourt", "montigny", "velizy", "vélizy", "meudon", "sèvres",
]

# Mapping fragment → nom complet en base de données
# Permet à SQL de trouver "Ivry-sur-Seine" quand l'utilisateur écrit "Ivry"
COMMUNE_FULLNAMES: Dict[str, str] = {
    "ivry": "Ivry-sur-Seine",
    "vitry": "Vitry-sur-Seine",
    "neuilly": "Neuilly-sur-Seine",
    "boulogne": "Boulogne-Billancourt",
    "fontenay": "Fontenay-sous-Bois",
    "issy": "Issy-les-Moulineaux",
    "rueil": "Rueil-Malmaison",
    "asnières": "Asnières-sur-Seine",
    "asnieres": "Asnières-sur-Seine",
    "noisy": "Noisy-le-Grand",
    "gif": "Gif-sur-Yvette",
    "gif-sur-yvette": "Gif-sur-Yvette",
    "juvisy": "Juvisy-sur-Orge",
    "viry": "Viry-Châtillon",
    "saint-germain": "Saint-Germain-en-Laye",
    "savigny": "Savigny-sur-Orge",
    "choisy": "Choisy-le-Roi",
    "châtillon": "Châtillon",
    "chatillon": "Châtillon",
    "charenton": "Charenton-le-Pont",
    "hay": "L'Haÿ-les-Roses",
    "l'haÿ": "L'Haÿ-les-Roses",
    "maisons-alfort": "Maisons-Alfort",
    "alfortville": "Alfortville",
}

DEPT_MAP = {
    "paris": "75", "seine-et-marne": "77", "yvelines": "78",
    "essonne": "91", "hauts-de-seine": "92", "seine-saint-denis": "93",
    "val-de-marne": "94", "val-d'oise": "95",
    "92": "92", "93": "93", "94": "94", "95": "95",
    "77": "77", "78": "78", "91": "91", "75": "75",
}


# ── Extracteurs d'entités ─────────────────────────────────────────────────────

def extract_price(text: str) -> int:
    m = re.search(r"(\d[\d\s]*)\s*(?:€|euros?|k€?|000)?\s*/?\s*m[²2]?", text, re.I)
    if m:
        val = int(re.sub(r'\s', '', m.group(1)))
        if val < 100:
            val *= 1000
        return val
    m = re.search(r"moins de\s+(\d[\d\s]+)", text, re.I)
    if m:
        val = int(re.sub(r'\s', '', m.group(1)))
        if val > 100000:
            val = val // 50
        return val
    return 5000


def extract_communes(text: str) -> list:
    found = []
    found_lower = []
    text_low = text.lower()
    for c in KNOWN_COMMUNES:
        if re.search(r'\b' + re.escape(c) + r'\b', text_low):
            # Résoudre le nom complet pour que le SQL matche la base (ex: "ivry" → "Ivry-sur-Seine")
            full = COMMUNE_FULLNAMES.get(c, c)
            if full.lower() not in found_lower:
                found.append(full)
                found_lower.append(full.lower())
    return found[:4]


def extract_departement(text: str) -> Optional[str]:
    m = re.search(r'\b(75|77|78|91|92|93|94|95)\b', text)
    if m:
        return m.group(1)
    t = text.lower()
    for name, code in DEPT_MAP.items():
        # Word boundary pour éviter "paris" → "parisienne" ou "sienne" → "essonne"
        if re.search(r'\b' + re.escape(name) + r'\b', t):
            return code
    return None


def extract_criteria(text: str) -> Dict[str, Any]:
    """
    Extrait les critères multi-dimensionnels d'une question.
    Retourne un dict avec les flags actifs.
    """
    q = text.lower()
    criteria: Dict[str, Any] = {}

    if re.search(r'moins de|sous les|budget|€|euro|pas cher|abordable|inférieur', q):
        criteria["prix_max"] = extract_price(text)

    if re.search(r'dpe|[eé]nerg|[eé]colog|passoire|thermique|classe [abc]', q):
        criteria["need_dpe"] = True

    if re.search(r's[eé]curit|calme|tranquille|cambriolage|\bs[uû]re?\b|criminalit|d[eé]linquance', q):
        criteria["need_securite"] = True

    if re.search(r'familial|famille|enfant|[eé]cole|ips|scolaire', q):
        criteria["need_famille"] = True

    return criteria


def build_multi_criteria_sql(criteria: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    """
    Construit le SQL dynamique pour les requêtes multi-critères.
    Les conditions injectées dans le f-string sont des constantes statiques
    (noms de colonnes fixes + placeholders psycopg2) — pas d'injection possible.
    """
    conditions = ["prix_median_m2 IS NOT NULL"]
    params: Dict[str, Any] = {"limit": 6}

    if "prix_max" in criteria:
        conditions.append("prix_median_m2 <= %(max_price)s")
        params["max_price"] = criteria["prix_max"]

    if criteria.get("need_dpe"):
        # score_dpe_moyen : 1=A (meilleur) → 7=G (pire)
        conditions.append("score_dpe_moyen <= 3.0")

    if criteria.get("need_securite"):
        # taux_cambriolages en ‰ — seuil 6.0 = sous la médiane IDF (~8‰)
        conditions.append("taux_cambriolages <= 6.0")

    if criteria.get("need_famille"):
        # IPS médian IDF ≈ 95 ; on filtre au-dessus
        conditions.append("ips_moyen >= 95")

    where = " AND ".join(conditions)
    sql = f"""
        SELECT city AS commune, TRIM(code_departement) AS dept,
               ROUND(prix_median_m2::numeric, 0) AS prix_m2,
               ROUND(score_global::numeric, 1) AS score_global,
               ROUND(score_dpe_moyen::numeric, 2) AS dpe_score,
               ROUND(taux_cambriolages::numeric, 3) AS cambriolages_pour_mille,
               ROUND(rendement_locatif_brut::numeric, 2) AS rendement_pct,
               ROUND(ips_moyen::numeric, 1) AS ips_ecoles
        FROM communes_agregat
        WHERE {where}
        ORDER BY score_global DESC NULLS LAST
        LIMIT %(limit)s
    """
    return sql, params


# ── Détection sémantique et regex ─────────────────────────────────────────────

def _cosine(a, b) -> float:
    import numpy as np
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def _semantic_intent(question: str) -> Tuple[str, float]:
    embedder = _get_embedder()
    if embedder is None or _intent_emb_cache is None:
        return "unknown", 0.0
    q_emb = embedder.encode([question], show_progress_bar=False)[0]
    best, best_score = "unknown", -1.0
    for intent, emb in _intent_emb_cache.items():
        s = _cosine(q_emb, emb)
        if s > best_score:
            best_score = s
            best = intent
    return best, best_score


def _regex_intent(question: str) -> Optional[str]:
    for intent_name, pattern in INTENT_PATTERNS:
        if pattern.search(question):
            return intent_name
    return None


def _build_params(intent: str, q: str) -> Dict[str, Any]:
    params = dict(TEMPLATES[intent]["params"])
    if intent == "forecast_prix":
        communes = extract_communes(q)
        params["city"] = communes[0] if communes else ""
    elif intent == "prix_max":
        params["max_price"] = extract_price(q)
    elif intent == "departement":
        dept = extract_departement(q)
        if dept:
            params["dept"] = dept
    elif intent == "top_prix":
        order = "ASC" if re.search(r"moins ch[eè]r|moins [eé]lev[eé]|pas cher|abordable|les? moins", q, re.I) else "DESC"
        # psycopg2 ne peut pas interpoler des mots-clés SQL (ORDER BY) → f-string avec valeur validée
        params["_sql"] = f"""
            SELECT city AS commune, TRIM(code_departement) AS dept,
                   ROUND(prix_median_m2::numeric, 0) AS prix_m2,
                   nb_transactions
            FROM communes_agregat
            WHERE prix_median_m2 IS NOT NULL
            ORDER BY prix_median_m2 {order}
            LIMIT %(limit)s
        """
    return params


# ── API publique ──────────────────────────────────────────────────────────────

def detect_intent(question: str) -> Tuple[str, Dict[str, Any]]:
    """
    Détection hybride :
    0. Hors périmètre IDF/immo → hors_scope (court-circuit)
    1. Comparaison multi-communes (heuristique)
    2. Commune unique nommée → fiche détail
    3. Multi-critères (≥ 2 dimensions actives)
    4. Sémantique MiniLM (score ≥ 0.45)
    5. Fallback regex
    6. Fallback final top_qualite_vie
    """
    q = question.strip()

    # 0. Hors périmètre — check regex prioritaire avant tout
    for intent_name, pattern in INTENT_PATTERNS:
        if intent_name == "hors_scope" and pattern.search(q):
            logger.info("🚫 Hors scope détecté")
            return "hors_scope", {}
        if intent_name == "general" and pattern.search(q):
            logger.info("📚 Question encyclopédique détectée")
            return "general", {}

    # 1. Comparaison explicite entre communes nommées
    communes = extract_communes(q)
    if len(communes) >= 2:
        return "comparaison", {"cities": communes}

    # 2. Commune unique → fiche détaillée
    if len(communes) == 1:
        return "commune_detail", {"city": communes[0]}

    # 2.5 top_prix explicite — "les plus chères c'est où ?" intercepté avant MiniLM
    # (après étapes communes pour éviter "Créteil vs Vitry, laquelle est moins chère ?")
    if re.search(r"\b(plus|moins)\s+ch[eè]r", q, re.I):
        logger.info("💰 top_prix explicite (plus/moins cher)")
        return "top_prix", _build_params("top_prix", q)

    # 3. Multi-critères (ex: "sûre ET bon DPE ET moins de 4000€")
    criteria = extract_criteria(q)
    n_active = sum([
        "prix_max" in criteria,
        criteria.get("need_dpe", False),
        criteria.get("need_securite", False),
        criteria.get("need_famille", False),
    ])
    if n_active >= 2:
        sql, params = build_multi_criteria_sql(criteria)
        logger.info(f"🔀 Multi-critères ({n_active} actifs) : {list(criteria.keys())}")
        return "multi_criteria", {"_sql": sql, **params}

    # 3.5 Département explicite (code numérique ou nom) — priorité sur sémantique
    # Évite que MiniLM confonde "communes du 91" avec dpe ou rendement
    if not communes:
        dept_early = extract_departement(q)
        if dept_early:
            logger.info(f"🗺️ Département détecté prioritaire: {dept_early}")
            return "departement", {"dept": dept_early, "limit": 5}

    # 3.6 DPE explicite — avant MiniLM qui peut confondre avec departement
    # Ne s'applique pas si multi-critères a déjà été retourné (step 3)
    if re.search(r"\bdpe\b|passoire\s+thermique|[eé]cologiqu|"
                 r"performance\s+[eé]nerg|consommation\s+[eé]nerg|"
                 r"bilan\s+[eé]nerg|thermique\b", q, re.I):
        logger.info("🌱 DPE explicite avant sémantique")
        return "dpe", dict(TEMPLATES["dpe"]["params"])

    # 4. Détection sémantique
    sem_intent, sem_score = _semantic_intent(q)
    if sem_score >= 0.45 and sem_intent in TEMPLATES:
        logger.info(f"🧠 Semantic intent={sem_intent} score={sem_score:.2f}")
        params = _build_params(sem_intent, q)
        # Si l'intent sémantique est prix_max, vérifier qu'on a un prix
        if sem_intent == "prix_max" and "max_price" not in params:
            params["max_price"] = extract_price(q)
        return sem_intent, params

    # 5. Fallback regex
    regex_intent = _regex_intent(q)
    if regex_intent:
        logger.info(f"🔤 Regex intent={regex_intent}")
        return regex_intent, _build_params(regex_intent, q)

    # 6. Fallback final
    logger.info("⚠️ Fallback top_qualite_vie")
    return "top_qualite_vie", dict(TEMPLATES["top_qualite_vie"]["params"])


def get_template(intent: str) -> Dict:
    return TEMPLATES.get(intent, TEMPLATES["top_qualite_vie"])
