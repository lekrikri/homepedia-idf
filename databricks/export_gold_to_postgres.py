# Databricks Notebook — Export Gold communes_agregat → PostgreSQL
# À exécuter par Ludo après avoir produit la table Gold
#
# Prérequis :
#   - La table gold/communes_agregat/ doit exister (produite par le pipeline Ludo)
#   - Le secret JDBC doit être configuré dans Databricks (ou saisir manuellement ci-dessous)
#   - La migration 001_communes_agregat.sql doit avoir été exécutée en local
#     → docker exec homepedia_postgres psql -U homepedia -d homepedia -f /path/001_communes_agregat.sql

# ── Config ─────────────────────────────────────────────────────────────────────

GOLD = "abfss://gold@homepediadatalake.dfs.core.windows.net"

# Connexion PostgreSQL — récupérer depuis les secrets Databricks si possible
try:
    PG_HOST     = dbutils.secrets.get(scope="homepedia", key="PG_HOST")
    PG_PORT     = dbutils.secrets.get(scope="homepedia", key="PG_PORT")
    PG_DB       = dbutils.secrets.get(scope="homepedia", key="PG_DB")
    PG_USER     = dbutils.secrets.get(scope="homepedia", key="PG_USER")
    PG_PASSWORD = dbutils.secrets.get(scope="homepedia", key="PG_PASSWORD")
except Exception:
    # Sinon saisir manuellement (ne pas committer avec les vraies valeurs !)
    PG_HOST     = "TON_IP_PUBLIQUE_OU_TUNNEL"   # ex: IP du poste local exposé
    PG_PORT     = "5433"
    PG_DB       = "homepedia"
    PG_USER     = "homepedia"
    PG_PASSWORD = "homepedia123"

JDBC_URL = f"jdbc:postgresql://{PG_HOST}:{PG_PORT}/{PG_DB}"
JDBC_PROPS = {
    "user": PG_USER,
    "password": PG_PASSWORD,
    "driver": "org.postgresql.Driver",
}

# ── Étape 1 : Lire la table Gold ───────────────────────────────────────────────

print("📖 Lecture de gold/communes_agregat/...")
df_gold = spark.read.format("delta").load(f"{GOLD}/communes_agregat/")
print(f"  → {df_gold.count()} communes")
df_gold.printSchema()

# ── Étape 2 : Sélectionner et renommer les colonnes pour PostgreSQL ────────────
# La table PG s'appelle "communes_agregat" avec les colonnes définies dans la migration

from pyspark.sql import functions as F

df_pg = df_gold.select(
    F.col("code_commune"),
    F.col("city"),
    F.col("code_departement"),
    F.col("centroid_lon"),
    F.col("centroid_lat"),
    F.col("surface_km2"),
    # INSEE
    F.col("population_totale"),
    F.col("population_municipale"),
    F.col("densite_pop_km2"),
    # DVF
    F.col("prix_median_m2"),
    F.col("prix_moyen_m2"),
    F.col("nb_transactions"),
    F.col("surface_moyenne"),
    F.col("prix_median_transaction"),
    # DPE
    F.col("score_dpe_moyen"),
    F.col("conso_energie_moyenne"),
    F.col("emission_ges_moyenne"),
    F.col("nb_dpe"),
    F.col("pct_dpe_bon"),
    # OSM POI
    F.col("nb_poi_total"),
    F.col("nb_transport"),
    F.col("nb_education"),
    F.col("nb_sante"),
    F.col("nb_commerce"),
    F.col("nb_restauration"),
    F.col("nb_parcs"),
    F.col("nb_services"),
    F.col("nb_bio_bobo"),
)

# Si certaines colonnes ont des noms différents dans ta table Gold,
# adapter les F.col() ci-dessus ou ajouter des .alias("nom_pg")
# Exemple si ta colonne s'appelle "population" au lieu de "population_totale" :
# F.col("population").alias("population_totale"),

print(f"\nAperçu des données à écrire :")
df_pg.show(5, truncate=False)

# ── Étape 3 : Écrire dans PostgreSQL ──────────────────────────────────────────

print(f"\n💾 Écriture dans PostgreSQL {PG_HOST}:{PG_PORT}/{PG_DB} → table communes_agregat...")

(df_pg.write
    .format("jdbc")
    .option("url", JDBC_URL)
    .option("dbtable", "communes_agregat")
    .option("user", PG_USER)
    .option("password", PG_PASSWORD)
    .option("driver", "org.postgresql.Driver")
    # "overwrite" vide et recrée la table, "append" ajoute
    # Utiliser "overwrite" pour la première fois ou pour ré-importer
    .mode("overwrite")
    .save()
)

print("✅ Export terminé !")

# ── Étape 4 : Vérification ────────────────────────────────────────────────────

df_check = spark.read \
    .format("jdbc") \
    .option("url", JDBC_URL) \
    .option("dbtable", "communes_agregat") \
    .option("user", PG_USER) \
    .option("password", PG_PASSWORD) \
    .option("driver", "org.postgresql.Driver") \
    .load()

print(f"\n🔍 Vérification : {df_check.count()} lignes dans communes_agregat (PG)")
df_check.select("code_commune", "city", "prix_median_m2", "nb_transactions", "nb_transport").show(10)

# ── Note importante ────────────────────────────────────────────────────────────
# Le mode "overwrite" Spark recrée la table sans les contraintes FK et index.
# Après l'export, re-exécuter en local :
#
#   docker exec homepedia_postgres psql -U homepedia -d homepedia -c "
#     CREATE INDEX IF NOT EXISTS communes_agregat_dept_idx ON communes_agregat (code_departement);
#     CREATE INDEX IF NOT EXISTS communes_agregat_prix_idx ON communes_agregat (prix_median_m2);
#   "
