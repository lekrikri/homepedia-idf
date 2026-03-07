"""
ingestion/gtfs_idfm/download.py
================================
Télécharge le GTFS d'Île-de-France Mobilités (IDFM) et extrait :
  - stops.txt     → toutes les stations/arrêts IDF (nom, GPS, type)
  - routes.txt    → lignes de transport (métro, RER, bus, tram)
  - trips.txt     → trajets planifiés
  - stop_times.txt → horaires (fichier volumineux ~500 MB)

Calcule un score d'accessibilité transport par commune (IRIS-level).

Upload vers Azure Data Lake Storage Gen2 (container bronze/gtfs/).

Usage :
    python3 download.py                # télécharge + traite + upload
    python3 download.py --no-upload    # test local
    python3 download.py --stops-only   # seulement les stations (rapide)
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

LOCAL_DATA_DIR    = Path(os.getenv("LOCAL_DATA_DIR", "/tmp/dvf")) / "gtfs"
ADLS_ACCOUNT_NAME = os.getenv("ADLS_ACCOUNT_NAME", "homepediadatalake")
ADLS_ACCOUNT_KEY  = os.getenv("ADLS_ACCOUNT_KEY", "")
BRONZE_CONTAINER  = "bronze"

# GTFS IDFM — open data officiel Île-de-France Mobilités
# Source : https://data.iledefrance-mobilites.fr/explore/dataset/offre-horaires-tc-gtfs-idfm/
GTFS_URL = "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/offre-horaires-tc-gtfs-idfm/files/a925e164271e4bcea90d293a5c2be594"

# Types de transport (route_type GTFS)
TRANSPORT_TYPES = {
    0: "tram",
    1: "metro",
    2: "rer",
    3: "bus",
    7: "funiculaire",
    11: "trolleybus",
    12: "monorail",
}

# Score d'accessibilité par type de transport (pour calcul composite)
TRANSPORT_SCORE = {
    "metro":      5,
    "rer":        5,
    "tram":       4,
    "bus":        2,
    "trolleybus": 2,
    "funiculaire": 1,
    "monorail":   1,
}


# ──────────────────────────────────────────────────────────────
# Téléchargement GTFS
# ──────────────────────────────────────────────────────────────

def download_gtfs() -> Path:
    """Télécharge le ZIP GTFS IDFM (~200 MB)."""
    import requests
    LOCAL_DATA_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = LOCAL_DATA_DIR / "idfm_gtfs.zip"

    if zip_path.exists():
        print(f"  📦 GTFS déjà téléchargé : {zip_path}")
        return zip_path

    print(f"  ↓ Téléchargement GTFS IDFM (~200 MB)...")
    r = requests.get(GTFS_URL, stream=True, timeout=300)
    r.raise_for_status()

    total = int(r.headers.get("content-length", 0))
    downloaded = 0

    with open(zip_path, "wb") as f:
        for chunk in r.iter_content(chunk_size=1024 * 1024):
            f.write(chunk)
            downloaded += len(chunk)
            if total:
                print(f"     {downloaded/1024/1024:.0f}/{total/1024/1024:.0f} MB", end="\r")

    print(f"\n  ✅ GTFS téléchargé : {zip_path.stat().st_size / 1024 / 1024:.0f} MB")
    return zip_path


def extract_gtfs_file(zip_path: Path, filename: str) -> pd.DataFrame:
    """Extrait et lit un fichier du ZIP GTFS."""
    print(f"  📂 Lecture {filename}...")
    with zipfile.ZipFile(zip_path) as z:
        matches = [n for n in z.namelist() if n.endswith(filename)]
        if not matches:
            print(f"  ⚠️  {filename} non trouvé dans le ZIP")
            return pd.DataFrame()
        with z.open(matches[0]) as f:
            df = pd.read_csv(f, dtype=str, low_memory=False)
    print(f"     {len(df):,} lignes")
    return df


# ──────────────────────────────────────────────────────────────
# Traitement
# ──────────────────────────────────────────────────────────────

def process_stops(zip_path: Path) -> Path:
    """
    Traite stops.txt → stations nettoyées avec type de transport.
    Jointure avec routes pour ajouter le type de transport à chaque arrêt.
    """
    df_stops = extract_gtfs_file(zip_path, "stops.txt")
    df_routes = extract_gtfs_file(zip_path, "routes.txt")
    df_trips = extract_gtfs_file(zip_path, "trips.txt")
    df_stop_times = extract_gtfs_file(zip_path, "stop_times.txt")

    # --- Arrêts de base ---
    stops = df_stops[["stop_id", "stop_name", "stop_lat", "stop_lon",
                       "location_type", "parent_station"]].copy()
    stops["stop_lat"] = pd.to_numeric(stops["stop_lat"], errors="coerce")
    stops["stop_lon"] = pd.to_numeric(stops["stop_lon"], errors="coerce")
    stops = stops.dropna(subset=["stop_lat", "stop_lon"])

    # --- Jointure pour récupérer route_type par arrêt ---
    # stop_times → trips → routes
    if not df_stop_times.empty and not df_trips.empty and not df_routes.empty:
        # Associer chaque stop à un trip
        st = df_stop_times[["stop_id", "trip_id"]].drop_duplicates()
        trips = df_trips[["trip_id", "route_id"]].drop_duplicates()
        routes = df_routes[["route_id", "route_type", "route_short_name"]].drop_duplicates()

        stop_routes = st.merge(trips, on="trip_id").merge(routes, on="route_id")

        # Pour chaque arrêt, garder le type de transport principal (le plus "important")
        stop_routes["route_type"] = pd.to_numeric(stop_routes["route_type"], errors="coerce")
        stop_routes["transport_type"] = stop_routes["route_type"].map(TRANSPORT_TYPES)
        stop_routes["transport_score"] = stop_routes["transport_type"].map(TRANSPORT_SCORE).fillna(1)

        # Meilleur score par arrêt
        best = (stop_routes.groupby("stop_id")
                .agg(transport_type=("transport_type", lambda x: x.iloc[stop_routes.loc[x.index, "transport_score"].idxmax()]),
                     lignes=("route_short_name", lambda x: ",".join(sorted(set(x.dropna())))))
                .reset_index())

        stops = stops.merge(best, on="stop_id", how="left")
    else:
        stops["transport_type"] = "bus"
        stops["lignes"] = ""

    print(f"  ✅ {len(stops):,} arrêts traités")

    parquet_path = LOCAL_DATA_DIR / "stops.parquet"
    stops.to_parquet(parquet_path, index=False, compression="snappy")
    print(f"     Parquet : {parquet_path.name} ({parquet_path.stat().st_size / 1024:.0f} KB)")
    return parquet_path


def process_accessibility_score(stops_parquet: Path) -> Path:
    """
    Calcule un score d'accessibilité transport par code commune (approx).
    Score = Σ(transport_score × nb_arrêts dans rayon 800m) normalisé sur 10.

    Note : sans PostGIS on fait un groupby approximatif lat/lon arrondi.
    L'enrichissement précis (rayon 800m) sera fait dans Databricks avec Spark.
    """
    print("  📊 Calcul score accessibilité par zone...")
    df = pd.read_parquet(stops_parquet)

    # Arrondir coordonnées pour regrouper par zone ~500m
    df["lat_zone"] = df["stop_lat"].round(3)
    df["lon_zone"] = df["stop_lon"].round(3)

    score_map = TRANSPORT_SCORE
    df["score"] = df["transport_type"].map(score_map).fillna(1)

    zone_scores = (df.groupby(["lat_zone", "lon_zone"])
                   .agg(score_transport=("score", "sum"),
                        nb_arrets=("stop_id", "count"),
                        types_transport=("transport_type", lambda x: ",".join(sorted(set(x.dropna())))))
                   .reset_index())

    # Normaliser sur 10
    max_score = zone_scores["score_transport"].max()
    if max_score > 0:
        zone_scores["score_transport_norm"] = (zone_scores["score_transport"] / max_score * 10).round(2)
    else:
        zone_scores["score_transport_norm"] = 0

    parquet_path = LOCAL_DATA_DIR / "accessibility_scores.parquet"
    zone_scores.to_parquet(parquet_path, index=False, compression="snappy")
    print(f"  ✅ {len(zone_scores):,} zones — Parquet : {parquet_path.name}")
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


def upload_to_bronze(local_path: Path, remote_subpath: str):
    remote_path = f"gtfs/{remote_subpath}"
    print(f"  ☁️  Upload → {BRONZE_CONTAINER}/{remote_path}")
    client = get_adls_client()
    fs = client.get_file_system_client(BRONZE_CONTAINER)
    fc = fs.get_file_client(remote_path)
    with open(local_path, "rb") as f:
        fc.upload_data(f.read(), overwrite=True)
    print(f"  ✅ Uploadé")


# ──────────────────────────────────────────────────────────────
# Point d'entrée
# ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingestion GTFS IDFM → Azure Data Lake bronze/")
    parser.add_argument("--no-upload", action="store_true")
    parser.add_argument("--stops-only", action="store_true", help="Seulement les arrêts (sans horaires)")
    args = parser.parse_args()

    print("\n" + "="*60)
    print("  🚇 GTFS Île-de-France Mobilités")
    print("="*60)

    zip_path = download_gtfs()
    stops_parquet = process_stops(zip_path)
    accessibility_parquet = process_accessibility_score(stops_parquet)

    if not args.no_upload:
        upload_to_bronze(stops_parquet, "stops.parquet")
        upload_to_bronze(accessibility_parquet, "accessibility_scores.parquet")
        stops_parquet.unlink()
        accessibility_parquet.unlink()
        zip_path.unlink()
    else:
        print(f"\n  📁 Mode local :")
        print(f"     {stops_parquet}")
        print(f"     {accessibility_parquet}")

    print("\n🎉 Ingestion GTFS terminée !")
