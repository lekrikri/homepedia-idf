"""
ingestion/scores/compute_scores.py
=====================================
Calcule 3 scores composites par commune IDF à partir des données
déjà agrégées dans communes_agregat (PostgreSQL).

  - score_qualite_vie    : qualité du cadre de vie (0-100)
  - score_investissement : attractivité pour l'investissement (0-100)
  - score_stabilite      : stabilité / faible risque (0-100)

Ces scores sont des indices normalisés percentile-based (5e-95e percentile)
avec pondération thématique. Toutes les communes obtiennent un score :
les valeurs manquantes sont remplacées par la médiane IDF de la variable.

Usage :
    python3 ingestion/scores/compute_scores.py
"""

import numpy as np
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import os

PG_HOST     = os.getenv("POSTGRES_HOST", "localhost")
PG_PORT     = int(os.getenv("POSTGRES_PORT", 5433))
PG_DB       = os.getenv("POSTGRES_DB", "homepedia")
PG_USER     = os.getenv("POSTGRES_USER", "homepedia")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "homepedia")


# ─── Normalisation ────────────────────────────────────────────────────────────

def minmax(series: pd.Series, invert: bool = False, pct: tuple = (5, 95)) -> pd.Series:
    """
    Normalise une série en 0-100 via percentile-clipping.
    Les NaN sont traités en dehors de cette fonction (remplacés avant appel).
    """
    low  = np.nanpercentile(series, pct[0])
    high = np.nanpercentile(series, pct[1])
    if high == low:
        return pd.Series(50.0, index=series.index)
    clipped = series.clip(lower=low, upper=high)
    normalized = (clipped - low) / (high - low) * 100.0
    if invert:
        normalized = 100.0 - normalized
    return normalized


def fill_median(df: pd.DataFrame, col: str) -> pd.Series:
    """Remplace les NaN par la médiane IDF de la colonne."""
    median = df[col].median()
    return df[col].fillna(median)


# ─── Score Qualité de Vie ─────────────────────────────────────────────────────
#
# Mesure la qualité du cadre de vie au quotidien :
#   - Environnement scolaire (IPS) : 30 %
#   - Qualité énergétique du bâti (DPE) : 20 %
#   - Densité en équipements (transport, éducation, santé, parcs) : 20 %
#   - Sobriété énergétique (conso élec/logement) : 15 %
#   - % écoles favorisées : 15 %

def score_qualite_vie(df: pd.DataFrame) -> pd.Series:
    amenities = (
        fill_median(df, "nb_transport") +
        fill_median(df, "nb_education") +
        fill_median(df, "nb_sante") +
        fill_median(df, "nb_parcs")
    ) / fill_median(df, "surface_km2").replace(0, np.nan).fillna(1)

    s = (
        minmax(fill_median(df, "ips_moyen"))                         * 0.30 +
        minmax(fill_median(df, "pct_dpe_bon"))                       * 0.20 +
        minmax(amenities.fillna(amenities.median()))                  * 0.20 +
        minmax(fill_median(df, "conso_elec_par_logement"), invert=True) * 0.15 +
        minmax(fill_median(df, "pct_ecoles_favorisees"))              * 0.15
    )
    return s.round(1)


# ─── Score Investissement ─────────────────────────────────────────────────────
#
# Mesure l'attractivité pour un investisseur immobilier :
#   - Liquidité du marché (nb transactions) : 25 %
#   - Qualité sociale de la commune (IPS) : 25 %
#   - Qualité énergétique du bâti (future réglementation) : 20 %
#   - Point d'entrée (prix médian inversé = moins cher = meilleure opportunité) : 15 %
#   - Signal de gentrification (nb commerces bio/bobo) : 15 %

def score_investissement(df: pd.DataFrame) -> pd.Series:
    s = (
        minmax(fill_median(df, "nb_transactions"))                    * 0.25 +
        minmax(fill_median(df, "ips_moyen"))                          * 0.25 +
        minmax(fill_median(df, "pct_dpe_bon"))                        * 0.20 +
        minmax(fill_median(df, "prix_median_m2"), invert=True)        * 0.15 +
        minmax(fill_median(df, "nb_bio_bobo"))                        * 0.15
    )
    return s.round(1)


# ─── Score Stabilité ──────────────────────────────────────────────────────────
#
# Mesure la stabilité du parc immobilier (faible risque de dévaluation) :
#   - Classe DPE (score_dpe_moyen inversé — A=1 bon, G=7 mauvais) : 30 %
#   - Faible conso énergie (risque réglementaire) : 25 %
#   - Faibles émissions GES : 25 %
#   - % logements en bon DPE (A/B/C) : 20 %

def score_stabilite(df: pd.DataFrame) -> pd.Series:
    s = (
        minmax(fill_median(df, "score_dpe_moyen"), invert=True)       * 0.30 +
        minmax(fill_median(df, "conso_energie_moyenne"), invert=True)  * 0.25 +
        minmax(fill_median(df, "emission_ges_moyenne"), invert=True)   * 0.25 +
        minmax(fill_median(df, "pct_dpe_bon"))                         * 0.20
    )
    return s.round(1)


# ─── Mise à jour PostgreSQL ───────────────────────────────────────────────────

def add_score_columns(conn):
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE communes_agregat
                ADD COLUMN IF NOT EXISTS score_qualite_vie    DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS score_investissement  DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS score_stabilite       DOUBLE PRECISION
        """)
        conn.commit()
    print("  ✅ Colonnes scores prêtes")


def update_scores(conn, df: pd.DataFrame) -> int:
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TEMP TABLE tmp_scores (
                code_commune         CHAR(5),
                score_qualite_vie    DOUBLE PRECISION,
                score_investissement DOUBLE PRECISION,
                score_stabilite      DOUBLE PRECISION
            ) ON COMMIT DROP
        """)
        data = [
            (str(row.code_commune).zfill(5),
             float(row.score_qualite_vie),
             float(row.score_investissement),
             float(row.score_stabilite))
            for row in df.itertuples()
        ]
        execute_values(cur, "INSERT INTO tmp_scores VALUES %s", data)
        cur.execute("""
            UPDATE communes_agregat ca
            SET
                score_qualite_vie    = t.score_qualite_vie,
                score_investissement = t.score_investissement,
                score_stabilite      = t.score_stabilite
            FROM tmp_scores t
            WHERE ca.code_commune = t.code_commune
        """)
        updated = cur.rowcount
        conn.commit()
    return updated


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("📊 Calcul des scores composites HomePedia\n")

    conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT,
        dbname=PG_DB, user=PG_USER, password=PG_PASSWORD
    )

    print("  📥 Lecture communes_agregat...")
    df = pd.read_sql("""
        SELECT
            code_commune, city,
            prix_median_m2, nb_transactions,
            score_dpe_moyen, conso_energie_moyenne, emission_ges_moyenne,
            nb_dpe, pct_dpe_bon,
            nb_poi_total, nb_transport, nb_education, nb_sante,
            nb_commerce, nb_restauration, nb_parcs, nb_services, nb_bio_bobo,
            surface_km2, population_totale, densite_pop_km2,
            conso_elec_par_logement, conso_gaz_par_logement,
            ips_moyen, pct_ecoles_favorisees
        FROM communes_agregat
        WHERE prix_median_m2 IS NOT NULL
    """, conn)
    print(f"     {len(df):,} communes chargées\n")

    print("  🔢 Calcul des scores...")
    df["score_qualite_vie"]    = score_qualite_vie(df)
    df["score_investissement"] = score_investissement(df)
    df["score_stabilite"]      = score_stabilite(df)

    # Affichage distribution
    for col in ["score_qualite_vie", "score_investissement", "score_stabilite"]:
        print(f"  {col}: min={df[col].min():.0f} | p25={df[col].quantile(.25):.0f} "
              f"| median={df[col].median():.0f} | p75={df[col].quantile(.75):.0f} "
              f"| max={df[col].max():.0f}")

    print()
    add_score_columns(conn)
    updated = update_scores(conn, df)
    print(f"  → {updated} communes mises à jour ✅\n")

    # ─── Top / Bottom par score ──────────────────────────────────────────────
    print("─" * 65)
    _show_ranking(df, "score_qualite_vie",    "Qualité de Vie")
    print()
    _show_ranking(df, "score_investissement", "Investissement")
    print()
    _show_ranking(df, "score_stabilite",      "Stabilité (faible risque DPE)")

    conn.close()
    print("\n✅ Scores composites calculés et exportés !")


def _show_ranking(df: pd.DataFrame, col: str, label: str):
    top = df.nlargest(5, col)[["city", col]]
    bot = df.nsmallest(5, col)[["city", col]]
    print(f"Top 5 — {label}:")
    for _, r in top.iterrows():
        print(f"  {str(r['city'] or '?'):<32} {r[col]:>5.1f}/100")
    print(f"Bottom 5 — {label}:")
    for _, r in bot.iterrows():
        print(f"  {str(r['city'] or '?'):<32} {r[col]:>5.1f}/100")


if __name__ == "__main__":
    main()
