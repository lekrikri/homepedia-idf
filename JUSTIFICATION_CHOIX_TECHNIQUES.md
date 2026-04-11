# Justification des choix techniques — HomePedia IDF

> Document de référence pour la soutenance jury.
> Chaque choix est justifié par rapport aux alternatives envisagées.

---

## 1. PostgreSQL + PostGIS — Base de données opérationnelle

### Choix retenu
PostgreSQL 16 avec l'extension **PostGIS** pour les données géospatiales.  
En production : **Supabase** (PostgreSQL managé, gratuit jusqu'à 500 MB).

### Pourquoi PostgreSQL ?
| Critère | PostgreSQL + PostGIS | MySQL | MongoDB |
|---|---|---|---|
| Requêtes géospatiales | ✅ ST_Distance, ST_Within, index GIST | ❌ Limité | ⚠️ GeoJSON basique |
| Données structurées (DVF) | ✅ Schéma strict, intégrité | ✅ | ❌ Schéma libre inadapté |
| Coût | ✅ Open source | ✅ | ⚠️ Atlas payant au-delà de 512MB |
| Maturité | ✅ 30 ans, très stable | ✅ | ✅ |
| Compatibilité DBT | ✅ Natif | ✅ | ❌ |

**PostGIS est indispensable** : les requêtes de proximité (trouver les transactions dans un rayon de 500m, calculer des centroïdes de communes) nécessitent des index géospatiaux que les bases classiques ne supportent pas.

### Si le volume de données explose (> 10M transactions)
PostgreSQL reste pertinent jusqu'à ~50M lignes avec un tuning correct (partitionnement, index partiels). Au-delà, les alternatives seraient :

| Solution | Cas d'usage | Coût |
|---|---|---|
| **TimescaleDB** | Séries temporelles (prix/mois) | Gratuit (extension PG) |
| **BigQuery** | Analytics massives (> 100M lignes) | Pay-per-query, ~5€/TB |
| **ClickHouse** | OLAP ultra-rapide | Open source, auto-hébergé |
| **Snowflake** | Entrepôt entreprise | Payant, crédit initial |

**Notre position** : 50 000 transactions IDF 2020-2024 = PostgreSQL largement suffisant. Si on passe à la France entière (5M transactions), on partitionne par département dans PostgreSQL.

---

## 2. DBT — Transformations de données (Bronze → Silver → Gold)

### Choix retenu
**DBT (Data Build Tool)** avec adaptateur BigQuery, remplaçant les notebooks PySpark Databricks.

### Pourquoi DBT plutôt que Spark ?

| Critère | Spark / PySpark | **DBT + BigQuery** |
|---|---|---|
| Langage | Python + API Spark complexe | **SQL pur** — lisible par tous |
| Infrastructure | Cluster Databricks (€€€/heure) | **BigQuery serverless** (1TB/mois gratuit) |
| Tests qualité | Manuels, à coder | **Intégrés** dans schema.yml |
| Documentation | À maintenir séparément | **Auto-générée** (`dbt docs`) |
| Versioning | Notebooks difficiles à versionner | **SQL dans Git** |
| Debugging | Logs Spark opaques | **SQL lisible + lineage graph** |
| Courbe d'apprentissage | Steep (API Spark, DataFrames) | **Faible** (SQL + YAML) |

**Conclusion** : Pour un volume IDF (50k-5M lignes), Spark est disproportionné. DBT génère le même résultat avec moins de complexité, moins de coût, et plus de testabilité.

### Architecture DBT HomePedia
```
bronze_transactions (vue BigQuery, données brutes DVF)
        ↓
silver_transactions (table incrémentale, nettoyée + dédupliquée)
        ↓
gold_communes_agregat (table complète, 1 ligne/commune)
        ↓
Supabase PostgreSQL (exporté pour l'API Go)
```

---

## 3. BigQuery — Data Warehouse

### Choix retenu
**Google BigQuery** comme entrepôt de données pour DBT.

### Pourquoi BigQuery ?
- **Free tier généreux** : 1 TB de requêtes/mois + 10 GB de stockage gratuits
- **Serverless** : pas de cluster à gérer (contrairement à Redshift ou Snowflake)
- **Intégration GCS** : lecture directe des fichiers Parquet depuis GCS sans import
- **DBT natif** : adaptateur officiel `dbt-bigquery`

### Pourquoi pas Redshift (comme suggéré par le jury) ?
| Critère | BigQuery | Redshift |
|---|---|---|
| Coût minimum | **0€** (free tier) | ~150€/mois (nœud dc2.large minimum) |
| Setup | **Immédiat** | VPC + cluster à configurer |
| Serverless | ✅ | ❌ (Serverless en option payante) |
| Écosystème | GCP (notre stack) | AWS (stack différente) |

**Redshift serait pertinent** si le projet était déjà dans un contexte AWS (Kinesis, S3, EMR). Ici, notre stack est GCP (Cloud Run, GCS, BigQuery) — la cohérence de l'écosystème justifie BigQuery.

---

## 4. Go — Backend API

### Choix retenu
**Go (Gin)** pour l'API REST exposant les données au frontend.

### Pourquoi Go ?
| Critère | Go | Node.js | Python (FastAPI) | Java (Spring) |
|---|---|---|---|---|
| Performance | ✅ Excellent | ✅ Bon | ⚠️ Moyen | ✅ Bon |
| Binaire statique (Docker) | ✅ ~10 MB | ❌ 200+ MB avec node_modules | ❌ 300+ MB | ❌ 400+ MB |
| Cold start Cloud Run | ✅ < 100ms | ⚠️ ~500ms | ⚠️ ~800ms | ❌ 2-3s |
| Concurrence | ✅ Goroutines | ⚠️ Event loop | ❌ GIL | ✅ Threads |
| Typage | ✅ Statique | ❌ Dynamique | ⚠️ Optionnel | ✅ Statique |

**Point clé Cloud Run** : Go génère un binaire statique de ~10 MB. L'image Docker finale fait ~20 MB contre 300+ MB pour Python ou Node. Sur Cloud Run (facturation à la milliseconde), un cold start plus rapide = moins de latence perçue par l'utilisateur.

---

## 5. Azure ADLS Gen2 — Stockage des données brutes

### Choix retenu
**Azure Data Lake Storage Gen2** pour les fichiers Parquet DVF et DPE.

### Pourquoi Azure plutôt que GCS ?
- **Databricks** est nativement intégré à Azure (même compte Microsoft)
- **Contrainte pédagogique** : les crédits Azure Epitech étaient disponibles
- En production pure GCP, on migrerait vers GCS (`gs://homepedia-datalake/`)

### Hiérarchie des zones
```
azure://homepedia-datalake/
├── bronze/dvf/          ← DVF brut (Parquet, non modifié)
├── bronze/dpe/          ← DPE ADEME brut
├── silver/transactions/ ← Nettoyé par DBT
└── gold/communes_agregat/ ← Prêt pour PostgreSQL
```

---

## 6. React + CesiumJS — Frontend cartographique

### Choix retenu
**React** avec **CesiumJS** pour la carte 3D et **Mapbox GL** pour la carte 2D.

### Pourquoi CesiumJS ?
- **Visualisation 3D des bâtiments** : CesiumJS supporte le format 3D Tiles (bâtiments OSM)
- **Open source** : contrairement à Google Maps 3D (payant)
- Alternative envisagée : **Deck.gl** (Uber) — plus moderne mais moins de doc sur les données immobilières

### Pourquoi React ?
- Ecosystème mature pour les dashboards de données (recharts, react-map-gl)
- Compatibilité avec CesiumJS via `resium`
- Vite pour un build rapide

---

## 7. Supabase — PostgreSQL de production

### Choix retenu
**Supabase** comme hébergeur PostgreSQL managé pour la production.

### Pourquoi Supabase plutôt que Cloud SQL (GCP) ?
| Critère | Supabase | Cloud SQL (GCP) | RDS (AWS) |
|---|---|---|---|
| Coût minimum | **0€** (500 MB gratuits) | ~50€/mois | ~25€/mois |
| Setup | **2 minutes** | 10-15 minutes | 10-15 minutes |
| PostGIS | ✅ Inclus | ✅ Extension | ✅ Extension |
| Backups auto | ✅ 7 jours | ✅ | ✅ |
| Dashboard | ✅ Studio intégré | ❌ GCP Console | ❌ |

**Limites Supabase gratuit** : 500 MB de données, 2 CPU partagés, pause après 1 semaine d'inactivité. Suffisant pour une démo et une soutenance.

---

## 8. GCP Cloud Run — Déploiement production

### Choix retenu
**Cloud Run** pour backend Go et frontend React (conteneurs Docker).

### Pourquoi Cloud Run ?
| Critère | Cloud Run | GKE (Kubernetes) | VM (Compute Engine) |
|---|---|---|---|
| Coût minimum | **0€** (2M req/mois gratuits) | ~70€/mois | ~20€/mois |
| Scaling auto | ✅ 0 → N instances | ✅ | ❌ Manuel |
| Gestion infra | **Aucune** | Complexe (k8s) | OS à maintenir |
| Cold start | ✅ ~100ms (Go) | ✅ | N/A |
| CI/CD | ✅ Natif GitHub Actions | ✅ | ⚠️ |

**Scale-to-zero** : Cloud Run descend à 0 instance quand personne n'utilise l'app → coût = 0€ en dehors des démos.

---

## 9. Résumé des choix — Pour la soutenance

```
Données brutes → Azure ADLS Gen2 (contrainte pédagogique / Databricks)
                        ↓
Transformations → DBT + BigQuery (SQL pur, gratuit, testé)
                        ↓
Base prod → Supabase PostgreSQL + PostGIS (gratuit, géospatial)
                        ↓
API → Go / Gin (binaire léger, Cloud Run optimisé)
                        ↓
Frontend → React + CesiumJS (carte 3D, open source)
                        ↓
Déploiement → GCP Cloud Run (serverless, scale-to-zero, gratuit)
                        ↓
CI/CD → GitHub Actions (tests auto + déploiement sur push)
```

### Cohérence des choix
Tous les choix privilégient **le gratuit** (free tiers) et **la simplicité opérationnelle** pour un projet académique, sans sacrifier les bonnes pratiques (tests, CI/CD, architecture en médaillon).

Si HomePedia passait en production commerciale avec 100k utilisateurs :
- Supabase → **Cloud SQL** (SLA, performance garantie)
- Cloud Run → **GKE** (plus de contrôle)
- DBT free → **DBT Cloud** (scheduling, alerting avancé)
- BigQuery → **BigQuery Enterprise** (réservations de slots)
