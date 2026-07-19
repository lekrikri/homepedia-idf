#!/usr/bin/env python3
"""
update_ips_nopandas.py
======================
Version sans pandas — contourne l'incompatibilité numpy système.
Télécharge l'IPS écoles depuis data.gouv.fr et met à jour communes_agregat.

Usage:
    python3 ingestion/ips/update_ips_nopandas.py
"""
import io
import csv
import requests
import psycopg2
from psycopg2.extras import execute_values
from collections import defaultdict
import os
import statistics
from urllib.parse import quote_plus

# Mot de passe Supabase : jamais en dur, ce dépôt est public.
_MDP = os.environ.get("SUPABASE_PASSWORD") or os.environ.get("POSTGRES_PASSWORD")
if not _MDP:
    raise SystemExit(
        "SUPABASE_PASSWORD manquant. Exportez-le avant de lancer ce script :\n"
        "  export SUPABASE_PASSWORD='<mot de passe Supabase>'"
    )
_MDP_URL = quote_plus(_MDP)

DB_URL = os.getenv(
    "DATABASE_URL",
    f"postgresql://postgres.iugsfmvqddburvufzacy:{_MDP_URL}@"
    "aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require"
)

IPS_URL = (
    "https://static.data.gouv.fr/resources/"
    "indices-de-position-sociale-geolocalises-des-ecoles-et-colleges-de-france-metropolitaine-et-des-drom-2/"
    "20221019-143830/ips-all-geoloc.csv"
)

DEPTS_IDF = {"75", "77", "78", "91", "92", "93", "94", "95"}


def fetch_ips():
    print("  ↓ Téléchargement IPS écoles...")
    r = requests.get(IPS_URL, timeout=120)
    r.raise_for_status()
    content = r.content.decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(content))

    # commune → liste d'IPS
    by_commune = defaultdict(list)
    total = 0
    idf_count = 0

    for row in reader:
        total += 1
        dept = (row.get("code_dept") or "").strip()
        if dept not in DEPTS_IDF:
            continue
        idf_count += 1
        code_insee = (row.get("code_insee") or "").strip().zfill(5)
        if not code_insee or len(code_insee) != 5:
            continue
        ips_raw = (row.get("ips") or "").strip().replace(",", ".")
        try:
            ips_val = float(ips_raw)
            if ips_val > 0:
                by_commune[code_insee].append(ips_val)
        except ValueError:
            pass

    print(f"     {total:,} établissements nationaux → {idf_count:,} en IDF")
    print(f"     → {len(by_commune):,} communes avec données IPS")
    return by_commune


def aggregate(by_commune: dict) -> list:
    """Retourne list of (code_commune, ips_moyen, ips_median, nb_ecoles, pct_favorisees)"""
    rows = []
    for code, ips_list in by_commune.items():
        nb = len(ips_list)
        moyen = round(sum(ips_list) / nb, 1)
        med = round(statistics.median(ips_list), 1)
        nb_fav = sum(1 for v in ips_list if v > 110)
        pct = round(nb_fav / nb * 100, 1)
        rows.append((code, moyen, med, nb, pct))
    return rows


def update_postgres(conn, rows: list) -> int:
    cur = conn.cursor()

    # Assurer les colonnes existent
    cur.execute("""
        ALTER TABLE communes_agregat
            ADD COLUMN IF NOT EXISTS ips_moyen              DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS ips_median             DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS nb_ecoles              INTEGER,
            ADD COLUMN IF NOT EXISTS pct_ecoles_favorisees  DOUBLE PRECISION
    """)
    conn.commit()
    print("  ✅ Colonnes IPS prêtes")

    cur.execute("""
        CREATE TEMP TABLE tmp_ips (
            code_commune          CHAR(5),
            ips_moyen             DOUBLE PRECISION,
            ips_median            DOUBLE PRECISION,
            nb_ecoles             INTEGER,
            pct_ecoles_favorisees DOUBLE PRECISION
        )
    """)
    execute_values(cur, "INSERT INTO tmp_ips VALUES %s", rows)

    cur.execute("""
        UPDATE communes_agregat ca
        SET
            ips_moyen             = t.ips_moyen,
            ips_median            = t.ips_median,
            nb_ecoles             = t.nb_ecoles,
            pct_ecoles_favorisees = t.pct_ecoles_favorisees
        FROM tmp_ips t
        WHERE ca.code_commune = t.code_commune
    """)
    updated = cur.rowcount
    conn.commit()
    return updated


def main():
    print("🏫 Mise à jour IPS écoles → communes_agregat")

    by_commune = fetch_ips()
    rows = aggregate(by_commune)

    print(f"\n🔗 Connexion Supabase...")
    conn = psycopg2.connect(DB_URL)
    print("  ✅ Connecté")

    updated = update_postgres(conn, rows)
    print(f"  ✅ {updated:,} communes mises à jour avec IPS")

    # Vérification
    cur = conn.cursor()
    cur.execute("""
        SELECT COUNT(*), AVG(ips_moyen), MIN(ips_moyen), MAX(ips_moyen)
        FROM communes_agregat
        WHERE ips_moyen IS NOT NULL
    """)
    cnt, avg, mn, mx = cur.fetchone()
    print(f"\n📊 IPS : {cnt:,} communes — moy={avg:.1f}, min={mn:.1f}, max={mx:.1f}")

    # Compter les communes manquantes
    cur.execute("SELECT COUNT(*) FROM communes_agregat WHERE ips_moyen IS NULL")
    missing = cur.fetchone()[0]
    print(f"   ⚠️ {missing:,} communes sans données IPS (écoles absentes ou hors périmètre)")

    conn.close()
    print("\n✅ Terminé")


if __name__ == "__main__":
    main()
