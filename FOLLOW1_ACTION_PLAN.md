# Follow-up 1 — Plan d'action détaillé
## Compte-rendu du 10/04/2026 → Actions techniques

---

## Résumé des retours et décisions prises

| # | Retour jury | Décision | Priorité |
|---|------------|----------|----------|
| 1 | Données plus fraîches → **ImmoData** | Ajouter source ImmoData API | 🔴 Haute |
| 2 | **DBT** à la place de Spark + **data warehouse** | Migrer vers BigQuery + DBT | 🔴 Haute |
| 3 | **Analyse émotionnelle** | Sentiment analysis sur avis quartiers | 🟡 Moyenne |
| 4 | **Qualité données** : tests unitaires à chaque étape | DBT tests sur chaque modèle | 🔴 Haute |
| 5 | **Alerting** jobs/doublons → ludovicbetam@gmail.com | BigQuery alerts + email | 🟡 Moyenne |
| 6 | **Justifier** tous les choix techniques | Section ADR dans README | 🟡 Moyenne |
| 7 | PostgreSQL PostGIS → **alternative si trop de données** | Documenter BigQuery GIS | 🟢 Basse |
| 8 | **Parcours utilisateur** bien défini | Wireflow dans README | 🟡 Moyenne |
| 9 | **Dashboard** macro → spécifique | Restructurer onglet Statistiques | 🟡 Moyenne |
| 10 | **Migrer vers GCP** | Migration complète Azure → GCP | 🔴 Haute |

---

## 🏗️ Nouvelle Architecture GCP

### Avant (Azure)
```
Python ingestion → Azure ADLS Gen2 → Databricks PySpark → PostgreSQL → Go API → React
```

### Après (GCP)
```
Python ingestion → Google Cloud Storage → BigQuery + DBT → Cloud SQL (PostGIS) → Cloud Run (Go) → Cloud Run (React)
```

### Schéma complet

```
┌──────────────────────────────────────────────────────────────────────┐
│                          DATA SOURCES                                │
│  DVF  │  ImmoData API  │  INSEE  │  ADEME DPE  │  OSM  │  GTFS IDFM │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │  Python scripts (ingestion/)
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│           GOOGLE CLOUD STORAGE — homepedia-bucket                    │
│   /bronze (raw Parquet)   /silver (validé)   /gold (agrégé IDF)     │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │  BigQuery external tables
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│              BIGQUERY — homepedia dataset                            │
│   bronze_*   silver_*   gold_*   (tables natives BQ)               │
│   Transformations via DBT (SQL pur, no Spark)                       │
│   DBT Tests : not_null, unique, range checks, custom                │
└──────────┬─────────────────────────────────────────────┬─────────────┘
           │  export via Dataflow / script Python         │
           ▼                                             ▼
┌─────────────────────────┐               ┌─────────────────────────────┐
│  Cloud SQL (PostgreSQL  │               │   ChromaDB sur Cloud Run   │
│  17 + PostGIS)          │               │   Embeddings RAG            │
│  → si >50M lignes :     │               └─────────────────────────────┘
│    BigQuery GIS natif   │
└──────────┬──────────────┘
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│             CLOUD RUN — Go 1.22 (Gin) + Redis Memorystore            │
│  /api/communes  /api/transactions  /api/agregat                     │
│  /api/rag/query                                                     │
└────────────────────────────────┬─────────────────────────────────────┘
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│               CLOUD RUN — React 18 + TypeScript                      │
│   CesiumJS · MapLibre GL · Recharts · Chat RAG                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 1. Migration Azure → GCP

### Étape 1.1 — Setup projet GCP

```bash
# Installer gcloud CLI
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
gcloud init

# Créer le projet
gcloud projects create homepedia-idf --name="HomePedia IDF"
gcloud config set project homepedia-idf

# Activer les APIs nécessaires
gcloud services enable \
  storage.googleapis.com \
  bigquery.googleapis.com \
  sqladmin.googleapis.com \
  run.googleapis.com \
  containerregistry.googleapis.com \
  cloudbuild.googleapis.com \
  monitoring.googleapis.com \
  cloudscheduler.googleapis.com
```

### Étape 1.2 — Créer le bucket GCS

```bash
# Bucket équivalent à Azure ADLS Gen2
gsutil mb -l europe-west1 -c STANDARD gs://homepedia-datalake

# Créer la structure medallion
gsutil mkdir gs://homepedia-datalake/bronze/
gsutil mkdir gs://homepedia-datalake/silver/
gsutil mkdir gs://homepedia-datalake/gold/
```

### Étape 1.3 — Migrer les données Parquet Azure → GCS

Script à créer : `ingestion/migrate_azure_to_gcp.py`
```python
"""
Copie tous les fichiers Parquet d'Azure ADLS Gen2 vers Google Cloud Storage.
Utilise azure-storage-blob + google-cloud-storage.
"""
from azure.storage.blob import BlobServiceClient
from google.cloud import storage

AZURE_ACCOUNT = "homepediadatalake"
AZURE_KEY = os.getenv("ADLS_ACCOUNT_KEY")
GCS_BUCKET = "homepedia-datalake"

azure_client = BlobServiceClient(
    f"https://{AZURE_ACCOUNT}.blob.core.windows.net",
    credential=AZURE_KEY
)
gcs_client = storage.Client()
bucket = gcs_client.bucket(GCS_BUCKET)

for container in ["bronze", "silver", "gold"]:
    for blob in azure_client.get_container_client(container).list_blobs():
        data = azure_client.get_container_client(container).download_blob(blob.name).readall()
        gcs_blob = bucket.blob(f"{container}/{blob.name}")
        gcs_blob.upload_from_string(data)
        print(f"  ✅ {container}/{blob.name}")
```

### Étape 1.4 — Créer les tables BigQuery

```sql
-- Dataset principal
CREATE SCHEMA IF NOT EXISTS `homepedia-idf.homepedia`
OPTIONS (location = 'EU');

-- Tables externes pointant vers GCS Parquet
CREATE OR REPLACE EXTERNAL TABLE `homepedia-idf.homepedia.bronze_dvf`
OPTIONS (
  format = 'PARQUET',
  uris = ['gs://homepedia-datalake/bronze/dvf/*.parquet']
);

CREATE OR REPLACE EXTERNAL TABLE `homepedia-idf.homepedia.bronze_dpe`
OPTIONS (
  format = 'PARQUET',
  uris = ['gs://homepedia-datalake/bronze/dpe/*.parquet']
);

CREATE OR REPLACE EXTERNAL TABLE `homepedia-idf.homepedia.bronze_gtfs`
OPTIONS (
  format = 'PARQUET',
  uris = ['gs://homepedia-datalake/bronze/gtfs/*.parquet']
);
```

### Étape 1.5 — Cloud SQL PostgreSQL + PostGIS

```bash
# Créer l'instance Cloud SQL
gcloud sql instances create homepedia-pg \
  --database-version=POSTGRES_17 \
  --tier=db-g1-small \
  --region=europe-west1 \
  --storage-type=SSD \
  --storage-size=20GB

# Créer la DB et activer PostGIS
gcloud sql databases create homepedia --instance=homepedia-pg
gcloud sql users create homepedia --instance=homepedia-pg --password=homepedia123

# Activer PostGIS via psql
gcloud sql connect homepedia-pg --user=homepedia --database=homepedia
# → CREATE EXTENSION postgis; CREATE EXTENSION postgis_topology;
```

> **Si les données dépassent 50M lignes** : remplacer Cloud SQL par **BigQuery GIS** natif
> (`ST_GEOGPOINT`, `ST_WITHIN`, `ST_DISTANCE` disponibles nativement dans BigQuery).

---

## 2. DBT + BigQuery (remplace Databricks PySpark)

### Pourquoi DBT ?
- **SQL pur** : lisible, versionnable, pas de dépendance Spark
- **Tests intégrés** : `not_null`, `unique`, `accepted_values`, custom
- **Lineage** : graphe de dépendances automatique
- **Documentation** auto-générée
- **Coût** : DBT Core = gratuit, BigQuery = pay-per-query (~$5/TB)

### Choix vs Spark/Databricks

| Critère | Databricks PySpark | BigQuery + DBT |
|---------|-------------------|----------------|
| Coût | ~€50/mois (cluster) | €0 à faible volume |
| Langage | Python + Spark | SQL pur |
| Tests données | Manuel | Intégré DBT |
| Lineage | Manuel | Auto DBT |
| Courbe appentissage | Élevée | Faible (SQL) |
| Scale | Très grand volume | Grand volume (pétaoctets) |

### Installation

```bash
pip install dbt-bigquery

dbt init homepedia_dbt
cd homepedia_dbt
```

### Structure projet DBT

```
homepedia_dbt/
├── profiles.yml           # connexion BigQuery
├── dbt_project.yml
├── models/
│   ├── bronze/            # données brutes nettoyées
│   │   ├── bronze_dvf.sql
│   │   ├── bronze_dpe.sql
│   │   └── bronze_gtfs.sql
│   ├── silver/            # données validées + jointures
│   │   ├── silver_transactions.sql
│   │   ├── silver_communes.sql
│   │   └── silver_dpe_enrichi.sql
│   └── gold/              # agrégats finaux
│       ├── gold_communes_agregat.sql
│       └── gold_scores_investissement.sql
└── tests/
    ├── bronze_dvf_no_null_price.sql
    ├── silver_prix_coherent.sql
    └── gold_communes_complete.sql
```

### Exemple modèle DBT silver (remplace notebook Databricks)

```sql
-- models/silver/silver_transactions.sql
{{ config(materialized='table') }}

SELECT
    id_mutation,
    PARSE_DATE('%Y-%m-%d', date_mutation)      AS date_mutation,
    nature_mutation,
    CAST(valeur_fonciere AS FLOAT64)           AS valeur_fonciere,
    type_local,
    CAST(surface_reelle_bati AS FLOAT64)       AS surface_reelle_bati,
    nombre_pieces,
    code_commune,
    CAST(longitude AS FLOAT64)                 AS longitude,
    CAST(latitude AS FLOAT64)                  AS latitude,
    classe_energie,
    EXTRACT(YEAR FROM PARSE_DATE('%Y-%m-%d', date_mutation)) AS source_annee

FROM {{ ref('bronze_dvf') }}

WHERE
    valeur_fonciere IS NOT NULL
    AND valeur_fonciere > 10000
    AND surface_reelle_bati > 9
    AND type_local IN ('Appartement', 'Maison', 'Studio')
    AND code_commune LIKE '7%'  -- IDF seulement
    OR code_commune LIKE '9%'
```

---

## 3. Qualité des données (DBT Tests)

### Tests automatiques à chaque couche

```yaml
# models/schema.yml

version: 2

models:
  - name: bronze_dvf
    columns:
      - name: id_mutation
        tests:
          - not_null
          - unique
      - name: valeur_fonciere
        tests:
          - not_null:
              where: "nature_mutation = 'Vente'"

  - name: silver_transactions
    columns:
      - name: valeur_fonciere
        tests:
          - not_null
          - dbt_utils.expression_is_true:
              expression: ">= 10000 AND valeur_fonciere <= 100000000"
      - name: classe_energie
        tests:
          - accepted_values:
              values: ['A', 'B', 'C', 'D', 'E', 'F', 'G']
      - name: code_commune
        tests:
          - not_null
          - relationships:
              to: ref('silver_communes')
              field: code_commune

  - name: gold_communes_agregat
    columns:
      - name: code_commune
        tests:
          - not_null
          - unique
      - name: prix_median_m2
        tests:
          - dbt_utils.expression_is_true:
              expression: "> 500 AND prix_median_m2 < 30000"
              config:
                severity: warn
```

### Test custom — doublons DVF

```sql
-- tests/bronze_dvf_no_duplicates.sql
-- Retourne les lignes si des doublons existent → fait échouer le job

SELECT
    id_mutation,
    date_mutation,
    COUNT(*) AS nb
FROM {{ ref('bronze_dvf') }}
GROUP BY id_mutation, date_mutation
HAVING COUNT(*) > 1
```

### Lancer les tests

```bash
dbt test --select bronze   # tests couche bronze uniquement
dbt test --select silver   # tests silver
dbt test                   # tous les tests
dbt build                  # run + test en une commande
```

---

## 4. Alerting (BigQuery Scheduled Queries → Email)

### Configuration alertes BigQuery

```bash
# Créer une alerte Monitoring si un job DBT échoue
gcloud alpha monitoring policies create \
  --notification-channels="email:ludovicbetam@gmail.com" \
  --display-name="HomePedia DBT Pipeline Alert" \
  --condition-display-name="Job DBT échoué" \
  --condition-filter='resource.type="bigquery_project" metric.type="bigquery.googleapis.com/job/num_in_flight" metric.labels.job_type="QUERY" metric.labels.status="FAILED"'
```

### Script d'alerting post-DBT (`ingestion/dbt_alert.py`)

```python
"""
À appeler après `dbt build` dans le pipeline CI.
Envoie un email si des tests ont échoué.
"""
import subprocess, smtplib, json
from email.mime.text import MIMEText

result = subprocess.run(
    ["dbt", "build", "--output", "json"],
    capture_output=True, text=True
)
data = json.loads(result.stdout)
failures = [r for r in data.get("results", []) if r["status"] == "fail"]

if failures:
    msg = MIMEText(
        f"⚠️ {len(failures)} test(s) DBT ont échoué :\n\n" +
        "\n".join(f"- {r['unique_id']}: {r.get('message', '')}" for r in failures)
    )
    msg["Subject"] = f"[HomePedia] ⚠️ {len(failures)} test(s) DBT échoués"
    msg["From"] = "homepedia-alerts@gmail.com"
    msg["To"] = "ludovicbetam@gmail.com"
    with smtplib.SMTP("smtp.gmail.com", 587) as s:
        s.starttls()
        s.login("homepedia-alerts@gmail.com", GMAIL_APP_PASSWORD)
        s.send_message(msg)
    print(f"🔔 Alerte envoyée : {len(failures)} échec(s)")
else:
    print("✅ Tous les tests passent")
```

---

## 5. ImmoData — Données plus fraîches

### Pourquoi ImmoData ?
- DVF a un décalage de 6 mois à 1 an
- ImmoData propose des données en quasi-temps réel (annonces + transactions récentes)
- Version gratuite : 1 000 requêtes/mois (suffisant pour le projet)

### Intégration

```python
# ingestion/immodata/fetch_recent.py

import requests, os

IMMODATA_API_KEY = os.getenv("IMMODATA_API_KEY")
BASE = "https://api.immodata.net/v2"

def fetch_recent_sales(code_commune: str, limit: int = 100) -> list[dict]:
    """Récupère les ventes récentes (< 6 mois) pour une commune."""
    resp = requests.get(
        f"{BASE}/transactions",
        headers={"Authorization": f"Bearer {IMMODATA_API_KEY}"},
        params={
            "commune": code_commune,
            "limit": limit,
            "sort": "-date_vente",
            "type": "vente",
        }
    )
    resp.raise_for_status()
    return resp.json()["data"]
```

### Justification du choix

> **DVF (gratuit, exhaustif, historique 2019-2024)** sert de base historique.
> **ImmoData (API, données fraîches)** complète avec les 6 derniers mois.
> Les deux sont chargés dans BigQuery, le modèle DBT `silver_transactions` fait la fusion avec déduplication sur `id_mutation`.

---

## 6. Analyse émotionnelle (Sentiment Analysis sur avis quartiers)

### Sources de données d'avis
- Commentaires utilisateurs (champ libre si on ajoute une feature)
- Descriptions de quartiers issues de Wikipedia/OpenStreetMap
- Commentaires Google Places API (voisinage)

### Architecture

```
Textes avis → Google Natural Language API → scores sentiment → BigQuery → Dashboard
```

### Implémentation

```python
# ingestion/sentiment/analyze_quartiers.py

from google.cloud import language_v2

client = language_v2.LanguageServiceClient()

def analyze_sentiment(text: str) -> dict:
    doc = language_v2.Document(
        content=text,
        type_=language_v2.Document.Type.PLAIN_TEXT,
        language_code="fr"
    )
    response = client.analyze_sentiment(request={"document": doc})
    sentiment = response.document_sentiment
    return {
        "score": sentiment.score,       # -1.0 (négatif) → +1.0 (positif)
        "magnitude": sentiment.magnitude  # intensité
    }
```

### Utilisation dans le RAG
Les scores de sentiment par quartier enrichissent les descriptions dans ChromaDB : "Le quartier Montrouge a un sentiment positif moyen de 0.6 (commercial, bien desservi)".

---

## 7. Parcours Utilisateur

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Accueil     │ →  │  Carte IDF   │ →  │  Commune     │ →  │  Bâtiment    │
│  KPIs macro  │    │  Choroplèthe │    │  Panel droit │    │  Détail 3D   │
│  Top 5 zones │    │  Filtres     │    │  Stats Gold  │    │  Transactions│
│  Tendances   │    │  Recherche   │    │  Équipements │    │  DPE         │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
                                                │
                                                ▼
                                    ┌──────────────────┐
                                    │  Chat RAG (IA)   │
                                    │  Questions libres │
                                    │  sur les données  │
                                    └──────────────────┘
```

**User Stories principales :**
1. Acheteur potentiel cherche une commune abordable dans le 92 → Carte + filtre prix
2. Investisseur compare 3 communes → Dashboard statistiques + export
3. Analyste interroge les données → Chat RAG
4. Visiteur découvre une adresse précise → Recherche → Vue 3D bâtiment

---

## 8. Dashboard Macro → Spécifique

### Niveau 1 — Macro (onglet Statistiques actuel)
- Évolution prix IDF 2019-2024
- Distribution DPE par département
- Top 10 communes par prix/transaction/volume
- Heatmap densité transactions

### Niveau 2 — Spécifique (à développer dans le panel commune)
- Évolution des prix sur 5 ans pour la commune sélectionnée
- Comparaison commune vs département vs IDF
- Profil acheteur type (surface, nb pièces, type bien)
- Score investissement expliqué (quels critères l'impactent)

---

## 9. Justification des choix techniques

| Choix | Justification |
|-------|---------------|
| **BigQuery** | Data warehouse serverless, pay-per-query, nativement intégré à GCP, GIS natif |
| **DBT** | SQL pur versionnable, tests intégrés, documentation auto, standard industrie |
| **GCS** | Équivalent S3/ADLS, intégration native BigQuery external tables, coût faible |
| **Cloud Run** | Serverless, scale-to-zero, déploiement simple via Docker, pas de k8s |
| **Cloud SQL + PostGIS** | Géospatial requis pour ST_WITHIN, ST_DISTANCE ; alternative : BigQuery GIS si >50M lignes |
| **CesiumJS** | Seul framework open source supportant 3D Tiles OSM + terrain GEBCO |
| **Go (Gin)** | Performance élevée pour API géospatiale, typage fort, Docker image légère |
| **ChromaDB** | Vector store simple, compatible sentence-transformers, open source |
| **ImmoData** | Données fraîches < 6 mois vs DVF (décalage 1 an) |

---

## 📋 Répartition des tâches

### Christophe
- [ ] Setup projet GCP (services, bucket, BigQuery dataset)
- [ ] Migration données Azure → GCS (`migrate_azure_to_gcp.py`)
- [ ] DBT setup + modèles bronze/silver/gold
- [ ] DBT tests données (schema.yml + tests custom)
- [ ] Cloud Run déploiement backend + frontend
- [ ] Cloud SQL PostgreSQL + PostGIS
- [ ] Alerting email (dbt_alert.py)
- [ ] Dashboard niveau 2 (panel commune)

### Ludo
- [ ] Valider modèles DBT silver (remplace notebooks Databricks)
- [ ] Modèle DBT gold `gold_communes_agregat.sql` (remplace le notebook Spark)
- [ ] Configurer DBT tests sur couche gold
- [ ] BigQuery scheduled query pour détection doublons

### Gaspard
- [ ] RAG depuis BigQuery (replace la source PostgreSQL locale)
- [ ] Analyse émotionnelle Google Natural Language API
- [ ] Enrichir descriptions ChromaDB avec scores sentiment

---

## 🗓️ Planning

| Semaine | Objectif |
|---------|----------|
| S1 (14-18/04) | Setup GCP + migration données Azure → GCS |
| S2 (21-25/04) | DBT bronze→silver + tests qualité données |
| S3 (28/04-02/05) | DBT gold + Cloud SQL + déploiement Cloud Run |
| S4 (05-09/05) | ImmoData + Sentiment + Dashboard niveau 2 |
| S5 (12-16/05) | Finalisation + présentation |
