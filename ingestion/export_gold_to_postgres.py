"""
ingestion/export_gold_to_postgres.py
======================================
Lit la table gold BigQuery (gold_communes_agregat)
et met à jour les colonnes DVF dans PostgreSQL (communes_agregat).

On ne touche PAS aux colonnes déjà remplies (city, population, OSM, etc.)
On UPDATE uniquement : prix_median_m2, prix_moyen_m2, nb_transactions,
                       surface_moyenne, prix_median_transaction, updated_at

Usage :
    python3 ingestion/export_gold_to_postgres.py
"""

from google.cloud import bigquery
import psycopg2
from psycopg2.extras import execute_values
import os

# ── BigQuery ───────────────────────────────────────────────────────────────────
PROJECT   = "homepedia-493013"
GOLD_TABLE = f"{PROJECT}.homepedia_dev_gold.gold_communes_agregat"

# ── PostgreSQL (Supabase) ──────────────────────────────────────────────────────
PG_HOST     = os.getenv("POSTGRES_HOST", "localhost")
PG_PORT     = int(os.getenv("POSTGRES_PORT", 5433))
PG_DB       = os.getenv("POSTGRES_DB", "homepedia")
PG_USER     = os.getenv("POSTGRES_USER", "homepedia")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "homepedia")


def fetch_gold_from_bigquery() -> list[dict]:
    """Récupère les agrégats communes depuis BigQuery."""
    print(f"📡 Lecture BigQuery : {GOLD_TABLE}")
    client = bigquery.Client(project=PROJECT)

    query = f"""
    SELECT
        code_commune,
        nb_transactions,
        prix_median_m2,
        prix_moyen_m2,
        surface_moyenne,
        prix_median_transaction
    FROM `{GOLD_TABLE}`
    WHERE code_commune IS NOT NULL
    ORDER BY code_commune
    """

    rows = list(client.query(query).result())
    print(f"  → {len(rows)} communes lues depuis BigQuery")
    return rows


def update_postgres(rows: list) -> int:
    """
    Met à jour les colonnes DVF dans communes_agregat.
    Utilise un UPDATE via table temporaire pour être rapide.
    """
    conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT,
        dbname=PG_DB, user=PG_USER, password=PG_PASSWORD
    )
    cur = conn.cursor()

    # Table temporaire pour le batch update
    cur.execute("""
        CREATE TEMP TABLE tmp_gold (
            code_commune          CHAR(5),
            nb_transactions       BIGINT,
            prix_median_m2        DOUBLE PRECISION,
            prix_moyen_m2         DOUBLE PRECISION,
            surface_moyenne       DOUBLE PRECISION,
            prix_median_transaction DOUBLE PRECISION
        ) ON COMMIT DROP
    """)

    # Insérer toutes les lignes BigQuery dans la temp table
    data = [
        (
            str(r.code_commune).zfill(5),  # s'assurer que c'est bien 5 chiffres
            r.nb_transactions,
            r.prix_median_m2,
            r.prix_moyen_m2,
            r.surface_moyenne,
            r.prix_median_transaction,
        )
        for r in rows
    ]

    execute_values(cur, """
        INSERT INTO tmp_gold
            (code_commune, nb_transactions, prix_median_m2, prix_moyen_m2,
             surface_moyenne, prix_median_transaction)
        VALUES %s
    """, data)

    # UPDATE en masse : uniquement les communes déjà présentes dans communes_agregat
    cur.execute("""
        UPDATE communes_agregat ca
        SET
            nb_transactions          = t.nb_transactions,
            prix_median_m2           = t.prix_median_m2,
            prix_moyen_m2            = t.prix_moyen_m2,
            surface_moyenne          = t.surface_moyenne,
            prix_median_transaction  = t.prix_median_transaction,
            updated_at               = now()
        FROM tmp_gold t
        WHERE ca.code_commune = t.code_commune
    """)

    updated = cur.rowcount
    conn.commit()
    cur.close()
    conn.close()
    return updated


def main():
    print("🚀 Export BigQuery Gold → PostgreSQL\n")

    rows = fetch_gold_from_bigquery()
    if not rows:
        print("❌ Aucune donnée dans BigQuery !")
        return

    print(f"\n💾 Mise à jour PostgreSQL {PG_HOST}:{PG_PORT}/{PG_DB}...")
    updated = update_postgres(rows)
    print(f"  → {updated} communes mises à jour ✅")

    # Vérification
    conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT,
        dbname=PG_DB, user=PG_USER, password=PG_PASSWORD
    )
    cur = conn.cursor()
    cur.execute("""
        SELECT city, code_commune, prix_median_m2, nb_transactions
        FROM communes_agregat
        WHERE prix_median_m2 IS NOT NULL
        ORDER BY prix_median_m2 DESC
        LIMIT 5
    """)
    print("\nTop 5 communes par prix médian/m² :")
    print(f"  {'Commune':<30} {'Code':<6} {'€/m²':>8} {'Transactions':>14}")
    print("  " + "-" * 62)
    for row in cur.fetchall():
        city, code, prix, nb = row
        print(f"  {(city or '?'):<30} {code:<6} {int(prix or 0):>7}€ {(nb or 0):>14,}")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
