#!/usr/bin/env python3
"""
Ingestion des données Filosofi INSEE 2019 (revenus par commune).
Source : INSEE - Indicateurs de structure et de distribution des revenus 2019
         https://www.insee.fr/fr/statistiques/6036907

Fichiers utilisés depuis le ZIP :
  - FILO2019_DISP_COM.csv  : revenu disponible médian/UC (Q219), D1 (D119), D9 (D919)
  - FILO2019_DISP_Pauvres_COM.csv : taux de pauvreté à 60% (TP6019)

Usage : python3 ingestion/ingest_filosofi.py
"""

import csv
import io
import os
import sys
import zipfile

import psycopg2
import requests

DB_CONN = {
    "dbname": "postgres",
    "user": "postgres.iugsfmvqddburvufzacy",
    "password": "@fanfan_gwada_971",
    "host": "aws-0-eu-west-1.pooler.supabase.com",
    "port": 5432,
    "sslmode": "require",
}

ZIP_URL = (
    "https://www.insee.fr/fr/statistiques/fichier/6036907/"
    "indic-struct-distrib-revenu-2019-COMMUNES_csv.zip"
)
LOCAL_ZIP = "/tmp/filosofi_2019_csv.zip"

# Noms de fichiers dans le ZIP
FILE_DISP = "FILO2019_DISP_COM.csv"
FILE_PAUVRES = "FILO2019_DISP_Pauvres_COM.csv"


def download_zip():
    """Télécharge le ZIP Filosofi ou réutilise le cache local."""
    if os.path.exists(LOCAL_ZIP) and os.path.getsize(LOCAL_ZIP) > 100_000:
        print(f"Fichier local trouve : {LOCAL_ZIP}")
        return LOCAL_ZIP

    print(f"Telechargement : {ZIP_URL}")
    r = requests.get(ZIP_URL, timeout=120, stream=True)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code} lors du telechargement")
    with open(LOCAL_ZIP, "wb") as f:
        for chunk in r.iter_content(chunk_size=65536):
            f.write(chunk)
    size_mb = os.path.getsize(LOCAL_ZIP) / 1024 / 1024
    print(f"  OK — {size_mb:.1f} Mo")
    return LOCAL_ZIP


def read_csv_from_zip(z, filename):
    """Lit un CSV depuis un ZipFile et retourne (headers, rows)."""
    content = z.open(filename).read().decode("latin1")
    reader = csv.reader(io.StringIO(content), delimiter=";")
    headers = next(reader)
    rows = list(reader)
    return headers, rows


def to_int(val):
    try:
        return int(float(str(val).replace(",", ".")))
    except (ValueError, TypeError):
        return None


def to_float(val):
    try:
        return float(str(val).replace(",", "."))
    except (ValueError, TypeError):
        return None


def main():
    zip_path = download_zip()
    z = zipfile.ZipFile(zip_path)

    print(f"Lecture de {FILE_DISP}...")
    headers_disp, rows_disp = read_csv_from_zip(z, FILE_DISP)
    # Colonnes : CODGEO, Q219 (médiane), D119 (D1), D919 (D9)
    idx = {h: i for i, h in enumerate(headers_disp)}
    def get_col(row, col_name):
        i = idx.get(col_name)
        return row[i] if i is not None and i < len(row) else None

    data_disp = {}
    for row in rows_disp:
        code = str(row[idx["CODGEO"]]).strip().zfill(5)
        data_disp[code] = {
            "median": to_int(get_col(row, "Q219")),
            "d1":     to_int(get_col(row, "D119")),
            "d9":     to_int(get_col(row, "D919")),
        }
    print(f"  {len(data_disp)} communes chargees (revenus)")

    print(f"Lecture de {FILE_PAUVRES}...")
    headers_pauv, rows_pauv = read_csv_from_zip(z, FILE_PAUVRES)
    idx_p = {h: i for i, h in enumerate(headers_pauv)}
    data_pauv = {}
    for row in rows_pauv:
        code = str(row[idx_p["CODGEO"]]).strip().zfill(5)
        i_tp60 = idx_p.get("TP6019")
        tp60_raw = row[i_tp60] if i_tp60 is not None and i_tp60 < len(row) else None
        data_pauv[code] = to_float(tp60_raw)
    print(f"  {len(data_pauv)} communes chargees (taux pauvrete)")

    # Connexion DB et liste communes IDF
    conn = psycopg2.connect(**DB_CONN)
    cur = conn.cursor()
    cur.execute("SELECT code_commune FROM communes_agregat WHERE code_commune IS NOT NULL")
    idf_codes = {r[0] for r in cur.fetchall()}
    print(f"\n{len(idf_codes)} communes IDF dans la DB")

    updated = 0
    skipped = 0
    for code in idf_codes:
        disp = data_disp.get(code, {})
        tp60 = data_pauv.get(code)

        median = disp.get("median")
        d1 = disp.get("d1")
        d9 = disp.get("d9")

        if median is None and tp60 is None:
            skipped += 1
            continue

        cur.execute(
            """
            UPDATE communes_agregat
            SET revenu_median_uc = %s,
                taux_pauvrete    = %s,
                revenu_d1        = %s,
                revenu_d9        = %s
            WHERE code_commune = %s
            """,
            (median, tp60, d1, d9, code),
        )
        if cur.rowcount:
            updated += 1

    conn.commit()
    print(f"\nMise a jour : {updated} communes, {skipped} sans donnee Filosofi")

    # Stats de controle
    cur.execute(
        """
        SELECT COUNT(*),
               ROUND(AVG(revenu_median_uc))::int,
               MIN(revenu_median_uc),
               MAX(revenu_median_uc)
        FROM communes_agregat
        WHERE revenu_median_uc IS NOT NULL
        """
    )
    n, avg, mn, mx = cur.fetchone()
    conn.close()

    print(
        f"\nRevenu median IDF — communes: {n}, "
        f"moyenne: {avg} EUR, min: {mn} EUR, max: {mx} EUR"
    )
    print("Ingestion Filosofi terminee.")


if __name__ == "__main__":
    main()
