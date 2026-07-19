#!/usr/bin/env python3
"""
Recalcul score_dpe_moyen par commune depuis les transactions DVF enrichies.

Le score DPE est maintenant calculé sur les données réelles des transactions
(1 899 179 biens avec classe_energie) plutôt que sur les DPE bâtiments ADEME.

Mapping : A=100, B=85, C=65, D=45, E=25, F=10, G=0

Usage:
    python ingestion/recalcul_dpe_score.py
"""

import os
import psycopg2
from psycopg2.extras import execute_values
from urllib.parse import quote_plus

# Mot de passe Supabase : jamais en dur, ce dépôt est public.
_MDP = os.environ.get("SUPABASE_PASSWORD") or os.environ.get("POSTGRES_PASSWORD")
if not _MDP:
    raise SystemExit(
        "SUPABASE_PASSWORD manquant. Exportez-le avant de lancer ce script :\n"
        "  export SUPABASE_PASSWORD='<mot de passe Supabase>'"
    )
_MDP_URL = quote_plus(_MDP)

DB_URL = os.getenv(
    "DATABASE_URL",
    f"postgresql://postgres.iugsfmvqddburvufzacy:{_MDP_URL}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require"
)

DPE_SCORE = {"A": 100, "B": 85, "C": 65, "D": 45, "E": 25, "F": 10, "G": 0}

def main():
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    print("Calcul score DPE par commune depuis transactions DVF enrichies...")
    cur.execute("""
        SELECT
            code_commune,
            ROUND(AVG(CASE classe_energie
                WHEN 'A' THEN 100 WHEN 'B' THEN 85 WHEN 'C' THEN 65
                WHEN 'D' THEN 45  WHEN 'E' THEN 25 WHEN 'F' THEN 10 WHEN 'G' THEN 0
            END)::numeric, 1) AS score_dpe,
            COUNT(*) AS nb_transactions,
            COUNT(CASE WHEN classe_energie IN ('A','B') THEN 1 END) AS nb_ab,
            COUNT(CASE WHEN classe_energie IN ('F','G') THEN 1 END) AS nb_fg
        FROM transactions
        WHERE classe_energie IS NOT NULL
          AND type_local IN ('Appartement', 'Maison')
        GROUP BY code_commune
        HAVING COUNT(*) >= 10
        ORDER BY score_dpe DESC
    """)
    rows = cur.fetchall()
    print(f"  {len(rows)} communes avec données DPE suffisantes (≥10 transactions)")

    if not rows:
        print("Aucune donnée, abandon.")
        conn.close()
        return

    # Stats avant
    cur.execute("SELECT ROUND(AVG(score_dpe_moyen)::numeric,2), MIN(score_dpe_moyen), MAX(score_dpe_moyen) FROM communes_agregat WHERE score_dpe_moyen IS NOT NULL")
    avant = cur.fetchone()
    print(f"  Score DPE avant : moy={avant[0]}, min={avant[1]}, max={avant[2]}")

    # UPDATE en batch
    updates = [(float(score), int(nb), code) for code, score, nb, _, _ in rows]
    for code, score, nb, nb_ab, nb_fg in rows:
        cur.execute(
            "UPDATE communes_agregat SET score_dpe_moyen = %s WHERE code_commune = %s",
            (float(score), code)
        )

    conn.commit()
    print(f"  {len(rows)} communes mises à jour")

    # Stats après
    cur.execute("SELECT ROUND(AVG(score_dpe_moyen)::numeric,2), MIN(score_dpe_moyen), MAX(score_dpe_moyen) FROM communes_agregat WHERE score_dpe_moyen IS NOT NULL")
    apres = cur.fetchone()
    print(f"  Score DPE après : moy={apres[0]}, min={apres[1]}, max={apres[2]}")

    # Top 10 meilleures communes DPE
    cur.execute("""
        SELECT city, ROUND(score_dpe_moyen::numeric,1) AS score
        FROM communes_agregat
        WHERE score_dpe_moyen IS NOT NULL
        ORDER BY score_dpe_moyen DESC LIMIT 10
    """)
    print("\nTop 10 communes meilleur DPE :")
    for city, score in cur.fetchall():
        print(f"  {city}: {score}/100")

    conn.close()
    print("\nRecalcul DPE terminé ✅")

if __name__ == "__main__":
    main()
