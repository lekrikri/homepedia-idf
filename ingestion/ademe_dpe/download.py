"""
ingestion/ademe_dpe/download.py
================================
Télécharge les Diagnostics de Performance Énergétique (DPE) depuis l'ADEME
via l'API officielle open data (data.ademe.fr).

Données : logements résidentiels — étiquettes DPE A→G, conso énergie, GES.
Focus : Île-de-France (départements 75, 77, 78, 91, 92, 93, 94, 95).

Upload vers Azure Data Lake Storage Gen2 (container bronze/dpe/).

Usage :
    python3 download.py                    # IDF complet
    python3 download.py --dept 75          # Paris uniquement
    python3 download.py --no-upload        # test local
"""

import os
import time
import argparse
from pathlib import Path

import pandas as pd
import requests
from azure.storage.filedatalake import DataLakeServiceClient
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

# ──────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────

LOCAL_DATA_DIR    = Path(os.getenv("LOCAL_DATA_DIR", "/tmp/dvf")) / "dpe"
ADLS_ACCOUNT_NAME = os.getenv("ADLS_ACCOUNT_NAME", "homepediadatalake")
ADLS_ACCOUNT_KEY  = os.getenv("ADLS_ACCOUNT_KEY", "")
BRONZE_CONTAINER  = "bronze"

# API ADEME data.ademe.fr (données DPE logements existants)
DPE_API_BASE = "https://data.ademe.fr/data-fair/api/v1/datasets/meg-83tjwtg8dyz4vv7h1dqe/lines"

# Colonnes utiles
COLONNES_DPE = [
    "numero_dpe",
    "date_reception_dpe",
    "code_insee_ban",
    "nom_commune_ban",
    "code_postal_ban",
    "etiquette_dpe",                # A, B, C, D, E, F, G
    "etiquette_ges",                # A, B, C, D, E, F, G
    "conso_5_usages_par_m2_ep",     # kWh ep/m².an (énergie primaire)
    "emission_ges_5_usages_par_m2", # kgCO2eq/m².an
    "surface_habitable_immeuble",   # m²
    "type_batiment",                # Maison individuelle, Appartement, Immeuble
    "periode_construction",         # ex: "après 2000"
    "coordonnee_cartographique_x_ban",
    "coordonnee_cartographique_y_ban",
]

RENAME_COLONNES = {
    "numero_dpe":                       "id_dpe",
    "date_reception_dpe":               "date_dpe",
    "code_insee_ban":                   "code_commune",
    "nom_commune_ban":                  "nom_commune",
    "code_postal_ban":                  "code_postal",
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

# Départements IDF
DEPTS_IDF = ["75", "77", "78", "91", "92", "93", "94", "95"]


# ──────────────────────────────────────────────────────────────
# Téléchargement API paginée
# ──────────────────────────────────────────────────────────────

def fetch_dpe_dept(dept: str, page_size: int = 10_000, max_rows: int = 100_000) -> pd.DataFrame:
    """
    Récupère les DPE d'un département via l'API ADEME (data-fair).
    Utilise le filtre exact sur code_departement_ban + pagination par curseur 'after'.
    Limite à max_rows pour éviter les téléchargements de plusieurs millions de lignes.
    """
    all_rows = []
    after = None
    total = None

    print(f"  📡 API ADEME — département {dept}")

    while True:
        params = {
            "size": page_size,
            "qs": f"code_departement_ban:{dept}",  # filtre exact par département
            "select": ",".join(COLONNES_DPE),
            "sort": "-date_reception_dpe",          # plus récents en premier
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
            cap = min(total, max_rows)
            print(f"     Total DPE dép.{dept} : {total:,} → téléchargement limité à {cap:,}")

        results = data.get("results", [])
        if not results:
            break

        all_rows.extend(results)
        after = data.get("next")  # curseur page suivante

        pct = len(all_rows) / min(total, max_rows) * 100 if total > 0 else 0
        print(f"     {len(all_rows):,}/{min(total,max_rows):,} ({pct:.0f}%)", end="\r")

        if len(all_rows) >= max_rows:
            break

        # `next` est une URL complète ou un paramètre after — on extrait juste la valeur after
        next_url = data.get("next")
        if not next_url:
            break
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(next_url)
        qs = parse_qs(parsed.query)
        after_values = qs.get("after", [])
        if not after_values:
            break
        after = after_values[0]

        time.sleep(0.2)

    print()
    return pd.DataFrame(all_rows) if all_rows else pd.DataFrame()


# ──────────────────────────────────────────────────────────────
# Traitement → Parquet
# ──────────────────────────────────────────────────────────────

def process_dpe(df: pd.DataFrame, dept: str) -> Path:
    """Nettoie et exporte en Parquet."""
    print(f"  🔄 Traitement DPE {dept} — {len(df):,} lignes")

    # Renommer les colonnes
    rename = {k: v for k, v in RENAME_COLONNES.items() if k in df.columns}
    df = df.rename(columns=rename)

    # Colonnes numériques
    for col in ["conso_energie_kwh_m2", "emission_ges_kg_m2", "surface_m2",
                "annee_construction", "longitude", "latitude"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Supprimer lignes sans code commune ou étiquette DPE
    avant = len(df)
    df = df.dropna(subset=["code_commune", "etiquette_dpe"])
    print(f"     🧹 {avant - len(df):,} lignes supprimées → {len(df):,} DPE propres")

    df["code_departement"] = dept

    LOCAL_DATA_DIR.mkdir(parents=True, exist_ok=True)
    parquet_path = LOCAL_DATA_DIR / f"dpe_{dept}.parquet"
    df.to_parquet(parquet_path, index=False, compression="snappy")
    print(f"     ✅ Parquet : {parquet_path.name} ({parquet_path.stat().st_size / 1024:.0f} KB)")
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


def upload_to_bronze(local_path: Path, dept: str):
    remote_path = f"dpe/dept={dept}/{local_path.name}"
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
    parser = argparse.ArgumentParser(description="Ingestion DPE ADEME → Azure Data Lake bronze/")
    parser.add_argument("--dept", default=None, help="Département unique (ex: 75). Défaut: tous IDF")
    parser.add_argument("--no-upload", action="store_true", help="Ne pas uploader sur Azure")
    args = parser.parse_args()

    depts = [args.dept] if args.dept else DEPTS_IDF

    for dept in depts:
        print(f"\n{'='*60}")
        print(f"  🏠 DPE — département {dept}")
        print(f"{'='*60}")

        df = fetch_dpe_dept(dept)
        if df.empty:
            print(f"  ⚠️  Aucune donnée pour le département {dept}")
            continue

        parquet_path = process_dpe(df, dept)

        if not args.no_upload:
            upload_to_bronze(parquet_path, dept)
            parquet_path.unlink()
        else:
            print(f"  📁 Mode local : {parquet_path}")

    print("\n🎉 Ingestion DPE terminée !")
