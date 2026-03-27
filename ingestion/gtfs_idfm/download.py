"""
ingestion/gtfs_idfm/download.py
================================
Récupère les données transport IDF via l'API PRIM Navitia (Île-de-France Mobilités) :
  - stop_areas  → 15 370 stations/arrêts IDF (nom, GPS, type)
  - lines       → lignes de transport (métro, RER, bus, tram)

Calcule un score d'accessibilité transport par zone (~500m).

Upload vers Azure Data Lake Storage Gen2 (container bronze/gtfs/).

Usage :
    python3 download.py                # télécharge + traite + upload
    python3 download.py --no-upload    # test local uniquement

Prérequis :
    PRIM_API_KEY dans ingestion/.env
    Inscription gratuite : https://prim.iledefrance-mobilites.fr/
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

LOCAL_DATA_DIR    = Path(os.getenv("LOCAL_DATA_DIR", "/tmp/dvf")) / "gtfs"
ADLS_ACCOUNT_NAME = os.getenv("ADLS_ACCOUNT_NAME", "homepediadatalake")
ADLS_ACCOUNT_KEY  = os.getenv("ADLS_ACCOUNT_KEY", "")
PRIM_API_KEY      = os.getenv("PRIM_API_KEY", "")
BRONZE_CONTAINER  = "bronze"

PRIM_BASE = "https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia"

# Types de transport navitia → label
PHYSICAL_MODES = {
    "physical_mode:Metro":       ("metro",       5),
    "physical_mode:RapidTransit":("rer",         5),
    "physical_mode:Tramway":     ("tram",        4),
    "physical_mode:Bus":         ("bus",         2),
    "physical_mode:LocalTrain":  ("train",       4),
    "physical_mode:Shuttle":     ("navette",     1),
    "physical_mode:Funicular":   ("funiculaire", 1),
}


# ──────────────────────────────────────────────────────────────
# API PRIM helpers
# ──────────────────────────────────────────────────────────────

def prim_get(endpoint: str, params: dict = None) -> dict:
    """Appel GET sur l'API PRIM Navitia."""
    if not PRIM_API_KEY:
        raise ValueError(
            "PRIM_API_KEY non définie.\n"
            "  → S'inscrire sur https://prim.iledefrance-mobilites.fr/\n"
            "  → Ajouter PRIM_API_KEY=<votre_clé> dans ingestion/.env"
        )
    url = f"{PRIM_BASE}/{endpoint.lstrip('/')}"
    r = requests.get(url, headers={"apikey": PRIM_API_KEY}, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def prim_paginate(endpoint: str, key: str, page_size: int = 1000) -> list:
    """Pagine automatiquement sur tous les résultats d'un endpoint navitia."""
    results = []
    start = 0
    total = None
    while True:
        data = prim_get(endpoint, params={"count": page_size, "start_page": start // page_size})
        if total is None:
            total = data.get("pagination", {}).get("total_result", 0)
        batch = data.get(key, [])
        results.extend(batch)
        print(f"     {len(results)}/{total}", end="\r")
        if len(results) >= total or not batch:
            break
        start += page_size
        time.sleep(0.15)   # respecter rate limit PRIM
    print()
    return results


# ──────────────────────────────────────────────────────────────
# Téléchargement et traitement
# ──────────────────────────────────────────────────────────────

def fetch_stops() -> Path:
    """Récupère tous les arrêts IDF via l'API navitia → stops.parquet."""
    print("  🚉 Téléchargement des arrêts (stop_areas)...")
    raw = prim_paginate("stop_areas/", "stop_areas")

    rows = []
    for s in raw:
        coord = s.get("coord", {})
        lat = float(coord.get("lat", 0) or 0)
        lon = float(coord.get("lon", 0) or 0)
        if not lat or not lon:
            continue

        # Déduire le type de transport depuis physical_modes
        modes = [m.get("id", "") for m in s.get("physical_modes", [])]
        transport_type = "bus"
        transport_score = 2
        for mode_id in modes:
            if mode_id in PHYSICAL_MODES:
                label, score = PHYSICAL_MODES[mode_id]
                if score > transport_score:
                    transport_type = label
                    transport_score = score

        lignes = ",".join(
            l.get("id", "") for l in s.get("lines", [])
        )

        rows.append({
            "stop_id":        s.get("id", ""),
            "stop_name":      s.get("name", ""),
            "stop_lat":       lat,
            "stop_lon":       lon,
            "transport_type": transport_type,
            "transport_score":transport_score,
            "lignes":         lignes,
        })

    df = pd.DataFrame(rows)
    LOCAL_DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = LOCAL_DATA_DIR / "stops.parquet"
    df.to_parquet(out, index=False, compression="snappy")
    print(f"  ✅ {len(df):,} arrêts → {out.name} ({out.stat().st_size / 1024:.0f} KB)")
    return out


def fetch_lines() -> Path:
    """Récupère toutes les lignes IDF → lines.parquet."""
    print("  🚇 Téléchargement des lignes (lines)...")
    raw = prim_paginate("lines/", "lines")

    rows = []
    for l in raw:
        rows.append({
            "line_id":       l.get("id", ""),
            "line_name":     l.get("name", ""),
            "line_code":     l.get("code", ""),
            "transport_type":l.get("physical_modes", [{}])[0].get("id", "").replace("physical_mode:", "").lower()
                             if l.get("physical_modes") else "bus",
            "color":         l.get("color", ""),
            "network":       l.get("network", {}).get("name", ""),
        })

    df = pd.DataFrame(rows)
    out = LOCAL_DATA_DIR / "lines.parquet"
    df.to_parquet(out, index=False, compression="snappy")
    print(f"  ✅ {len(df):,} lignes → {out.name} ({out.stat().st_size / 1024:.0f} KB)")
    return out


def compute_accessibility(stops_path: Path) -> Path:
    """Score d'accessibilité transport par zone (~500m) → accessibility_scores.parquet."""
    print("  📊 Calcul score accessibilité par zone...")
    df = pd.read_parquet(stops_path)

    df["lat_zone"] = df["stop_lat"].round(3)
    df["lon_zone"] = df["stop_lon"].round(3)

    zone = (df.groupby(["lat_zone", "lon_zone"])
              .agg(score_transport=("transport_score", "sum"),
                   nb_arrets=("stop_id", "count"),
                   types_transport=("transport_type", lambda x: ",".join(sorted(set(x)))))
              .reset_index())

    max_s = zone["score_transport"].max()
    zone["score_transport_norm"] = (zone["score_transport"] / max_s * 10).round(2) if max_s else 0

    out = LOCAL_DATA_DIR / "accessibility_scores.parquet"
    zone.to_parquet(out, index=False, compression="snappy")
    print(f"  ✅ {len(zone):,} zones → {out.name}")
    return out


# ──────────────────────────────────────────────────────────────
# Upload Azure
# ──────────────────────────────────────────────────────────────

def upload_to_bronze(local_path: Path, remote_name: str):
    print(f"  ☁️  Upload → {BRONZE_CONTAINER}/gtfs/{remote_name}")
    client = DataLakeServiceClient(
        account_url=f"https://{ADLS_ACCOUNT_NAME}.dfs.core.windows.net",
        credential=ADLS_ACCOUNT_KEY,
    )
    fc = client.get_file_system_client(BRONZE_CONTAINER).get_file_client(f"gtfs/{remote_name}")
    with open(local_path, "rb") as f:
        fc.upload_data(f.read(), overwrite=True)
    print(f"  ✅ Uploadé ({local_path.stat().st_size / 1024:.0f} KB)")


# ──────────────────────────────────────────────────────────────
# Point d'entrée
# ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingestion transports IDF via PRIM Navitia → Azure bronze/gtfs/")
    parser.add_argument("--no-upload", action="store_true", help="Ne pas uploader sur Azure")
    args = parser.parse_args()

    print("\n" + "=" * 60)
    print("  🚇 GTFS / PRIM Île-de-France Mobilités")
    print("=" * 60)

    stops_path        = fetch_stops()
    lines_path        = fetch_lines()
    accessibility_path = compute_accessibility(stops_path)

    if not args.no_upload:
        upload_to_bronze(stops_path,         "stops.parquet")
        upload_to_bronze(lines_path,         "lines.parquet")
        upload_to_bronze(accessibility_path, "accessibility_scores.parquet")
        stops_path.unlink()
        lines_path.unlink()
        accessibility_path.unlink()
    else:
        print(f"\n  📁 Fichiers locaux :")
        for p in [stops_path, lines_path, accessibility_path]:
            print(f"     {p}")

    print("\n🎉 Ingestion GTFS/PRIM terminée !")
