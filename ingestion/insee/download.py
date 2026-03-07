"""
ingestion/insee/download.py
============================
Télécharge les données INSEE :
  - Populations légales par commune (RP 2021)
  - Revenus et pauvreté par commune (Filosofi 2021)
  - Logements par commune (RP 2021)

Toutes les données sont open data sur insee.fr et data.gouv.fr.

Upload vers Azure Data Lake Storage Gen2 (container bronze/insee/).

Usage :
    python3 download.py
    python3 download.py --no-upload  # test local
"""

import os
import io
import zipfile
import argparse
from pathlib import Path

import pandas as pd
from azure.storage.filedatalake import DataLakeServiceClient
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

# ──────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────

LOCAL_DATA_DIR   = Path(os.getenv("LOCAL_DATA_DIR", "/tmp/dvf")) / "insee"
ADLS_ACCOUNT_NAME = os.getenv("ADLS_ACCOUNT_NAME", "homepediadatalake")
ADLS_ACCOUNT_KEY  = os.getenv("ADLS_ACCOUNT_KEY", "")
BRONZE_CONTAINER  = "bronze"

# Sources INSEE open data
SOURCES = {
    # Populations légales 2021 par commune (RP 2021 — INSEE)
    # ZIP contient donnees_communes.csv avec sep=';'
    "populations": {
        "url": "https://www.insee.fr/fr/statistiques/fichier/7739582/ensemble.zip",
        "file_in_zip": "donnees_communes.csv",
        "sheet": None,
        "skip_rows": 0,
        "sep": ";",
        "columns_rename": {
            "COM":      "code_commune",
            "Commune":  "nom_commune",
            "DEP":      "code_departement",
            "PMUN":     "population_municipale",
            "PCAP":     "population_comptee_a_part",
            "PTOT":     "population_totale",
        },
        "remote": "insee/populations/populations_2021.parquet",
    },
    # Revenus médians et taux de pauvreté par commune (Filosofi 2021)
    # ⚠️  INSEE bloque le téléchargement automatique.
    # Télécharger manuellement sur :
    #   https://www.insee.fr/fr/statistiques/7233950
    #   → Télécharger "filo-dec-communes-2021.zip"
    #   → Extraire FILO2021_DISP_COM.csv dans /tmp/dvf/insee/
    # Puis relancer : python3 download.py --source revenus
    "revenus": {
        "url": None,  # téléchargement manuel requis
        "file_in_zip": "FILO2021_DISP_COM.csv",
        "sheet": None,
        "skip_rows": 0,
        "sep": ";",
        "columns_rename": {
            "CODGEO":   "code_commune",
            "LIBGEO":   "nom_commune",
            "MED21":    "revenu_median",
            "TP6021":   "taux_pauvrete",
            "RD21":     "ratio_interdecile",
        },
        "remote": "insee/revenus/revenus_2021.parquet",
    },
}


# ──────────────────────────────────────────────────────────────
# Téléchargement + extraction ZIP
# ──────────────────────────────────────────────────────────────

def download_and_extract(url: str, file_in_zip: str, dest_dir: Path) -> Path:
    """
    Télécharge un fichier depuis une URL.
    - Si l'URL est un ZIP → extrait le fichier cible
    - Sinon → télécharge directement
    """
    import requests
    print(f"  ↓ {url}")
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_file = dest_dir / file_in_zip

    r = requests.get(url, timeout=120)
    r.raise_for_status()

    content_type = r.headers.get("Content-Type", "")
    is_zip = url.endswith(".zip") or "zip" in content_type

    if is_zip:
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            matches = [n for n in z.namelist() if n.endswith(file_in_zip) or file_in_zip in n]
            if not matches:
                raise FileNotFoundError(f"{file_in_zip} non trouvé dans le ZIP. Contenu : {z.namelist()}")
            with z.open(matches[0]) as src, open(dest_file, "wb") as dst:
                dst.write(src.read())
    else:
        # Téléchargement direct (CSV, etc.)
        with open(dest_file, "wb") as f:
            f.write(r.content)

    print(f"  ✅ Téléchargé : {dest_file.name} ({dest_file.stat().st_size / 1024:.0f} KB)")
    return dest_file


# ──────────────────────────────────────────────────────────────
# Traitement → Parquet
# ──────────────────────────────────────────────────────────────

def process_to_parquet(source_name: str, cfg: dict) -> Path:
    """Lit le fichier source, renomme les colonnes clés, exporte en Parquet."""
    raw_file = LOCAL_DATA_DIR / cfg["file_in_zip"]

    print(f"  🔄 Traitement {source_name}...")

    if raw_file.suffix in (".xlsx", ".xls"):
        df = pd.read_excel(raw_file, sheet_name=cfg["sheet"], skiprows=cfg["skip_rows"])
    else:
        sep = cfg.get("sep", ",")
        df = pd.read_csv(raw_file, sep=sep, skiprows=cfg["skip_rows"],
                         dtype=str, low_memory=False)

    print(f"     {len(df):,} lignes brutes, {len(df.columns)} colonnes")

    # Renommer les colonnes d'intérêt
    rename = {k: v for k, v in cfg["columns_rename"].items() if k in df.columns}
    df = df.rename(columns=rename)

    # Garder seulement les colonnes renommées (celles qui nous intéressent)
    keep = [v for v in cfg["columns_rename"].values() if v in df.columns]
    df = df[keep]

    # Convertir numériques
    for col in df.columns:
        if col != "code_commune" and col != "nom_commune":
            df[col] = pd.to_numeric(
                df[col].astype(str).str.replace(",", "."),
                errors="coerce"
            )

    # Supprimer lignes sans code commune
    df = df.dropna(subset=["code_commune"])
    df["code_commune"] = df["code_commune"].astype(str).str.zfill(5)

    print(f"     → {len(df):,} communes après nettoyage")

    parquet_path = LOCAL_DATA_DIR / f"{source_name}_2021.parquet"
    df.to_parquet(parquet_path, index=False, compression="snappy")
    print(f"     ✅ Parquet : {parquet_path.name} ({parquet_path.stat().st_size / 1024:.0f} KB)")

    # Supprimer le fichier source temporaire
    raw_file.unlink(missing_ok=True)
    return parquet_path


# ──────────────────────────────────────────────────────────────
# Upload Azure
# ──────────────────────────────────────────────────────────────

def get_adls_client():
    if not ADLS_ACCOUNT_KEY:
        raise ValueError("ADLS_ACCOUNT_KEY non définie.")
    return DataLakeServiceClient(
        account_url=f"https://{ADLS_ACCOUNT_NAME}.dfs.core.windows.net",
        credential=ADLS_ACCOUNT_KEY,
    )


def upload_to_bronze(local_path: Path, remote_path: str):
    print(f"  ☁️  Upload → {BRONZE_CONTAINER}/{remote_path}")
    client = get_adls_client()
    fs = client.get_file_system_client(BRONZE_CONTAINER)
    fc = fs.get_file_client(remote_path)
    with open(local_path, "rb") as f:
        fc.upload_data(f.read(), overwrite=True)
    print(f"  ✅ abfss://{BRONZE_CONTAINER}@{ADLS_ACCOUNT_NAME}.dfs.core.windows.net/{remote_path}")


# ──────────────────────────────────────────────────────────────
# Point d'entrée
# ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingestion INSEE → Azure Data Lake bronze/")
    parser.add_argument("--no-upload", action="store_true", help="Ne pas uploader sur Azure")
    args = parser.parse_args()

    LOCAL_DATA_DIR.mkdir(parents=True, exist_ok=True)

    for name, cfg in SOURCES.items():
        print(f"\n{'='*60}")
        print(f"  📊 INSEE — {name}")
        print(f"{'='*60}")

        try:
            if cfg["url"] is None:
                # Vérifier si le fichier a été téléchargé manuellement
                manual_file = LOCAL_DATA_DIR / cfg["file_in_zip"]
                if not manual_file.exists():
                    print(f"  ⚠️  Téléchargement manuel requis pour '{name}'.")
                    print(f"     Voir les instructions dans le script (section SOURCES).")
                    print(f"     Fichier attendu : {manual_file}")
                    continue
                print(f"  📂 Fichier manuel détecté : {manual_file.name}")
            else:
                download_and_extract(cfg["url"], cfg["file_in_zip"], LOCAL_DATA_DIR)
            parquet_path = process_to_parquet(name, cfg)

            if not args.no_upload:
                upload_to_bronze(parquet_path, cfg["remote"])
                parquet_path.unlink()
            else:
                print(f"  📁 Mode local : {parquet_path}")

        except Exception as e:
            print(f"  ❌ Erreur {name} : {e}")
            continue

    print("\n🎉 Ingestion INSEE terminée !")
