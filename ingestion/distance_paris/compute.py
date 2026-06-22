"""
ingestion/distance_paris/compute.py
======================================
Calcule la distance vol d'oiseau entre chaque commune IDF et le centre de Paris
(Notre-Dame de Paris — référence historique des distances routières françaises).

Utilise les centroïdes (centroid_lat, centroid_lon) déjà stockés dans communes_agregat.

Colonne ajoutée :
  distance_paris_km → distance en km (vol d'oiseau, Haversine)

Cette distance sert à calculer le score_accessibilite :
  - < 5 km → très proche (Paris intramuros ou première couronne)
  - 5-15 km → proche (petite couronne)
  - 15-30 km → moyen (grande couronne proche)
  - 30-50 km → éloigné
  - > 50 km → très éloigné (Fontainebleau, Rambouillet, Vexin...)

Usage :
    python3 ingestion/distance_paris/compute.py
"""

import math
import psycopg2
from psycopg2.extras import execute_values
import os

PG_HOST     = os.getenv("POSTGRES_HOST", "localhost")
PG_PORT     = int(os.getenv("POSTGRES_PORT", 5433))
PG_DB       = os.getenv("POSTGRES_DB", "homepedia")
PG_USER     = os.getenv("POSTGRES_USER", "homepedia")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "homepedia")

# Parvis de Notre-Dame de Paris — point de référence officiel km 0
PARIS_LAT = 48.8530
PARIS_LON = 2.3498


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance en km entre deux points GPS (formule de Haversine)."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def add_distance_column(conn):
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE communes_agregat
                ADD COLUMN IF NOT EXISTS distance_paris_km DOUBLE PRECISION
        """)
        conn.commit()
    print("  ✅ Colonne distance_paris_km prête")


def compute_and_update(conn) -> int:
    """Calcule et met à jour la distance Paris pour toutes les communes."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT code_commune, centroid_lat, centroid_lon
            FROM communes_agregat
            WHERE centroid_lat IS NOT NULL AND centroid_lon IS NOT NULL
        """)
        communes = cur.fetchall()

    print(f"  Calcul distance Paris pour {len(communes):,} communes...")

    data = []
    for code, lat, lon in communes:
        d = haversine_km(float(lat), float(lon), PARIS_LAT, PARIS_LON)
        data.append((str(code).zfill(5), round(d, 2)))

    with conn.cursor() as cur:
        cur.execute("""
            CREATE TEMP TABLE tmp_dist (
                code_commune      CHAR(5),
                distance_paris_km DOUBLE PRECISION
            ) ON COMMIT DROP
        """)
        execute_values(cur, "INSERT INTO tmp_dist VALUES %s", data)
        cur.execute("""
            UPDATE communes_agregat ca
            SET distance_paris_km = t.distance_paris_km
            FROM tmp_dist t
            WHERE ca.code_commune = t.code_commune
        """)
        updated = cur.rowcount
        conn.commit()

    return updated


def main():
    print("📍 Calcul distances Paris → PostgreSQL\n")

    conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT,
        dbname=PG_DB, user=PG_USER, password=PG_PASSWORD
    )

    add_distance_column(conn)
    updated = compute_and_update(conn)
    print(f"  → {updated} communes mises à jour ✅")

    # Stats
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
                MIN(distance_paris_km)::numeric(6,1) as min_km,
                AVG(distance_paris_km)::numeric(6,1) as moy_km,
                MAX(distance_paris_km)::numeric(6,1) as max_km,
                COUNT(*) FILTER (WHERE distance_paris_km < 5)  as n_lt5,
                COUNT(*) FILTER (WHERE distance_paris_km < 15) as n_lt15,
                COUNT(*) FILTER (WHERE distance_paris_km < 30) as n_lt30
            FROM communes_agregat WHERE distance_paris_km IS NOT NULL
        """)
        row = cur.fetchone()
        if row:
            print(f"\n  Distances : min={row[0]}km | moy={row[1]}km | max={row[2]}km")
            print(f"  < 5km (Paris) : {row[3]} communes")
            print(f"  < 15km       : {row[4]} communes")
            print(f"  < 30km       : {row[5]} communes")

        cur.execute("""
            SELECT city, distance_paris_km
            FROM communes_agregat
            WHERE distance_paris_km IS NOT NULL
            ORDER BY distance_paris_km DESC
            LIMIT 5
        """)
        print("\nCommunes les plus éloignées de Paris :")
        for city, d in cur.fetchall():
            print(f"  {(city or '?'):<35} {d:.1f} km")

    conn.close()
    print("\n✅ Distances Paris calculées !")


if __name__ == "__main__":
    main()
