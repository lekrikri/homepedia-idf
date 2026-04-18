"""
ingestion/setup_bigquery.py
============================
Crée les tables BigQuery qui lisent les fichiers Parquet depuis GCS.

C'est ce qu'on appelle des "External Tables" (tables externes) :
BigQuery ne copie pas les données, il les lit directement depuis GCS.
C'est gratuit et instantané !

Une fois ces tables créées, DBT peut faire ses transformations SQL dessus.

Lancer :
    python3 ingestion/setup_bigquery.py
"""

from google.cloud import bigquery

PROJECT  = "homepedia-493013"
LOCATION = "EU"
BUCKET   = "homepedia-datalake"

client = bigquery.Client(project=PROJECT)

# ──────────────────────────────────────────────────────────────
# Étape 1 : Créer les datasets si inexistants
# ──────────────────────────────────────────────────────────────

DATASETS = ["homepedia_dev_bronze", "homepedia_dev_silver", "homepedia_dev_gold"]

for ds_id in DATASETS:
    ds = bigquery.Dataset(f"{PROJECT}.{ds_id}")
    ds.location = LOCATION
    ds = client.create_dataset(ds, exists_ok=True)
    print(f"✅ Dataset : {ds_id}")

# ──────────────────────────────────────────────────────────────
# Étape 2 : Table externe DVF (lit tous les Parquet bronze/dvf/)
# ──────────────────────────────────────────────────────────────

print("\n📊 Création table externe : bronze_dvf_transactions")

table_id = f"{PROJECT}.homepedia_dev_bronze.dvf_transactions"

# Supprimer si elle existe déjà (pour pouvoir relancer le script)
client.delete_table(table_id, not_found_ok=True)

external_config = bigquery.ExternalConfig("PARQUET")
external_config.source_uris = [f"gs://{BUCKET}/bronze/dvf/*"]
# Hive partitioning = BigQuery comprend automatiquement annee= et dept=
external_config.hive_partitioning = bigquery.HivePartitioningOptions()
external_config.hive_partitioning.mode = "AUTO"
external_config.hive_partitioning.source_uri_prefix = f"gs://{BUCKET}/bronze/dvf/"

table = bigquery.Table(table_id)
table.external_data_configuration = external_config
client.create_table(table)
print(f"  ✅ {table_id}")

# ──────────────────────────────────────────────────────────────
# Étape 3 : Vérification — compter les lignes
# ──────────────────────────────────────────────────────────────

print("\n🔍 Vérification des données...")

query = f"""
SELECT
    annee,
    code_departement,
    COUNT(*) AS nb_transactions,
    ROUND(AVG(CAST(valeur_fonciere AS FLOAT64) / NULLIF(CAST(surface_reelle_bati AS FLOAT64), 0)), 0) AS prix_m2_moyen
FROM `{table_id}`
WHERE valeur_fonciere IS NOT NULL
GROUP BY annee, code_departement
ORDER BY annee, code_departement
"""

print(f"\n{'Année':<8} {'Dept':<6} {'Transactions':>15} {'Prix moy/m²':>12}")
print("-" * 45)
for row in client.query(query).result():
    prix = f"{int(row.prix_m2_moyen):,} €" if row.prix_m2_moyen else "—"
    print(f"{row.annee:<8} {row.code_departement:<6} {row.nb_transactions:>15,} {prix:>12}")

# Total
total_query = f"SELECT COUNT(*) as total FROM `{table_id}`"
total = list(client.query(total_query).result())[0].total
print(f"\n{'TOTAL':<8} {'IDF':<6} {total:>15,}")
print(f"\n✅ Table prête pour DBT : `{table_id}`")

# ──────────────────────────────────────────────────────────────
# Étape 4 : Table externe DPE ADEME
# ──────────────────────────────────────────────────────────────

print("\n📊 Création table externe : bronze_dpe_ademe")

dpe_table_id = f"{PROJECT}.homepedia_dev_bronze.dpe_ademe"
client.delete_table(dpe_table_id, not_found_ok=True)

dpe_config = bigquery.ExternalConfig("PARQUET")
dpe_config.source_uris = [f"gs://{BUCKET}/bronze/dpe/*"]
dpe_config.hive_partitioning = bigquery.HivePartitioningOptions()
dpe_config.hive_partitioning.mode = "AUTO"
dpe_config.hive_partitioning.source_uri_prefix = f"gs://{BUCKET}/bronze/dpe/"

dpe_table = bigquery.Table(dpe_table_id)
dpe_table.external_data_configuration = dpe_config
client.create_table(dpe_table)
print(f"  ✅ {dpe_table_id}")

# Vérification DPE
dpe_check = f"SELECT COUNT(*) as total, COUNT(DISTINCT code_departement) as depts FROM `{dpe_table_id}`"
row = list(client.query(dpe_check).result())[0]
print(f"  → {row.total:,} DPE | {row.depts} département(s)")
