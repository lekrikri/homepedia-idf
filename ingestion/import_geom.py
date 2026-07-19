#!/usr/bin/env python3
"""
Import des géométries communes IDF dans Supabase (colonne geom PostGIS).
Source : geo.api.gouv.fr — contours WGS84 / EPSG:4326

Usage : python ingestion/import_geom.py
"""
import json
import os
import requests
import psycopg2
from psycopg2.extras import execute_batch

DB = (
    "host=aws-0-eu-west-1.pooler.supabase.com "
    "port=5432 "
    "user=postgres.iugsfmvqddburvufzacy "
    "dbname=postgres "
    "sslmode=require "
    f"password={os.getenv('POSTGRES_PASSWORD')}"
)

GEO_API = (
    "https://geo.api.gouv.fr/communes"
    "?codeRegion=11&geometry=contour&format=geojson&fields=nom,code"
)


def main() -> None:
    print("📥 Téléchargement géométries communes IDF (geo.api.gouv.fr)...")
    r = requests.get(GEO_API, timeout=30)
    r.raise_for_status()
    features = r.json().get("features", [])
    print(f"✅ {len(features)} communes reçues")

    updates = [
        (json.dumps(f["geometry"]), f["properties"]["code"])
        for f in features
        if f.get("geometry") and f.get("properties", {}).get("code")
    ]
    print(f"🔄 {len(updates)} géométries à insérer...")

    conn = psycopg2.connect(DB)
    cur = conn.cursor()

    execute_batch(
        cur,
        """
        UPDATE communes
        SET geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
        WHERE code_insee = %s
        """,
        updates,
        page_size=100,
    )
    conn.commit()

    cur.execute("SELECT COUNT(*) FROM communes WHERE geom IS NOT NULL")
    n = cur.fetchone()[0]
    print(f"✅ {n} communes mises à jour avec géométrie PostGIS")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
