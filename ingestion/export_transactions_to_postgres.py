"""
ingestion/export_transactions_to_postgres.py
=============================================
Exporte les transactions depuis BigQuery silver_transactions vers
PostgreSQL Supabase — table publique `transactions`.

Colonnes non présentes dans silver (adresse_numero, adresse_voie, code_iris,
section, numero_plan) sont laissées NULL. La géométrie PostGIS est calculée
depuis longitude/latitude.

Usage :
    # Ajouter uniquement 2025
    POSTGRES_HOST=... POSTGRES_USER=... POSTGRES_PASSWORD=... \\
    python ingestion/export_transactions_to_postgres.py --annee 2025

    # Recharger une année complète (TRUNCATE + INSERT)
    python ingestion/export_transactions_to_postgres.py --annee 2024 --replace

Variables d'env requises :
    POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
"""

import os
import sys
import argparse
from google.cloud import bigquery
import psycopg2
from psycopg2.extras import execute_values

PROJECT  = "homepedia-493013"
DATASET  = "homepedia_dev_silver"
TABLE    = "silver_transactions"

PG_HOST     = os.getenv("POSTGRES_HOST", "localhost")
PG_PORT     = int(os.getenv("POSTGRES_PORT", 5432))
PG_DB       = os.getenv("POSTGRES_DB", "postgres")
PG_USER     = os.getenv("POSTGRES_USER", "postgres")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "")


def read_from_bigquery(annee: int) -> list[tuple]:
    print(f"\n📡 Lecture BigQuery : silver_transactions annee={annee}")
    client = bigquery.Client(project=PROJECT)

    query = f"""
        SELECT
            id_mutation,
            date_mutation,
            nature_mutation,
            valeur_fonciere,
            code_postal,
            nom_commune       AS commune,
            code_commune,
            surface_terrain,
            type_local,
            surface_reelle_bati,
            CAST(nb_pieces AS INT64) AS nombre_pieces,
            longitude,
            latitude,
            annee             AS source_annee
        FROM `{PROJECT}.{DATASET}.{TABLE}`
        WHERE annee = {annee}
          AND code_commune IS NOT NULL
          AND id_mutation IS NOT NULL
    """
    rows = list(client.query(query).result())
    print(f"  → {len(rows):,} transactions lues")
    return rows


def get_valid_communes(conn) -> set:
    with conn.cursor() as cur:
        cur.execute("SELECT code_insee FROM communes")
        return {r[0] for r in cur.fetchall()}


def insert_transactions(conn, rows: list, valid_communes: set, annee: int, replace: bool):
    if replace:
        print(f"  🗑️  Suppression des transactions existantes annee={annee}...")
        with conn.cursor() as cur:
            cur.execute("DELETE FROM transactions WHERE source_annee = %s", (annee,))
        conn.commit()
        print(f"     Supprimées ✅")

    records = []
    skipped = 0
    for r in rows:
        code = r["code_commune"] if r["code_commune"] else ""
        code = str(code).strip().zfill(5)
        if code not in valid_communes:
            skipped += 1
            continue

        lon = r["longitude"]
        lat = r["latitude"]
        geom = f"SRID=4326;POINT({lon} {lat})" if lon and lat else None

        records.append((
            str(r["id_mutation"]),
            r["date_mutation"],
            r["nature_mutation"],
            float(r["valeur_fonciere"]) if r["valeur_fonciere"] else None,
            None,  # adresse_numero
            None,  # adresse_voie
            r["code_postal"],
            r["commune"],
            code,
            None,  # code_iris
            None,  # section
            None,  # numero_plan
            float(r["surface_terrain"]) if r["surface_terrain"] else None,
            r["type_local"],
            float(r["surface_reelle_bati"]) if r["surface_reelle_bati"] else None,
            int(r["nombre_pieces"]) if r["nombre_pieces"] else None,
            lon,
            lat,
            geom,
            int(r["source_annee"]),
        ))

    if skipped:
        print(f"  ⚠️  {skipped} lignes ignorées (commune hors IDF ou inconnue)")

    print(f"  💾 Insertion {len(records):,} transactions annee={annee}...")

    SQL = """
        INSERT INTO transactions (
            id_mutation, date_mutation, nature_mutation, valeur_fonciere,
            adresse_numero, adresse_voie, code_postal, commune, code_commune,
            code_iris, section, numero_plan,
            surface_terrain, type_local, surface_reelle_bati, nombre_pieces,
            longitude, latitude, geom,
            source_annee
        )
        VALUES %s
        ON CONFLICT (id_mutation, date_mutation, type_local) DO NOTHING
    """

    batch = 2000
    inserted = 0
    for i in range(0, len(records), batch):
        chunk = records[i:i+batch]
        with conn.cursor() as cur:
            execute_values(cur, SQL, chunk, template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,ST_GeomFromEWKT(%s),%s)")
            inserted += cur.rowcount
        conn.commit()
        print(f"     {min(i+batch, len(records)):,}/{len(records):,}…", end="\r")

    print(f"\n  ✅ {inserted:,} nouvelles transactions insérées (doublons ignorés)")
    return inserted


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--annee", type=int, default=2025, help="Année à importer (défaut: 2025)")
    parser.add_argument("--replace", action="store_true", help="Supprimer et réinsérer l'année complète")
    args = parser.parse_args()

    print(f"🚀 Export silver_transactions {args.annee} → PostgreSQL")
    print(f"   DB : {PG_HOST}:{PG_PORT}/{PG_DB}\n")

    rows = read_from_bigquery(args.annee)
    if not rows:
        print("⚠️  Aucune donnée trouvée, abandon.")
        sys.exit(1)

    conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT,
        dbname=PG_DB, user=PG_USER, password=PG_PASSWORD,
        sslmode="require", options="-c statement_timeout=120000"
    )

    valid_communes = get_valid_communes(conn)
    print(f"  → {len(valid_communes)} communes valides en base\n")

    inserted = insert_transactions(conn, rows, valid_communes, args.annee, args.replace)
    conn.close()

    print(f"\n🎉 Terminé ! {inserted:,} transactions {args.annee} ajoutées dans Supabase.")


if __name__ == "__main__":
    main()
