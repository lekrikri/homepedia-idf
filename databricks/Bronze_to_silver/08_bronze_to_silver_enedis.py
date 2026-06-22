# Databricks notebook source
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  HomePedia — Bronze → Silver : ENEDIS/GRDF Énergie + Merge Gold            ║
# ║                                                                              ║
# ║  Transforme les données de consommation résidentielle agenceORE              ║
# ║  en métriques par commune (MWh/logement/an).                                ║
# ║                                                                              ║
# ║  Colonnes ajoutées au Gold :                                                 ║
# ║    conso_elec_mwh           → conso élec résidentielle totale (MWh)        ║
# ║    conso_gaz_mwh            → conso gaz résidentielle totale (MWh)         ║
# ║    conso_elec_par_logement  → MWh/logement/an (proxy isolation)            ║
# ║    conso_gaz_par_logement   → MWh/logement/an                              ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# COMMAND ----------

# %run ../utils/init.py

# COMMAND ----------

from pyspark.sql import functions as F
from pyspark.sql.window import Window
from delta.tables import DeltaTable

BRONZE_ENERGIE = f"{BRONZE}/energie/"
SILVER_ENERGIE = f"{SILVER}/energie/"

# COMMAND ----------

# ── Step 1 : Lire les CSV Bronze (électricité + gaz) ─────────────────────────

def read_filiere(filiere_key: str):
    path = f"{BRONZE_ENERGIE}{filiere_key}_residentiel_idf.csv/"
    try:
        df = (
            spark.read
            .option("header", "true")
            .option("inferSchema", "true")
            .csv(path)
        )
        print(f"  {filiere_key}: {df.count():,} lignes, colonnes: {df.columns[:8]}")
        return df
    except Exception as e:
        print(f"  ⚠️  {filiere_key} introuvable : {e}")
        return None

print("📥 Lecture Bronze Énergie...")
df_elec = read_filiere("electricite")
df_gaz  = read_filiere("gaz")

# COMMAND ----------

# ── Step 2 : Normaliser colonnes + agréger par commune ───────────────────────

import re

def norm_col(c):
    return re.sub(r"[^a-z0-9_]", "_",
                  c.lower().strip()
                   .replace("é","e").replace("è","e").replace("ê","e"))

def find_col(cols, candidates):
    cols_l = {c.lower(): c for c in cols}
    for cand in candidates:
        if cand.lower() in cols_l:
            return cols_l[cand.lower()]
    return None


def process_filiere(df, prefix: str):
    """
    Agrège par commune, garde l'année la plus récente.
    Retourne: code_commune, conso_{prefix}_mwh, nb_sites_{prefix}, conso_{prefix}_par_logement
    """
    if df is None:
        return None

    # Normaliser les noms
    df_n = df
    for old in df.columns:
        new = norm_col(old)
        if old != new:
            df_n = df_n.withColumnRenamed(old, new)

    col_commune = find_col(df_n.columns, ["code_commune", "codecommune", "code_insee"])
    col_conso   = find_col(df_n.columns, ["conso_totale_mwh", "conso_mwh", "consommation",
                                            "energie_kwh", "conso_kwh"])
    col_sites   = find_col(df_n.columns, ["nb_sites", "nb_points_livraison", "nb_pdl",
                                            "nombre_sites", "nb_clients"])
    col_annee   = find_col(df_n.columns, ["annee", "year", "annee_"])

    if not col_commune or not col_conso:
        print(f"  ⚠️  Colonnes introuvables pour {prefix}: commune={col_commune}, conso={col_conso}")
        return None

    df_typed = (
        df_n
        .withColumn("code_commune", F.lpad(F.trim(F.col(col_commune).cast("string")), 5, "0"))
        .withColumn("conso_mwh",    F.col(col_conso).cast("double"))
        .withColumn("nb_sites",     F.col(col_sites).cast("double") if col_sites else F.lit(None).cast("double"))
        .withColumn("annee",        F.col(col_annee).cast("int") if col_annee else F.lit(2022).cast("int"))
        .filter(F.col("conso_mwh").isNotNull() & (F.col("conso_mwh") > 0))
        .filter(F.col("code_commune").isNotNull())
    )

    # Garder l'année la plus récente par commune
    window_latest = Window.partitionBy("code_commune").orderBy(F.desc("annee"))
    df_latest = (
        df_typed
        .withColumn("rn", F.row_number().over(window_latest))
        .filter(F.col("rn") == 1)
        .drop("rn")
    )

    # Grouper (au cas où plusieurs lignes par commune/année)
    df_agg = (
        df_latest
        .groupBy("code_commune")
        .agg(
            F.sum("conso_mwh").alias(f"conso_{prefix}_mwh"),
            F.sum("nb_sites").alias(f"nb_sites_{prefix}"),
            F.first("annee").alias("annee"),
        )
        .withColumn(
            f"conso_{prefix}_par_logement",
            F.round(
                F.col(f"conso_{prefix}_mwh") / F.greatest(F.col(f"nb_sites_{prefix}"), F.lit(1.0)),
                2
            )
        )
    )

    print(f"  {prefix}: {df_agg.count():,} communes")
    return df_agg


df_elec_agg = process_filiere(df_elec, "elec")
df_gaz_agg  = process_filiere(df_gaz,  "gaz")

# COMMAND ----------

# ── Step 3 : Jointure élec + gaz ─────────────────────────────────────────────

if df_elec_agg is not None and df_gaz_agg is not None:
    df_energie = df_elec_agg.join(
        df_gaz_agg.select("code_commune", "conso_gaz_mwh",
                           "nb_sites_gaz", "conso_gaz_par_logement"),
        on="code_commune", how="outer"
    )
elif df_elec_agg is not None:
    df_energie = df_elec_agg.withColumn("conso_gaz_mwh", F.lit(None).cast("double")) \
                             .withColumn("conso_gaz_par_logement", F.lit(None).cast("double"))
elif df_gaz_agg is not None:
    df_energie = df_gaz_agg.withColumn("conso_elec_mwh", F.lit(None).cast("double")) \
                            .withColumn("conso_elec_par_logement", F.lit(None).cast("double"))
else:
    dbutils.notebook.exit("ERREUR : aucune donnée énergie disponible")

print(f"  → {df_energie.count():,} communes avec données énergie")

# COMMAND ----------

# ── Step 4 : Écriture Silver Delta ───────────────────────────────────────────

silver_cols = ["code_commune",
               "conso_elec_mwh", "conso_gaz_mwh",
               "conso_elec_par_logement", "conso_gaz_par_logement"]

# Assurer toutes les colonnes existent
df_silver = df_energie.withColumn("ingested_at", F.current_timestamp())
for col in silver_cols:
    if col not in df_silver.columns:
        df_silver = df_silver.withColumn(col, F.lit(None).cast("double"))

(df_silver
 .select(*silver_cols, "ingested_at")
 .write
 .format("delta")
 .mode("overwrite")
 .option("overwriteSchema", "true")
 .save(SILVER_ENERGIE)
)
print(f"✅ Silver Énergie → {SILVER_ENERGIE}")

# COMMAND ----------

# ── Step 5 : Validation qualité ──────────────────────────────────────────────

stats = df_silver.agg(
    F.count(F.when(F.col("conso_elec_par_logement").isNotNull(), 1)).alias("n_elec"),
    F.count(F.when(F.col("conso_gaz_par_logement").isNotNull(),  1)).alias("n_gaz"),
    F.round(F.expr("percentile_approx(conso_elec_par_logement, 0.5)"), 1).alias("median_elec"),
    F.round(F.expr("percentile_approx(conso_gaz_par_logement, 0.5)"),  1).alias("median_gaz"),
).first()

print(f"""
Distribution :
  Électricité → {stats['n_elec']} communes | médiane {stats['median_elec']} MWh/log/an
  Gaz         → {stats['n_gaz']}  communes | médiane {stats['median_gaz']}  MWh/log/an
Valeurs hors-norme (> 100 MWh/log) filtrées.
""")

# Filtrer les valeurs aberrantes (> 100 MWh/logement = erreur de données)
df_silver_clean = df_silver.filter(
    F.col("conso_elec_par_logement").isNull() | F.col("conso_elec_par_logement").between(0, 100)
).filter(
    F.col("conso_gaz_par_logement").isNull() | F.col("conso_gaz_par_logement").between(0, 100)
)

# COMMAND ----------

# ── Step 6 : Merge INTO Gold ──────────────────────────────────────────────────

gold_path  = f"{GOLD}/communes_agregat/"
gold_table = DeltaTable.forPath(spark, gold_path)

df_merge = df_silver_clean.select(
    "code_commune",
    "conso_elec_mwh", "conso_gaz_mwh",
    "conso_elec_par_logement", "conso_gaz_par_logement"
)

gold_table.alias("gold").merge(
    df_merge.alias("en"),
    "gold.code_commune = en.code_commune"
).whenMatchedUpdate(set={
    "conso_elec_mwh":          "en.conso_elec_mwh",
    "conso_gaz_mwh":           "en.conso_gaz_mwh",
    "conso_elec_par_logement": "en.conso_elec_par_logement",
    "conso_gaz_par_logement":  "en.conso_gaz_par_logement",
}).execute()

n = df_merge.count()
print(f"""
╔══════════════════════════════════════════════════════╗
║  ✅ ENEDIS/GRDF → Gold terminé                       ║
║                                                      ║
║  {n:>4} communes mises à jour                          ║
║  Colonnes : conso_elec_mwh, conso_gaz_mwh,           ║
║             conso_elec_par_logement,                 ║
║             conso_gaz_par_logement (MWh/log/an)      ║
╚══════════════════════════════════════════════════════╝
""")
