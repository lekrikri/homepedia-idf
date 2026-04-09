"""
import_gold_to_postgres.py
Lit gold/communes_agregat/ depuis Azure ADLS Gen2
et importe dans PostgreSQL local (table communes_agregat).

Usage :
    pip install azure-storage-blob pandas pyarrow psycopg2-binary python-dotenv
    python ingestion/import_gold_to_postgres.py
"""

import io
import os
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from sqlalchemy import create_engine, text
from azure.storage.blob import BlobServiceClient
from dotenv import load_dotenv

load_dotenv()

# ── Config Azure ───────────────────────────────────────────────────────────────
AZURE_ACCOUNT_NAME = os.getenv("ADLS_ACCOUNT_NAME", "homepediadatalake")
AZURE_ACCOUNT_KEY  = os.getenv("ADLS_ACCOUNT_KEY")   # clé d'accès Azure Portal → Clés d'accès
GOLD_CONTAINER     = "gold"
GOLD_PREFIX        = "communes_agregat/"

# ── Config PostgreSQL ──────────────────────────────────────────────────────────
PG_HOST     = os.getenv("POSTGRES_HOST", "localhost")
PG_PORT     = int(os.getenv("POSTGRES_PORT", 5433))
PG_DB       = os.getenv("POSTGRES_DB", "homepedia")
PG_USER     = os.getenv("POSTGRES_USER", "homepedia")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "homepedia123")


def download_parquet_from_azure() -> pd.DataFrame:
    print(f"🔌 Connexion Azure : {AZURE_ACCOUNT_NAME}/{GOLD_CONTAINER}/{GOLD_PREFIX}")
    client = BlobServiceClient(
        account_url=f"https://{AZURE_ACCOUNT_NAME}.blob.core.windows.net",
        credential=AZURE_ACCOUNT_KEY,
    )
    container = client.get_container_client(GOLD_CONTAINER)

    blobs = [b for b in container.list_blobs(name_starts_with=GOLD_PREFIX)
             if b.name.endswith(".parquet")]

    if not blobs:
        raise FileNotFoundError(f"Aucun fichier Parquet dans {GOLD_CONTAINER}/{GOLD_PREFIX}")

    print(f"  → {len(blobs)} fichier(s) Parquet trouvé(s)")
    frames = []
    for blob in blobs:
        print(f"  → Téléchargement : {blob.name} ({blob.size // 1024} KB)")
        data = container.download_blob(blob.name).readall()
        frames.append(pd.read_parquet(io.BytesIO(data)))

    df = pd.concat(frames, ignore_index=True)
    print(f"  → {len(df)} lignes, colonnes : {list(df.columns)}")
    return df


# Mapping colonnes Gold → colonnes PostgreSQL
# Ajuster si Ludo a utilisé des noms légèrement différents
COLUMN_MAP = {
    "code_commune":           "code_commune",
    "city":                   "city",
    "code_departement":       "code_departement",
    "centroid_lon":           "centroid_lon",
    "centroid_lat":           "centroid_lat",
    "surface_km2":            "surface_km2",
    "population_totale":      "population_totale",
    "population_municipale":  "population_municipale",
    "densite_pop_km2":        "densite_pop_km2",
    "prix_median_m2":         "prix_median_m2",
    "prix_moyen_m2":          "prix_moyen_m2",
    "nb_transactions":        "nb_transactions",
    "surface_moyenne":        "surface_moyenne",
    "prix_median_transaction":"prix_median_transaction",
    "score_dpe_moyen":        "score_dpe_moyen",
    "conso_energie_moyenne":  "conso_energie_moyenne",
    "emission_ges_moyenne":   "emission_ges_moyenne",
    "nb_dpe":                 "nb_dpe",
    "pct_dpe_bon":            "pct_dpe_bon",
    "nb_poi_total":           "nb_poi_total",
    "nb_transport":           "nb_transport",
    "nb_education":           "nb_education",
    "nb_sante":               "nb_sante",
    "nb_commerce":            "nb_commerce",
    "nb_restauration":        "nb_restauration",
    "nb_parcs":               "nb_parcs",
    "nb_services":            "nb_services",
    "nb_bio_bobo":            "nb_bio_bobo",
}

PG_COLUMNS = list(COLUMN_MAP.values())


def normalize_df(df: pd.DataFrame) -> pd.DataFrame:
    # Renommer les colonnes source → colonnes PG
    rename = {src: dst for src, dst in COLUMN_MAP.items() if src in df.columns and src != dst}
    if rename:
        df = df.rename(columns=rename)

    # Colonnes manquantes → NULL
    for col in PG_COLUMNS:
        if col not in df.columns:
            print(f"  ⚠️  Colonne absente dans Gold, sera NULL en PG : {col}")
            df[col] = None

    # Garder uniquement les colonnes PG, dans l'ordre
    df = df[PG_COLUMNS].copy()

    # Colonnes entières — convertir float64 → Int64 nullable (évite bigint out of range)
    int_columns = [
        "population_totale", "population_municipale",
        "nb_transactions", "nb_dpe",
        "nb_poi_total", "nb_transport", "nb_education", "nb_sante",
        "nb_commerce", "nb_restauration", "nb_parcs", "nb_services", "nb_bio_bobo",
    ]
    for col in int_columns:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").round(0)
            # Clamp pour éviter les valeurs hors range bigint
            df[col] = df[col].clip(-9_223_372_036_854_775_808, 9_223_372_036_854_775_807)
            df[col] = df[col].astype("Int64")  # Int64 nullable pandas

    # Convertir NaN / pd.NA → None (pour psycopg2)
    df = df.where(pd.notnull(df), None)
    # Int64 pandas → int Python natif (psycopg2 ne connaît pas pd.NA)
    for col in int_columns:
        if col in df.columns:
            df[col] = df[col].apply(lambda x: int(x) if pd.notna(x) else None)

    return df


def import_to_postgres(df: pd.DataFrame):
    engine = create_engine(
        f"postgresql+psycopg2://{PG_USER}:{PG_PASSWORD}@{PG_HOST}:{PG_PORT}/{PG_DB}"
    )

    # Vider la table avant import (désactiver FK check temporairement)
    with engine.connect() as con:
        con.execute(text("ALTER TABLE communes_agregat DISABLE TRIGGER ALL"))
        con.execute(text("TRUNCATE TABLE communes_agregat"))
        con.commit()
    print("  → Table communes_agregat vidée")

    print(f"  → Insertion de {len(df)} lignes...")
    # to_sql gère automatiquement les types pandas → PostgreSQL
    df.to_sql(
        "communes_agregat",
        engine,
        if_exists="append",
        index=False,
        method="multi",
        chunksize=200,
    )

    with engine.connect() as con:
        con.execute(text("ALTER TABLE communes_agregat ENABLE TRIGGER ALL"))
        count = con.execute(text("SELECT COUNT(*) FROM communes_agregat")).scalar()
        con.execute(text("CREATE INDEX IF NOT EXISTS communes_agregat_dept_idx ON communes_agregat (code_departement)"))
        con.execute(text("CREATE INDEX IF NOT EXISTS communes_agregat_prix_idx ON communes_agregat (prix_median_m2)"))
        con.commit()

    print(f"  → {count} lignes dans communes_agregat ✅")
    engine.dispose()


def main():
    if not AZURE_ACCOUNT_KEY:
        raise ValueError(
            "ADLS_ACCOUNT_KEY non défini !\n"
            "Ajouter dans ingestion/.env :\n"
            "  ADLS_ACCOUNT_KEY=<ta_clé_azure>\n"
            "  (Azure Portal → homepediadatalake → Paramètres → Clés d'accès → key1)"
        )

    print("📦 Import gold/communes_agregat/ → PostgreSQL\n")
    df = download_parquet_from_azure()
    df = normalize_df(df)
    print(f"\n💾 Import dans PostgreSQL {PG_HOST}:{PG_PORT}/{PG_DB}...")
    import_to_postgres(df)
    print("\n✅ Import terminé !")

    # Vérification rapide
    engine = create_engine(f"postgresql+psycopg2://{PG_USER}:{PG_PASSWORD}@{PG_HOST}:{PG_PORT}/{PG_DB}")
    df_check = pd.read_sql(
        "SELECT code_commune, city, prix_median_m2, nb_transport, score_dpe_moyen "
        "FROM communes_agregat ORDER BY prix_median_m2 DESC NULLS LAST LIMIT 5",
        engine
    )
    print("\nTop 5 communes par prix médian m² :")
    print(df_check.to_string(index=False))
    engine.dispose()


if __name__ == "__main__":
    main()
