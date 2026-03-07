"""
ingestion/dvf/download.py
=========================
Télécharge les données DVF (Demandes de Valeurs Foncières) depuis data.gouv.fr,
anonymise les colonnes personnelles, convertit en Parquet et upload vers
Azure Data Lake Storage Gen2 (container bronze/).

Usage local (test sur un département) :
    python download.py --mode dept --dept 75 --year 2024

Usage production (France entière, tous les ans) :
    python download.py --mode full --years 2020,2021,2022,2023,2024

Variables d'environnement requises (.env ou Azure Key Vault) :
    ADLS_ACCOUNT_NAME   : nom du compte ADLS (ex: homepediadatalake)
    ADLS_ACCOUNT_KEY    : clé d'accès du compte ADLS
    LOCAL_DATA_DIR      : dossier temporaire local (ex: /tmp/dvf)
"""

import os
import argparse
import gzip
import shutil
from pathlib import Path

import pandas as pd
from azure.storage.filedatalake import DataLakeServiceClient
from dotenv import load_dotenv

load_dotenv()

# ──────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────

BASE_URL = "https://files.data.gouv.fr/geo-dvf/latest/csv"

# Départements France métropolitaine + DOM
DEPARTEMENTS = [f"{i:02d}" for i in range(1, 96) if i != 20] + \
               ["2A", "2B", "971", "972", "973", "974"]

# Colonnes à SUPPRIMER pour conformité RGPD
# (noms d'acheteurs/vendeurs présents dans certaines années)
COLONNES_RGPD = ["nom_vendeur", "nom_acheteur", "prenom_vendeur", "prenom_acheteur"]

# Colonnes utiles qu'on garde
COLONNES_UTILES = [
    "id_mutation",
    "date_mutation",
    "nature_mutation",          # Vente, Vente en l'état futur d'achèvement...
    "valeur_fonciere",          # Prix de vente en €
    "code_commune",             # Code INSEE (5 chiffres) — clé de jointure principale
    "nom_commune",
    "code_departement",
    "code_postal",
    "type_local",               # Appartement, Maison, Local industriel...
    "surface_reelle_bati",      # Surface habitable en m²
    "nombre_pieces_principales",
    "surface_terrain",
    "longitude",                # GPS — pour jointures spatiales PostGIS
    "latitude",
]

LOCAL_DATA_DIR = Path(os.getenv("LOCAL_DATA_DIR", "/tmp/dvf"))
ADLS_ACCOUNT_NAME = os.getenv("ADLS_ACCOUNT_NAME", "homepediadatalake")
ADLS_ACCOUNT_KEY = os.getenv("ADLS_ACCOUNT_KEY", "")
BRONZE_CONTAINER = "bronze"


# ──────────────────────────────────────────────────────────────
# Téléchargement
# ──────────────────────────────────────────────────────────────

def download_file(url: str, dest: Path) -> bool:
    """Télécharge un fichier en streaming. Retourne False si 404."""
    import requests
    print(f"  ↓ {url}")
    try:
        with requests.get(url, stream=True, timeout=60) as r:
            if r.status_code == 404:
                print(f"  ⚠️  404 — fichier absent (normal pour certains départements)")
                return False
            r.raise_for_status()
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(dest, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 1024):  # 1 MB chunks
                    f.write(chunk)
        return True
    except Exception as e:
        print(f"  ❌ Erreur téléchargement : {e}")
        return False


# ──────────────────────────────────────────────────────────────
# Traitement CSV → Parquet
# ──────────────────────────────────────────────────────────────

def process_csv_to_parquet(csv_gz_path: Path, year: int, dept: str) -> Path:
    """
    Lit un CSV.GZ DVF, applique :
    - Suppression colonnes RGPD
    - Sélection colonnes utiles (ignore les colonnes manquantes)
    - Nettoyage : supprime lignes sans valeur_fonciere ni surface
    - Ajout colonne 'annee' pour partitionnement
    - Export en Parquet compressé (snappy)
    """
    print(f"  🔄 Traitement {csv_gz_path.name}...")

    df = pd.read_csv(
        csv_gz_path,
        compression="gzip",
        dtype=str,          # Tout en string pour éviter les erreurs de parsing
        low_memory=False,
    )

    print(f"     {len(df):,} lignes brutes")

    # 1. Supprimer colonnes RGPD si présentes
    colonnes_a_supprimer = [c for c in COLONNES_RGPD if c in df.columns]
    if colonnes_a_supprimer:
        df = df.drop(columns=colonnes_a_supprimer)
        print(f"     🔒 RGPD : colonnes supprimées : {colonnes_a_supprimer}")

    # 2. Garder seulement les colonnes utiles (ignorer celles absentes)
    colonnes_presentes = [c for c in COLONNES_UTILES if c in df.columns]
    df = df[colonnes_presentes]

    # 3. Convertir les types numériques
    for col in ["valeur_fonciere", "surface_reelle_bati", "surface_terrain",
                "nombre_pieces_principales", "longitude", "latitude"]:
        if col in df.columns:
            df[col] = pd.to_numeric(
                df[col].str.replace(",", "."),  # DVF utilise la virgule comme séparateur décimal
                errors="coerce"
            )

    # 4. Supprimer les lignes inutilisables (pas de prix ou pas de surface)
    avant = len(df)
    df = df.dropna(subset=["valeur_fonciere"])
    df = df[df["valeur_fonciere"] > 0]
    df = df[df["surface_reelle_bati"].isna() | (df["surface_reelle_bati"] > 0)]
    print(f"     🧹 {avant - len(df):,} lignes supprimées (nulles/invalides) → {len(df):,} lignes propres")

    # 5. Ajouter métadonnées pour le partitionnement
    df["annee"] = year
    df["code_departement"] = dept

    # 6. Export Parquet
    parquet_path = csv_gz_path.with_suffix("").with_suffix(".parquet")
    df.to_parquet(parquet_path, index=False, compression="snappy")
    print(f"     ✅ Parquet : {parquet_path.name} ({parquet_path.stat().st_size / 1024 / 1024:.1f} MB)")

    # Supprimer le CSV.GZ temporaire
    csv_gz_path.unlink()

    return parquet_path


# ──────────────────────────────────────────────────────────────
# Upload Azure Data Lake
# ──────────────────────────────────────────────────────────────

def get_adls_client() -> DataLakeServiceClient:
    """Crée le client Azure Data Lake."""
    if not ADLS_ACCOUNT_KEY:
        raise ValueError(
            "ADLS_ACCOUNT_KEY non définie. "
            "Ajoute-la dans .env ou dans Azure Key Vault."
        )
    return DataLakeServiceClient(
        account_url=f"https://{ADLS_ACCOUNT_NAME}.dfs.core.windows.net",
        credential=ADLS_ACCOUNT_KEY,
    )


def upload_to_bronze(local_path: Path, year: int, dept: str) -> str:
    """
    Upload le fichier Parquet vers :
    bronze/dvf/annee={year}/dept={dept}/dvf_{year}_{dept}.parquet

    Structure partitionnée pour que Spark puisse lire efficacement
    (ex: spark.read.parquet("bronze/dvf/annee=2024/") lit uniquement 2024)
    """
    remote_path = f"dvf/annee={year}/dept={dept}/{local_path.name}"
    print(f"  ☁️  Upload → {BRONZE_CONTAINER}/{remote_path}")

    client = get_adls_client()
    fs_client = client.get_file_system_client(BRONZE_CONTAINER)
    file_client = fs_client.get_file_client(remote_path)

    with open(local_path, "rb") as f:
        data = f.read()
        file_client.upload_data(data, overwrite=True)

    full_url = f"abfss://{BRONZE_CONTAINER}@{ADLS_ACCOUNT_NAME}.dfs.core.windows.net/{remote_path}"
    print(f"  ✅ Uploadé : {full_url}")
    return full_url


# ──────────────────────────────────────────────────────────────
# Modes d'exécution
# ──────────────────────────────────────────────────────────────

def run_department(year: int, dept: str, upload: bool = True):
    """Télécharge et traite un seul département (mode dev/test)."""
    print(f"\n📦 DVF {year} — département {dept}")

    url = f"{BASE_URL}/{year}/departements/{dept}.csv.gz"
    local_csv = LOCAL_DATA_DIR / f"dvf_{year}_{dept}.csv.gz"

    ok = download_file(url, local_csv)
    if not ok:
        return

    parquet_path = process_csv_to_parquet(local_csv, year, dept)

    if upload:
        upload_to_bronze(parquet_path, year, dept)
        parquet_path.unlink()  # Supprimer le fichier local après upload
    else:
        print(f"  📁 Mode local : fichier gardé dans {parquet_path}")


def run_full(years: list[int], upload: bool = True):
    """Télécharge et traite tous les départements pour plusieurs années."""
    total = len(years) * len(DEPARTEMENTS)
    done = 0

    for year in years:
        print(f"\n{'='*60}")
        print(f"  Année {year} — {len(DEPARTEMENTS)} départements")
        print(f"{'='*60}")

        for dept in DEPARTEMENTS:
            done += 1
            print(f"\n[{done}/{total}]", end="")
            run_department(year, dept, upload=upload)

    print(f"\n🎉 Terminé ! {done} fichiers traités.")


# ──────────────────────────────────────────────────────────────
# Point d'entrée
# ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingestion DVF → Azure Data Lake bronze/")
    parser.add_argument(
        "--mode",
        choices=["dept", "full"],
        default="dept",
        help="dept = un seul département (test), full = France entière (production)"
    )
    parser.add_argument("--dept", default="75", help="Code département (ex: 75, 92, 2A)")
    parser.add_argument("--year", type=int, default=2024, help="Année (mode dept)")
    parser.add_argument(
        "--years",
        default="2020,2021,2022,2023,2024",
        help="Années séparées par virgule (mode full)"
    )
    parser.add_argument(
        "--no-upload",
        action="store_true",
        help="Ne pas uploader sur Azure (garder en local, pour les tests)"
    )
    args = parser.parse_args()

    LOCAL_DATA_DIR.mkdir(parents=True, exist_ok=True)

    if args.mode == "dept":
        run_department(args.year, args.dept, upload=not args.no_upload)
    else:
        years = [int(y) for y in args.years.split(",")]
        run_full(years, upload=not args.no_upload)
