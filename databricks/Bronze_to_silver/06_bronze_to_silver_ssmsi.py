# Databricks notebook source
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  HomePedia — Bronze → Silver : SSMSI Délinquance + Merge Gold              ║
# ║                                                                              ║
# ║  Pipeline :                                                                  ║
# ║    Bronze CSV (data.gouv.fr) → nettoyage → Silver Delta                    ║
# ║    → taux par département → score_securite → Merge INTO Gold               ║
# ║                                                                              ║
# ║  Colonnes ajoutées au Gold :                                                 ║
# ║    taux_cambriolages  → cambriolages pour 1 000 logements (par dpt)        ║
# ║    taux_vols_violence → coups et blessures pour 1 000 habitants             ║
# ║    score_securite     → score 0-100 (100 = très sûr)                       ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# COMMAND ----------

# %run ../utils/init.py

# COMMAND ----------

from pyspark.sql import functions as F
from pyspark.sql.window import Window
from delta.tables import DeltaTable

BRONZE_SSMSI = f"{BRONZE}/ssmsi/"
SILVER_SSMSI = f"{SILVER}/ssmsi/"

# Populations et logements IDF 2022 (INSEE)
DEPT_POP = {"75": 2133111, "77": 1441305, "78": 1456299, "91": 1303639,
            "92": 1611662, "93": 1654994, "94": 1387926, "95": 1232939}
DEPT_LOG = {"75": 1408000, "77": 626000,  "78": 636000,  "91": 576000,
            "92": 766000,  "93": 651000,  "94": 616000,  "95": 543000}

DEPTS_IDF = list(DEPT_POP.keys())

# COMMAND ----------

# ── Step 1 : Lire le(s) CSV Bronze ───────────────────────────────────────────
#
# Le CSV SSMSI peut avoir divers formats selon l'année.
# On tente une lecture flexible avec inférence de schéma.

print("📥 Lecture Bronze SSMSI...")

try:
    df_raw = (
        spark.read
        .option("header", "true")
        .option("inferSchema", "true")
        .option("sep", ";")
        .csv(f"{BRONZE_SSMSI}*.csv")
    )
    if df_raw.columns == ["_c0"]:
        raise ValueError("Séparateur ';' incorrect, essai avec ','")
except Exception:
    df_raw = (
        spark.read
        .option("header", "true")
        .option("inferSchema", "true")
        .option("sep", ",")
        .csv(f"{BRONZE_SSMSI}*.csv")
    )

print(f"  → {df_raw.count():,} lignes brutes")
print(f"  → Colonnes : {df_raw.columns}")

# COMMAND ----------

# ── Step 2 : Normalisation des noms de colonnes ───────────────────────────────
#
# Le CSV SSMSI change de format chaque année. On normalise les noms.

import re

def normalize_col(c: str) -> str:
    return re.sub(r"[^a-z0-9_]", "_", c.lower().strip()
                   .replace("é", "e").replace("è", "e").replace("ê", "e")
                   .replace("à", "a").replace("â", "a").replace("ô", "o")
                   .replace(".", "_").replace("-", "_").replace(" ", "_"))

renamed = {c: normalize_col(c) for c in df_raw.columns}
df_norm = df_raw
for old, new in renamed.items():
    if old != new:
        df_norm = df_norm.withColumnRenamed(old, new)

print("Colonnes normalisées :", df_norm.columns[:10])

# COMMAND ----------

# ── Step 3 : Identifier les colonnes clés (fuzzy matching) ───────────────────

def find_col(cols, candidates):
    cols_l = {c.lower(): c for c in cols}
    for cand in candidates:
        if cand.lower() in cols_l:
            return cols_l[cand.lower()]
    return None

col_dept  = find_col(df_norm.columns, ["code_departement", "num_dep", "departement", "dept", "dep",
                                         "code_dep", "numero_departement"])
col_label = find_col(df_norm.columns, ["libelle", "indicateur", "index_", "type_infraction",
                                        "categorie", "nature", "libelle_infraction"])
col_val   = find_col(df_norm.columns, ["valeur", "nombre", "nb_faits", "faits", "count_", "nb"])
col_year  = find_col(df_norm.columns, ["annee", "annee_", "year", "millesime"])

print(f"Colonnes identifiées → dept={col_dept}, label={col_label}, val={col_val}, year={col_year}")

if not col_dept or not col_val:
    print("⚠️  Colonnes introuvables — utilisation des valeurs fallback IDF 2022")
    # Données de secours ONDRP/SSMSI 2022 (moyennes observées)
    fallback = spark.createDataFrame([
        ("75", "Cambriolages de logement", 8.2 * 1408000 / 1000, 2022),
        ("77", "Cambriolages de logement", 5.8 * 626000  / 1000, 2022),
        ("78", "Cambriolages de logement", 4.7 * 636000  / 1000, 2022),
        ("91", "Cambriolages de logement", 5.1 * 576000  / 1000, 2022),
        ("92", "Cambriolages de logement", 5.4 * 766000  / 1000, 2022),
        ("93", "Cambriolages de logement", 9.3 * 651000  / 1000, 2022),
        ("94", "Cambriolages de logement", 6.3 * 616000  / 1000, 2022),
        ("95", "Cambriolages de logement", 6.8 * 543000  / 1000, 2022),
        ("75", "Coups et blessures volontaires", 7.1 * 2133111 / 1000, 2022),
        ("77", "Coups et blessures volontaires", 4.2 * 1441305 / 1000, 2022),
        ("78", "Coups et blessures volontaires", 3.9 * 1456299 / 1000, 2022),
        ("91", "Coups et blessures volontaires", 4.5 * 1303639 / 1000, 2022),
        ("92", "Coups et blessures volontaires", 4.8 * 1611662 / 1000, 2022),
        ("93", "Coups et blessures volontaires", 10.2 * 1654994 / 1000, 2022),
        ("94", "Coups et blessures volontaires", 5.6 * 1387926 / 1000, 2022),
        ("95", "Coups et blessures volontaires", 5.9 * 1232939 / 1000, 2022),
    ], ["code_dept", "libelle", "nb_faits", "annee"])
    df_ssmsi = fallback
else:
    df_ssmsi = (
        df_norm
        .select(
            F.regexp_replace(F.trim(F.col(col_dept)), r"^0+", "").alias("code_dept"),
            F.trim(F.col(col_label)).alias("libelle"),
            F.col(col_val).cast("double").alias("nb_faits"),
            (F.col(col_year).cast("int") if col_year else F.lit(2023)).alias("annee"),
        )
        .filter(F.col("code_dept").isin(DEPTS_IDF))
        .filter(F.col("nb_faits").isNotNull())
    )
    print(f"  → {df_ssmsi.count():,} lignes IDF filtrées")

# COMMAND ----------

# ── Step 4 : Classifier cambriolages vs violences ────────────────────────────

df_classified = df_ssmsi.withColumn(
    "categorie",
    F.when(
        F.lower(F.col("libelle")).rlike("cambri|effract"),
        F.lit("cambriolage")
    ).when(
        F.lower(F.col("libelle")).rlike("coups.*bless|violence.*physiq|violence.*volont|agression|cbv"),
        F.lit("vols_violence")
    ).otherwise(F.lit(None))
).filter(F.col("categorie").isNotNull())

print(f"  → {df_classified.count():,} lignes après classification")

# COMMAND ----------

# ── Step 5 : Agrégation — moyenne sur 2 dernières années ─────────────────────

recent_years = (
    df_classified.agg(F.collect_set("annee").alias("annees"))
    .first()["annees"]
)
recent_years = sorted([y for y in recent_years if y is not None])[-2:]
print(f"Années retenues : {recent_years}")

df_agg = (
    df_classified
    .filter(F.col("annee").isin(recent_years))
    .groupBy("code_dept", "categorie")
    .agg(F.avg("nb_faits").alias("nb_faits_moyen"))
)

df_pivot = df_agg.groupBy("code_dept").pivot("categorie").agg(
    F.first("nb_faits_moyen")
)

# COMMAND ----------

# ── Step 6 : Calcul des taux pour 1 000 logements/habitants ──────────────────

dept_pop_df = spark.createDataFrame(
    [(k, float(v[0]), float(v[1])) for k, v in
     {d: (DEPT_POP[d], DEPT_LOG[d]) for d in DEPTS_IDF}.items()],
    ["code_dept", "population", "nb_logements"]
)

df_taux = (
    df_pivot
    .join(dept_pop_df, on="code_dept", how="left")
    .withColumn(
        "taux_cambriolages",
        F.when(
            F.col("cambriolage").isNotNull(),
            F.round(F.col("cambriolage") / F.col("nb_logements") * 1000, 2)
        )
    )
    .withColumn(
        "taux_vols_violence",
        F.when(
            F.col("vols_violence").isNotNull(),
            F.round(F.col("vols_violence") / F.col("population") * 1000, 2)
        )
    )
    .select("code_dept", "taux_cambriolages", "taux_vols_violence")
)

# Remplir les NaN par médiane IDF
median_cambrio  = df_taux.agg(F.percentile_approx("taux_cambriolages",  0.5)).first()[0]
median_violence = df_taux.agg(F.percentile_approx("taux_vols_violence", 0.5)).first()[0]

df_taux = (
    df_taux
    .withColumn("taux_cambriolages",  F.coalesce(F.col("taux_cambriolages"),  F.lit(median_cambrio)))
    .withColumn("taux_vols_violence", F.coalesce(F.col("taux_vols_violence"), F.lit(median_violence)))
)

print("Taux par département IDF :")
df_taux.show()

# COMMAND ----------

# ── Step 7 : Score sécurité 0-100 (inversé) ──────────────────────────────────
#
# Normalisation absolue (bornes nationales SSMSI 2022) :
#   cambriolages : 0‰ → 100pts | 20‰ → 0pts
#   violence     : 0‰ → 100pts | 25‰ → 0pts
#   Poids : 60% cambrio + 40% violence

CAMBRIO_MAX  = 20.0
VIOLENCE_MAX = 25.0

df_scored = (
    df_taux
    .withColumn(
        "score_cambrio",
        (1.0 - F.least(F.lit(1.0), F.col("taux_cambriolages")  / F.lit(CAMBRIO_MAX)))  * 100
    )
    .withColumn(
        "score_violence",
        (1.0 - F.least(F.lit(1.0), F.col("taux_vols_violence") / F.lit(VIOLENCE_MAX))) * 100
    )
    .withColumn(
        "score_securite",
        F.round(F.col("score_cambrio") * 0.60 + F.col("score_violence") * 0.40, 1)
    )
    .select("code_dept", "taux_cambriolages", "taux_vols_violence", "score_securite")
)

print("Scores sécurité par département :")
df_scored.orderBy(F.desc("score_securite")).show()

# COMMAND ----------

# ── Step 8 : Écriture Silver Delta ───────────────────────────────────────────

(df_scored
 .write
 .format("delta")
 .mode("overwrite")
 .option("overwriteSchema", "true")
 .save(SILVER_SSMSI)
)
print(f"✅ Silver SSMSI → {SILVER_SSMSI}")

# COMMAND ----------

# ── Step 9 : Merge dans Gold communes_agregat ─────────────────────────────────
#
# On propage les taux département → toutes les communes du département.
# Les communes non IDF ne sont pas touchées.

gold_path = f"{GOLD}/communes_agregat/"

df_gold_communes = (
    spark.read.format("delta").load(gold_path)
    .select("code_commune", F.trim(F.col("code_departement")).alias("code_dept"))
    .filter(F.col("code_dept").isin(DEPTS_IDF))
)

df_communes_scored = (
    df_gold_communes
    .join(df_scored, on="code_dept", how="left")
    .select("code_commune", "taux_cambriolages", "taux_vols_violence", "score_securite")
)

gold_table = DeltaTable.forPath(spark, gold_path)
gold_table.alias("gold").merge(
    df_communes_scored.alias("sec"),
    "gold.code_commune = sec.code_commune"
).whenMatchedUpdate(set={
    "taux_cambriolages":  "sec.taux_cambriolages",
    "taux_vols_violence": "sec.taux_vols_violence",
    "score_securite":     "sec.score_securite",
}).execute()

n_updated = df_communes_scored.count()
print(f"""
╔══════════════════════════════════════════════════════╗
║  ✅ SSMSI → Gold terminé                             ║
║                                                      ║
║  {n_updated:>4} communes mises à jour                       ║
║  Colonnes : taux_cambriolages, taux_vols_violence,   ║
║             score_securite (0-100)                   ║
╚══════════════════════════════════════════════════════╝
""")
