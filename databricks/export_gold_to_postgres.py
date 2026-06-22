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
    # Loyers CLAMEUR (migration 004)
    F.col("loyer_median_m2"),
    F.col("zone_tendue"),
    F.col("rendement_locatif_brut"),
    # Sécurité SSMSI (migration 005)
    F.col("taux_cambriolages"),
    F.col("taux_vols_violence"),
    F.col("score_securite"),
    # IPS Éducation (migration 005)
    F.col("ips_moyen"),
    F.col("ips_median"),
    F.col("nb_ecoles"),
    F.col("pct_ecoles_favorisees"),
    # Énergie ENEDIS/GRDF (migration 005)
    F.col("conso_elec_mwh"),
    F.col("conso_gaz_mwh"),
    F.col("conso_elec_par_logement"),
    F.col("conso_gaz_par_logement"),
    # Scores composites (migration 005)
    F.col("score_qualite_vie"),
    F.col("score_investissement"),
    F.col("score_stabilite"),
)

# Les colonnes enrichies (loyers, sécurité, IPS, énergie, scores) sont ajoutées
# par les notebooks bronze_to_silver via MERGE INTO gold. Si elles n'existent pas
# encore dans Gold, on les remplace par NULL pour ne pas bloquer l'export.
OPTIONAL_COLS = [
    "loyer_median_m2", "zone_tendue", "rendement_locatif_brut",
    "taux_cambriolages", "taux_vols_violence", "score_securite",
    "ips_moyen", "ips_median", "nb_ecoles", "pct_ecoles_favorisees",
    "conso_elec_mwh", "conso_gaz_mwh", "conso_elec_par_logement", "conso_gaz_par_logement",
    "score_qualite_vie", "score_investissement", "score_stabilite",
]
gold_cols = set(df_gold.columns)
for col in OPTIONAL_COLS:
    if col not in gold_cols:
        df_gold = df_gold.withColumn(col, F.lit(None))
        print(f"  ⚠️  Colonne absente du Gold, sera NULL : {col}")

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
df_check.select(
    "code_commune", "city", "prix_median_m2", "nb_transactions",
    "score_securite", "ips_moyen", "conso_elec_par_logement",
    "score_qualite_vie", "score_investissement",
).show(10)

# ── Note importante ────────────────────────────────────────────────────────────
# Le mode "overwrite" Spark recrée la table sans les contraintes FK et index.
# Après l'export, re-exécuter en local :
#
#   psql -h <host> -U homepedia -d homepedia -f backend/migrations/005_new_indicators.sql
#
# (idempotent grâce aux IF NOT EXISTS — recrée seulement les index manquants)

# ── Note importante ────────────────────────────────────────────────────────────
# Le mode "overwrite" Spark recrée la table sans les contraintes FK et index.
# Après l'export, re-exécuter en local :
#
#   docker exec homepedia_postgres psql -U homepedia -d homepedia -c "
#     CREATE INDEX IF NOT EXISTS communes_agregat_dept_idx ON communes_agregat (code_departement);
#     CREATE INDEX IF NOT EXISTS communes_agregat_prix_idx ON communes_agregat (prix_median_m2);
#   "
