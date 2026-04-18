"""
ingestion/dvf/download_gcs.py
==============================
Télécharge les données DVF (Demandes de Valeurs Foncières) depuis data.gouv.fr,
nettoie les données, convertit en Parquet et upload vers Google Cloud Storage.

C'est LA VERSION GCP (remplace download.py qui ciblait Azure).

Usage :
    # Tester avec un seul département
    python download_gcs.py --mode dept --dept 75 --year 2024

    # Tous les départements IDF (production)
    python download_gcs.py --mode idf --years 2020,2021,2022,2023,2024

Prérequis :
    pip install google-cloud-storage pandas pyarrow requests
    gcloud auth application-default login
"""

import os
import argparse
import requests
from pathlib import Path

import pandas as pd
from google.cloud import storage

# ──────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────

GCS_BUCKET     = "homepedia-datalake"
GCS_PREFIX     = "bronze/dvf"           # chemin dans le bucket
BASE_URL       = "https://files.data.gouv.fr/geo-dvf/latest/csv"
LOCAL_TMP      = Path("/tmp/dvf_gcs")  # dossier temporaire local

# Les 8 départements Île-de-France
DEPTS_IDF = ["75", "77", "78", "91", "92", "93", "94", "95"]

# Colonnes qu'on conserve (on enlève les données personnelles)
COLONNES_UTILES = [
    "id_mutation",
    "date_mutation",
    "nature_mutation",
    "valeur_fonciere",
    "code_commune",
    "nom_commune",
    "code_departement",
    "code_postal",
    "type_local",
    "surface_reelle_bati",
    "nombre_pieces_principales",
    "surface_terrain",
    "longitude",
    "latitude",
]

# Colonnes personnelles à supprimer (RGPD)
COLONNES_RGPD = ["nom_vendeur", "nom_acheteur", "prenom_vendeur", "prenom_acheteur"]


# ──────────────────────────────────────────────────────────────
# Téléchargement
# ──────────────────────────────────────────────────────────────

def download_csv(url: str, dest: Path) -> bool:
    """Télécharge un fichier CSV.GZ depuis data.gouv.fr."""
    print(f"  ↓ Téléchargement : {url}")
    try:
        r = requests.get(url, stream=True, timeout=120)
        if r.status_code == 404:
            print(f"  ⚠️  Fichier absent (404) — département peut-être manquant")
            return False
        r.raise_for_status()
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                f.write(chunk)
        print(f"  ✅ Téléchargé : {dest.name}")
        return True
    except Exception as e:
        print(f"  ❌ Erreur : {e}")
        return False


# ──────────────────────────────────────────────────────────────
# Nettoyage CSV → Parquet
# ──────────────────────────────────────────────────────────────

def csv_to_parquet(csv_gz_path: Path, year: int, dept: str) -> Path:
    """
    Lit un CSV.GZ DVF et :
    1. Supprime les colonnes personnelles (RGPD)
    2. Garde seulement les colonnes utiles
    3. Convertit les types numériques (virgule → point décimal)
    4. Filtre les lignes sans prix
    5. Exporte en Parquet (format colonne, compressé)
    """
    print(f"  🔄 Nettoyage des données...")

    df = pd.read_csv(
        csv_gz_path,
        compression="gzip",
        dtype=str,          # on lit tout en texte d'abord
        low_memory=False,
    )
    print(f"     {len(df):,} lignes brutes lues")

    # 1. Supprimer données personnelles
    to_drop = [c for c in COLONNES_RGPD if c in df.columns]
    if to_drop:
        df.drop(columns=to_drop, inplace=True)

    # 2. Garder seulement les colonnes utiles
    cols = [c for c in COLONNES_UTILES if c in df.columns]
    df = df[cols]

    # 3. Convertir les nombres (DVF utilise la virgule comme séparateur décimal !)
    for col in ["valeur_fonciere", "surface_reelle_bati", "surface_terrain",
                "nombre_pieces_principales", "longitude", "latitude"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col].str.replace(",", "."), errors="coerce")

    # 4. Filtrer les lignes sans prix (inutilisables)
    avant = len(df)
    df = df[df["valeur_fonciere"].notna() & (df["valeur_fonciere"] > 0)]
    print(f"     🧹 {avant - len(df):,} lignes sans prix supprimées → {len(df):,} lignes")

    # 5. Ajouter colonnes de partitionnement
    df["annee"]            = year
    df["code_departement"] = dept

    # 6. Export Parquet
    parquet_path = csv_gz_path.with_suffix("").with_suffix(".parquet")
    df.to_parquet(parquet_path, index=False, compression="snappy")
    size_mb = parquet_path.stat().st_size / 1024 / 1024
    print(f"  ✅ Parquet créé : {parquet_path.name} ({size_mb:.1f} MB)")

    # Supprimer le CSV temporaire
    csv_gz_path.unlink()

    return parquet_path


# ──────────────────────────────────────────────────────────────
# Upload GCS
# ──────────────────────────────────────────────────────────────

def upload_to_gcs(local_path: Path, year: int, dept: str) -> str:
    """
    Upload le Parquet vers :
    gs://homepedia-datalake/bronze/dvf/annee=2024/dept=75/dvf_2024_75.parquet

    La structure annee=/dept= permet à BigQuery de lire un an ou un dept
    sans tout scanner (= moins cher et plus rapide).
    """
    gcs_path = f"{GCS_PREFIX}/annee={year}/dept={dept}/{local_path.name}"
    print(f"  ☁️  Upload GCS → gs://{GCS_BUCKET}/{gcs_path}")

    client = storage.Client(project="homepedia-493013")
    bucket = client.bucket(GCS_BUCKET)
    blob   = bucket.blob(gcs_path)
    blob.upload_from_filename(str(local_path))

    full_uri = f"gs://{GCS_BUCKET}/{gcs_path}"
    print(f"  ✅ Uploadé : {full_uri}")
    local_path.unlink()   # nettoyer le fichier local
    return full_uri


# ──────────────────────────────────────────────────────────────
# Pipeline complet pour un département
# ──────────────────────────────────────────────────────────────

def process_dept(year: int, dept: str, no_upload: bool = False):
    """Pipeline complet pour 1 département + 1 année."""
    print(f"\n📦 DVF {year} — Département {dept}")

    url       = f"{BASE_URL}/{year}/departements/{dept}.csv.gz"
    csv_path  = LOCAL_TMP / f"dvf_{year}_{dept}.csv.gz"

    # Étape 1 : Téléchargement
    ok = download_csv(url, csv_path)
    if not ok:
        return

    # Étape 2 : Nettoyage → Parquet
    parquet_path = csv_to_parquet(csv_path, year, dept)

    # Étape 3 : Upload GCS (ou garder en local si --no-upload)
    if no_upload:
        print(f"  📁 Mode local : fichier gardé dans {parquet_path}")
    else:
        upload_to_gcs(parquet_path, year, dept)


# ──────────────────────────────────────────────────────────────
# Point d'entrée
# ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Ingestion DVF → Google Cloud Storage (bucket homepedia-datalake)"
    )
    parser.add_argument(
        "--mode",
        choices=["dept", "idf"],
        default="dept",
        help="dept = un seul département (test), idf = tous les 8 depts IDF"
    )
    parser.add_argument("--dept",  default="75",   help="Code département (mode dept)")
    parser.add_argument("--year",  type=int, default=2024, help="Année (mode dept)")
    parser.add_argument(
        "--years",
        default="2020,2021,2022,2023,2024",
        help="Années séparées par virgule (mode idf)"
    )
    parser.add_argument(
        "--no-upload",
        action="store_true",
        help="Garder le Parquet en local sans uploader (pour tester)"
    )
    args = parser.parse_args()

    LOCAL_TMP.mkdir(parents=True, exist_ok=True)

    if args.mode == "dept":
        process_dept(args.year, args.dept, no_upload=args.no_upload)

    elif args.mode == "idf":
        years = [int(y) for y in args.years.split(",")]
        total = len(years) * len(DEPTS_IDF)
        done  = 0
        for year in years:
            print(f"\n{'='*60}")
            print(f"  Année {year} — 8 départements IDF")
            print(f"{'='*60}")
            for dept in DEPTS_IDF:
                done += 1
                print(f"\n[{done}/{total}]", end="")
                process_dept(year, dept, no_upload=args.no_upload)

        print(f"\n🎉 Terminé ! {done} fichiers traités → gs://{GCS_BUCKET}/{GCS_PREFIX}/")
