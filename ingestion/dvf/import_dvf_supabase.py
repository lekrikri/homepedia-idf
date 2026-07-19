"""
ingestion/dvf/import_dvf_supabase.py
======================================
Import direct DVF → Supabase, by-passe BigQuery.

Deux formats selon l'année :
  - 2021/2022 : fichier national DGFiP (txt.zip, séparateur |, sans GPS)
                → https://static.data.gouv.fr/resources/demandes-de-valeurs-foncieres/
  - 2023/2024  : fichiers geo-dvf par département (csv.gz, avec GPS)
                → https://files.data.gouv.fr/geo-dvf/latest/csv/{year}/departements/{dept}.csv.gz

Usage :
    # Toutes les années manquantes (2021-2024)
    python ingestion/dvf/import_dvf_supabase.py

    # Réimporter une seule année
    python ingestion/dvf/import_dvf_supabase.py --annees 2023 --replace

    # Test : Paris 2023 uniquement
    python ingestion/dvf/import_dvf_supabase.py --annees 2023 --depts 75 --replace
"""

import os, io, sys, zipfile, gzip, argparse, hashlib
import requests
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

# ── Config ─────────────────────────────────────────────────────────────────────

PG_HOST     = os.getenv("SUPABASE_HOST",     "db.iugsfmvqddburvufzacy.supabase.co")
PG_PORT     = int(os.getenv("SUPABASE_PORT", "5432"))
PG_DB       = os.getenv("SUPABASE_DB",       "postgres")
PG_USER     = os.getenv("SUPABASE_USER",     "postgres")
PG_PASSWORD = os.getenv("SUPABASE_PASSWORD")

DEPTS_IDF   = ["75", "77", "78", "91", "92", "93", "94", "95"]
BATCH_SIZE  = 2000

# URLs des fichiers DVF officiels DGFiP (nat, txt|zip, sans GPS)
DGFIP_URLS = {
    2021: "https://static.data.gouv.fr/resources/demandes-de-valeurs-foncieres/20260405-002223/valeursfoncieres-2021.txt.zip",
    2022: "https://static.data.gouv.fr/resources/demandes-de-valeurs-foncieres/20260405-002236/valeursfoncieres-2022.txt.zip",
}
# geo-dvf par département (csv.gz, avec GPS)
GEODVF_BASE = "https://files.data.gouv.fr/geo-dvf/latest/csv"

SQL_INSERT = """
    INSERT INTO transactions (
        id_mutation, date_mutation, nature_mutation, valeur_fonciere,
        adresse_numero, adresse_voie, code_postal, commune, code_commune,
        code_iris, section, numero_plan,
        surface_terrain, type_local, surface_reelle_bati, nombre_pieces,
        longitude, latitude, geom, source_annee
    )
    VALUES %s
    ON CONFLICT (id_mutation, date_mutation, type_local) DO NOTHING
"""

# ── Connexion ───────────────────────────────────────────────────────────────────

def connect():
    conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT, dbname=PG_DB,
        user=PG_USER, password=PG_PASSWORD,
        sslmode="require",
        options="-c statement_timeout=300000 -c default_transaction_read_only=off"
    )
    conn.set_session(readonly=False, autocommit=False)
    return conn

def load_valid_communes(conn) -> set:
    with conn.cursor() as cur:
        cur.execute("SELECT code_insee FROM communes")
        return {r[0].strip() for r in cur.fetchall()}

# ── Insert ──────────────────────────────────────────────────────────────────────

RECONNECT_EVERY = 80  # reconnecter tous les 80 batches (~160k lignes) pour éviter read-only

def insert_records(conn, records: list, label: str) -> int:
    _conn = conn
    inserted = 0
    for i in range(0, len(records), BATCH_SIZE):
        batch_num = i // BATCH_SIZE
        if batch_num > 0 and batch_num % RECONNECT_EVERY == 0:
            try: _conn.close()
            except: pass
            _conn = connect()

        chunk = records[i:i + BATCH_SIZE]
        for attempt in range(3):
            try:
                with _conn.cursor() as cur:
                    execute_values(
                        cur, SQL_INSERT, chunk,
                        template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,ST_GeomFromEWKT(%s),%s)"
                    )
                    inserted += cur.rowcount
                _conn.commit()
                break
            except (psycopg2.errors.ReadOnlySqlTransaction, psycopg2.OperationalError):
                print(f"\n     ⚠️  Reconnexion (tentative {attempt + 1})…", end="")
                try: _conn.close()
                except: pass
                _conn = connect()
        done = min(i + BATCH_SIZE, len(records))
        print(f"     {done:,}/{len(records):,}…", end="\r")
    print()
    if _conn is not conn:
        try: _conn.close()
        except: pass
    return inserted

def delete_year(conn, year: int):
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM transactions WHERE source_annee = %s", (year,))
        n = cur.fetchone()[0]
    if n:
        print(f"  🗑️  Suppression de {n:,} transactions {year} existantes…")
        with conn.cursor() as cur:
            cur.execute("DELETE FROM transactions WHERE source_annee = %s", (year,))
        conn.commit()

# ── FORMAT 1 : DGFiP TXT.ZIP national (2021-2022, sans GPS) ───────────────────

DGFIP_COLS = {
    "Identifiant de document": "id_doc",
    "No disposition":          "no_disp",
    "Date mutation":           "date_mutation",
    "Nature mutation":         "nature_mutation",
    "Valeur fonciere":         "valeur_fonciere",
    "No voie":                 "adresse_numero",
    "Voie":                    "adresse_voie",
    "Code postal":             "code_postal",
    "Commune":                 "commune",
    "Code departement":        "code_departement",
    "Code commune":            "code_commune_court",
    "Type local":              "type_local",
    "Surface reelle bati":     "surface_reelle_bati",
    "Nombre pieces principales": "nombre_pieces",
    "Surface terrain":         "surface_terrain",
}

def import_dgfip(conn, year: int, valid_communes: set) -> int:
    url = DGFIP_URLS[year]
    print(f"  ↓ Téléchargement DGFiP {year} (~80MB)…")
    r = requests.get(url, stream=True, timeout=300)
    r.raise_for_status()

    content = b"".join(r.iter_content(chunk_size=1024 * 512))
    print(f"     Téléchargé ({len(content)//1024//1024}MB) — lecture ZIP…")

    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        fname = zf.namelist()[0]
        with zf.open(fname) as f:
            df = pd.read_csv(f, sep="|", encoding="latin-1", dtype=str, low_memory=False)

    print(f"     {len(df):,} lignes nationales lues")

    # Renommer
    df = df.rename(columns=DGFIP_COLS)
    keep = [c for c in DGFIP_COLS.values() if c in df.columns]
    df = df[keep].copy()

    # Filtrer IDF
    df = df[df["code_departement"].isin(DEPTS_IDF)].copy()
    print(f"     {len(df):,} lignes IDF")

    # Code commune complet (5 chiffres : dept 2 chars + commune 3 chars)
    df["code_commune"] = (
        df["code_departement"].str.zfill(2) + df["code_commune_court"].str.zfill(3)
    )
    df = df[df["code_commune"].isin(valid_communes)].copy()

    # Convertir date DD/MM/YYYY → YYYY-MM-DD
    df["date_mutation"] = pd.to_datetime(
        df["date_mutation"], format="%d/%m/%Y", errors="coerce"
    ).dt.date

    # Convertir numériques (virgule décimale)
    for col in ["valeur_fonciere", "surface_reelle_bati", "surface_terrain"]:
        if col in df.columns:
            df[col] = pd.to_numeric(
                df[col].str.replace(",", "."), errors="coerce"
            )

    # Filtrer sans prix
    avant = len(df)
    df = df[df["valeur_fonciere"].notna() & (df["valeur_fonciere"] > 0)]
    df = df[df["date_mutation"].notna()]
    print(f"     → {len(df):,} lignes valides ({avant - len(df):,} filtrées)")

    if df.empty:
        return 0

    # Construire id_mutation unique par bien : hash des champs discriminants
    # Le no_disp seul ne suffit pas (se répète pour des mutations différentes le même jour)
    # On inclut type_local, valeur, surface pour quasi-unicité garantie
    def make_id(row):
        key = "|".join([
            str(row.get("code_departement", "")),
            str(row.get("code_commune_court", "")),
            str(row.get("no_disp", "")),
            str(row.get("date_mutation", "")),
            str(row.get("type_local", "") or ""),
            str(row.get("valeur_fonciere", "") or ""),
            str(row.get("surface_reelle_bati", "") or ""),
            str(row.get("adresse_voie", "") or ""),
        ])
        return hashlib.md5(key.encode()).hexdigest()[:24]

    df["id_mutation"] = df.apply(make_id, axis=1)

    # Nombre de pièces
    if "nombre_pieces" in df.columns:
        df["nombre_pieces"] = pd.to_numeric(df["nombre_pieces"], errors="coerce")

    # Construire records
    records = []
    for row in df.itertuples(index=False):
        def g(attr, default=None):
            v = getattr(row, attr, default)
            return None if (v is None or (isinstance(v, float) and pd.isna(v))) else v

        records.append((
            str(g("id_mutation", ""))[:50],
            g("date_mutation"),
            g("nature_mutation"),
            g("valeur_fonciere"),
            g("adresse_numero"),
            g("adresse_voie"),
            g("code_postal"),
            g("commune"),
            str(g("code_commune", ""))[:5],
            None, None, None,          # code_iris, section, numero_plan
            g("surface_terrain"),
            g("type_local"),
            g("surface_reelle_bati"),
            int(g("nombre_pieces")) if g("nombre_pieces") is not None else None,
            None, None,                # longitude, latitude
            None,                      # geom (pas de GPS dans DGFiP)
            year,
        ))

    return insert_records(conn, records, f"DGFiP {year}")


# ── FORMAT 2 : geo-dvf CSV.GZ par département (2023-2024, avec GPS) ────────────

GEODVF_COL_MAP = {
    "id_mutation":               "id_mutation",
    "date_mutation":             "date_mutation",
    "nature_mutation":           "nature_mutation",
    "valeur_fonciere":           "valeur_fonciere",
    "adresse_numero":            "adresse_numero",
    "adresse_voie":              "adresse_voie",
    "code_postal":               "code_postal",
    "nom_commune":               "commune",
    "code_commune":              "code_commune",
    "type_local":                "type_local",
    "surface_reelle_bati":       "surface_reelle_bati",
    "nombre_pieces_principales": "nombre_pieces",
    "surface_terrain":           "surface_terrain",
    "longitude":                 "longitude",
    "latitude":                  "latitude",
}

def import_geodvf_dept(conn, year: int, dept: str, valid_communes: set) -> int:
    url = f"{GEODVF_BASE}/{year}/departements/{dept}.csv.gz"
    print(f"  ↓ geo-dvf {year} dept {dept}  [{url}]")
    try:
        r = requests.get(url, stream=True, timeout=180)
        if r.status_code == 404:
            print(f"     ⚠️  404 — fichier absent")
            return 0
        r.raise_for_status()
        content = b"".join(r.iter_content(chunk_size=1024 * 512))
    except Exception as e:
        print(f"     ❌ Erreur : {e}")
        return 0

    with gzip.open(io.BytesIO(content)) as gz:
        df = pd.read_csv(gz, dtype=str, low_memory=False)

    print(f"     {len(df):,} lignes brutes")
    df = df.rename(columns=GEODVF_COL_MAP)
    keep = [c for c in GEODVF_COL_MAP.values() if c in df.columns]
    df = df[keep].copy()

    for col in ["valeur_fonciere", "surface_reelle_bati", "surface_terrain", "longitude", "latitude"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col].str.replace(",", "."), errors="coerce")

    if "code_commune" in df.columns:
        df["code_commune"] = df["code_commune"].astype(str).str.strip().str.zfill(5)

    avant = len(df)
    df = df[df["valeur_fonciere"].notna() & (df["valeur_fonciere"] > 0)]
    df = df[df["code_commune"].isin(valid_communes)]
    print(f"     → {len(df):,} valides ({avant - len(df):,} filtrées)")

    if df.empty:
        return 0

    if "nombre_pieces" in df.columns:
        df["nombre_pieces"] = pd.to_numeric(df["nombre_pieces"], errors="coerce")

    records = []
    for row in df.itertuples(index=False):
        def g(attr, default=None):
            v = getattr(row, attr, default)
            return None if (v is None or (isinstance(v, float) and pd.isna(v))) else v

        lon = g("longitude")
        lat = g("latitude")
        geom = None
        try:
            if lon and lat:
                geom = f"SRID=4326;POINT({float(lon):.6f} {float(lat):.6f})"
        except Exception:
            pass

        records.append((
            str(g("id_mutation", ""))[:50],
            g("date_mutation"),
            g("nature_mutation"),
            g("valeur_fonciere"),
            g("adresse_numero"),
            g("adresse_voie"),
            g("code_postal"),
            g("commune"),
            str(g("code_commune", "")).zfill(5)[:5],
            None, None, None,
            g("surface_terrain"),
            g("type_local"),
            g("surface_reelle_bati"),
            int(g("nombre_pieces")) if g("nombre_pieces") is not None else None,
            lon, lat, geom,
            year,
        ))

    return insert_records(conn, records, f"geo-dvf {year} dept {dept}")


# ── Stats ───────────────────────────────────────────────────────────────────────

def print_stats(conn):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT source_annee, COUNT(*) AS nb,
                   MIN(date_mutation)::text AS debut,
                   MAX(date_mutation)::text AS fin,
                   COUNT(*) FILTER (WHERE geom IS NOT NULL) AS avec_gps
            FROM transactions
            GROUP BY source_annee ORDER BY source_annee
        """)
        rows = cur.fetchall()
    print(f"\n{'Année':<8} {'Nb trans':>10}  {'Début':<12} {'Fin':<12} {'GPS':>8}")
    print("-" * 55)
    total = 0
    for annee, nb, debut, fin, gps in rows:
        print(f"{annee:<8} {nb:>10,}  {debut:<12} {fin:<12} {gps:>7,}")
        total += nb
    print("-" * 55)
    print(f"{'TOTAL':<8} {total:>10,}")


# ── Main ────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Import DVF direct → Supabase")
    parser.add_argument("--annees", default="2021,2022,2023,2024",
                        help="Années séparées par virgule")
    parser.add_argument("--depts", default=",".join(DEPTS_IDF),
                        help="Départements IDF (pour geo-dvf 2023/2024 seulement)")
    parser.add_argument("--replace", action="store_true",
                        help="Supprimer les données existantes avant de réimporter")
    args = parser.parse_args()

    annees = [int(y.strip()) for y in args.annees.split(",")]
    depts  = [d.strip() for d in args.depts.split(",")]

    print(f"🚀 Import DVF → Supabase")
    print(f"   Années  : {annees}")
    print(f"   Replace : {args.replace}\n")

    conn = connect()
    valid_communes = load_valid_communes(conn)
    print(f"✅ {len(valid_communes)} communes IDF valides chargées\n")

    total = 0
    for year in annees:
        print(f"\n{'='*60}")
        print(f"  Année {year}")
        print(f"{'='*60}")

        if args.replace:
            delete_year(conn, year)

        n = 0
        if year in DGFIP_URLS:
            print(f"  → Format DGFiP TXT/ZIP national (sans GPS)")
            n = import_dgfip(conn, year, valid_communes)
            print(f"  ✅ {n:,} transactions insérées")
        else:
            print(f"  → Format geo-dvf CSV/GZ par département (avec GPS)")
            for dept in depts:
                dn = import_geodvf_dept(conn, year, dept, valid_communes)
                print(f"     dept {dept} : {dn:,} insérées")
                n += dn
            print(f"  ✅ Année {year} : {n:,} transactions insérées au total")

        total += n

    print(f"\n{'='*60}")
    print(f"🎉 Import terminé — {total:,} transactions ajoutées")
    print_stats(conn)
    conn.close()


if __name__ == "__main__":
    main()
