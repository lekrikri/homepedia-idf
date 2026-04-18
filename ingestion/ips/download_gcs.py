"""
ingestion/ips/download_gcs.py
================================
Télécharge l'Indice de Position Sociale (IPS) des écoles et collèges
depuis data.gouv.fr et calcule un IPS moyen par commune IDF.

L'IPS mesure le niveau social moyen des élèves d'un établissement.
Plus il est élevé → meilleur environnement scolaire → très prédicteur du prix immo.
  - IPS < 80  : milieu défavorisé
  - IPS 80-110: milieu intermédiaire
  - IPS > 110 : milieu favorisé (top 25% national ~115 en IDF riche)

Source : data.gouv.fr — dataset 634fefba689b52c6ef7bf3db

Usage :
    python3 ingestion/ips/download_gcs.py
"""

import io
import requests
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import os

PG_HOST     = os.getenv("POSTGRES_HOST", "localhost")
PG_PORT     = int(os.getenv("POSTGRES_PORT", 5433))
PG_DB       = os.getenv("POSTGRES_DB", "homepedia")
PG_USER     = os.getenv("POSTGRES_USER", "homepedia")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "homepedia")

IPS_URL = "https://static.data.gouv.fr/resources/indices-de-position-sociale-geolocalises-des-ecoles-et-colleges-de-france-metropolitaine-et-des-drom-2/20221019-143830/ips-all-geoloc.csv"

DEPTS_IDF = {"75", "77", "78", "91", "92", "93", "94", "95"}


def fetch_ips() -> pd.DataFrame:
    print(f"  ↓ Téléchargement IPS écoles...")
    r = requests.get(IPS_URL, timeout=120)
    r.raise_for_status()
    df = pd.read_csv(io.BytesIO(r.content), sep=",", dtype=str)
    print(f"     {len(df):,} établissements nationaux")

    # Filtrer IDF
    df = df[df["code_dept"].isin(DEPTS_IDF)].copy()
    print(f"     → {len(df):,} établissements en IDF")

    # Convertir IPS en numérique
    df["ips"] = pd.to_numeric(df["ips"], errors="coerce")
    df["code_insee"] = df["code_insee"].astype(str).str.zfill(5)

    return df


def aggregate_by_commune(df: pd.DataFrame) -> pd.DataFrame:
    """
    Agrège par commune :
    - IPS moyen (toutes écoles)
    - IPS public vs privé séparément
    - Nombre d'établissements
    - % établissements "favorisés" (IPS > 110)
    """
    agg = df.groupby("code_insee").agg(
        ips_moyen=("ips", "mean"),
        ips_median=("ips", "median"),
        nb_ecoles=("uai", "count"),
        nb_ecoles_favorisees=("ips", lambda x: (x > 110).sum()),
    ).reset_index()

    agg["pct_ecoles_favorisees"] = (
        agg["nb_ecoles_favorisees"] / agg["nb_ecoles"] * 100
    ).round(1)
    agg["ips_moyen"] = agg["ips_moyen"].round(1)
    agg["ips_median"] = agg["ips_median"].round(1)

    print(f"  → {len(agg):,} communes avec données IPS")
    return agg


def add_ips_columns(conn):
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE communes_agregat
                ADD COLUMN IF NOT EXISTS ips_moyen              DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS ips_median             DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS nb_ecoles              INTEGER,
                ADD COLUMN IF NOT EXISTS pct_ecoles_favorisees  DOUBLE PRECISION
        """)
        conn.commit()
    print("  ✅ Colonnes IPS prêtes")


def update_postgres(conn, df: pd.DataFrame) -> int:
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TEMP TABLE tmp_ips (
                code_commune          CHAR(5),
                ips_moyen             DOUBLE PRECISION,
                ips_median            DOUBLE PRECISION,
                nb_ecoles             INTEGER,
                pct_ecoles_favorisees DOUBLE PRECISION
            ) ON COMMIT DROP
        """)
        data = [
            (str(row.code_insee).zfill(5),
             float(row.ips_moyen) if pd.notna(row.ips_moyen) else None,
             float(row.ips_median) if pd.notna(row.ips_median) else None,
             int(row.nb_ecoles),
             float(row.pct_ecoles_favorisees) if pd.notna(row.pct_ecoles_favorisees) else None)
            for row in df.itertuples()
        ]
        execute_values(cur, "INSERT INTO tmp_ips VALUES %s", data)
        cur.execute("""
            UPDATE communes_agregat ca
            SET
                ips_moyen             = t.ips_moyen,
                ips_median            = t.ips_median,
                nb_ecoles             = t.nb_ecoles,
                pct_ecoles_favorisees = t.pct_ecoles_favorisees
            FROM tmp_ips t
            WHERE ca.code_commune = t.code_commune
        """)
        updated = cur.rowcount
        conn.commit()
    return updated


def main():
    print("🏫 Ingestion IPS Écoles → PostgreSQL\n")

    df_raw = fetch_ips()
    df_agg = aggregate_by_commune(df_raw)

    conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT,
        dbname=PG_DB, user=PG_USER, password=PG_PASSWORD
    )
    add_ips_columns(conn)
    updated = update_postgres(conn, df_agg)
    print(f"  → {updated} communes mises à jour ✅")

    # Vérification — top/bottom communes IDF
    with conn.cursor() as cur:
        cur.execute("""
            SELECT city, ips_moyen, nb_ecoles, pct_ecoles_favorisees
            FROM communes_agregat
            WHERE ips_moyen IS NOT NULL
            ORDER BY ips_moyen DESC
            LIMIT 5
        """)
        top = cur.fetchall()
        cur.execute("""
            SELECT city, ips_moyen, nb_ecoles, pct_ecoles_favorisees
            FROM communes_agregat
            WHERE ips_moyen IS NOT NULL
            ORDER BY ips_moyen ASC
            LIMIT 5
        """)
        bottom = cur.fetchall()
    conn.close()

    print("\nTop 5 IPS (communes les plus favorisées) :")
    print(f"  {'Commune':<30} {'IPS':>6} {'Écoles':>7} {'% favorisées':>14}")
    print("  " + "-" * 60)
    for city, ips, nb, pct in top:
        print(f"  {(city or '?'):<30} {ips:>6.1f} {nb:>7} {(pct or 0):>13.1f}%")

    print("\nBottom 5 IPS (communes les moins favorisées) :")
    print(f"  {'Commune':<30} {'IPS':>6} {'Écoles':>7} {'% favorisées':>14}")
    print("  " + "-" * 60)
    for city, ips, nb, pct in bottom:
        print(f"  {(city or '?'):<30} {ips:>6.1f} {nb:>7} {(pct or 0):>13.1f}%")

    print("\n✅ Ingestion IPS terminée !")


if __name__ == "__main__":
    main()
