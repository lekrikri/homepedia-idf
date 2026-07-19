#!/usr/bin/env python3
"""
Ingestion gares RER/Transilien IDF — données open data statiques (sans clé API).
Sources : SNCF Open Data API puis fallback dataset hardcodé des principales gares.
Estimation temps Paris via haversine (vitesse commerciale ~45 km/h).
"""

import io
import math
import requests
import pandas as pd
import psycopg2

DB_CONN = {
    "dbname": "postgres",
    "user": "postgres.iugsfmvqddburvufzacy",
    "password": os.environ["SUPABASE_PASSWORD"],
    "host": "aws-0-eu-west-1.pooler.supabase.com",
    "port": 6543,
    "sslmode": "require",
}

PARIS_LAT, PARIS_LON = 48.8596, 2.3477  # Châtelet-Les-Halles


def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def estimate_lines(lat, lon):
    """Estime les lignes RER/Transilien par position géographique."""
    if not (48.12 <= lat <= 49.24 and 1.44 <= lon <= 3.56):
        return None
    lines = []
    dist = haversine(lat, lon, PARIS_LAT, PARIS_LON)
    if abs(lat - 48.87) < 0.25 and dist < 40:
        lines.append("A")
    if abs(lon - 2.33) < 0.20 and dist < 35:
        lines.append("B")
    if lon < 2.45 and lat < 48.95 and dist < 45:
        lines.append("C")
    if lon > 2.30 and dist < 50 and lat < 48.95:
        lines.append("D")
    if lon > 2.40 and 48.78 < lat < 49.0:
        lines.append("E")
    if not lines:
        if lon < 2.0:
            lines = ["N"]
        elif lat > 49.0:
            lines = ["H"]
        elif lon > 2.8:
            lines = ["P"]
        elif lat < 48.5:
            lines = ["D"]
        else:
            lines = ["J"]
    return ",".join(lines)


def estimate_temps_paris(lat, lon):
    dist_km = haversine(lat, lon, PARIS_LAT, PARIS_LON)
    return min(120, max(5, round(dist_km / 45 * 60) + 5))


# Dataset hardcodé : ~100 principales gares RER/Transilien IDF
HARDCODED_STATIONS = [
    ("Châtelet-Les-Halles", 48.8596, 2.3477, "A,B,D"),
    ("Gare du Nord", 48.8809, 2.3553, "B,D,E,H,K"),
    ("Saint-Lazare", 48.8763, 2.3247, "E,J,L,U"),
    ("Gare de Lyon", 48.8448, 2.3735, "A,D"),
    ("Gare d'Austerlitz", 48.8427, 2.3653, "C"),
    ("Gare Montparnasse", 48.8408, 2.3195, "N"),
    ("Versailles-Chantiers", 48.7809, 2.3102, "C,N,U"),
    ("Versailles Rive Droite", 48.7856, 2.3078, "L"),
    ("Versailles Rive Gauche", 48.7949, 2.2914, "C"),
    ("Saint-Germain-en-Laye", 48.8985, 2.0943, "A"),
    ("Cergy-le-Haut", 49.0359, 2.0597, "A"),
    ("Poissy", 48.9268, 2.0461, "A"),
    ("Marne-la-Vallée Chessy", 48.8684, 2.7791, "A"),
    ("Torcy", 48.8497, 2.6532, "A"),
    ("Bussy-Saint-Georges", 48.8398, 2.6979, "A"),
    ("Val de Fontenay", 48.8549, 2.4797, "A"),
    ("Vincennes", 48.8473, 2.4392, "A"),
    ("Nation", 48.8481, 2.3963, "A"),
    ("Roissy CDG T2", 49.0054, 2.5696, "B"),
    ("Le Bourget", 48.9316, 2.4193, "B"),
    ("La Courneuve-Aubervilliers", 48.9248, 2.3896, "B"),
    ("Stade de France - Saint-Denis", 48.9242, 2.3588, "B"),
    ("Saint-Denis", 48.9363, 2.3565, "B,D"),
    ("Denfert-Rochereau", 48.8337, 2.3326, "B"),
    ("Arcueil-Cachan", 48.7955, 2.3392, "B"),
    ("Fontenay-aux-Roses", 48.7865, 2.2876, "B"),
    ("Robinson", 48.7791, 2.2748, "B"),
    ("Saint-Rémy-lès-Chevreuse", 48.7016, 2.0706, "B"),
    ("Mitry - Claye", 48.9984, 2.6348, "B"),
    ("Villiers-le-Bel - Gonesse", 49.0025, 2.3919, "D"),
    ("Garges-Sarcelles", 48.9803, 2.3807, "D"),
    ("Évry-Courcouronnes", 48.6262, 2.4396, "D"),
    ("Corbeil-Essonnes", 48.6075, 2.4818, "D"),
    ("Juvisy", 48.6895, 2.3731, "C,D"),
    ("Savigny-sur-Orge", 48.6702, 2.3474, "C"),
    ("Viry-Châtillon", 48.6718, 2.3825, "D"),
    ("Orly", 48.7191, 2.3782, "C"),
    ("Pontoise", 49.0517, 2.1005, "C"),
    ("Ermont-Eaubonne", 48.9895, 2.2737, "C"),
    ("Saint-Ouen", 48.9063, 2.3376, "C"),
    ("Chelles - Gournay", 48.8799, 2.5975, "E"),
    ("Tournan", 48.7348, 2.7678, "E"),
    ("Mantes-la-Jolie", 48.9900, 1.7186, "J,N"),
    ("Massy-Palaiseau", 48.7239, 2.2565, "B,C"),
    ("Palaiseau", 48.7148, 2.2478, "B"),
    ("Antony", 48.7530, 2.3006, "B"),
    ("Clamart", 48.8007, 2.2514, "N"),
    ("Issy-les-Moulineaux", 48.8258, 2.2735, "C"),
    ("Vitry-sur-Seine", 48.7921, 2.3961, "C"),
    ("Choisy-le-Roi", 48.7636, 2.4145, "C"),
    ("Villeneuve-Saint-Georges", 48.7312, 2.4476, "D"),
    ("Maisons-Alfort - Alfortville", 48.8057, 2.4172, "D"),
    ("Saint-Maur des Fossés", 48.8061, 2.4870, "A"),
    ("Sucy - Bonneuil", 48.7728, 2.5196, "A"),
    ("Boissy-Saint-Léger", 48.7524, 2.5088, "A"),
    ("Noisy-le-Grand - Mont d'Est", 48.8442, 2.5569, "A,E"),
    ("Rosny-sous-Bois", 48.8764, 2.4911, "E"),
    ("Bondy", 48.8962, 2.4827, "E"),
    ("Gagny", 48.8878, 2.5433, "E"),
    ("Neuilly-Plaisance", 48.8598, 2.5133, "A"),
    ("Drancy - Bobigny", 48.9278, 2.4539, "B"),
    ("Aulnay-sous-Bois", 48.9411, 2.4982, "B"),
    ("Argenteuil", 48.9479, 2.2470, "J"),
    ("Sartrouville", 48.9360, 2.1632, "J"),
    ("Maisons-Laffitte", 48.9506, 2.1452, "A"),
    ("Conflans-Sainte-Honorine", 48.9991, 2.1013, "J"),
    ("Saint-Cloud", 48.8408, 2.2125, "L,U"),
    ("Sèvres - Ville d'Avray", 48.8236, 2.1912, "C"),
    ("Chaville", 48.8105, 2.1901, "L,N"),
    ("Viroflay", 48.8013, 2.1681, "C,N"),
    ("Gif-sur-Yvette", 48.7002, 2.1430, "B"),
    ("Orsay", 48.6935, 2.1858, "B"),
    ("Dourdan", 48.5293, 2.0136, "C"),
    ("Étampes", 48.4337, 2.1566, "D"),
    ("Melun", 48.5423, 2.6558, "D"),
    ("Combs-la-Ville", 48.6686, 2.5562, "D"),
    ("Lieusaint - Moissy", 48.6280, 2.5543, "D"),
    ("Savigny-le-Temple", 48.5844, 2.5813, "D"),
    ("Brunoy", 48.6986, 2.5034, "D"),
    ("Yerres", 48.7215, 2.4895, "D"),
    ("Montgeron - Crosne", 48.7046, 2.4617, "D"),
    ("Massy-Verrières", 48.7349, 2.2764, "C"),
    ("Rungis - La Fraternelle", 48.7531, 2.3545, "C"),
    ("Morangis", 48.7184, 2.3375, "C"),
    ("Paray-Vieille-Poste", 48.7243, 2.3622, "C"),
    ("Croissy-Beaubourg", 48.8349, 2.6403, "A"),
    ("Pontault-Combault", 48.7969, 2.6076, "E"),
    ("Roissy-en-Brie", 48.7935, 2.6506, "E"),
    ("Gretz-Armainvilliers", 48.7365, 2.7386, "E"),
    ("Villeparisis", 48.9428, 2.6001, "B"),
    ("La Verrière", 48.7333, 1.9649, "N"),
    ("Trappes", 48.7773, 1.9887, "N"),
    ("Plaisir", 48.8206, 1.9518, "N"),
    ("Épône - Mézières", 48.9538, 1.8108, "J,N"),
    ("Limay", 48.9989, 1.7458, "J"),
    ("Gargenville", 49.0121, 1.8159, "J"),
    ("Issou - Porcheville", 49.0155, 1.8622, "J"),
    ("Aubergenville - Élisabethville", 48.9716, 1.8524, "J"),
    ("Épluches", 49.0517, 2.1005, "C"),
    ("Cormeilles-en-Parisis", 48.9751, 2.2027, "J"),
    ("Franconville - Le Plessis-Bouchard", 48.9872, 2.2324, "H"),
    ("Saint-Leu-la-Forêt", 49.0212, 2.2476, "H"),
    ("Montsoult - Maffliers", 49.0738, 2.3202, "H"),
    ("Luzarches", 49.1132, 2.4245, "H"),
    ("Valmondois", 49.1004, 2.2028, "H"),
    ("L'Isle-Adam - Parmain", 49.1116, 2.2150, "H"),
    ("Cergy-Préfecture", 49.0367, 2.0816, "A"),
    ("Achères-Grand-Cormier", 48.9636, 2.0896, "A"),
    ("Noisy-le-Sec", 48.8934, 2.4596, "E"),
    ("Bobigny - Pablo Picasso", 48.9139, 2.4447, "E"),
    ("Bondy", 48.8962, 2.4827, "E"),
    ("Rosny-Bois-Perrier", 48.8661, 2.4967, "E"),
    ("Val de Fontenay", 48.8549, 2.4797, "A,E"),
]


def main():
    conn = psycopg2.connect(**DB_CONN)
    cur = conn.cursor()

    # Créer/vider la table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS rer_stations (
            id SERIAL PRIMARY KEY,
            code_sncf VARCHAR(30),
            nom VARCHAR(200) NOT NULL,
            lat FLOAT NOT NULL,
            lon FLOAT NOT NULL,
            lignes TEXT,
            temps_paris_min INT,
            code_commune VARCHAR(10)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rer_stations_commune ON rer_stations(code_commune)")
    cur.execute("DELETE FROM rer_stations")
    conn.commit()
    print("🗑️ Table rer_stations vidée")

    # Charger communes IDF pour le linking
    cur.execute("SELECT code_commune, centroid_lat, centroid_lon FROM communes_agregat WHERE centroid_lat IS NOT NULL")
    communes = cur.fetchall()
    print(f"📍 {len(communes)} communes IDF chargées")

    def find_commune(lat, lon):
        best_code, best_dist = None, 3.0
        for code, clat, clon in communes:
            d = haversine(lat, lon, clat, clon)
            if d < best_dist:
                best_dist, best_code = d, code
        return best_code

    # Tenter SNCF Open Data API d'abord
    df_opendata = None
    print("📡 Tentative SNCF Open Data API...")
    try:
        url = "https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/referentiel-gares-voyageurs/exports/csv?delimiter=%3B&lang=fr&limit=-1"
        r = requests.get(url, timeout=20)
        if r.status_code == 200 and len(r.content) > 20000:
            df_opendata = pd.read_csv(io.BytesIO(r.content), sep=";", dtype=str, low_memory=False)
            # Filtrer IDF
            if "LATITUDE_WGS84" in df_opendata.columns:
                df_opendata["_lat"] = pd.to_numeric(df_opendata["LATITUDE_WGS84"].str.replace(",", "."), errors="coerce")
                df_opendata["_lon"] = pd.to_numeric(df_opendata["LONGITUDE_WGS84"].str.replace(",", "."), errors="coerce")
                df_opendata = df_opendata[df_opendata["_lat"].between(48.12, 49.24) & df_opendata["_lon"].between(1.44, 3.56)]
                print(f"  ✅ {len(df_opendata)} gares IDF depuis SNCF Open Data")
            else:
                df_opendata = None
    except Exception as e:
        print(f"  ❌ {e}")

    inserted = 0

    if df_opendata is not None and len(df_opendata) > 10:
        for _, row in df_opendata.iterrows():
            try:
                lat, lon = float(row["_lat"]), float(row["_lon"])
                nom = str(row.get("LIBELLE_GARE", row.get("LIBELLE", ""))).strip()
                if not nom or nom == "nan":
                    continue
                code = str(row.get("CODE_UIC_COMPLET", row.get("CODE_UIC", ""))).strip()
                lignes = estimate_lines(lat, lon) or "Transilien"
                temps = estimate_temps_paris(lat, lon)
                commune = find_commune(lat, lon)
                cur.execute(
                    "INSERT INTO rer_stations (code_sncf, nom, lat, lon, lignes, temps_paris_min, code_commune) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                    (code, nom, lat, lon, lignes, temps, commune)
                )
                inserted += 1
            except Exception:
                continue
    else:
        # Fallback hardcodé
        print("📋 Utilisation dataset hardcodé (principales gares RER/Transilien IDF)")
        for nom, lat, lon, lignes in HARDCODED_STATIONS:
            temps = estimate_temps_paris(lat, lon)
            commune = find_commune(lat, lon)
            cur.execute(
                "INSERT INTO rer_stations (code_sncf, nom, lat, lon, lignes, temps_paris_min, code_commune) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (f"OD_{inserted}", nom, lat, lon, lignes, temps, commune)
            )
            inserted += 1

    conn.commit()
    conn.close()
    print(f"\n✅ {inserted} gares insérées dans rer_stations")

    # Stats
    conn2 = psycopg2.connect(**DB_CONN)
    cur2 = conn2.cursor()
    cur2.execute("SELECT COUNT(*), ROUND(AVG(temps_paris_min)), MIN(temps_paris_min), MAX(temps_paris_min) FROM rer_stations")
    n, avg, mn, mx = cur2.fetchone()
    print(f"Stats : {n} gares | temps Paris : moy {avg}min, min {mn}min, max {mx}min")
    cur2.execute("SELECT nom, lignes, temps_paris_min FROM rer_stations ORDER BY temps_paris_min LIMIT 8")
    print("\nGares les plus proches de Paris :")
    for row in cur2.fetchall():
        print(f"  {row[0]} — {row[1]} — {row[2]} min")
    conn2.close()


if __name__ == "__main__":
    main()
