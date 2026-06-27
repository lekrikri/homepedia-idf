"""
ingestion/dvf/update_dvf_agregats.py
=====================================
Recalcule les agrégats DVF dans communes_agregat depuis la table transactions.

Met à jour :
  - prix_median_m2         : prix médian au m² (appartements + maisons)
  - prix_moyen_m2          : prix moyen au m²
  - nb_transactions        : nombre de transactions
  - surface_moyenne        : surface moyenne des biens
  - prix_median_transaction: valeur foncière médiane par transaction

Usage :
    python ingestion/dvf/update_dvf_agregats.py
"""

import os
import psycopg2

PG_HOST     = os.getenv("SUPABASE_HOST",     "db.iugsfmvqddburvufzacy.supabase.co")
PG_PORT     = int(os.getenv("SUPABASE_PORT", "5432"))
PG_DB       = os.getenv("SUPABASE_DB",       "postgres")
PG_USER     = os.getenv("SUPABASE_USER",     "postgres")
PG_PASSWORD = os.getenv("SUPABASE_PASSWORD", "@fanfan_gwada_971")

SQL_UPDATE = """
WITH agg AS (
    SELECT
        code_commune,
        PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY valeur_fonciere / NULLIF(surface_reelle_bati, 0)
        )                                                       AS prix_median_m2,
        AVG(valeur_fonciere / NULLIF(surface_reelle_bati, 0))  AS prix_moyen_m2,
        COUNT(*)                                                AS nb_transactions,
        AVG(surface_reelle_bati)                               AS surface_moyenne,
        PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY valeur_fonciere
        )                                                       AS prix_median_transaction
    FROM transactions
    WHERE surface_reelle_bati > 5
      AND valeur_fonciere     > 10000
      AND type_local IN ('Appartement', 'Maison')
    GROUP BY code_commune
)
UPDATE communes_agregat ca
SET
    prix_median_m2          = agg.prix_median_m2,
    prix_moyen_m2           = agg.prix_moyen_m2,
    nb_transactions         = agg.nb_transactions,
    surface_moyenne         = agg.surface_moyenne,
    prix_median_transaction = agg.prix_median_transaction,
    updated_at              = NOW()
FROM agg
WHERE ca.code_commune = agg.code_commune
RETURNING ca.code_commune
"""

def main():
    print("📊 Mise à jour agrégats DVF → communes_agregat")
    print(f"   Host : {PG_HOST}\n")

    conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT, dbname=PG_DB,
        user=PG_USER, password=PG_PASSWORD,
        sslmode="require",
        options="-c statement_timeout=600000 -c default_transaction_read_only=off"
    )
    conn.set_session(readonly=False, autocommit=False)

    # Stats avant
    with conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(*) as n,
                   MIN(date_mutation) as debut,
                   MAX(date_mutation) as fin,
                   COUNT(DISTINCT EXTRACT(YEAR FROM date_mutation)) as nb_annees
            FROM transactions
            WHERE surface_reelle_bati > 5
              AND valeur_fonciere > 10000
              AND type_local IN ('Appartement', 'Maison')
        """)
        n, debut, fin, nb_annees = cur.fetchone()
    print(f"   Transactions source : {n:,} ({nb_annees} années, {debut} → {fin})")

    print("   Calcul en cours (PERCENTILE_CONT, ~10-30s)…")
    with conn.cursor() as cur:
        cur.execute(SQL_UPDATE)
        updated = cur.rowcount
    conn.commit()

    print(f"   ✅ {updated} communes mises à jour\n")

    # Stats après
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
                COUNT(*) as total,
                ROUND(AVG(prix_median_m2)::numeric, 0) as prix_med_moyen,
                ROUND(MIN(prix_median_m2)::numeric, 0) as prix_min,
                ROUND(MAX(prix_median_m2)::numeric, 0) as prix_max,
                SUM(nb_transactions) as total_trans
            FROM communes_agregat
            WHERE prix_median_m2 IS NOT NULL
        """)
        total, prix_med, prix_min, prix_max, total_trans = cur.fetchone()
    print(f"   communes_agregat : {total} communes avec prix")
    print(f"   Prix médian IDF  : {prix_med} €/m²  (min {prix_min} — max {prix_max})")
    print(f"   Total trans pris en compte : {total_trans:,}")

    conn.close()
    print("\n✅ Agrégats DVF mis à jour !")


if __name__ == "__main__":
    main()
