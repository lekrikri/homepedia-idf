"""
ingestion/transports/download_gcs.py
=======================================
Récupère les arrêts de transports en commun IDFM (bus, métro, RER, tram, Transilien)
depuis l'open data Île-de-France Mobilités et calcule le nombre d'arrêts par commune.

Source : data.iledefrance-mobilites.fr — dataset "Arrêts lignes"
         GTFS statique IDF (stops.txt)

Colonne ajoutée :
  nb_arrets_tc → nombre d'arrêts TC distincts dans la commune

La jointure commune↔arrêt se fait par code INSEE si disponible,
sinon par distance Haversine (arrêt ↔ centroïde commune ≤ rayon estimé).

Usage :
    python3 ingestion/transports/download_gcs.py
"""

import io
import math
import zipfile
import requests
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import os

PG_HOST     = os.getenv("POSTGRES_HOST", "localhost")
PG_PORT     = int(os.getenv("POSTGRES_PORT", 5433))
PG_DB       = os.getenv("POSTGRES_DB", "homepedia")
PG_USER     = os.getenv("POSTGRES_USER", "homepedia")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "homepedia")

# IDFM open data — dataset arrêts
IDFM_ARRETS_URL = "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/arrets-lignes/exports/csv?lang=fr&timezone=Europe%2FParis"

# GTFS statique IDF (fallback)
GTFS_URL = "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/offre-horaires-tc-gtfs-idfm/files/a925e164271e4bced9018680e72a6fb1"


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance en km entre deux points GPS."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def fetch_arrets_idfm() -> pd.DataFrame | None:
    """Récupère les arrêts depuis l'API IDFM open data."""
    try:
        print("  ↓ Téléchargement arrêts IDFM...")
        r = requests.get(IDFM_ARRETS_URL, timeout=120)
        r.raise_for_status()
        df = pd.read_csv(io.BytesIO(r.content), sep=";", dtype=str, on_bad_lines="skip")
        print(f"     ✅ {len(df):,} arrêts | colonnes: {list(df.columns)[:8]}")
        return df
    except Exception as e:
        print(f"  ⚠️  API IDFM échouée : {e}")
        return None


def fetch_arrets_gtfs() -> pd.DataFrame | None:
    """Fallback : télécharge le GTFS IDFM et extrait stops.txt."""
    try:
        print("  ↓ Téléchargement GTFS IDFM (fallback)...")
        r = requests.get(GTFS_URL, timeout=300)
        r.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
            if "stops.txt" in zf.namelist():
                with zf.open("stops.txt") as f:
                    df = pd.read_csv(f, dtype=str)
                    print(f"     ✅ {len(df):,} arrêts GTFS | colonnes: {list(df.columns)[:8]}")
                    return df
    except Exception as e:
        print(f"  ⚠️  GTFS IDFM échoué : {e}")
    return None


def normalize_arrets(df: pd.DataFrame) -> pd.DataFrame | None:
    """
    Normalise le DataFrame arrêts pour avoir :
    stop_id, stop_lat, stop_lon, code_insee (si dispo)
    """
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]

    col_lat = _find_col(df, ["stop_lat", "coordonnees_geo_lat", "lat", "latitude", "y"])
    col_lon = _find_col(df, ["stop_lon", "coordonnees_geo_lon", "lon", "longitude", "x"])
    col_id  = _find_col(df, ["stop_id", "id_arret", "id", "identifiant_arret"])
    col_insee = _find_col(df, ["code_commune", "code_insee", "insee_com", "commune_code"])

    # Parfois geo est dans une colonne "geo_point_2d" : "48.8566,2.3522"
    if (not col_lat or not col_lon):
        col_geo = _find_col(df, ["geo_point_2d", "geo", "coordonnees_geo", "geom"])
        if col_geo:
            coords = df[col_geo].astype(str).str.split(",", expand=True)
            if coords.shape[1] >= 2:
                df["stop_lat"] = pd.to_numeric(coords[0], errors="coerce")
                df["stop_lon"] = pd.to_numeric(coords[1], errors="coerce")
                col_lat, col_lon = "stop_lat", "stop_lon"

    if not col_lat or not col_lon:
        print(f"  ⚠️  Colonnes lat/lon introuvables. Colonnes dispo: {list(df.columns)[:15]}")
        return None

    result = pd.DataFrame()
    result["stop_id"]   = df[col_id].astype(str) if col_id else df.index.astype(str)
    result["stop_lat"]  = pd.to_numeric(df[col_lat], errors="coerce")
    result["stop_lon"]  = pd.to_numeric(df[col_lon], errors="coerce")
    result["code_insee"] = df[col_insee].astype(str).str.zfill(5) if col_insee else None

    result = result[result["stop_lat"].notna() & result["stop_lon"].notna()].copy()
    # Filtrer IDF (lat ~48.1-49.3, lon ~1.4-3.6)
    result = result[
        result["stop_lat"].between(48.0, 49.5) &
        result["stop_lon"].between(1.3, 3.7)
    ]
    # Dédupliquer sur coordonnées (arrondissement à 4 décimales ~10m)
    result["lat4"] = result["stop_lat"].round(4)
    result["lon4"] = result["stop_lon"].round(4)
    result = result.drop_duplicates(subset=["lat4", "lon4"])

    print(f"  → {len(result):,} arrêts uniques IDF")
    return result


def _find_col(df: pd.DataFrame, candidates: list) -> str | None:
    cols = {c.lower(): c for c in df.columns}
    for cand in candidates:
        if cand.lower() in cols:
            return cols[cand.lower()]
    return None


def load_communes(conn) -> pd.DataFrame:
    """Charge les communes IDF avec centroïde et surface."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT code_commune, centroid_lat, centroid_lon, surface_km2
            FROM communes_agregat
            WHERE centroid_lat IS NOT NULL AND centroid_lon IS NOT NULL
        """)
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=["code_commune", "lat", "lon", "surface_km2"])


def assign_arrets_to_communes(arrets: pd.DataFrame, communes: pd.DataFrame) -> pd.DataFrame:
    """
    Pour chaque arrêt, trouve la commune la plus proche (si ≤ rayon).
    Rayon estimé = √(surface/π) * 1.2 (majoration pour communes étirées).
    Compte ensuite nb_arrets_tc par commune.
    """
    print(f"  Jointure spatiale {len(arrets):,} arrêts × {len(communes):,} communes...")

    comm_list = communes.to_dict("records")
    counts = {row["code_commune"]: 0 for row in comm_list}

    # Si code_insee disponible dans les arrêts, jointure directe
    if "code_insee" in arrets.columns and arrets["code_insee"].notna().sum() > len(arrets) * 0.5:
        joined = arrets[arrets["code_insee"].notna()].groupby("code_insee").size().reset_index(name="n")
        for _, r in joined.iterrows():
            code = str(r["code_insee"]).zfill(5)
            if code in counts:
                counts[code] = int(r["n"])
        assigned = sum(1 for v in counts.values() if v > 0)
        print(f"  Jointure directe par code INSEE : {assigned} communes couvertes")
    else:
        # Jointure géographique Haversine
        # Pré-calcul des rayons par commune
        radii = {
            row["code_commune"]: math.sqrt(max(row["surface_km2"] or 1, 0.5) / math.pi) * 1.5
            for row in comm_list
        }

        for _, arret in arrets.iterrows():
            lat_a, lon_a = arret["stop_lat"], arret["stop_lon"]
            best_code, best_dist = None, float("inf")
            for comm in comm_list:
                d = haversine_km(lat_a, lon_a, comm["lat"], comm["lon"])
                if d < best_dist and d <= radii[comm["code_commune"]]:
                    best_dist = d
                    best_code = comm["code_commune"]
            if best_code:
                counts[best_code] += 1

        assigned = sum(1 for v in counts.values() if v > 0)
        print(f"  Jointure Haversine : {assigned} communes avec au moins 1 arrêt")

    result = pd.DataFrame([
        {"code_commune": k, "nb_arrets_tc": v}
        for k, v in counts.items()
    ])
    return result


def add_tc_column(conn):
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE communes_agregat
                ADD COLUMN IF NOT EXISTS nb_arrets_tc INTEGER
        """)
        conn.commit()
    print("  ✅ Colonne nb_arrets_tc prête")


def update_postgres(conn, df: pd.DataFrame) -> int:
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TEMP TABLE tmp_tc (
                code_commune CHAR(5),
                nb_arrets_tc INTEGER
            ) ON COMMIT DROP
        """)
        data = [(str(r.code_commune).zfill(5), int(r.nb_arrets_tc)) for r in df.itertuples()]
        execute_values(cur, "INSERT INTO tmp_tc VALUES %s", data)
        cur.execute("""
            UPDATE communes_agregat ca
            SET nb_arrets_tc = t.nb_arrets_tc
            FROM tmp_tc t
            WHERE ca.code_commune = t.code_commune
        """)
        updated = cur.rowcount
        conn.commit()
    return updated


def main():
    print("🚇 Ingestion Transports en Commun IDFM → PostgreSQL\n")

    # 1. Télécharger arrêts
    df_raw = fetch_arrets_idfm()
    if df_raw is None:
        df_raw = fetch_arrets_gtfs()
    if df_raw is None:
        print("  ❌ Impossible de récupérer les données IDFM")
        return

    # 2. Normaliser
    arrets = normalize_arrets(df_raw)
    if arrets is None or arrets.empty:
        print("  ❌ Données arrêts non exploitables")
        return

    # 3. Charger communes
    conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT,
        dbname=PG_DB, user=PG_USER, password=PG_PASSWORD
    )
    communes = load_communes(conn)
    print(f"  {len(communes):,} communes IDF chargées avec centroïdes")

    # 4. Jointure
    df_counts = assign_arrets_to_communes(arrets, communes)

    # 5. Mise à jour
    add_tc_column(conn)
    updated = update_postgres(conn, df_counts)
    print(f"\n  → {updated} communes mises à jour ✅")

    # 6. Stats
    with conn.cursor() as cur:
        cur.execute("""
            SELECT city, nb_arrets_tc
            FROM communes_agregat
            WHERE nb_arrets_tc IS NOT NULL
            ORDER BY nb_arrets_tc DESC
            LIMIT 10
        """)
        top = cur.fetchall()
    print("\nTop 10 communes par nombre d'arrêts TC :")
    for city, nb in top:
        print(f"  {(city or '?'):<35} {nb:>5} arrêts")

    conn.close()
    print("\n✅ Ingestion transports terminée !")


if __name__ == "__main__":
    main()
