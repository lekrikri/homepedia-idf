"""
ingestion/energie/download_gcs.py
===================================
Télécharge les consommations annuelles d'électricité et de gaz par commune
depuis l'agenceORE (données ENEDIS + GRDF agrégées).

Source : data.gouv.fr → dataset 65f1185fd7321d8e647ba548
API   : opendata.agenceore.fr

Données récupérées (secteur RESIDENTIEL uniquement) :
  - Conso électricité résidentielle (MWh/an) par commune
  - Conso gaz résidentielle (MWh/an) par commune
  → Conso moyenne par logement = proxy qualité isolation réelle

Usage :
    python3 ingestion/energie/download_gcs.py
"""

import requests
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import os
import time

PG_HOST     = os.getenv("POSTGRES_HOST", "localhost")
PG_PORT     = int(os.getenv("POSTGRES_PORT", 5433))
PG_DB       = os.getenv("POSTGRES_DB", "homepedia")
PG_USER     = os.getenv("POSTGRES_USER", "homepedia")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "homepedia")

API_BASE = "https://opendata.agenceore.fr/data-fair/api/v1/datasets/consommation-annuelle-d-electricite-et-gaz-par-commune/lines"

# IDF = code_region 11
REGION_IDF = "11"


def fetch_filiere(filiere: str) -> pd.DataFrame:
    """Récupère les données résidentielles pour une filière (Electricité ou Gaz)."""
    all_rows = []
    after = None

    print(f"  📡 {filiere} résidentiel IDF...")

    while True:
        params = {
            "size": 10000,
            "qs": f'code_region:{REGION_IDF} AND code_grand_secteur:RESIDENTIEL AND filiere:"{filiere}"',
            "sort": "-annee",
        }
        if after:
            params["after"] = after

        try:
            r = requests.get(API_BASE, params=params, timeout=60)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            print(f"  ❌ Erreur : {e}")
            break

        results = data.get("results", [])
        if not results:
            break

        all_rows.extend(results)
        total = data.get("total", 0)
        print(f"     {len(all_rows):,}/{total:,}", end="\r")

        next_url = data.get("next")
        if not next_url or len(all_rows) >= total:
            break

        from urllib.parse import urlparse, parse_qs
        qs = parse_qs(urlparse(next_url).query)
        after_vals = qs.get("after", [])
        if not after_vals:
            break
        after = after_vals[0]
        time.sleep(0.1)

    print()
    if not all_rows:
        return pd.DataFrame()

    df = pd.DataFrame(all_rows)
    print(f"     → {len(df):,} lignes")
    return df


def process_to_commune(df_elec: pd.DataFrame, df_gaz: pd.DataFrame) -> pd.DataFrame:
    """Agrège par commune en gardant la dernière année disponible."""

    def agg_latest(df: pd.DataFrame, prefix: str) -> pd.DataFrame:
        if df.empty:
            return pd.DataFrame()
        df = df.copy()
        df["annee"] = pd.to_numeric(df["annee"], errors="coerce")
        df["conso_totale_mwh"] = pd.to_numeric(df["conso_totale_mwh"], errors="coerce")
        df["nb_sites"] = pd.to_numeric(df["nb_sites"], errors="coerce")

        # Regrouper par commune + année, sommer la conso résidentielle totale
        grp = df.groupby(["code_commune", "nom_commune", "annee"]).agg(
            conso_mwh=("conso_totale_mwh", "sum"),
            nb_sites=("nb_sites", "sum"),
        ).reset_index()

        # Garder seulement la dernière année par commune
        grp = grp.sort_values("annee", ascending=False)
        grp = grp.drop_duplicates(subset=["code_commune"], keep="first")

        grp["conso_par_logement"] = (grp["conso_mwh"] / grp["nb_sites"].replace(0, float('nan'))).round(2)
        grp = grp.rename(columns={
            "conso_mwh": f"conso_{prefix}_mwh",
            "nb_sites": f"nb_sites_{prefix}",
            "conso_par_logement": f"conso_{prefix}_par_logement",
        })
        return grp[["code_commune", "nom_commune", f"conso_{prefix}_mwh",
                    f"nb_sites_{prefix}", f"conso_{prefix}_par_logement"]]

    elec = agg_latest(df_elec, "elec")
    gaz  = agg_latest(df_gaz, "gaz")

    if elec.empty and gaz.empty:
        return pd.DataFrame()
    elif elec.empty:
        result = gaz
    elif gaz.empty:
        result = elec
    else:
        result = elec.merge(gaz[["code_commune", "conso_gaz_mwh",
                                  "nb_sites_gaz", "conso_gaz_par_logement"]],
                             on="code_commune", how="outer")

    result["code_commune"] = result["code_commune"].astype(str).str.zfill(5)
    print(f"  → {len(result):,} communes avec données énergie")
    return result


def add_energie_columns(conn):
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE communes_agregat
                ADD COLUMN IF NOT EXISTS conso_elec_mwh           DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS conso_gaz_mwh            DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS conso_elec_par_logement   DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS conso_gaz_par_logement    DOUBLE PRECISION
        """)
        conn.commit()
    print("  ✅ Colonnes énergie prêtes")


def update_postgres(conn, df: pd.DataFrame) -> int:
    cols_pg = ["code_commune", "conso_elec_mwh", "conso_gaz_mwh",
               "conso_elec_par_logement", "conso_gaz_par_logement"]

    for c in cols_pg:
        if c not in df.columns:
            df[c] = None

    with conn.cursor() as cur:
        cur.execute("""
            CREATE TEMP TABLE tmp_energie (
                code_commune              CHAR(5),
                conso_elec_mwh            DOUBLE PRECISION,
                conso_gaz_mwh             DOUBLE PRECISION,
                conso_elec_par_logement   DOUBLE PRECISION,
                conso_gaz_par_logement    DOUBLE PRECISION
            ) ON COMMIT DROP
        """)

        def safe_float(v):
            try:
                return float(v) if v is not None and pd.notna(v) else None
            except Exception:
                return None

        data = [
            (str(row.code_commune).zfill(5),
             safe_float(getattr(row, "conso_elec_mwh", None)),
             safe_float(getattr(row, "conso_gaz_mwh", None)),
             safe_float(getattr(row, "conso_elec_par_logement", None)),
             safe_float(getattr(row, "conso_gaz_par_logement", None)))
            for row in df.itertuples()
        ]
        execute_values(cur, "INSERT INTO tmp_energie VALUES %s", data)
        cur.execute("""
            UPDATE communes_agregat ca
            SET
                conso_elec_mwh          = t.conso_elec_mwh,
                conso_gaz_mwh           = t.conso_gaz_mwh,
                conso_elec_par_logement = t.conso_elec_par_logement,
                conso_gaz_par_logement  = t.conso_gaz_par_logement
            FROM tmp_energie t
            WHERE ca.code_commune = t.code_commune
        """)
        updated = cur.rowcount
        conn.commit()
    return updated


def main():
    print("⚡ Ingestion Énergie ENEDIS/GRDF → PostgreSQL\n")

    df_elec = fetch_filiere("Electricité")
    df_gaz  = fetch_filiere("Gaz")

    if df_elec.empty and df_gaz.empty:
        print("❌ Aucune donnée récupérée")
        return

    print("\n🔄 Agrégation par commune...")
    df = process_to_commune(df_elec, df_gaz)

    if df.empty:
        print("❌ Aucune commune après agrégation")
        return

    conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT,
        dbname=PG_DB, user=PG_USER, password=PG_PASSWORD
    )
    add_energie_columns(conn)
    updated = update_postgres(conn, df)
    print(f"  → {updated} communes mises à jour ✅")

    # Vérification
    with conn.cursor() as cur:
        cur.execute("""
            SELECT city, conso_elec_par_logement, conso_gaz_par_logement
            FROM communes_agregat
            WHERE conso_elec_par_logement IS NOT NULL
            ORDER BY conso_elec_par_logement DESC
            LIMIT 5
        """)
        rows = cur.fetchall()
    conn.close()

    if rows:
        print("\nTop 5 conso électricité/logement :")
        print(f"  {'Commune':<30} {'Élec MWh/log':>13} {'Gaz MWh/log':>13}")
        print("  " + "-" * 58)
        for city, elec, gaz in rows:
            print(f"  {(city or '?'):<30} {(elec or 0):>12.1f} {(gaz or 0):>12.1f}")

    print("\n✅ Terminé !")


if __name__ == "__main__":
    main()
