#!/usr/bin/env python3
"""
Ingestion des gares RER/Transilien IDF depuis l'API SNCF Open Data.
Peuple la table rer_stations avec les coordonnées et temps de trajet depuis Paris.

Usage : SNCF_TOKEN=xxx python3 ingestion/ingest_rer_stations.py
"""

import os
import sys
import time
import base64
import requests
import psycopg2

# ── Config ──────────────────────────────────────────────────────────────────
SNCF_TOKEN = os.environ.get("SNCF_TOKEN", "")
if not SNCF_TOKEN:
    print("❌ SNCF_TOKEN manquant. Ex: SNCF_TOKEN=xxx python3 ingest_rer_stations.py")
    sys.exit(1)

AUTH = base64.b64encode(f"{SNCF_TOKEN}:".encode()).decode()
HEADERS = {"Authorization": f"Basic {AUTH}"}
BASE_URL = "https://api.sncf.com/v1/coverage/sncf"

# Châtelet-Les-Halles — hub central Paris
CHATELET_ID = "stop_area:SNCF:87271007"

# Limites IDF pour filtrer les gares
IDF_LAT = (48.12, 49.24)
IDF_LON = (1.44, 3.56)

# Lignes RER et Transilien IDF à conserver
LIGNES_IDF = {"A", "B", "C", "D", "E", "H", "J", "K", "L", "N", "P", "R", "U"}

DB_CONN = {
    "dbname": "postgres",
    "user": "postgres.iugsfmvqddburvufzacy",
    "password": "@fanfan_gwada_971",
    "host": "aws-0-eu-west-1.pooler.supabase.com",
    "port": 5432,
    "sslmode": "require",
}

def get_json(url, params=None):
    try:
        r = requests.get(url, headers=HEADERS, params=params, timeout=15)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"  ⚠ {url}: {e}")
        return None

def fetch_idf_stop_areas():
    """Récupère toutes les gares IDF par pagination."""
    print("📡 Récupération des stop_areas IDF...")
    stops = []
    start_page = 0
    count = 100
    while True:
        data = get_json(f"{BASE_URL}/stop_areas", params={
            "count": count,
            "start_page": start_page,
        })
        if not data:
            break
        items = data.get("stop_areas", [])
        if not items:
            break
        for s in items:
            coord = s.get("coord", {})
            lat = float(coord.get("lat", 0))
            lon = float(coord.get("lon", 0))
            # Filtrer IDF géographiquement
            if IDF_LAT[0] <= lat <= IDF_LAT[1] and IDF_LON[0] <= lon <= IDF_LON[1]:
                stops.append({
                    "id": s["id"],
                    "nom": s["name"],
                    "lat": lat,
                    "lon": lon,
                })
        print(f"  Page {start_page}: {len(items)} stops ({len(stops)} IDF total)")
        if len(items) < count:
            break
        start_page += count
        time.sleep(0.3)
    return stops

def get_lines_for_stop(stop_id):
    """Récupère les lignes RER/Transilien passant par un arrêt."""
    data = get_json(f"{BASE_URL}/stop_areas/{stop_id}/lines")
    if not data:
        return []
    lines = []
    for line in data.get("lines", []):
        code = line.get("code", "")
        mode = line.get("physical_modes", [{}])[0].get("id", "")
        if code in LIGNES_IDF or "RapidTransit" in mode or "LocalTrain" in mode:
            lines.append(code)
    return list(set(lines))

def get_travel_time_from_paris(stop_id):
    """Temps de trajet Châtelet → stop_id (minutes), via l'API journeys SNCF."""
    data = get_json(f"{BASE_URL}/journeys", params={
        "from": CHATELET_ID,
        "to": stop_id,
        "datetime": "20260717T083000",
        "count": 1,
        "min_nb_journeys": 1,
        "data_freshness": "base_schedule",
    })
    if not data:
        return None
    journeys = data.get("journeys", [])
    if not journeys:
        return None
    duration_s = journeys[0].get("duration", 0)
    return round(duration_s / 60)

def main():
    stops = fetch_idf_stop_areas()
    print(f"\n✅ {len(stops)} arrêts IDF trouvés")

    conn = psycopg2.connect(**DB_CONN)
    cur = conn.cursor()

    # Vider la table pour re-ingérer proprement
    cur.execute("TRUNCATE rer_stations RESTART IDENTITY")
    conn.commit()

    inserted = 0
    for i, stop in enumerate(stops):
        stop_id = stop["id"]
        print(f"[{i+1}/{len(stops)}] {stop['nom']}...", end=" ", flush=True)

        # Lignes passant par cet arrêt
        lines = get_lines_for_stop(stop_id)
        if not lines:
            print("skip (pas de ligne RER/Transilien)")
            continue

        # Temps de trajet depuis Paris
        temps = get_travel_time_from_paris(stop_id)
        if temps is None or temps > 120:
            print(f"skip (temps={temps})")
            continue

        print(f"{temps} min [{', '.join(lines)}]")

        cur.execute("""
            INSERT INTO rer_stations (code_sncf, nom, lat, lon, lignes, temps_paris_min)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (code_sncf) DO UPDATE
            SET nom=EXCLUDED.nom, lat=EXCLUDED.lat, lon=EXCLUDED.lon,
                lignes=EXCLUDED.lignes, temps_paris_min=EXCLUDED.temps_paris_min
        """, (stop_id, stop["nom"], stop["lat"], stop["lon"], ", ".join(lines), temps))
        inserted += 1

        if inserted % 20 == 0:
            conn.commit()
            print(f"  💾 {inserted} gares sauvegardées")
        time.sleep(0.4)  # respecter le rate limit SNCF

    conn.commit()
    conn.close()
    print(f"\n✅ Ingestion terminée : {inserted} gares RER/Transilien enregistrées")

if __name__ == "__main__":
    main()
