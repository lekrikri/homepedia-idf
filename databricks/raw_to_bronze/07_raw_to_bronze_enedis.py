# Databricks notebook source
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  HomePedia — Raw → Bronze : ENEDIS/GRDF Énergie                            ║
# ║                                                                              ║
# ║  Télécharge les consommations annuelles d'électricité et de gaz par        ║
# ║  commune IDF depuis l'API opendata.agenceore.fr.                             ║
# ║                                                                              ║
# ║  Source : opendata.agenceore.fr (ENEDIS + GRDF agrégatés)                  ║
# ║  Secteur : RESIDENTIEL uniquement — région IDF (code_region = 11)           ║
# ║  Colonnes Gold : conso_elec_par_logement, conso_gaz_par_logement            ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# COMMAND ----------

# %run ../utils/init.py

# COMMAND ----------

import requests
import json
import time
from pyspark.sql import functions as F

BRONZE_ENERGIE = f"{BRONZE}/energie/"

API_BASE   = "https://opendata.agenceore.fr/data-fair/api/v1/datasets/consommation-annuelle-d-electricite-et-gaz-par-commune/lines"
REGION_IDF = "11"
PAGE_SIZE  = 10000

# COMMAND ----------

# ── Step 1 : Téléchargement pagié par filière ─────────────────────────────────

def fetch_filiere(filiere: str) -> list:
    """Récupère toutes les lignes résidentielles IDF pour une filière."""
    all_rows = []
    after    = None
    page     = 0

    print(f"  📡 {filiere} résidentiel IDF (paginé par {PAGE_SIZE})...")

    while True:
        params = {
            "size": PAGE_SIZE,
            "qs":   f'code_region:{REGION_IDF} AND code_grand_secteur:RESIDENTIEL AND filiere:"{filiere}"',
            "sort": "-annee",
        }
        if after:
            params["after"] = after

        resp = requests.get(API_BASE, params=params, timeout=90)
        resp.raise_for_status()
        data = resp.json()

        results = data.get("results", [])
        if not results:
            break

        all_rows.extend(results)
        total = data.get("total", 0)
        page += 1
        print(f"     Page {page} — {len(all_rows):,}/{total:,}", end="\r")

        next_url = data.get("next")
        if not next_url or len(all_rows) >= total:
            break

        from urllib.parse import urlparse, parse_qs
        qs_vals = parse_qs(urlparse(next_url).query)
        after_vals = qs_vals.get("after", [])
        if not after_vals:
            break
        after = after_vals[0]
        time.sleep(0.15)

    print()
    print(f"     → {len(all_rows):,} lignes {filiere}")
    return all_rows

rows_elec = fetch_filiere("Electricité")
rows_gaz  = fetch_filiere("Gaz")

# COMMAND ----------

# ── Step 2 : Sauvegarder en Bronze ADLS (JSON → CSV via Spark) ───────────────

import json

for filiere, rows in [("electricite", rows_elec), ("gaz", rows_gaz)]:
    if not rows:
        print(f"⚠️  Aucune donnée pour {filiere}")
        continue

    tmp_path = f"/tmp/energie_{filiere}.jsonl"
    with open(tmp_path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    # Lire le JSONL → DataFrame Spark → CSV Bronze
    df_tmp = spark.read.json(f"file:{tmp_path}")
    dest_csv = f"{BRONZE_ENERGIE}{filiere}_residentiel_idf.csv"

    (df_tmp.write
        .option("header", "true")
        .option("encoding", "UTF-8")
        .mode("overwrite")
        .csv(dest_csv)
    )
    print(f"✅ {filiere} → {dest_csv}  ({df_tmp.count():,} lignes)")

# COMMAND ----------

# ── Step 3 : Vérification Bronze ─────────────────────────────────────────────

files = dbutils.fs.ls(BRONZE_ENERGIE)
print(f"\n📁 Contenu {BRONZE_ENERGIE} :")
for fi in files:
    print(f"   {fi.name:60s}  {fi.size:>12,} octets")
