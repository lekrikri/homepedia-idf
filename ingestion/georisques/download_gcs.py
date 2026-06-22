"""
ingestion/georisques/download_gcs.py
======================================
Récupère les risques naturels par commune IDF depuis l'API Géorisques (BRGM/GASPAR).

Source : https://georisques.gouv.fr/api/v1/gaspar/risques?code_insee={code}

Colonnes ajoutées :
  risque_inondation → 0=aucun, 1=présence PPRi/risque inondation (GASPAR num_risque 11x)
  risque_argile     → 0=aucun, 1=présence tassements/argile (GASPAR num_risque 127)
  score_risques     → score 0-100 (100=sans risque) — inondation 50% + argile 50%

Usage :
    python3 ingestion/georisques/download_gcs.py
"""

import time
import requests
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from concurrent.futures import ThreadPoolExecutor, as_completed
import os

PG_HOST     = os.getenv("POSTGRES_HOST", "localhost")
PG_PORT     = int(os.getenv("POSTGRES_PORT", 5433))
PG_DB       = os.getenv("POSTGRES_DB", "homepedia")
PG_USER     = os.getenv("POSTGRES_USER", "homepedia")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "homepedia")

GASPAR_API = "https://georisques.gouv.fr/api/v1/gaspar/risques"
MAX_WORKERS = 8
RATE_LIMIT_DELAY = 0.05  # 20 req/s max


def fetch_risques_commune(code_insee: str) -> dict:
    """
    Récupère les risques GASPAR pour un code INSEE.
    Retourne un dict : { code, inondation: bool, argile: bool }
    """
    try:
        r = requests.get(
            GASPAR_API,
            params={"code_insee": code_insee},
            timeout=15
        )
        if r.status_code != 200:
            return {"code": code_insee, "inondation": False, "argile": False, "ok": False}

        data = r.json()
        items = data.get("data", [])
        if not items:
            return {"code": code_insee, "inondation": False, "argile": False, "ok": True}

        risques = items[0].get("risques_detail", [])
        a_inondation = False
        a_argile = False

        for r_item in risques:
            num = str(r_item.get("num_risque") or "")
            lib = (r_item.get("libelle_risque_long") or "").lower()
            if num.startswith("11"):
                a_inondation = True
            if num == "127" or any(kw in lib for kw in ["tassement", "retrait", "gonflement", "argile"]):
                a_argile = True

        return {"code": code_insee, "inondation": a_inondation, "argile": a_argile, "ok": True}

    except Exception:
        return {"code": code_insee, "inondation": False, "argile": False, "ok": False}


def fetch_all_communes(codes: list[str]) -> list[dict]:
    """
    Récupère les risques GASPAR pour toutes les communes en parallèle.
    """
    results = []
    errors = 0
    done = 0

    print(f"  ↓ Requêtes GASPAR pour {len(codes)} communes ({MAX_WORKERS} threads)...")

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_code = {executor.submit(fetch_risques_commune, code): code for code in codes}
        for future in as_completed(future_to_code):
            result = future.result()
            results.append(result)
            done += 1
            if not result["ok"]:
                errors += 1
            if done % 100 == 0:
                print(f"     {done}/{len(codes)} communes traitées ({errors} erreurs)...")
            time.sleep(RATE_LIMIT_DELAY / MAX_WORKERS)

    print(f"     ✅ {done} communes | {errors} erreurs API")
    return results


def build_risques_df(raw_results: list[dict]) -> pd.DataFrame:
    """
    Construit le DataFrame risques depuis les résultats GASPAR.
    risque_inondation : 0=aucun, 1=PPRi présent
    risque_argile     : 0=aucun, 1=tassements/argile présent
    """
    rows = []
    for item in raw_results:
        # Niveau inondation : 0 ou 2 (présence de PPRi = risque modéré minimum)
        risque_inond = 2 if item["inondation"] else 0
        # Niveau argile : 0 ou 1 (présence = faible à moyen par défaut)
        risque_arg   = 1 if item["argile"] else 0
        rows.append({
            "code_commune":     str(item["code"]).zfill(5),
            "risque_inondation": risque_inond,
            "risque_argile":     risque_arg,
        })
    return pd.DataFrame(rows)


def compute_score_risques(df: pd.DataFrame) -> pd.DataFrame:
    """
    Score risques 0-100 (100 = sans risque).
    Inondation (0/2/3) → inversé 0-100 : 0→100, 2→33, 3→0
    Argile (0/1/2/3)   → inversé 0-100 : 0→100, 1→67, 2→33, 3→0
    """
    df = df.copy()
    score_inond = ((3 - df["risque_inondation"].clip(0, 3)) / 3 * 100).round(1)
    score_arg   = ((3 - df["risque_argile"].clip(0, 3)) / 3 * 100).round(1)
    df["score_risques"] = (score_inond * 0.50 + score_arg * 0.50).round(1)
    return df


def add_risques_columns(conn):
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE communes_agregat
                ADD COLUMN IF NOT EXISTS risque_inondation SMALLINT,
                ADD COLUMN IF NOT EXISTS risque_argile     SMALLINT,
                ADD COLUMN IF NOT EXISTS score_risques     DOUBLE PRECISION
        """)
        conn.commit()
    print("  ✅ Colonnes risques prêtes")


def update_postgres(conn, df: pd.DataFrame) -> int:
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TEMP TABLE tmp_risques (
                code_commune       CHAR(5),
                risque_inondation  SMALLINT,
                risque_argile      SMALLINT,
                score_risques      DOUBLE PRECISION
            ) ON COMMIT DROP
        """)
        data = [
            (str(r.code_commune).zfill(5),
             int(r.risque_inondation),
             int(r.risque_argile),
             float(r.score_risques))
            for r in df.itertuples()
        ]
        execute_values(cur, "INSERT INTO tmp_risques VALUES %s", data)
        cur.execute("""
            UPDATE communes_agregat ca
            SET
                risque_inondation = t.risque_inondation,
                risque_argile     = t.risque_argile,
                score_risques     = t.score_risques
            FROM tmp_risques t
            WHERE ca.code_commune = t.code_commune
        """)
        updated = cur.rowcount
        conn.commit()
    return updated


def main():
    print("⚠️  Ingestion Géorisques → PostgreSQL\n")

    conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT,
        dbname=PG_DB, user=PG_USER, password=PG_PASSWORD
    )

    # 1. Charger les codes INSEE depuis la DB
    with conn.cursor() as cur:
        cur.execute("SELECT code_commune FROM communes_agregat ORDER BY code_commune")
        codes = [str(r[0]).strip().zfill(5) for r in cur.fetchall()]
    print(f"  {len(codes)} communes à traiter")

    # 2. Récupérer les risques GASPAR
    raw_results = fetch_all_communes(codes)

    # 3. Construire le DataFrame
    df = build_risques_df(raw_results)
    print(f"\n  Résultats GASPAR :")
    print(f"    Communes avec risque inondation : {(df['risque_inondation'] > 0).sum()}")
    print(f"    Communes avec risque argile     : {(df['risque_argile'] > 0).sum()}")

    # 4. Score risques
    df = compute_score_risques(df)

    # 5. Mise à jour
    add_risques_columns(conn)
    updated = update_postgres(conn, df)
    print(f"\n  → {updated} communes mises à jour ✅")

    # 6. Stats
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
                risque_inondation,
                COUNT(*) as n
            FROM communes_agregat
            WHERE risque_inondation IS NOT NULL
            GROUP BY risque_inondation
            ORDER BY risque_inondation
        """)
        rows = cur.fetchall()

    labels = {0: "Aucun", 1: "Faible", 2: "PPRi", 3: "Fort"}
    print("\nDistribution risque inondation IDF :")
    for niveau, n in rows:
        print(f"  Niveau {niveau} ({labels.get(niveau, '?'):<6}) : {n:>4} communes")

    conn.close()
    print("\n✅ Ingestion géorisques terminée !")


if __name__ == "__main__":
    main()
