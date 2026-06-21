# Databricks notebook source
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  HomePedia — Bronze → Silver : Loyers CLAMEUR / OLAP IDF                  ║
# ║                                                                              ║
# ║  Transforme le CSV loyers (généré par ingestion/loyers/download.py) en     ║
# ║  table Delta Silver, puis l'agrège dans communes_agregat Gold.              ║
# ║                                                                              ║
# ║  Colonnes ajoutées au Gold :                                                 ║
# ║    loyer_median_m2        → loyer médian/m²/mois estimé CLAMEUR 2022        ║
# ║    rendement_locatif_brut → loyer_annuel / prix_m2 * 100 (%)                ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# COMMAND ----------

# %run ../utils/init.py

# COMMAND ----------

from pyspark.sql import functions as F
from delta.tables import DeltaTable

BRONZE_LOYERS = f"{BRONZE}/loyers/"
SILVER_LOYERS = f"{SILVER}/loyers/"

# COMMAND ----------

# ── Step 1 : Lire le CSV depuis le Bronze ────────────────────────────────────

df_raw = (
    spark.read
    .option("header", "true")
    .option("inferSchema", "true")
    .csv(f"{BRONZE_LOYERS}loyers_idf_communes.csv")
)

print(f"📥 Bronze loyers — {df_raw.count():,} lignes")
df_raw.printSchema()

# COMMAND ----------

# ── Step 2 : Nettoyage et typage (Silver) ────────────────────────────────────

df_silver = (
    df_raw
    # Supprimer les lignes sans loyer valide
    .filter(F.col("loyer_median_m2").isNotNull())
    .filter(F.col("loyer_median_m2").between(6.0, 40.0))
    # Cast explicite
    .withColumn("loyer_median_m2",  F.col("loyer_median_m2").cast("double"))
    .withColumn("zone_tendue",      F.col("zone_tendue").cast("boolean"))
    .withColumn("annee",            F.col("annee").cast("int"))
    # Champs nettoyés
    .withColumn("code_commune",     F.trim(F.col("code_commune")))
    .withColumn("code_departement", F.trim(F.col("code_departement")))
    # Timestamp ingestion
    .withColumn("ingested_at",      F.current_timestamp())
    .select(
        "code_commune", "code_departement", "city",
        "loyer_median_m2", "zone_tendue", "source", "annee", "ingested_at",
    )
)

print(f"✅ Silver loyers — {df_silver.count():,} communes valides")

# Distribution par département
print("\nLoyer médian par département :")
(df_silver
 .groupBy("code_departement")
 .agg(
     F.count("*").alias("n"),
     F.round(F.expr("percentile_approx(loyer_median_m2, 0.5)"), 1).alias("median"),
     F.round(F.min("loyer_median_m2"), 1).alias("min"),
     F.round(F.max("loyer_median_m2"), 1).alias("max"),
 )
 .orderBy("code_departement")
 .show()
)

# COMMAND ----------

# ── Step 3 : Écrire en Delta Silver ──────────────────────────────────────────

(df_silver
 .write
 .format("delta")
 .mode("overwrite")
 .option("overwriteSchema", "true")
 .save(SILVER_LOYERS)
)

print(f"✅ Table Silver loyers écrite → {SILVER_LOYERS}")

# COMMAND ----------

# ── Step 4 : Enrichir le Gold communes_agregat ────────────────────────────────
#
# Calcul du rendement locatif brut :
#   rendement_locatif_brut (%) = loyer_median_m2 * 12 / prix_median_m2 * 100
#
# Exemple : loyer = 18€/m²/mois, prix = 5000€/m²
#   → rendement = 18 * 12 / 5000 * 100 = 4.32%

df_loyers_enrichi = (
    df_silver
    .select("code_commune", "loyer_median_m2", "zone_tendue")
    # Joindre au Gold pour calculer le rendement
    .join(
        spark.read.format("delta").load(f"{GOLD}/communes_agregat/")
            .select("code_commune", "prix_median_m2"),
        on="code_commune",
        how="left"
    )
    .withColumn(
        "rendement_locatif_brut",
        F.when(
            F.col("prix_median_m2").isNotNull() & (F.col("prix_median_m2") > 0),
            F.round(
                F.col("loyer_median_m2") * 12 / F.col("prix_median_m2") * 100,
                2
            )
        ).otherwise(F.lit(None))
    )
    .select("code_commune", "loyer_median_m2", "zone_tendue", "rendement_locatif_brut")
)

print("Aperçu rendement locatif (top 10 par rendement) :")
(df_loyers_enrichi
 .filter(F.col("rendement_locatif_brut").isNotNull())
 .orderBy(F.desc("rendement_locatif_brut"))
 .limit(10)
 .show()
)

# COMMAND ----------

# ── Step 5 : Merge dans la table Gold ────────────────────────────────────────

gold_path = f"{GOLD}/communes_agregat/"
gold_table = DeltaTable.forPath(spark, gold_path)

gold_table.alias("gold").merge(
    df_loyers_enrichi.alias("loyers"),
    "gold.code_commune = loyers.code_commune"
).whenMatchedUpdate(set={
    "loyer_median_m2":        "loyers.loyer_median_m2",
    "zone_tendue":            "loyers.zone_tendue",
    "rendement_locatif_brut": "loyers.rendement_locatif_brut",
}).execute()

print("✅ Gold communes_agregat enrichi avec loyers + rendement locatif")

# COMMAND ----------

# ── Step 6 : Validation qualité rapide ───────────────────────────────────────

df_gold = spark.read.format("delta").load(gold_path)
n_total = df_gold.count()

stats = df_gold.select(
    F.count(F.when(F.col("loyer_median_m2").isNotNull(), 1)).alias("avec_loyer"),
    F.count(F.when(F.col("rendement_locatif_brut").isNotNull(), 1)).alias("avec_rend"),
    F.round(F.expr("percentile_approx(rendement_locatif_brut, 0.5)"), 2).alias("median_rend"),
    F.round(F.min("rendement_locatif_brut"), 2).alias("min_rend"),
    F.round(F.max("rendement_locatif_brut"), 2).alias("max_rend"),
).first()

pct_loyer = stats["avec_loyer"] / n_total * 100
pct_rend  = stats["avec_rend"]  / n_total * 100

print(f"""
╔══════════════════════════════════════════════════════╗
║  ✅ Loyers intégrés dans Gold                        ║
║                                                      ║
║  Communes avec loyer         : {stats['avec_loyer']:>5} ({pct_loyer:.1f}%)       ║
║  Communes avec rendement     : {stats['avec_rend']:>5} ({pct_rend:.1f}%)       ║
║  Rendement médian IDF        : {stats['median_rend'] or 0:>5.2f}%              ║
║  Rendement min / max         : {stats['min_rend'] or 0:.2f}% / {stats['max_rend'] or 0:.2f}%        ║
╚══════════════════════════════════════════════════════╝
""")
