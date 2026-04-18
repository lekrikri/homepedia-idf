"""
ingestion/insee/download_gcs.py
=================================
Télécharge les données INSEE depuis data.gouv.fr :
  - Populations légales 2021 (RP INSEE)
  - Revenus médians et taux de pauvreté 2021 (Filosofi)

Et les importe directement dans PostgreSQL (ces datasets sont petits,
pas besoin de passer par GCS/BigQuery).

Usage :
    python3 ingestion/insee/download_gcs.py
"""

import io
import zipfile
import requests
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import os

# ── PostgreSQL ─────────────────────────────────────────────────────────────────
PG_HOST     = os.getenv("POSTGRES_HOST", "localhost")
PG_PORT     = int(os.getenv("POSTGRES_PORT", 5433))
PG_DB       = os.getenv("POSTGRES_DB", "homepedia")
PG_USER     = os.getenv("POSTGRES_USER", "homepedia")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "homepedia")

# Départements IDF pour filtrer
DEPTS_IDF = {"75", "77", "78", "91", "92", "93", "94", "95"}


# ──────────────────────────────────────────────────────────────
# Source 1 : Populations légales INSEE 2021
# ──────────────────────────────────────────────────────────────

def fetch_populations() -> pd.DataFrame:
    """Télécharge les populations légales depuis INSEE."""
    url = "https://www.insee.fr/fr/statistiques/fichier/7739582/ensemble.zip"
    print(f"  ↓ Populations INSEE : {url}")

    r = requests.get(url, timeout=120)
    r.raise_for_status()

    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        names = z.namelist()
        csv_files = [n for n in names if "commune" in n.lower() and n.endswith(".csv")]
        target = csv_files[0] if csv_files else names[0]
        print(f"     Fichier dans ZIP : {target}")
        with z.open(target) as f:
            df = pd.read_csv(f, sep=";", dtype=str, low_memory=False)

    print(f"     {len(df):,} lignes, colonnes : {list(df.columns[:8])}...")

    # Colonnes clés (noms peuvent varier selon la version)
    rename = {}
    for col in df.columns:
        col_up = col.upper()
        if col_up in ("COM", "CODGEO"):
            rename[col] = "code_commune"
        elif col_up in ("PMUN", "PMUN21"):
            rename[col] = "population_municipale"
        elif col_up in ("PTOT", "PTOT21"):
            rename[col] = "population_totale"
        elif col_up in ("DEP",):
            rename[col] = "code_departement"

    df = df.rename(columns=rename)

    keep = [c for c in ["code_commune", "code_departement", "population_municipale", "population_totale"] if c in df.columns]
    df = df[keep].copy()

    df["code_commune"] = df["code_commune"].astype(str).str.zfill(5)

    # Filtrer IDF
    if "code_departement" in df.columns:
        df = df[df["code_departement"].isin(DEPTS_IDF)]
    else:
        df = df[df["code_commune"].str[:2].isin(DEPTS_IDF) |
                df["code_commune"].str[:3].isin({"750", "751", "752", "753", "754", "755",
                                                  "756", "757", "758", "759"})]

    for col in ["population_municipale", "population_totale"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    print(f"     → {len(df):,} communes IDF")
    return df


# ──────────────────────────────────────────────────────────────
# Source 2 : Revenus Filosofi 2021 (data.gouv.fr)
# ──────────────────────────────────────────────────────────────

def fetch_revenus() -> pd.DataFrame:
    """
    Télécharge les revenus médians depuis data.gouv.fr (Filosofi 2021).
    URL stable via l'API data.gouv.fr.
    """
    # Dataset Filosofi sur data.gouv.fr — revenus par commune
    url = "https://www.data.gouv.fr/fr/datasets/r/f03bc4e1-6e18-4abc-8c24-7e0dad6e1bb9"
    print(f"  ↓ Revenus Filosofi : {url}")

    try:
        r = requests.get(url, timeout=120, allow_redirects=True)
        r.raise_for_status()
    except Exception as e:
        print(f"  ⚠️  Erreur téléchargement Filosofi : {e}")
        print("     Tentative avec l'URL alternative...")
        # URL alternative (fichier direct Filosofi)
        url2 = "https://www.insee.fr/fr/statistiques/fichier/7233950/FILO2021_DISP_COM.zip"
        try:
            r = requests.get(url2, timeout=120)
            r.raise_for_status()
        except Exception as e2:
            print(f"  ❌ Impossible de télécharger les revenus : {e2}")
            return pd.DataFrame()

    content_type = r.headers.get("Content-Type", "")

    if "zip" in content_type or url.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            csv_files = [n for n in z.namelist() if n.upper().endswith(".CSV")]
            target = csv_files[0]
            print(f"     Fichier dans ZIP : {target}")
            with z.open(target) as f:
                df = pd.read_csv(f, sep=";", dtype=str, low_memory=False)
    else:
        # Fichier CSV direct
        df = pd.read_csv(io.BytesIO(r.content), sep=";", dtype=str, low_memory=False)

    print(f"     {len(df):,} lignes, colonnes : {list(df.columns[:8])}...")

    # Renommage colonnes Filosofi
    rename = {}
    for col in df.columns:
        col_up = col.upper()
        if col_up in ("CODGEO", "COM", "CODE_COMMUNE"):
            rename[col] = "code_commune"
        elif col_up in ("MED21", "REVENU_MEDIAN", "Q221"):
            rename[col] = "revenu_median"
        elif col_up in ("TP6021", "TAUX_PAUVRETE"):
            rename[col] = "taux_pauvrete"
        elif col_up in ("RD21",):
            rename[col] = "ratio_interdecile"

    df = df.rename(columns=rename)

    if "code_commune" not in df.columns:
        print("  ❌ Colonne code_commune introuvable dans le fichier Filosofi")
        return pd.DataFrame()

    keep = [c for c in ["code_commune", "revenu_median", "taux_pauvrete"] if c in df.columns]
    df = df[keep].copy()
    df["code_commune"] = df["code_commune"].astype(str).str.zfill(5)

    # Filtrer IDF
    df = df[df["code_commune"].str[:2].isin(DEPTS_IDF) |
            df["code_commune"].str[:3].isin({"750", "751", "752", "753", "754",
                                              "755", "756", "757", "758", "759"})]

    for col in ["revenu_median", "taux_pauvrete"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col].str.replace(",", "."), errors="coerce")

    print(f"     → {len(df):,} communes IDF avec données revenus")
    return df


# ──────────────────────────────────────────────────────────────
# Import PostgreSQL
# ──────────────────────────────────────────────────────────────

def add_revenu_columns_if_needed(conn):
    """Ajoute les colonnes revenus si elles n'existent pas encore."""
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE communes_agregat
                ADD COLUMN IF NOT EXISTS revenu_median     DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS taux_pauvrete     DOUBLE PRECISION
        """)
        conn.commit()
    print("  ✅ Colonnes revenu_median, taux_pauvrete prêtes")


def update_populations(conn, df: pd.DataFrame) -> int:
    """Met à jour population_totale et population_municipale."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TEMP TABLE tmp_pop (
                code_commune         CHAR(5),
                population_municipale BIGINT,
                population_totale     BIGINT
            ) ON COMMIT DROP
        """)
        data = [
            (row.code_commune,
             int(row.population_municipale) if pd.notna(getattr(row, "population_municipale", None)) else None,
             int(row.population_totale) if pd.notna(getattr(row, "population_totale", None)) else None)
            for row in df.itertuples()
        ]
        execute_values(cur, "INSERT INTO tmp_pop VALUES %s", data)
        cur.execute("""
            UPDATE communes_agregat ca
            SET
                population_municipale = t.population_municipale,
                population_totale     = t.population_totale
            FROM tmp_pop t
            WHERE ca.code_commune = t.code_commune
        """)
        updated = cur.rowcount
        conn.commit()
    return updated


def update_revenus(conn, df: pd.DataFrame) -> int:
    """Met à jour revenu_median et taux_pauvrete."""
    if df.empty:
        return 0
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TEMP TABLE tmp_rev (
                code_commune   CHAR(5),
                revenu_median  DOUBLE PRECISION,
                taux_pauvrete  DOUBLE PRECISION
            ) ON COMMIT DROP
        """)
        data = [
            (row.code_commune,
             float(row.revenu_median) if "revenu_median" in df.columns and pd.notna(row.revenu_median) else None,
             float(row.taux_pauvrete) if "taux_pauvrete" in df.columns and pd.notna(row.taux_pauvrete) else None)
            for row in df.itertuples()
        ]
        execute_values(cur, "INSERT INTO tmp_rev VALUES %s", data)
        cur.execute("""
            UPDATE communes_agregat ca
            SET
                revenu_median = t.revenu_median,
                taux_pauvrete = t.taux_pauvrete
            FROM tmp_rev t
            WHERE ca.code_commune = t.code_commune
        """)
        updated = cur.rowcount
        conn.commit()
    return updated


# ──────────────────────────────────────────────────────────────
# Point d'entrée
# ──────────────────────────────────────────────────────────────

def main():
    print("🚀 Ingestion INSEE → PostgreSQL\n")

    conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT,
        dbname=PG_DB, user=PG_USER, password=PG_PASSWORD
    )

    # S'assurer que les colonnes revenus existent
    add_revenu_columns_if_needed(conn)

    # 1. Populations
    print("\n📊 Source 1 : Populations légales 2021")
    df_pop = fetch_populations()
    if not df_pop.empty:
        n = update_populations(conn, df_pop)
        print(f"  → {n} communes mises à jour (populations)")

    # 2. Revenus Filosofi
    print("\n💰 Source 2 : Revenus médians Filosofi 2021")
    df_rev = fetch_revenus()
    if not df_rev.empty:
        n = update_revenus(conn, df_rev)
        print(f"  → {n} communes mises à jour (revenus)")

    conn.close()

    print("\n✅ Ingestion INSEE terminée !")

    # Vérification
    conn2 = psycopg2.connect(
        host=PG_HOST, port=PG_PORT,
        dbname=PG_DB, user=PG_USER, password=PG_PASSWORD
    )
    with conn2.cursor() as cur:
        cur.execute("""
            SELECT city, revenu_median, taux_pauvrete, population_totale
            FROM communes_agregat
            WHERE revenu_median IS NOT NULL
            ORDER BY revenu_median DESC
            LIMIT 5
        """)
        rows = cur.fetchall()
    conn2.close()

    if rows:
        print("\nTop 5 communes par revenu médian :")
        print(f"  {'Commune':<30} {'Revenu médian':>15} {'Taux pauvreté':>15}")
        print("  " + "-" * 62)
        for city, rev, tp, pop in rows:
            print(f"  {(city or '?'):<30} {int(rev or 0):>14}€ {(tp or 0):>14.1f}%")


if __name__ == "__main__":
    main()
