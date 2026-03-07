"""
ingestion/osm/extract.py
=========================
Extrait les Points d'Intérêt (POI) d'Île-de-France depuis OpenStreetMap
via l'API Overpass (requêtes ciblées par type de lieu).

POI extraits :
  - Écoles, collèges, lycées, universités
  - Hôpitaux, pharmacies, médecins
  - Commerces (supermarchés, marchés, boulangeries)
  - Parcs et espaces verts
  - Restaurants, cafés, bars
  - Banques, poste

Résultat : GeoJSON + Parquet uploadés dans bronze/osm/

Usage :
    python3 extract.py                # tous les POI IDF
    python3 extract.py --category education  # une catégorie
    python3 extract.py --no-upload    # test local
"""

import os
import json
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

LOCAL_DATA_DIR    = Path(os.getenv("LOCAL_DATA_DIR", "/tmp/dvf")) / "osm"
ADLS_ACCOUNT_NAME = os.getenv("ADLS_ACCOUNT_NAME", "homepediadatalake")
ADLS_ACCOUNT_KEY  = os.getenv("ADLS_ACCOUNT_KEY", "")
BRONZE_CONTAINER  = "bronze"

# API Overpass publique (rate limit : ~1 req/s)
OVERPASS_API = "https://overpass-api.de/api/interpreter"

# Bounding box Île-de-France
IDF_BBOX = "48.12,1.44,49.24,3.56"  # south,west,north,east

# Catégories de POI à extraire
# Format : {nom_categorie: [(tag_key, tag_value), ...]}
POI_CATEGORIES = {
    "education": [
        ("amenity", "school"),
        ("amenity", "college"),
        ("amenity", "university"),
        ("amenity", "kindergarten"),
    ],
    "sante": [
        ("amenity", "hospital"),
        ("amenity", "clinic"),
        ("amenity", "pharmacy"),
        ("amenity", "doctors"),
    ],
    "commerce": [
        ("shop", "supermarket"),
        ("amenity", "marketplace"),
        ("shop", "bakery"),
        ("shop", "butcher"),
        ("shop", "mall"),
    ],
    "parcs": [
        ("leisure", "park"),
        ("leisure", "garden"),
        ("landuse", "recreation_ground"),
    ],
    "restauration": [
        ("amenity", "restaurant"),
        ("amenity", "cafe"),
        ("amenity", "bar"),
        ("amenity", "fast_food"),
    ],
    "services": [
        ("amenity", "bank"),
        ("amenity", "post_office"),
        ("amenity", "police"),
        ("amenity", "fire_station"),
    ],
    "transport": [
        ("highway", "bus_stop"),
        ("railway", "station"),
        ("railway", "subway_entrance"),
        ("amenity", "parking"),
    ],
}


# ──────────────────────────────────────────────────────────────
# Requêtes Overpass
# ──────────────────────────────────────────────────────────────

def build_overpass_query(tags: list[tuple], bbox: str) -> str:
    """Construit une requête Overpass QL pour plusieurs tags dans une bbox."""
    union_parts = []
    for key, value in tags:
        union_parts.append(f'  node["{key}"="{value}"]({bbox});')
        union_parts.append(f'  way["{key}"="{value}"]({bbox});')

    query = f"""
[out:json][timeout:60];
(
{chr(10).join(union_parts)}
);
out center tags;
"""
    return query


def fetch_poi_category(category: str, tags: list[tuple]) -> list[dict]:
    """Récupère tous les POI d'une catégorie via Overpass."""
    print(f"  📍 OSM — {category} ({len(tags)} types)")
    query = build_overpass_query(tags, IDF_BBOX)

    for attempt in range(3):
        try:
            r = requests.post(
                OVERPASS_API,
                data={"data": query},
                timeout=120,
            )
            r.raise_for_status()
            elements = r.json().get("elements", [])
            print(f"     → {len(elements):,} éléments trouvés")
            return elements
        except Exception as e:
            print(f"  ⚠️  Tentative {attempt + 1}/3 échouée : {e}")
            time.sleep(5 * (attempt + 1))

    return []


# ──────────────────────────────────────────────────────────────
# Traitement → Parquet
# ──────────────────────────────────────────────────────────────

def elements_to_dataframe(elements: list[dict], category: str) -> pd.DataFrame:
    """
    Convertit les éléments OSM en DataFrame plat.
    Pour les ways (polygones), utilise le centre calculé par Overpass.
    """
    rows = []
    for el in elements:
        # Récupérer lat/lon
        if el["type"] == "node":
            lat, lon = el.get("lat"), el.get("lon")
        elif el["type"] == "way":
            center = el.get("center", {})
            lat, lon = center.get("lat"), center.get("lon")
        else:
            continue

        if lat is None or lon is None:
            continue

        tags = el.get("tags", {})
        rows.append({
            "osm_id":       el["id"],
            "osm_type":     el["type"],
            "category":     category,
            "name":         tags.get("name", ""),
            "amenity":      tags.get("amenity", ""),
            "shop":         tags.get("shop", ""),
            "leisure":      tags.get("leisure", ""),
            "highway":      tags.get("highway", ""),
            "railway":      tags.get("railway", ""),
            "landuse":      tags.get("landuse", ""),
            "latitude":     lat,
            "longitude":    lon,
            "addr_street":  tags.get("addr:street", ""),
            "addr_city":    tags.get("addr:city", ""),
            "addr_postcode": tags.get("addr:postcode", ""),
        })

    return pd.DataFrame(rows)


def process_category(category: str, tags: list[tuple]) -> Path | None:
    """Fetch + traitement + export Parquet pour une catégorie."""
    elements = fetch_poi_category(category, tags)
    if not elements:
        return None

    df = elements_to_dataframe(elements, category)
    if df.empty:
        return None

    print(f"     ✅ {len(df):,} POI traités")

    LOCAL_DATA_DIR.mkdir(parents=True, exist_ok=True)
    parquet_path = LOCAL_DATA_DIR / f"poi_{category}.parquet"
    df.to_parquet(parquet_path, index=False, compression="snappy")
    print(f"     💾 Parquet : {parquet_path.name} ({parquet_path.stat().st_size / 1024:.0f} KB)")
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


def upload_to_bronze(local_path: Path):
    remote_path = f"osm/{local_path.name}"
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
    parser = argparse.ArgumentParser(description="Ingestion POI OSM IDF → Azure Data Lake bronze/")
    parser.add_argument(
        "--category",
        choices=list(POI_CATEGORIES.keys()) + ["all"],
        default="all",
        help="Catégorie de POI à extraire (défaut: all)"
    )
    parser.add_argument("--no-upload", action="store_true")
    args = parser.parse_args()

    categories = POI_CATEGORIES if args.category == "all" else {args.category: POI_CATEGORIES[args.category]}

    print(f"\n{'='*60}")
    print(f"  🗺️  Extraction POI OSM — Île-de-France")
    print(f"  Catégories : {', '.join(categories.keys())}")
    print(f"{'='*60}")

    for cat, tags in categories.items():
        print(f"\n--- {cat} ---")
        parquet_path = process_category(cat, tags)

        if parquet_path is None:
            continue

        if not args.no_upload:
            upload_to_bronze(parquet_path)
            parquet_path.unlink()
        else:
            print(f"  📁 Mode local : {parquet_path}")

        # Politesse Overpass : attendre entre catégories
        time.sleep(2)

    print("\n🎉 Extraction OSM terminée !")
