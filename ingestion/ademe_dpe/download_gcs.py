"""
ingestion/ademe_dpe/download_gcs.py
=====================================
Télécharge les DPE (Diagnostics de Performance Énergétique) depuis l'API ADEME
et les upload vers Google Cloud Storage.

C'est la version GCP du script original (qui ciblait Azure).

Usage :
    python3 ingestion/ademe_dpe/download_gcs.py              # tous IDF
    python3 ingestion/ademe_dpe/download_gcs.py --dept 75    # Paris uniquement
    python3 ingestion/ademe_dpe/download_gcs.py --no-upload  # test local

Prérequis :
    pip install google-cloud-storage pandas pyarrow requests
    gcloud auth application-default login
"""

import time
import argparse
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import pandas as pd
import requests
from google.cloud import storage

# ──────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────

GCS_BUCKET  = "homepedia-datalake"
GCS_PREFIX  = "bronze/dpe"
LOCAL_TMP   = Path("/tmp/dpe_gcs")

# API ADEME data.ademe.fr (DPE logements existants)
DPE_API_BASE = "https://data.ademe.fr/data-fair/api/v1/datasets/meg-83tjwtg8dyz4vv7h1dqe/lines"

# Colonnes à garder depuis l'API
COLONNES_DPE = [
    "numero_dpe",
    "date_reception_dpe",
    "code_insee_ban",
    "nom_commune_ban",
    "code_postal_ban",
    "code_departement_ban",
    "etiquette_dpe",
    "etiquette_ges",
    "conso_5_usages_par_m2_ep",
    "emission_ges_5_usages_par_m2",
    "surface_habitable_immeuble",
    "type_batiment",
    "periode_construction",
    "coordonnee_cartographique_x_ban",
    "coordonnee_cartographique_y_ban",
]

# Renommage vers des noms lisibles
RENAME = {
    "numero_dpe":                       "id_dpe",
    "date_reception_dpe":               "date_dpe",
    "code_insee_ban":                   "code_commune",
    "nom_commune_ban":                  "nom_commune",
    "code_postal_ban":                  "code_postal",
    "code_departement_ban":             "code_departement",
    "etiquette_dpe":                    "etiquette_dpe",
    "etiquette_ges":                    "etiquette_ges",
    "conso_5_usages_par_m2_ep":         "conso_energie_kwh_m2",
    "emission_ges_5_usages_par_m2":     "emission_ges_kg_m2",
    "surface_habitable_immeuble":       "surface_m2",
    "type_batiment":                    "type_batiment",
    "periode_construction":             "periode_construction",
    "coordonnee_cartographique_x_ban":  "longitude",
    "coordonnee_cartographique_y_ban":  "latitude",
}

DEPTS_IDF = ["75", "77", "78", "91", "92", "93", "94", "95"]


# ──────────────────────────────────────────────────────────────
# Téléchargement API paginée
# ──────────────────────────────────────────────────────────────

def fetch_dpe_dept(dept: str, page_size: int = 10_000, max_rows: int = 200_000) -> pd.DataFrame:
    """Récupère tous les DPE d'un département via l'API ADEME."""
    all_rows = []
    after    = None
    total    = None

    print(f"  📡 API ADEME — département {dept}")

    while True:
        params = {
            "size":   page_size,
            "qs":     f"code_departement_ban:{dept}",
            "select": ",".join(COLONNES_DPE),
            "sort":   "-date_reception_dpe",
        }
        if after:
            params["after"] = after

        try:
            r = requests.get(DPE_API_BASE, params=params, timeout=60)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            print(f"  ❌ Erreur API : {e}")
            break

        if total is None:
            total = data.get("total", 0)
            cap   = min(total, max_rows)
            print(f"     {total:,} DPE disponibles → téléchargement de {cap:,}")

        results = data.get("results", [])
        if not results:
            break

        all_rows.extend(results)
        pct = len(all_rows) / min(total, max_rows) * 100 if total > 0 else 0
        print(f"     {len(all_rows):,}/{min(total, max_rows):,} ({pct:.0f}%)", end="\r")

        if len(all_rows) >= max_rows:
            break

        # Extraire le curseur `after` de l'URL next
        next_url = data.get("next")
        if not next_url:
            break
        qs_parsed = parse_qs(urlparse(next_url).query)
        after_values = qs_parsed.get("after", [])
        if not after_values:
            break
        after = after_values[0]

        time.sleep(0.2)

    print()
    return pd.DataFrame(all_rows) if all_rows else pd.DataFrame()


# ──────────────────────────────────────────────────────────────
# Nettoyage → Parquet
# ──────────────────────────────────────────────────────────────

def clean_to_parquet(df: pd.DataFrame, dept: str) -> Path:
    """Nettoie les données DPE et exporte en Parquet."""
    print(f"  🔄 Nettoyage {len(df):,} DPE...")

    # Renommer les colonnes
    df = df.rename(columns={k: v for k, v in RENAME.items() if k in df.columns})

    # Conversion numérique
    for col in ["conso_energie_kwh_m2", "emission_ges_kg_m2", "surface_m2", "longitude", "latitude"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Supprimer lignes sans code commune ou étiquette DPE (inutilisables)
    avant = len(df)
    df = df.dropna(subset=["code_commune", "etiquette_dpe"])
    print(f"     🧹 {avant - len(df):,} lignes invalides → {len(df):,} DPE propres")

    # Score DPE numérique (A=1, B=2, ..., G=7) — utile pour les calculs
    score_map = {"A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "F": 6, "G": 7}
    df["score_dpe"] = df["etiquette_dpe"].map(score_map)
    df["est_bon_dpe"] = df["score_dpe"].apply(lambda x: 1 if x is not None and x <= 2 else 0)

    # Extraire l'année du DPE (pour filtrer les DPE trop vieux)
    df["annee_dpe"] = pd.to_datetime(df["date_dpe"], errors="coerce").dt.year

    df["code_departement"] = dept

    # Export Parquet
    LOCAL_TMP.mkdir(parents=True, exist_ok=True)
    parquet_path = LOCAL_TMP / f"dpe_{dept}.parquet"
    df.to_parquet(parquet_path, index=False, compression="snappy")
    size_kb = parquet_path.stat().st_size / 1024
    print(f"  ✅ Parquet : {parquet_path.name} ({size_kb:.0f} KB)")
    return parquet_path


# ──────────────────────────────────────────────────────────────
# Upload GCS
# ──────────────────────────────────────────────────────────────

def upload_to_gcs(local_path: Path, dept: str) -> str:
    """Upload le Parquet vers gs://homepedia-datalake/bronze/dpe/dept={dept}/"""
    gcs_path = f"{GCS_PREFIX}/dept={dept}/{local_path.name}"
    print(f"  ☁️  Upload GCS → gs://{GCS_BUCKET}/{gcs_path}")

    client = storage.Client(project="homepedia-493013")
    bucket = client.bucket(GCS_BUCKET)
    blob   = bucket.blob(gcs_path)
    blob.upload_from_filename(str(local_path))

    full_uri = f"gs://{GCS_BUCKET}/{gcs_path}"
    print(f"  ✅ Uploadé : {full_uri}")
    local_path.unlink()
    return full_uri


# ──────────────────────────────────────────────────────────────
# Pipeline complet pour un département
# ──────────────────────────────────────────────────────────────

def process_dept(dept: str, no_upload: bool = False):
    print(f"\n{'='*60}")
    print(f"  🏠 DPE — département {dept}")
    print(f"{'='*60}")

    df = fetch_dpe_dept(dept)
    if df.empty:
        print(f"  ⚠️  Aucune donnée pour le département {dept}")
        return

    parquet_path = clean_to_parquet(df, dept)

    if no_upload:
        print(f"  📁 Mode local : {parquet_path}")
    else:
        upload_to_gcs(parquet_path, dept)


# ──────────────────────────────────────────────────────────────
# Point d'entrée
# ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Ingestion DPE ADEME → Google Cloud Storage (bucket homepedia-datalake)"
    )
    parser.add_argument("--dept",      default=None,  help="Département unique (ex: 75). Défaut: tous IDF")
    parser.add_argument("--no-upload", action="store_true", help="Garder en local sans uploader")
    args = parser.parse_args()

    depts = [args.dept] if args.dept else DEPTS_IDF

    for dept in depts:
        process_dept(dept, no_upload=args.no_upload)

    print(f"\n🎉 Ingestion DPE terminée ! → gs://{GCS_BUCKET}/{GCS_PREFIX}/")
