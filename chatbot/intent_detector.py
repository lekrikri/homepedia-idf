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
    "risques": [
        "communes sans risque inondation",
        "zones non inondables en IDF",
        "risque argile gonflement maison",
        "risque retrait gonflement argile",
        "communes sûres des risques naturels",
        "pas de risque inondation banlieue",
        "zones à faible risque BRGM",
        "communes sans risque environnemental",
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
    "budget_achat": [
        "j'ai 300 000 euros pour acheter un appartement",
        "avec 250k€ que puis-je acheter en IDF",
        "mon budget total est de 350 000€ pour acheter",
        "j'ai 400 000 euros à investir dans l'immobilier",
        "pour 280 000€ que puis-je acquérir en banlieue",
        "j'ai un budget de 320 000 euros pour acheter",
        "avec 500 000 euros quelle superficie puis-je espérer",
        "je dispose de 200k€ pour acheter un bien",
        "acheter avec 300 000€ où aller en IDF",
        "quelle surface pour 250 000 euros en Île-de-France",
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
    "commune_similaire": [
        "quelle ville ressemble à Versailles",
        "commune similaire à Montreuil",
        "alternative moins chère à Boulogne",
        "ville comme Versailles mais moins chère",
        "alternative à Vincennes",
        "ville jumelle de Créteil",
        "commune proche en profil de Nanterre",
        "alternative abordable à Neuilly",
        "quelle ville est similaire à Cergy",
        "quelque chose de proche de Massy mais moins cher",
    ],
    "isochrone_paris": [
        "où habiter à moins de 30 minutes de Paris",
        "communes accessibles en 45 min de Paris",
        "30 min de Paris en voiture",
        "banlieue proche de Paris moins de 20 minutes",
        "accessible depuis Paris en 30 minutes",
        "communes à 45 minutes de Paris",
        "pas trop loin de Paris en transport",
        "proche de Paris 30 minutes",
        "quelle commune à 30 min de Paris",
    ],
    "tendance_prix": [
        "est-ce que les prix baissent en Essonne",
        "évolution des prix depuis 2021",
        "quelle commune a le plus augmenté",
        "hausse ou baisse des prix à Versailles",
        "communes où les prix ont le plus progressé",
        "où les prix ont le plus baissé en IDF",
        "tendance des prix immobiliers IDF depuis 2021",
        "quelle ville a vu ses prix le plus augmenter",
        "baisse des prix en Seine-et-Marne",
        "marché immobilier en hausse ou baisse",
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

    "risques": {
        "sql": """
            SELECT city AS commune, TRIM(code_departement) AS dept,
                   ROUND(prix_median_m2::numeric, 0) AS prix_m2,
                   risque_argile,
                   risque_inondation,
                   ROUND(score_risques::numeric, 1) AS score_risques
            FROM communes_agregat
            WHERE risque_argile IS NOT NULL
              AND risque_inondation IS NOT NULL
              AND prix_median_m2 IS NOT NULL
            ORDER BY (risque_argile + risque_inondation) ASC,
                     score_risques DESC
            LIMIT %(limit)s
        """,
        "params": {"limit": 6},
        "response_hint": "communes à faibles risques environnementaux (inondation, argile BRGM)",
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

    "commune_similaire": {
        "sql": """
            WITH ref AS (
                SELECT COALESCE(prix_median_m2,0)/15000.0 AS p,
                       COALESCE(score_investissement,50)/100.0 AS si,
                       COALESCE(score_qualite_vie,50)/100.0 AS sqv,
                       COALESCE(score_securite,50)/100.0 AS ss,
                       (COALESCE(ips_moyen,100)-60)/100.0 AS ips,
                       code_commune AS ref_code,
                       prix_median_m2 AS ref_prix
                FROM communes_agregat WHERE LOWER(city) = LOWER(%(city)s) LIMIT 1
            )
            SELECT c2.city AS commune, TRIM(c2.code_departement) AS dept,
                   ROUND(c2.prix_median_m2::numeric, 0) AS prix_m2,
                   ROUND(c2.score_qualite_vie::numeric, 1) AS qualite_vie,
                   ROUND(c2.score_investissement::numeric, 1) AS investissement,
                   ROUND(c2.rendement_locatif_brut::numeric, 2) AS rendement_pct
            FROM communes_agregat c2, ref
            WHERE c2.code_commune != ref.ref_code
              AND c2.prix_median_m2 IS NOT NULL
              AND c2.score_investissement IS NOT NULL
            ORDER BY SQRT(
                POWER(COALESCE(c2.prix_median_m2,0)/15000.0 - ref.p, 2) +
                POWER(COALESCE(c2.score_investissement,50)/100.0 - ref.si, 2) +
                POWER(COALESCE(c2.score_qualite_vie,50)/100.0 - ref.sqv, 2) +
                POWER(COALESCE(c2.score_securite,50)/100.0 - ref.ss, 2) +
                POWER((COALESCE(c2.ips_moyen,100)-60)/100.0 - ref.ips, 2)
            ) ASC
            LIMIT %(limit)s
        """,
        "params": {"city": "", "limit": 5},
        "response_hint": "communes similaires à une commune de référence (profil prix, investissement, qualité de vie)",
    },

    "isochrone_paris": {
        "sql": """
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
        """,
        "params": {"rayon_km": 21.0, "limit": 8},
        "response_hint": "communes accessibles depuis Paris en X minutes — données RER/Transilien réelles si table rer_stations peuplée, sinon haversine",
    },

    "tendance_prix": {
        "sql": None,  # construit dynamiquement dans _build_params
        "params": {"limit": 6},
        "response_hint": "évolution des prix immobiliers depuis 2021 (données Prophet historiques)",
    },

    "budget_achat": {
        "sql": """
            SELECT city AS commune, TRIM(code_departement) AS dept,
                   ROUND(prix_median_m2::numeric, 0) AS prix_m2,
                   ROUND(%(budget)s::numeric / NULLIF(prix_median_m2::numeric, 0), 0)::int AS surface_m2_accessible,
                   ROUND(rendement_locatif_brut::numeric, 2) AS rendement_pct,
                   ROUND(score_qualite_vie::numeric, 1) AS qualite_vie
            FROM communes_agregat
            WHERE prix_median_m2 IS NOT NULL AND prix_median_m2 > 0
              AND prix_median_m2 <= %(prix_m2_max)s
            ORDER BY score_qualite_vie DESC NULLS LAST
            LIMIT %(limit)s
        """,
        "params": {"budget": 300000, "prix_m2_max": 7500, "limit": 8},
        "response_hint": "communes accessibles selon le budget total d'achat avec surface estimée",
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
    ("commune_similaire", re.compile(
        r"similaire?\s+[àa]\s+\w|ressemble\s+[àa]|alternative\s+[àa]|"
        r"comme\s+\w+\s+(mais|en)\s+moins|ville\s+jumelle|"
        r"proche\s+en\s+profil|m[eê]me\s+profil", re.I
    )),
    ("isochrone_paris", re.compile(
        r"\d+\s*(?:min(?:utes?)?|mn)\s+(?:de\s+)?paris|"
        r"(?:de\s+)?paris\s+(?:en\s+)?\d+\s*(?:min|mn)|"
        r"(?:accessible|proche|[àa]\s+proximit[eé])\s+(?:de\s+)?paris\b|"
        r"moins\s+(?:de\s+)?\d+\s*(?:min|mn)\s+(?:de\s+)?paris", re.I
    )),
    ("tendance_prix", re.compile(
        r"tendance|[eé]volution\s+(?:des\s+)?prix\s+(?:depuis|depuis\s+\d{4})|"
        r"(?:les\s+)?prix\s+(?:baiss|augment|progress|diminu|montent|descend)|"
        r"(?:plus|moins)\s+augment[eé]|hausse\s+des\s+prix|baisse\s+des\s+prix|"
        r"march[eé]\s+(?:en\s+)?hausse|march[eé]\s+(?:en\s+)?baisse", re.I
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
    ("budget_achat", re.compile(
        r"j'?ai\s+\d+[\d\s]*(?:k€|000\s*€|euros?)|"
        r"avec\s+\d+[\d\s]*(?:k€|000\s*€|euros?).{0,30}(?:acheter|acquérir|investir)|"
        r"budget\s+(?:total|d.achat|de)\s+\d+[\d\s]*(?:k€|€|euros?)|"
        r"(?:pour|avec)\s+\d+\s*k€", re.I
    )),
    ("prix_max", re.compile(
        r"moins de \d|pas ch[eè]r|abordable|accessible|"
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
    ("risques", re.compile(
        r"risque.?(inondation|argile|naturel|brgm|g[eé]ologique)|inondation|"
        r"retrait.gonflement|zone.inondable|risque.environnemental", re.I
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

def extract_budget(text: str) -> int:
    """Extrait un budget total d'achat (montant en €, typiquement 100k-1M€)."""
    m = re.search(r"(\d+)\s*k€", text, re.I)
    if m:
        return int(m.group(1)) * 1000
    m = re.search(r"(\d[\d\s]{2,})\s*(?:€|euros?)", text, re.I)
    if m:
        val = int(re.sub(r'\s', '', m.group(1)))
        if val >= 50000:
            return val
    m = re.search(r"(\d{2,3})\s*000\b", text, re.I)
    if m:
        val = int(m.group(1)) * 1000
        if val >= 50000:
            return val
    return 300000


def extract_minutes(text: str) -> int:
    """Extrait les minutes depuis Paris (approximation isochrone)."""
    m = re.search(r"(\d+)\s*(?:min(?:utes?)?)", text, re.I)
    if m:
        return int(m.group(1))
    if re.search(r"une?\s+heure\b", text, re.I):
        return 60
    if re.search(r"demi[- ]?heure\b", text, re.I):
        return 30
    return 30


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
    elif intent == "budget_achat":
        budget = extract_budget(q)
        params["budget"] = budget
        params["prix_m2_max"] = budget // 40  # Surface minimale ~40m² visée
    elif intent == "commune_similaire":
        communes = extract_communes(q)
        params["city"] = communes[0] if communes else ""
        moins_cher = bool(re.search(r"moins ch[eè]r|pas cher|moins \w+\s+qu[e']|abordable|jumelle?", q, re.I))
        if moins_cher:
            params["_sql"] = """
                WITH ref AS (
                    SELECT COALESCE(prix_median_m2,0)/15000.0 AS p,
                           COALESCE(score_qualite_vie,50)/100.0 AS sqv,
                           COALESCE(score_investissement,50)/100.0 AS si,
                           COALESCE(score_securite,50)/100.0 AS ss,
                           (COALESCE(ips_moyen,100)-60)/100.0 AS ips,
                           code_commune AS ref_code,
                           prix_median_m2 AS ref_prix
                    FROM communes_agregat WHERE LOWER(city) = LOWER(%(city)s) LIMIT 1
                )
                SELECT c2.city AS commune, TRIM(c2.code_departement) AS dept,
                       ROUND(c2.prix_median_m2::numeric, 0) AS prix_m2,
                       ROUND(c2.score_qualite_vie::numeric, 1) AS qualite_vie,
                       ROUND(c2.score_investissement::numeric, 1) AS investissement,
                       ROUND(((c2.prix_median_m2 - ref.ref_prix) / NULLIF(ref.ref_prix,0) * 100)::numeric, 1)::float AS ecart_prix_pct
                FROM communes_agregat c2, ref
                WHERE c2.code_commune != ref.ref_code
                  AND c2.prix_median_m2 IS NOT NULL
                  AND c2.prix_median_m2 < ref.ref_prix * 0.92
                  AND c2.score_qualite_vie IS NOT NULL
                ORDER BY SQRT(
                    POWER(COALESCE(c2.prix_median_m2,0)/15000.0 - ref.p, 2) +
                    POWER(COALESCE(c2.score_investissement,50)/100.0 - ref.si, 2) +
                    POWER(COALESCE(c2.score_qualite_vie,50)/100.0 - ref.sqv, 2) +
                    POWER(COALESCE(c2.score_securite,50)/100.0 - ref.ss, 2) +
                    POWER((COALESCE(c2.ips_moyen,100)-60)/100.0 - ref.ips, 2)
                ) ASC
                LIMIT %(limit)s
            """
    elif intent == "isochrone_paris":
        minutes = extract_minutes(q)
        params["rayon_km"] = round(minutes * 0.7, 1)
        params["minutes"] = minutes
        params["_sql_rer"] = """
            WITH stations_accessibles AS (
                SELECT nom AS gare, lat AS gare_lat, lon AS gare_lon, lignes,
                       temps_paris_min,
                       (%(minutes)s - temps_paris_min) * 0.08 AS rayon_marche_km
                FROM rer_stations
                WHERE temps_paris_min IS NOT NULL AND temps_paris_min < %(minutes)s
            )
            SELECT DISTINCT ON (ca.code_commune)
                ca.city AS commune,
                TRIM(ca.code_departement) AS dept,
                ROUND(ca.prix_median_m2::numeric, 0)::int AS prix_m2,
                ROUND(ca.score_qualite_vie::numeric, 1)::float AS qualite_vie,
                ROUND(ca.rendement_locatif_brut::numeric, 2)::float AS rendement_pct,
                sa.gare,
                sa.lignes,
                sa.temps_paris_min
            FROM stations_accessibles sa
            JOIN communes_agregat ca ON ca.centroid_lat IS NOT NULL
                AND ca.prix_median_m2 IS NOT NULL
                AND 2 * 6371 * ASIN(SQRT(
                    POWER(SIN(RADIANS((ca.centroid_lat - sa.gare_lat)/2)), 2) +
                    COS(RADIANS(sa.gare_lat)) * COS(RADIANS(ca.centroid_lat)) *
                    POWER(SIN(RADIANS((ca.centroid_lon - sa.gare_lon)/2)), 2)
                )) <= sa.rayon_marche_km
            ORDER BY ca.code_commune, sa.temps_paris_min
            LIMIT %(limit)s
        """
    elif intent == "tendance_prix":
        dept = extract_departement(q)
        communes = extract_communes(q)
        order = "ASC" if re.search(r"baiss|diminu|recul|chute|moins cher|d[eé]clin", q, re.I) else "DESC"
        dept_cond = "AND TRIM(ca.code_departement) = %(dept_val)s" if dept else ""
        city_cond = "AND LOWER(ca.city) = LOWER(%(city_val)s)" if communes else ""
        params["dept_val"] = dept or ""
        params["city_val"] = communes[0] if communes else ""
        params["_sql"] = f"""
            SELECT ca.city AS commune, TRIM(ca.code_departement) AS dept,
                   ROUND(pf_debut.prix_m2_pred::numeric, 0) AS prix_2021,
                   ROUND(pf_fin.prix_m2_pred::numeric, 0) AS prix_2024,
                   ROUND(((pf_fin.prix_m2_pred - pf_debut.prix_m2_pred) /
                          NULLIF(pf_debut.prix_m2_pred, 0) * 100)::numeric, 1)::float AS evolution_pct
            FROM communes_agregat ca
            JOIN prix_forecast pf_debut ON pf_debut.code_commune = ca.code_commune
                 AND pf_debut.annee = 2021 AND NOT pf_debut.is_forecast
            JOIN prix_forecast pf_fin ON pf_fin.code_commune = ca.code_commune
                 AND pf_fin.annee = 2024 AND NOT pf_fin.is_forecast
            WHERE ca.prix_median_m2 IS NOT NULL
            {dept_cond}
            {city_cond}
            ORDER BY evolution_pct {order}
            LIMIT %(limit)s
        """
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

    # 1.5 Forecast prix — checker AVANT commune_detail sinon "prévisions pour Vincennes" → commune_detail
    _forecast_re = INTENT_PATTERNS[[n for n,_ in INTENT_PATTERNS].index("forecast_prix")][1]
    if _forecast_re.search(q):
        params = _build_params("forecast_prix", q)
        logger.info(f"🔮 forecast_prix détecté (commune={params.get('city','?')})")
        return "forecast_prix", params

    # 2. Commune unique → fiche détaillée
    if len(communes) == 1:
        return "commune_detail", {"city": communes[0]}

    # 2.5 top_prix explicite — "les plus chères c'est où ?" intercepté avant MiniLM
    # (après étapes communes pour éviter "Créteil vs Vitry, laquelle est moins chère ?")
    if re.search(r"\b(plus|moins)\s+ch[eè]r", q, re.I):
        logger.info("💰 top_prix explicite (plus/moins cher)")
        return "top_prix", _build_params("top_prix", q)

    # 2.6 commune_similaire explicite — avant sémantique
    _sim_re = INTENT_PATTERNS[[n for n,_ in INTENT_PATTERNS].index("commune_similaire")][1]
    if _sim_re.search(q) and communes:
        logger.info(f"🔗 commune_similaire détecté ({communes[0]})")
        return "commune_similaire", _build_params("commune_similaire", q)

    # 2.7 isochrone_paris explicite
    _iso_re = INTENT_PATTERNS[[n for n,_ in INTENT_PATTERNS].index("isochrone_paris")][1]
    if _iso_re.search(q):
        logger.info("🗺️ isochrone_paris détecté")
        return "isochrone_paris", _build_params("isochrone_paris", q)

    # 2.8 tendance_prix explicite
    _tend_re = INTENT_PATTERNS[[n for n,_ in INTENT_PATTERNS].index("tendance_prix")][1]
    if _tend_re.search(q):
        logger.info("📈 tendance_prix détecté")
        return "tendance_prix", _build_params("tendance_prix", q)

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
