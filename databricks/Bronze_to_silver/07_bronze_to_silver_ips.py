# Databricks notebook source
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  HomePedia — Bronze → Silver : IPS Éducation + Merge Gold                  ║
# ║                                                                              ║
# ║  L'IPS (Indice de Position Sociale) est le meilleur proxy du niveau         ║
# ║  socio-économique d'un quartier — très corrélé aux prix immobiliers.        ║
# ║                                                                              ║
# ║  Colonnes ajoutées au Gold :                                                 ║
# ║    ips_moyen              → IPS moyen des écoles de la commune              ║
# ║    ips_median             → IPS médian (robuste aux outliers)               ║
# ║    nb_ecoles              → nb établissements (écoles + collèges)           ║
# ║    pct_ecoles_favorisees  → % établissements IPS > 110                     ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# COMMAND ----------

# %run ../utils/init.py

# COMMAND ----------

from pyspark.sql import functions as F
from pyspark.sql.window import Window
from delta.tables import DeltaTable

BRONZE_IPS = f"{BRONZE}/ips/"
SILVER_IPS = f"{SILVER}/ips/"

DEPTS_IDF = {"75", "77", "78", "91", "92", "93", "94", "95"}

# COMMAND ----------

# ── Step 1 : Lire le CSV Bronze ───────────────────────────────────────────────

print("📥 Lecture Bronze IPS...")

df_raw = (
    spark.read
    .option("header", "true")
    .option("inferSchema", "true")
    .csv(f"{BRONZE_IPS}*.csv")
)

print(f"  → {df_raw.count():,} établissements nationaux")
print(f"  → Colonnes : {df_raw.columns}")

# COMMAND ----------

# ── Step 2 : Normalisation colonnes ──────────────────────────────────────────

import re

def norm_col(c):
    return re.sub(r"[^a-z0-9_]", "_",
                  c.lower().strip()
                   .replace("é","e").replace("è","e").replace("ê","e")
                   .replace("à","a").replace("â","a"))

df_norm = df_raw
for old in df_raw.columns:
    new = norm_col(old)
    if old != new:
        df_norm = df_norm.withColumnRenamed(old, new)

print(f"Colonnes normalisées : {df_norm.columns[:12]}")

# COMMAND ----------

# ── Step 3 : Identifier les colonnes clés ────────────────────────────────────

def find_col(cols, candidates):
    cols_l = {c.lower(): c for c in cols}
    for cand in candidates:
        if cand.lower() in cols_l:
            return cols_l[cand.lower()]
    return None

col_code_commune = find_col(df_norm.columns, ["code_insee", "code_commune", "code_uai",
                                               "codecommune", "code_com"])
col_dept         = find_col(df_norm.columns, ["code_dept", "code_dep", "num_dep",
                                               "departement", "dep"])
col_uai          = find_col(df_norm.columns, ["uai", "identifiant", "numero_uai", "id"])
col_ips          = find_col(df_norm.columns, ["ips", "ips_2022", "ips_2021", "indice_position"])

print(f"Colonnes → commune={col_code_commune}, dept={col_dept}, uai={col_uai}, ips={col_ips}")

if not col_ips:
    dbutils.notebook.exit("ERREUR : colonne IPS introuvable dans le CSV")

# COMMAND ----------

# ── Step 4 : Filtrer IDF + nettoyage ─────────────────────────────────────────

df_idf = (
    df_norm
    .filter(F.col(col_dept).isin(DEPTS_IDF) if col_dept
            else F.substring(F.col(col_code_commune), 1, 2).isin(DEPTS_IDF))
    .withColumn("code_commune", F.lpad(F.trim(F.col(col_code_commune)).cast("string"), 5, "0"))
    .withColumn("ips",          F.col(col_ips).cast("double"))
    .withColumn("uai",          F.col(col_uai).cast("string") if col_uai else F.lit(None).cast("string"))
    .filter(F.col("ips").between(50, 180))  # IPS réaliste (national: ~60-160)
    .filter(F.col("code_commune").isNotNull())
    .select("code_commune", "uai", "ips")
    .withColumn("ingested_at", F.current_timestamp())
)

print(f"  → {df_idf.count():,} établissements IDF valides")

# COMMAND ----------

# ── Step 5 : Écriture Silver Delta ───────────────────────────────────────────

(df_idf
 .write
 .format("delta")
 .mode("overwrite")
 .option("overwriteSchema", "true")
 .save(SILVER_IPS)
)
print(f"✅ Silver IPS → {SILVER_IPS}")

# COMMAND ----------

# ── Step 6 : Agrégation par commune ──────────────────────────────────────────

df_agg = (
    df_idf
    .groupBy("code_commune")
    .agg(
        F.round(F.avg("ips"),    1).alias("ips_moyen"),
        F.round(F.expr("percentile_approx(ips, 0.5)"), 1).alias("ips_median"),
        F.count("uai").alias("nb_ecoles"),
        F.round(
            F.sum(F.when(F.col("ips") > 110, 1).otherwise(0)) / F.count("uai") * 100, 1
        ).alias("pct_ecoles_favorisees"),
    )
)

print(f"  → {df_agg.count():,} communes avec données IPS")
print("\nTop 10 par IPS moyen :")
df_agg.orderBy(F.desc("ips_moyen")).limit(10).show()

# COMMAND ----------

# ── Step 7 : Merge INTO Gold ──────────────────────────────────────────────────

gold_path  = f"{GOLD}/communes_agregat/"
gold_table = DeltaTable.forPath(spark, gold_path)

gold_table.alias("gold").merge(
    df_agg.alias("ips"),
    "gold.code_commune = ips.code_commune"
).whenMatchedUpdate(set={
    "ips_moyen":             "ips.ips_moyen",
    "ips_median":            "ips.ips_median",
    "nb_ecoles":             "ips.nb_ecoles",
    "pct_ecoles_favorisees": "ips.pct_ecoles_favorisees",
}).execute()

n = df_agg.count()
print(f"""
╔══════════════════════════════════════════════════════╗
║  ✅ IPS → Gold terminé                               ║
║                                                      ║
║  {n:>4} communes mises à jour                          ║
║  Colonnes : ips_moyen, ips_median,                   ║
║             nb_ecoles, pct_ecoles_favorisees         ║
╚══════════════════════════════════════════════════════╝
""")
