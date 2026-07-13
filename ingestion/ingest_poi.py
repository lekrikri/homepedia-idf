#!/usr/bin/env python3
"""
ingest_poi.py — Pré-ingestion POI Overpass → Supabase
Élimine tous les appels Overpass en temps réel. À relancer ~1x/mois.

Usage:
  python3 ingest_poi.py                   # toutes les communes
  python3 ingest_poi.py --dept 92         # un département
  python3 ingest_poi.py --limit 10        # test sur 10 communes
  python3 ingest_poi.py --skip-existing   # ignorer les communes déjà ingérées
"""
import argparse
import time
import requests
import psycopg2
from psycopg2.extras import Json
import os

DB_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:@fanfan_gwada_971@db.iugsfmvqddburvufzacy.supabase.co:5432/postgres"
)
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
DELAY_S = 1.2  # ~50 req/min — sous le rate-limit Overpass

# Exactement la même requête batch que MapView.jsx fetchPOIBatch()
QUERY_TEMPLATE = """[out:json][timeout:25];(
node["public_transport"="station"](around:3000,{lat},{lon});
node["railway"~"station|tram_stop"](around:2500,{lat},{lon});
node["amenity"~"police|fire_station|hospital|pharmacy"](around:3500,{lat},{lon});
way["amenity"~"police|fire_station|hospital"](around:3500,{lat},{lon});
node["amenity"~"restaurant|cafe|bar|fast_food|brasserie"](around:2000,{lat},{lon});
node["amenity"~"school|university|college|kindergarten"](around:3000,{lat},{lon});
way["amenity"~"school|university|college"](around:3000,{lat},{lon});
node["leisure"~"park|garden|nature_reserve|playground"](around:3000,{lat},{lon});
way["leisure"~"park|garden|nature_reserve"](around:3000,{lat},{lon});
node["shop"~"supermarket|convenience|bakery|butcher|mall|marketplace|florist"](around:2000,{lat},{lon});
);out center body;"""


def classify(elements: list) -> dict:
    """Même logique de classification que MapView.jsx (lignes 87-102)."""
    b = {"transports": [], "security": [], "restaurants": [], "schools": [], "parks": [], "shops": []}
    for el in elements:
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if not lat or not lon:
            continue
        tags = el.get("tags", {})
        am = tags.get("amenity", "")
        pt = tags.get("public_transport", "")
        ra = tags.get("railway", "")
        le = tags.get("leisure", "")
        sh = tags.get("shop", "")
        entry = {"name": tags.get("name", ""), "lat": lat, "lon": lon, "tags": tags}
        if pt == "station" or any(x in ra for x in ["station", "tram_stop"]):
            b["transports"].append(entry)
        elif any(x in am for x in ["police", "fire_station", "hospital", "pharmacy"]):
            b["security"].append(entry)
        elif any(x in am for x in ["restaurant", "cafe", "bar", "fast_food", "brasserie"]):
            b["restaurants"].append(entry)
        elif any(x in am for x in ["school", "university", "college", "kindergarten"]):
            b["schools"].append(entry)
        elif any(x in le for x in ["park", "garden", "nature_reserve", "playground"]):
            b["parks"].append(entry)
        elif sh:
            b["shops"].append(entry)
    return b


def fetch_poi(lat: float, lon: float, retries: int = 3) -> dict:
    q = QUERY_TEMPLATE.format(lat=lat, lon=lon)
    for attempt in range(retries):
        try:
            r = requests.post(OVERPASS_URL, data=q, timeout=30)
            if r.status_code == 200:
                return classify(r.json().get("elements", []))
            if r.status_code == 429:
                wait = 30 + attempt * 30
                print(f"\n  ⏳ Rate-limit Overpass — attente {wait}s...")
                time.sleep(wait)
        except requests.Timeout:
            print(f"\n  ⏱️  Timeout (tentative {attempt+1}/{retries})")
            time.sleep(5)
        except Exception as e:
            print(f"\n  ❌ Erreur réseau: {e}")
            break
    return {"transports": [], "security": [], "restaurants": [], "schools": [], "parks": [], "shops": []}


def main():
    parser = argparse.ArgumentParser(description="Ingestion POI Overpass → Supabase")
    parser.add_argument("--limit", type=int, default=0, help="Nb communes max (0=toutes)")
    parser.add_argument("--dept", type=str, default="", help="Département (ex: 92)")
    parser.add_argument("--skip-existing", action="store_true", help="Ignorer communes déjà ingérées")
    args = parser.parse_args()

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    # Créer la table si elle n'existe pas
    cur.execute("""
        CREATE TABLE IF NOT EXISTS poi_communes (
            code_commune TEXT PRIMARY KEY,
            data         JSONB NOT NULL,
            updated_at   TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_poi_communes_updated ON poi_communes (updated_at);
    """)
    conn.commit()
    print("✅ Table poi_communes prête")

    # Charger les communes à traiter
    params: list = []
    where = ""
    if args.dept:
        where = "WHERE TRIM(code_departement) = %s"
        params.append(args.dept)
    limit_sql = f"LIMIT {args.limit}" if args.limit > 0 else ""
    cur.execute(
        f"SELECT code_commune, centroid_lon, centroid_lat, city FROM communes_agregat {where} ORDER BY code_commune {limit_sql}",
        params
    )
    communes = cur.fetchall()

    if args.skip_existing:
        cur.execute("SELECT code_commune FROM poi_communes")
        done = {r[0] for r in cur.fetchall()}
        before = len(communes)
        communes = [c for c in communes if c[0] not in done]
        print(f"  → skip-existing : {before - len(communes)} ignorées, {len(communes)} restantes")

    total = len(communes)
    print(f"🗺️  {total} communes à traiter" + (f" (dept {args.dept})" if args.dept else ""))

    errors = []
    for i, (code, lon, lat, city) in enumerate(communes, 1):
        label = f"[{i:4}/{total}] {code} {city[:20]:<20}"
        print(f"{label}...", end=" ", flush=True)

        poi = fetch_poi(lat, lon)
        n = sum(len(v) for v in poi.values())

        try:
            cur.execute("""
                INSERT INTO poi_communes (code_commune, data)
                VALUES (%s, %s)
                ON CONFLICT (code_commune)
                DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
            """, (code, Json(poi)))
            conn.commit()
            print(f"✅ {n:4d} POI")
        except Exception as e:
            conn.rollback()
            errors.append(code)
            print(f"❌ DB error: {e}")

        time.sleep(DELAY_S)

    cur.close()
    conn.close()

    print(f"\n{'='*50}")
    print(f"✅ Terminé — {total - len(errors)}/{total} communes ingérées")
    if errors:
        print(f"⚠️  Erreurs sur {len(errors)} communes : {errors[:10]}")
    print(f"💡 Durée estimée pour 1266 communes : ~{1266 * DELAY_S / 60:.0f} min")


if __name__ == "__main__":
    main()
