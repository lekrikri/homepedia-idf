# Databricks notebook source
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  HomePedia — Silver → Gold avec Delta Lake Change Data Feed (CDF)          ║
# ║                                                                              ║
# ║  Objectif : ne recalculer que les communes IDF impactées par de nouvelles   ║
# ║  données Bronze/Silver, au lieu de tout écraser à chaque pipeline run.      ║
# ║                                                                              ║
# ║  Flux :                                                                      ║
# ║    Silver (DVF + DPE + INSEE + OSM) → CDF → agrégation incrémentale → Gold  ║
# ║                                                                              ║
# ║  Pré-requis :                                                                ║
# ║    - Tables Silver déjà créées par Bronze_to_silver/ notebooks               ║
# ║    - delta.enableChangeDataFeed activé sur ces tables (Step 1 ci-dessous)    ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# COMMAND ----------

# %run ../utils/init.py

# COMMAND ----------

# ── Step 0 : Imports ──────────────────────────────────────────────────────────
from pyspark.sql import functions as F
from pyspark.sql.window import Window
from delta.tables import DeltaTable

WATERMARK_PATH = f"{GOLD}/_cdf_watermarks/"

# COMMAND ----------

# ── Step 1 : Activer CDF sur les tables Silver (idempotent) ──────────────────
#
# delta.enableChangeDataFeed = true permet à Delta de journaliser chaque INSERT,
# UPDATE, DELETE dans _change_data/ au sein de la table.
# Exécuter une seule fois ; les runs suivants passent directement au Step 2.

for table_path in [
    f"{SILVER}/dvf_transactions/",
    f"{SILVER}/dpe/",
    f"{SILVER}/insee/",
    f"{SILVER}/osm_poi/",
]:
    try:
        spark.sql(f"""
            ALTER TABLE delta.`{table_path}`
            SET TBLPROPERTIES (delta.enableChangeDataFeed = true)
        """)
        print(f"✅ CDF activé : {table_path}")
    except Exception as e:
        print(f"⚠️  {table_path} : {e}")

# COMMAND ----------

# ── Step 2 : Charger/initialiser le watermark de version Delta ───────────────
#
# Le watermark stocke la dernière version Delta lue par table.
# À chaque run, on lit uniquement les changements depuis ce watermark.

def load_watermarks():
    try:
        return spark.read.json(WATERMARK_PATH).collect()
    except Exception:
        return []

def get_watermark(wm_rows, table_name):
    for row in wm_rows:
        if row["table"] == table_name:
            return int(row["version"])
    return 0  # première exécution → lire depuis version 0

def save_watermarks(wm_dict):
    rows = [{"table": k, "version": v} for k, v in wm_dict.items()]
    spark.createDataFrame(rows).write.mode("overwrite").json(WATERMARK_PATH)
    print(f"💾 Watermarks sauvegardés : {wm_dict}")

wm_rows = load_watermarks()
print(f"📌 Watermarks actuels : {wm_rows}")

# COMMAND ----------

# ── Step 3 : Lire les changements DVF depuis le dernier watermark ─────────────
#
# readChangeFeed retourne les colonnes habituelles + _change_type, _commit_version
# _change_type : "insert" | "update_preimage" | "update_postimage" | "delete"
# On garde uniquement insert + update_postimage (valeurs finales).

dvf_path = f"{SILVER}/dvf_transactions/"
dvf_wm   = get_watermark(wm_rows, "dvf_transactions")

df_dvf_changes = (
    spark.read
    .format("delta")
    .option("readChangeFeed", "true")
    .option("startingVersion", dvf_wm)
    .load(dvf_path)
    .filter(F.col("_change_type").isin("insert", "update_postimage"))
    .drop("_change_type", "_commit_timestamp")
)
dvf_new_version = DeltaTable.forPath(spark, dvf_path).history(1).select("version").first()[0]

nb_changes = df_dvf_changes.count()
print(f"📊 DVF — {nb_changes:,} lignes changées depuis version {dvf_wm} (version actuelle : {dvf_new_version})")

# COMMAND ----------

# ── Step 4 : Identifier les communes impactées ───────────────────────────────
#
# Seules les communes ayant des transactions modifiées/ajoutées sont recalculées.
# Pour les autres, on conserve les valeurs Gold existantes.

communes_impactees = (
    df_dvf_changes
    .select("code_commune")
    .distinct()
)

nb_communes = communes_impactees.count()
print(f"🏘️  {nb_communes} commune(s) à recalculer")

if nb_communes == 0:
    print("✅ Aucune modification détectée — Gold déjà à jour. Fin du job.")
    dbutils.notebook.exit("NO_CHANGES")

# COMMAND ----------

# ── Step 5 : Recalculer les agrégations DVF pour les communes impactées ───────

df_dvf_full = (
    spark.read.format("delta").load(dvf_path)
    .join(communes_impactees, on="code_commune", how="inner")
)

df_gold_dvf = (
    df_dvf_full
    .groupBy("code_commune")
    .agg(
        F.count("*").cast("long").alias("nb_transactions"),
        F.expr("percentile_approx(prix_m2, 0.5)").alias("prix_median_m2"),
        F.avg("prix_m2").alias("prix_moyen_m2"),
        F.avg("surface_reelle_bati").alias("surface_moyenne"),
        F.expr("percentile_approx(valeur_fonciere, 0.5)").alias("prix_median_transaction"),
    )
)

print(f"✅ Agrégations DVF recalculées pour {df_gold_dvf.count()} communes")

# COMMAND ----------

# ── Step 6 : Merge incrémental dans la table Gold ─────────────────────────────
#
# MERGE INTO garantit que :
#   - les communes impactées reçoivent les nouvelles agrégations
#   - les communes non impactées conservent leurs valeurs Gold inchangées

gold_path = f"{GOLD}/communes_agregat/"

# Créer la table Gold si elle n'existe pas encore
if not DeltaTable.isDeltaTable(spark, gold_path):
    print("📝 Création initiale de la table Gold communes_agregat...")
    df_gold_dvf.write.format("delta").mode("overwrite").save(gold_path)
    print("✅ Table Gold créée")
else:
    gold_table = DeltaTable.forPath(spark, gold_path)

    gold_table.alias("gold").merge(
        df_gold_dvf.alias("updates"),
        "gold.code_commune = updates.code_commune"
    ).whenMatchedUpdateAll().whenNotMatchedInsertAll().execute()

    print(f"✅ Merge Gold DVF terminé — {nb_communes} commune(s) mises à jour")

# COMMAND ----------

# ── Step 7 : Sauvegarder le watermark DVF ────────────────────────────────────

wm_current = {row["table"]: row["version"] for row in wm_rows} if wm_rows else {}
wm_current["dvf_transactions"] = int(dvf_new_version)

# Lire également les versions actuelles des autres tables Silver pour prochain run
for name, path in [
    ("dpe",      f"{SILVER}/dpe/"),
    ("insee",    f"{SILVER}/insee/"),
    ("osm_poi",  f"{SILVER}/osm_poi/"),
]:
    try:
        ver = DeltaTable.forPath(spark, path).history(1).select("version").first()[0]
        wm_current.setdefault(name, int(ver))
    except Exception:
        pass

save_watermarks(wm_current)

# COMMAND ----------

# ── Step 8 : Optimisation périodique de la table Gold ────────────────────────
#
# OPTIMIZE compacte les petits fichiers Parquet générés par les merges successifs.
# Z-ORDER sur code_commune accélère les requêtes par commune.
# À lancer tous les N runs (ex. 1 fois par semaine) plutôt qu'à chaque run.

from datetime import datetime
day_of_week = datetime.now().weekday()  # 0 = lundi

if day_of_week == 0:  # chaque lundi
    print("🔧 OPTIMIZE + ZORDER Gold (run hebdomadaire)...")
    spark.sql(f"OPTIMIZE delta.`{gold_path}` ZORDER BY (code_commune)")
    spark.sql(f"VACUUM delta.`{gold_path}` RETAIN 168 HOURS")  # 7 jours
    print("✅ OPTIMIZE + VACUUM terminés")
else:
    print(f"⏭️  OPTIMIZE ignoré (jour {day_of_week}, sera fait lundi)")

# COMMAND ----------

print("""
╔══════════════════════════════════════════════════════╗
║  ✅ Silver → Gold CDF terminé                        ║
║                                                      ║
║  Seules les communes avec nouvelles données DVF      ║
║  ont été recalculées → économie Databricks DBU.      ║
╚══════════════════════════════════════════════════════╝
""")
