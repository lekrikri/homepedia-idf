# Databricks notebook source
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  HomePedia — Raw → Bronze : IPS Éducation                                  ║
# ║                                                                              ║
# ║  Télécharge l'Indice de Position Sociale (IPS) des écoles et collèges      ║
# ║  IDF depuis data.gouv.fr et le dépose en Bronze ADLS.                       ║
# ║                                                                              ║
# ║  Source : data.gouv.fr — dataset 634fefba689b52c6ef7bf3db                  ║
# ║  IPS = proxy du niveau socio-économique — très corrélé aux prix immo        ║
# ║  Colonnes Gold ajoutées : ips_moyen, nb_ecoles, pct_ecoles_favorisees       ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# COMMAND ----------

# %run ../utils/init.py

# COMMAND ----------

import requests
import io

BRONZE_IPS = f"{BRONZE}/ips/"

# URL directe CSV IPS géolocalisé (stable depuis 2022)
IPS_URL = "https://static.data.gouv.fr/resources/indices-de-position-sociale-geolocalises-des-ecoles-et-colleges-de-france-metropolitaine-et-des-drom-2/20221019-143830/ips-all-geoloc.csv"

# COMMAND ----------

# ── Step 1 : Téléchargement ───────────────────────────────────────────────────

print("🏫 Téléchargement IPS écoles/collèges IDF...")
print(f"  URL : {IPS_URL}")

r = requests.get(IPS_URL, timeout=180)
r.raise_for_status()
print(f"  → {len(r.content):,} octets téléchargés")

# COMMAND ----------

# ── Step 2 : Dépôt Bronze ADLS ───────────────────────────────────────────────

tmp_path = "/tmp/ips_all_geoloc.csv"
with open(tmp_path, "wb") as f:
    f.write(r.content)

dest = f"{BRONZE_IPS}ips_ecoles_geoloc.csv"
dbutils.fs.cp(f"file:{tmp_path}", dest)
print(f"✅ Déposé → {dest}")

# COMMAND ----------

# ── Step 3 : Vérification rapide (lecture 5 lignes) ──────────────────────────

from pyspark.sql import functions as F

df_check = (
    spark.read
    .option("header", "true")
    .option("inferSchema", "true")
    .csv(dest)
    .limit(5)
)
print("Aperçu Bronze IPS :")
df_check.show(truncate=False)
print(f"Colonnes : {df_check.columns}")
