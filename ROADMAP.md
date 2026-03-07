# HomePedia IDF — Roadmap Technique Complète
> **T-DAT-902** · Big Data Housing · Epitech Paris
> Issu du projet ITP "Jumeau Numérique de l'Immobilier Francilien" (validation 73/100)

---

## Vision Produit

**HomePedia IDF** est une application web de visualisation 3D du marché immobilier en France,
avec focus sur l'Île-de-France. L'utilisateur navigue fluidement depuis la vue régionale
jusqu'au bâtiment individuel (région → département → commune → bâtiment), chaque bâtiment
étant rendu en 3D à partir des données OSM et du Cadastre IGN.

Un assistant conversationnel intégré (RAG) permet d'interroger les données en langage naturel :
prix au m², comparaison de quartiers, impact des transports, tendances par période.

> Score de validation ITP : **73/100** · MVP estimé : **6-9 mois** · Complexité : **high**
> Différenciateurs : visualisation 3D bâtiment par bâtiment · AI conversationnelle · pipeline open data complet

---

## Architecture Globale (Stack Cloud)

```
┌──────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES                             │
│   DVF  │  INSEE  │  ADEME DPE  │  OSM/Cadastre IGN  │  GTFS IDFM│
│   (France entière en bronze → focus IDF en gold)                 │
└──────────────────────────────────────────────────────────────────┘
                                ↓
┌──────────────────────────────────────────────────────────────────┐
│               INGESTION  (Python scripts)                        │
│          requests · GDAL · osmnx · pandas · geopandas            │
│               + py3dtiles (génération 3D Tiles OSM)              │
└──────────────────────────────────────────────────────────────────┘
                                ↓
┌──────────────────────────────────────────────────────────────────┐
│          STOCKAGE BRUT — Azure Data Lake Storage Gen2            │
│           /bronze  /silver  /gold  (Delta Lake / HDFS)           │
└──────────────────────────────────────────────────────────────────┘
                                ↓
┌──────────────────────────────────────────────────────────────────┐
│           BIG DATA PROCESSING — Azure Databricks                 │
│   PySpark (Hadoop/HDFS) · GeoPandas · NetworkX · MLflow · DLT    │
└────────────────────────┬─────────────────────────────────────────┘
                         ↓                        ↓
          ┌──────────────────────┐    ┌───────────────────────────┐
          │  PostgreSQL + PostGIS│    │       MongoDB Atlas        │
          │   (Azure Database)   │    │  avis quartiers + rapports │
          │  transactions DVF    │    │  → ChromaDB (vecteurs RAG) │
          │  communes / IRIS     │    └───────────────────────────┘
          │  stats agrégées gold │
          └──────────┬───────────┘
                     ↓              ↓ MVT (pg_tileserv)
┌──────────────────────────────────────────────────────────────────┐
│           BACKEND — Go 1.22 (Gin)  +  Redis (cache L2)           │
│                   Azure Container Apps                           │
│  /api/communes   /api/transactions   /api/batiments/:id          │
│  /api/score      /api/rag/query      /api/tiles/{z}/{x}/{y}.mvt  │
│  /api/isochrone  /api/stats/heatmap  /api/stats/evolution        │
└───────────────────────────┬──────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────────┐
│         FRONTEND — React 18 + TypeScript                         │
│   CesiumJS (3D Tiles) · MapLibre GL/Mapbox · Recharts · Chat RAG │
└──────────────────────────────────────────────────────────────────┘
```

---

## Structure du Projet

```
homepedia/
├── ingestion/              # Scripts Python d'ingestion
│   ├── dvf/                # Demandes Valeurs Foncières (France entière)
│   ├── insee/              # Données socio-démographiques
│   ├── ademe_dpe/          # Performance énergétique
│   ├── osm/                # Bâtiments OSM + Cadastre IGN
│   ├── gtfs_idfm/          # Transports RATP/SNCF
│   ├── avis/               # Collecte avis quartiers (sources légales)
│   ├── tiles/              # Génération 3D Tiles (py3dtiles)
│   └── load_postgres.py    # Versement gold → PostgreSQL
├── databricks/             # Notebooks PySpark + Delta Live Tables
│   ├── bronze_to_silver/   # Nettoyage, normalisation, anonymisation RGPD
│   ├── silver_to_gold/     # Enrichissement spatial + agrégations
│   ├── ml/                 # MLflow — score investissement
│   └── pipelines/          # Delta Live Tables orchestration
├── backend/                # API Go (Gin)
│   ├── cmd/server/
│   ├── internal/
│   │   ├── handlers/       # HTTP handlers par ressource
│   │   ├── repository/     # Accès PostgreSQL, MongoDB, ChromaDB, Redis
│   │   ├── services/       # Logique métier
│   │   └── models/         # Structs Go
│   ├── go.mod
│   └── Dockerfile
├── rag/                    # Service RAG Python
│   ├── embeddings/         # Génération embeddings CamemBERT
│   ├── query/              # RAG query + LLM
│   ├── analysis/           # Sentiment + word cloud
│   └── Dockerfile
├── streamlit/              # Prototype démo analyses Databricks (soutenance)
│   └── app.py
├── frontend/               # React 18 + TypeScript
│   ├── src/
│   │   ├── pages/          # LandingPage, DashboardPage, LoginPage
│   │   ├── components/
│   │   │   ├── map/        # CesiumJS 3D + MapLibre choroplèthes
│   │   │   ├── charts/     # Recharts stats
│   │   │   └── rag/        # Chat panel AI
│   │   └── lib/api.ts
│   └── Dockerfile
├── infra/
│   ├── bicep/              # Azure resources (IaC)
│   └── docker-compose.yml  # Dev local COMPLET
└── docs/
    ├── schema_db.md         # Schéma BDD — livrable obligatoire Epitech
    ├── data_cleaning.md     # Méthodologie nettoyage — livrable obligatoire
    ├── rgpd.md              # Conformité RGPD (anonymisation DVF)
    └── hadoop_spark.md      # Justification stack Hadoop/Spark/HDFS
```

---

## Phase 0 — Dev Local (docker-compose)
> A faire EN PREMIER — évite de payer Databricks pour du développement
> **Nouveau** : sans setup local, chaque test coûte du crédit Azure

- [ ] `infra/docker-compose.yml` avec tous les services :
  ```yaml
  services:
    postgres:    # PostgreSQL 16 + PostGIS
    mongodb:     # MongoDB 7
    chromadb:    # ChromaDB
    redis:       # Redis 7 (cache)
    backend:     # Go API (hot reload avec Air)
    rag:         # Service Python RAG
    frontend:    # React (Vite dev server)
    tileserver:  # pg_tileserv (MVT depuis PostGIS)
  ```
- [ ] `backend/` : installer **Air** (`cosmtrek/air`) pour hot-reload Go en dev
- [ ] Données de dev : sous-ensemble DVF (75 + 77 + 78 uniquement, ~200k transactions)
- [ ] Script `scripts/seed_dev.py` : charger données de dev dans PostgreSQL/MongoDB local
- [ ] **Spark local** : DuckDB comme simulateur pipeline pour le dev
  - `databricks/local_dev/duckdb_pipeline.py` — même logique que PySpark, sans cluster

---

## Phase 1 — Infrastructure Azure & CI/CD
> Durée estimée : ~1 semaine

### 1.1 Azure Cloud Setup
- [x] ~~Créer Resource Group `homepedia-rg`~~ ✅ **FAIT** (Sweden Central)
- [x] ~~Créer workspace Azure Databricks~~ ✅ **FAIT**
  - Workspace : `homepedia-dbx` · URL : `https://adb-7405612925607784.4.azuredatabricks.net`
  - Tier : Standard · Type : Hybrid · IP publique désactivée
- [x] ~~Provisionner Azure Data Lake Storage Gen2~~ ✅ **FAIT**
  - Nom : `homepediadatalake` · Containers : `raw` / `bronze` / `silver` / `gold`
- [x] ~~Service Principal~~ ✅ **FAIT** — `homepedia-sp` + secrets Databricks configurés
- [x] ~~Provisionner PostgreSQL~~ ✅ **FAIT**
  - Serveur : `homepedia-postgres` (PostgreSQL **17**) · DB : `homepedia`
  - PostGIS **3.6.1** activé
- [x] ~~Déployer Redis~~ ✅ **FAIT** — `homepedia-redis` (Azure Cache for Redis)
- [x] ~~Configurer Azure Key Vault~~ ✅ **FAIT** — `homepedia-kv`
- [x] ~~Créer Azure Container Registry~~ ✅ **FAIT** — `homepediaacr`
- [ ] Déployer ChromaDB (Azure Container Instances)
- [ ] Créer compte MongoDB Atlas (compte séparé, hors Azure)
- [ ] **Monter le Data Lake sur Databricks** (lier `homepediadatalake` au workspace DBFS)
- [ ] **Créer le cluster Spark dans `homepedia-dbx`**
  - Driver + 2 workers (Standard_DS3_v2) · Runtime 14.x (Spark 3.5 + Python 3.11)

### 1.2 data.gouv.fr MCP Server
> Outil de découverte et d'exploration des datasets open data — utilisé tout au long des phases 2 et 3

- [x] ~~Ajouter le MCP dans Claude Code~~ ✅ **FAIT** (`https://mcp.data.gouv.fr` dans Windsurf settings)
- [ ] Usages par phase :
  - **Phase 2 (exploration)** : `search_datasets` → identifier les bons IDs de ressources DVF, INSEE, ADEME avant d'écrire les scripts
  - **Phase 2 (ingestion)** : `download_and_parse_resource` → automatiser le téléchargement dans les scripts Python
  - **Phase 3 dev local** : `query_resource_data` → charger des échantillons dans DuckDB sans bulk download
- [ ] ⚠️ **Limite** : MCP non adapté au bulk production (6M transactions DVF) → scripts Python classiques obligatoires pour Databricks

**Tools disponibles :**
| Tool | Usage HomePedia |
|---|---|
| `search_datasets` | Trouver DVF, INSEE Filosofi, ADEME DPE, Cadastre IGN |
| `get_dataset_info` | Vérifier structure + licence avant ingestion |
| `list_dataset_resources` | Lister les fichiers disponibles (CSV, Parquet, GeoJSON) |
| `query_resource_data` | Requêter échantillons pour dev local / DuckDB |
| `download_and_parse_resource` | Automatiser téléchargement dans scripts ingestion |
| `get_metrics` | Vérifier fraîcheur des données (date de mise à jour) |

### 1.3 Repo & CI/CD
- [ ] Initialiser monorepo Git
- [ ] Configurer GitHub Actions :
  - `ci.yml` : lint Go (`golangci-lint`) + Python (`ruff`), tests, build Docker
  - `deploy.yml` : push → ACR → Azure Container Apps (staging puis prod)
- [ ] Fichiers `.env.example` documentés pour chaque service
- [ ] `docs/hadoop_spark.md` : justifier Databricks HDFS comme implémentation Hadoop

---

## Phase 2 — Data Gathering (Ingestion)
> Durée estimée : ~1.5 semaines
> **Critère Epitech :** ✓ Data gathering multi-niveaux état → région → département → commune → bâtiment
> **Important :** France entière en bronze — focus IDF uniquement en gold

### 2.1 DVF — Demandes de Valeurs Foncières
- [x] ~~`ingestion/dvf/download.py`~~ ✅ **FAIT** — testé Paris 2024 (74 574 lignes, 1.2 MB Parquet)
  - Source : `https://files.data.gouv.fr/geo-dvf/`
  - Upload vers `/bronze/dvf/` (Parquet partitionné par année/département)
  - ⚠️ RGPD : colonnes `nom_*` supprimées à l'ingestion
- [x] ~~France entière 2020–2024~~ ✅ **FAIT** — **500 fichiers traités, 485 uploadés** (07/03/2026)
  - `bronze/dvf/annee=XXXX/dept=XX/dvf_XXXX_XX.parquet` (5 années × ~97 depts effectifs)

### 2.2 INSEE — Statistiques socio-démographiques
- [x] ~~`ingestion/insee/download.py`~~ ✅ **FAIT**
  - Populations légales 2021 : **34 970 communes** → `bronze/insee/populations/populations_2021.parquet`
  - ⚠️ Revenus Filosofi : téléchargement manuel requis (INSEE bloque l'automatisation)
    → Télécharger `filo-dec-communes-2021.zip` sur [insee.fr/fr/statistiques/7233950](https://www.insee.fr/fr/statistiques/7233950)
    → Extraire `FILO2021_DISP_COM.csv` dans `/tmp/dvf/insee/`
    → Relancer : `python3 ingestion/insee/download.py`

### 2.3 ADEME DPE — Performance Énergétique
- [x] ~~`ingestion/ademe_dpe/download.py`~~ ✅ **FAIT**
  - API ADEME `meg-83tjwtg8dyz4vv7h1dqe` · 100 000 DPE/département (les plus récents)
  - 8 départements IDF (75, 77, 78, 91, 92, 93, 94, 95) → `bronze/dpe/dept=XX/`
  - ~800 000 DPE IDF uploadés au total

### 2.4 OSM — POI et géométries
- [x] ~~`ingestion/osm/extract.py`~~ ✅ **FAIT**
  - API Overpass · Bounding box IDF complète
  - **172 911 POI** uploadés → `bronze/osm/` :
    - `poi_education.parquet` — 12 237 établissements
    - `poi_sante.parquet` — 5 856 lieux de soin
    - `poi_commerce.parquet` — 9 609 commerces
    - `poi_parcs.parquet` — 17 275 espaces verts
    - `poi_restauration.parquet` — 31 908 restaurants/cafés
    - `poi_services.parquet` — 5 983 services
    - `poi_transport.parquet` — 89 843 arrêts/gares
- [ ] `ingestion/tiles/generate_3dtiles.py` ← **Étape critique pour la 3D** (Phase suivante)
  - Input : emprises OSM + hauteurs IGN BD TOPO
  - Output : 3D Tiles → Azure Blob Storage

### 2.5 GTFS IDFM — Transports en commun
- [x] ~~`ingestion/gtfs_idfm/download.py`~~ ✅ **Script créé** — à lancer
  - Source : `https://data.iledefrance-mobilites.fr/`
  - Arrêts, lignes, score accessibilité par zone
  - Commande : `python3 ingestion/gtfs_idfm/download.py`

### 2.6 Avis Quartiers — Source des données textuelles
> ⚠️ Point le plus flou de la stack — à clarifier en priorité

- [ ] Évaluer et choisir parmi ces sources légales :
  - **Option A** (recommandée) : `villesavivre.fr` — vérifier CGU scraping
    → Si autorisé : `ingestion/avis/scrape_villesavivre.py` (BeautifulSoup + respect rate limit)
  - **Option B** : Google Places API — avis de quartiers/POI (payant, ~2$/1000 req)
    → `ingestion/avis/google_places.py`
  - **Option C** : Données synthétiques générées par LLM pour la démo
    → Acceptable pour une soutenance si sources réelles indisponibles
- [ ] Upload vers MongoDB Atlas `avis_quartiers` (format JSON, pas de Parquet)
- [ ] **Documenter le choix et les CGU** dans `docs/data_cleaning.md`

---

## Phase 3 — Big Data Processing (Databricks)
> Durée estimée : ~2 semaines
> **Critère Epitech :** ✓ Hadoop (HDFS Databricks) + Spark distribué, cluster multi-nœuds

> **Note Hadoop :** Databricks utilise HDFS comme système de fichiers distribué (DBFS = Databricks
> File System, couche sur HDFS). Delta Lake s'appuie sur HDFS. Cela répond au critère Epitech
> "Hadoop and Spark". Documenter dans `docs/hadoop_spark.md`.

### 3.1 Bronze → Silver (Nettoyage)
- [ ] `bronze_to_silver/dvf_cleaning.py` (PySpark)
  - Suppression doublons, filtrage valeurs aberrantes (prix ≤ 0, surface ≤ 0)
  - Standardisation codes commune INSEE (5 chiffres)
  - Normalisation types de biens (MAISON, APPARTEMENT, LOCAL…)
  - **Anonymisation RGPD** : supprimer/hasher colonnes `nom_1`, `nom_2` si présentes
- [ ] `bronze_to_silver/insee_cleaning.py`
  - Jointure Filosofi + population/IRIS
  - Imputation valeurs manquantes (médiane par département)
- [ ] `bronze_to_silver/dpe_cleaning.py`
  - Géocodage adresses → GPS (API BAN : `api-adresse.data.gouv.fr`)
  - Normalisation classes DPE
- [ ] `bronze_to_silver/osm_cleaning.py`
  - Nettoyage géométries invalides (`ST_IsValid` + Shapely `make_valid`)
  - Standardisation attributs bâtiments (hauteur en mètres, étages)

### 3.2 Silver → Gold (Enrichissement & Agrégation)
- [ ] `silver_to_gold/spatial_joins.py` (GeoPandas + Shapely)
  - Jointures spatiales DVF ↔ IRIS ↔ OSM (focus IDF pour le gold)
  - Rattacher chaque transaction à son IRIS, commune, département, région
  - Enrichir avec DPE, score INSEE, distances aux POI
- [ ] `silver_to_gold/aggregations.py`
  - Prix médian/m² par commune, département, région (2019–2024)
  - Évolution temporelle (glissement annuel + CAGR)
  - Distribution DPE par zone
  - Top communes par score investissement
- [ ] `silver_to_gold/network_analysis.py` (NetworkX)
  - Graphe réseau transport depuis GTFS
  - Score accessibilité : temps moyen depuis arrêt le plus proche
  - Corrélation accessibilité ↔ prix au m² (à inclure dans le rapport)

### 3.3 ML — Score Investissement (MLflow)
- [ ] `ml/investment_score.py`
  - Features : prix/m², tendance 3 ans, DPE moyen, accessibilité transport, revenus médians, taux vacance
  - Modèle : XGBoost (Gradient Boosting)
  - **MLflow** intégré Databricks : tracking runs, métriques, artefacts
  - MLflow Model Registry : versionner et promouvoir le modèle
  - Output : score 0–100 par commune + IRIS
- [ ] `ml/serve_score.py` : endpoint MLflow Model Serving → appelé par backend Go

### 3.4 Delta Live Tables — Pipeline Automatisé
- [ ] `pipelines/homepedia_dlt.py`
  - Orchestration bronze → silver → gold automatique
  - Refresh planifié : DVF mensuel, DPE hebdomadaire, GTFS quotidien
  - Data quality constraints (DLT) : bloquer si > 5% valeurs nulles
  - Alertes Databricks si pipeline échoue ou qualité < seuil

### 3.5 Prototype Streamlit (soutenance)
> Epitech mentionne Streamlit explicitement — utile pour démo rapide des analyses

- [ ] `streamlit/app.py`
  - Connexion directe à PostgreSQL gold
  - Vue 1 : carte choroplèthe prix/m² par département (Folium ou Plotly)
  - Vue 2 : évolution temporelle (Plotly line chart)
  - Vue 3 : distribution DPE (bar chart)
  - Déployable sur Streamlit Cloud (gratuit) pour démo soutenance

---

## Phase 4 — Database Organization
> Durée estimée : ~1 semaine
> **Critère Epitech :** ✓ Bases relationnelle + non-relationnelle, standardisation, indexation

### 4.1 PostgreSQL + PostGIS (Données structurées)
Tout documenter dans `docs/schema_db.md` (livrable obligatoire Epitech)

- [ ] Table `users`
  ```sql
  id UUID PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(), role TEXT DEFAULT 'user'
  ```
- [ ] Table `communes`
  ```sql
  code_insee TEXT PRIMARY KEY, nom TEXT, departement TEXT, region TEXT,
  prix_median_m2 NUMERIC, nb_transactions INT, score_investissement NUMERIC,
  population INT, revenu_median NUMERIC,
  geom GEOMETRY(MultiPolygon, 4326)
  ```
- [ ] Table `iris`
  ```sql
  code_iris TEXT PRIMARY KEY, code_commune TEXT REFERENCES communes,
  nom TEXT, prix_median_m2 NUMERIC, geom GEOMETRY(MultiPolygon, 4326)
  ```
- [ ] Table `transactions`
  ```sql
  id BIGSERIAL PRIMARY KEY, date_mutation DATE, valeur_fonciere NUMERIC,
  surface_reelle NUMERIC, type_local TEXT, code_commune TEXT,
  dpe_classe TEXT, annee INT,
  geom GEOMETRY(Point, 4326)  -- lat/lon intégrés dans le point
  ```
- [ ] Table `batiments`
  ```sql
  id TEXT PRIMARY KEY, osm_id TEXT, code_commune TEXT,
  nb_etages INT, hauteur_m NUMERIC, dpe_classe TEXT,
  tiles_url TEXT,  -- URL des 3D Tiles Azure Blob Storage
  geom GEOMETRY(Polygon, 4326)
  ```
- [ ] Table `favorites`
  ```sql
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users, building_id TEXT, created_at TIMESTAMPTZ DEFAULT now()
  ```
- [ ] **Index PostGIS GIST** sur toutes les colonnes `geom` (obligatoire pour les performances)
- [ ] **Index B-tree** sur `code_commune`, `date_mutation`, `annee`, `type_local`
- [ ] Script `ingestion/load_postgres.py` : Delta gold Parquet → PostgreSQL (via COPY)

### 4.2 Tuiles Vectorielles MVT — pg_tileserv
> ⚠️ **Nouveau** — évite de renvoyer du GeoJSON brut (trop lourd pour 36k communes)

- [ ] Déployer **pg_tileserv** (Go, léger) sur Azure Container Apps
  - Ou déployer **Martin** (Rust, alternative)
  - Se connecte directement à PostgreSQL + PostGIS
  - Expose `GET /tiles/{table}/{z}/{x}/{y}.mvt`
- [ ] MapLibre GL consomme les MVT nativement → 10x plus léger que GeoJSON

### 4.3 MongoDB Atlas (Données non-structurées)
- [ ] Collection `avis_quartiers`
  ```json
  {
    "code_commune": "75001",
    "source": "villesavivre | google_places | synthetic",
    "texte": "...",
    "date": "2024-01-15",
    "sentiment_score": 0.8,
    "sentiment_label": "positif",
    "themes": ["securite", "transport", "commerce"]
  }
  ```
- [ ] Collection `rapports_marche` (études FNAIM, INSEE, articles)
- [ ] **Index full-text Atlas Search** sur `texte` (pour recherche textuelle)

### 4.4 ChromaDB — Vecteurs RAG
- [ ] `rag/embeddings/generate.py`
  - Modèle : `dangvantuan/sentence-camembert-large` (français)
  - Chunking 512 tokens, overlap 50
  - Metadata : `code_commune`, `source`, `date`, `sentiment_label`
  - Upsert dans collection `homepedia_docs`

---

## Phase 5 — Backend Go (API REST)
> Durée estimée : ~2 semaines
> **Stack :** Go 1.22 + Gin + pgx/v5 + mongo-go-driver + Redis + JWT

### 5.1 Setup Projet Go
- [ ] `go mod init github.com/homepedia/backend`
- [ ] Dépendances principales :
  ```
  gin-gonic/gin              HTTP framework
  jackc/pgx/v5               PostgreSQL driver natif (le plus performant)
  go.mongodb.org/mongo-driver  MongoDB
  redis/go-redis/v9          Redis cache
  golang-jwt/jwt/v5          Authentification JWT
  joho/godotenv              Configuration .env
  cosmtrek/air               Hot reload dev (dev uniquement)
  ```
- [ ] Structure `internal/` : handlers / repository / services / models / cache

### 5.2 Cache Redis (couche L2)
> ⚠️ **Nouveau** — les requêtes PostGIS choroplèthes prennent 2-5s sans cache

- [ ] `repository/redis_cache.go`
  - `Get(key string) ([]byte, error)`
  - `Set(key string, value []byte, ttl time.Duration) error`
- [ ] TTL par type de donnée :
  - GeoJSON communes : 1h (données statiques)
  - Heatmap transactions : 30min
  - Score investissement : 6h
  - RAG responses : 15min (pour questions identiques)
- [ ] Invalidation manuelle via `GET /admin/cache/clear` (route admin protégée)

### 5.3 Models Go
- [ ] `models/user.go` — User, LoginRequest, JWTClaims
- [ ] `models/commune.go` — Commune, CommuneStats, GeoJSON Feature
- [ ] `models/building.go` — Building, BuildingDetail, TilesInfo
- [ ] `models/transaction.go` — Transaction, PriceHistory, PricePoint, HeatPoint
- [ ] `models/rag.go` — RAGQuery, RAGResponse, Source
- [ ] `models/isochrone.go` — IsochroneRequest, IsochroneResponse

### 5.4 Repository Layer
- [ ] `repository/postgres.go` — pool pgx (max 20 connexions)
- [ ] `repository/communes_repo.go`
  - `GetByCode(code string) (*Commune, error)`
  - `Search(query string, filters Filters) ([]Commune, error)`
  - `GetMVTTile(table string, z, x, y int) ([]byte, error)` → délègue à pg_tileserv
- [ ] `repository/transactions_repo.go`
  - `List(filters TransactionFilters, page, limit int) ([]Transaction, error)`
  - `GetPriceHistory(code string, years int) ([]PricePoint, error)`
  - `GetHeatmap(bounds BoundingBox) ([]HeatPoint, error)`
- [ ] `repository/buildings_repo.go`
  - `GetByID(id string) (*Building, error)`
  - `GetInBounds(bounds BoundingBox) ([]Building, error)`
- [ ] `repository/mongo_repo.go`
  - `GetAvis(code string, limit int) ([]Avis, error)`
- [ ] `repository/chroma_client.go` (client HTTP vers service RAG Python)
  - `QueryRAG(question string, nResults int) ([]Chunk, error)`

### 5.5 Service Layer
- [ ] `services/geo_service.go` — calculs spatiaux, validation bounds
- [ ] `services/stats_service.go` — agrégations, comparaisons inter-communes
- [ ] `services/rag_service.go` — orchestration retrieve + format contexte + appel LLM
- [ ] `services/score_service.go` — appel MLflow Model Serving endpoint
- [ ] `services/auth_service.go` — bcrypt hashage, génération + validation JWT
- [ ] `services/isochrone_service.go` — appel Valhalla pour isochrones transport

### 5.6 Isochrones Transport — Valhalla
> ⚠️ **Nouveau** — feature forte mentionnée mais sans implémentation

- [ ] Déployer **Valhalla** (routing engine open source) sur Azure Container Instances
  - Charger données OSM IDF (`.osm.pbf`)
  - Endpoint : `POST /isochrone` → polygones d'accessibilité en X minutes
- [ ] `services/isochrone_service.go` : appel HTTP Valhalla
- [ ] `GET /api/isochrone?lat=48.85&lon=2.35&minutes=30` → GeoJSON polygone

### 5.7 Handlers (Routes API)
- [ ] `POST /auth/register` — création compte (email + password)
- [ ] `POST /auth/login` — retourne JWT (24h)
- [ ] `GET  /api/communes` — liste avec stats (réponse MVT via pg_tileserv)
  - Query params : `departement`, `region`, `min_prix`, `max_prix`, `dpe`, `level`
- [ ] `GET  /api/communes/:code` — détail commune + historique prix + avis
- [ ] `GET  /api/tiles/:table/:z/:x/:y.mvt` — proxy MVT depuis pg_tileserv (avec cache Redis)
- [ ] `GET  /api/transactions` — DVF filtrées (pagination cursor)
  - Query params : `commune`, `type`, `date_from`, `date_to`, `min_prix`, `max_prix`
- [ ] `GET  /api/batiments/:id` — détail bâtiment (OSM + DPE + 3D Tiles URL)
- [ ] `GET  /api/score/:code` — score investissement par commune/IRIS
- [ ] `POST /api/rag/query` — assistant IA (délègue au service Python)
  ```json
  { "question": "Quel arrondissement de Paris a la meilleure performance DPE ?" }
  ```
- [ ] `GET  /api/isochrone` — polygone d'accessibilité transport (Valhalla)
- [ ] `GET  /api/stats/heatmap` — données heatmap (bounds en query params)
- [ ] `GET  /api/stats/evolution` — évolution prix nationale/régionale
- [ ] `GET  /api/communes/:code/wordcloud` — PNG word cloud (Azure Blob Storage)
- [ ] `GET  /admin/stats` — monitoring (users, RAG/jour, cache hit rate) — route admin JWT
- [ ] `GET  /admin/cache/clear` — invalidation cache Redis
- [ ] `GET  /health` — healthcheck (vérifie PG + Mongo + Redis)
- [ ] **Middleware JWT** sur toutes les routes `/api/*` et `/admin/*`
- [ ] **Middleware CORS** (domaines autorisés uniquement)
- [ ] **Middleware rate limiting** : 100 req/min par IP (gin-rate-limiter)

### 5.8 Containerisation & Déploiement
- [ ] `Dockerfile` multi-stage : `golang:1.22-alpine` build → `alpine:3.19` run
- [ ] GitHub Actions → Azure Container Registry → Azure Container Apps
- [ ] Variables d'environnement via Azure Key Vault (managed identity — 0 secret dans env)

---

## Phase 6 — Service RAG (Python)
> Durée estimée : ~1 semaine
> **Critère Epitech :** ✓ AI — analyse textuelle, sentiment, NLP

### 6.1 RAG Query Service
- [ ] `rag/query/api.py` (FastAPI, appelé par backend Go via HTTP interne)
  - `POST /rag/query`
    1. Embed la question (CamemBERT)
    2. Retrieve top-5 chunks ChromaDB par similarité cosinus
    3. Filtrer par `code_commune` si spécifié dans la question
    4. Appel LLM (Mistral-7B-Instruct via Ollama, ou Claude API)
    5. Retourner réponse structurée + sources (commune, date, extrait)
  - Streaming Server-Sent Events pour la réponse progressive (frontend)

### 6.2 Analyse Textuelle (Critère Epitech obligatoire)
- [ ] `rag/analysis/sentiment.py`
  - Modèle : **CamemBERT fine-tuné sentiment** (`tblard/tf-allocine`)
  - Appliquer sur tous les avis MongoDB → stocker `sentiment_score` + `sentiment_label`
  - Résumé par commune : % positif/négatif/neutre, top thèmes récurrents
- [ ] `rag/analysis/wordcloud.py`
  - Librairie Python `wordcloud` + NLTK (stop words français)
  - Word clouds par commune et thème : sécurité, transport, commerce, école, environnement
  - Export PNG → **Azure Blob Storage** → URL publique servie par endpoint Go
  - Régénérer si nouveaux avis (pipeline déclenché par DLT)

---

## Phase 7 — Frontend (Visualisation Interactive)
> Durée estimée : ~2 semaines
> **Critère Epitech :** ✓ Cartographique + Tabulaire + Textuel · Interactivité multi-niveaux

### 7.1 Setup
- [ ] React 18 + TypeScript + TailwindCSS
- [ ] Dépendances :
  ```
  cesium / resium          3D Tiles bâtiments (CesiumJS wrappé React)
  maplibre-gl              cartes choroplèthes via MVT (compatibilité Mapbox)
  recharts                 graphiques statistiques
  react-query              data fetching + cache client
  zustand                  state management global
  react-map-gl             wrapper React pour MapLibre (Airbnb)
  ```
- [ ] **Note Mapbox** : MapLibre GL est fork open source de Mapbox GL JS v1 — syntaxe identique,
  gratuit, accepte les styles Mapbox. Epitech recommande mapbox.com → MapLibre couvre ce critère
  sans coût supplémentaire.

### 7.2 Pages
- [ ] `LandingPage` — présentation, demo screenshot, CTA "Explorer la carte"
- [ ] `LoginPage` — auth JWT, register (US-005)
- [ ] `DashboardPage` — vue principale : carte + panel stats + filtres + chat RAG

### 7.3 Composants Cartographiques (US-001)
- [ ] **Choroplèthe MapLibre GL** — prix/m² coloré via MVT
  - Tuiles vectorielles depuis pg_tileserv (pas de GeoJSON brut)
  - Niveaux zoom adaptatifs : région (z<7) → département (z7-10) → commune (z10-13) → IRIS (z>13)
  - Clic → drill-down + panel stats à droite
- [ ] **Heatmap** — densité de transactions (`maplibre-gl-heatmap`)
- [ ] **Bubble Plot interactif** — prix vs accessibilité transport (inspiré Gapminder)
  - Axe X : score accessibilité transport, Axe Y : prix/m², taille bulle : volume transactions
- [ ] **Visualisation 3D CesiumJS/Resium** (US-001)
  - 3D Tiles bâtiments (depuis py3dtiles ou Cesium Ion)
  - Couleur selon DPE (A=vert → G=rouge) ou score investissement
  - Clic bâtiment → popup avec prix médian, surface, DPE, nb transactions voisines
- [ ] **Isochrones** — zones à 30/45 min depuis une gare (appel `/api/isochrone`)

### 7.4 Composants Statistiques (Epitech : tabulaire + textuel)
- [ ] **Recharts line chart** : évolution prix/m² par commune (2019–2024)
- [ ] **Histogramme** distribution DPE par zone sélectionnée
- [ ] **Scatter plot** prix vs revenus médians INSEE (Gapminder style)
- [ ] **Tableau interactif** top-20 communes IDF par score investissement
  - Colonnes triables : commune, prix/m², score, DPE moyen, accessibilité
- [ ] **Word cloud** avis quartier — image PNG depuis Azure Blob Storage
- [ ] **Sentiment gauge** : % positif/négatif par commune

### 7.5 Chat RAG (US-002)
- [ ] Panel latéral dépliable (slide-in depuis la droite)
- [ ] Streaming réponse via Server-Sent Events (`EventSource`)
- [ ] Exemples de questions préremplies cliquables :
  - "Quelle commune IDF a la plus forte hausse de prix en 2023 ?"
  - "Meilleur rapport qualité/prix pour un appartement avec DPE A ou B ?"
  - "Impact du Grand Paris Express sur les prix à Bobigny ?"
- [ ] Affichage des sources utilisées (commune, date, extrait tronqué)
- [ ] Contexte automatique de la zone visible sur la carte

### 7.6 Filtres (US-004)
- [ ] Sélecteur zone hiérarchique (région → département → commune)
- [ ] Filtre période slider (2019–2024)
- [ ] Filtre type de bien (appartement, maison, local, terrain)
- [ ] Filtre DPE multiselect (A–G)
- [ ] Filtre prix/m² range slider
- [ ] Filtre score investissement slider
- [ ] Bouton "Réinitialiser les filtres"

---

## Phase 8 — Déploiement & Qualité
> **Critère Epitech :** ✓ Bonus — déploiement online, auth, sécurité, admin, real-time

### 8.1 Tests
- [ ] Tests unitaires Go (`go test ./...`) — handlers, services, repository
- [ ] Tests intégration PostgreSQL (testcontainers-go) — requêtes spatiales
- [ ] Tests Python ingestion (pytest) — nettoyage et normalisation
- [ ] Tests E2E frontend (Playwright) — navigation carte, filtres, chat RAG

### 8.2 Déploiement Final
- [ ] Backend Go → **Azure Container Apps** (auto-scaling 1-5 instances)
- [ ] pg_tileserv → **Azure Container Apps** (co-deployé avec le backend)
- [ ] RAG Python → **Azure Container Instances**
- [ ] Valhalla → **Azure Container Instances** (avec données OSM IDF)
- [ ] Frontend → **Azure Static Web Apps** (CDN intégré)
- [ ] PostgreSQL → **Azure Database for PostgreSQL Flexible Server**
- [ ] MongoDB → **MongoDB Atlas**
- [ ] ChromaDB → **Azure Container Instances**
- [ ] Redis → **Azure Cache for Redis**
- [ ] 3D Tiles → **Azure Blob Storage** (accès public CORS activé)
- [ ] Word clouds PNG → **Azure Blob Storage**

### 8.3 Sécurité (Bonus Epitech)
- [ ] HTTPS partout (certificats automatiques Azure)
- [ ] Rate limiting Go (100 req/min par IP)
- [ ] CORS restreint aux domaines autorisés
- [ ] Secrets Azure Key Vault + managed identity (0 secret dans le code ou env files)
- [ ] pgx parameterized queries (protection SQL injection)
- [ ] Input validation sur tous les handlers (longueur max, regex)
- [ ] `docs/rgpd.md` : documenter anonymisation DVF et conformité RGPD

### 8.4 Admin View & Monitoring (Bonus Epitech)
- [ ] Dashboard Databricks : monitoring Delta Live Tables (alertes qualité données)
- [ ] `GET /admin/stats` : nb users, requêtes RAG/jour, cache hit rate Redis, top questions
- [ ] Azure Monitor : alertes si pipeline échoue ou API latency > 2s
- [ ] Logs structurés Go (`slog` package) → Azure Log Analytics

### 8.5 Guided Tour (Bonus Epitech)
- [ ] Librairie `react-joyride` : visite guidée au premier login
  - Étape 1 : "Explorez la carte choroplèthe"
  - Étape 2 : "Cliquez sur une commune pour voir les stats"
  - Étape 3 : "Passez en vue 3D pour voir les bâtiments"
  - Étape 4 : "Posez une question à l'assistant IA"

---

## User Stories (Issues GitHub recommandées)

| ID | Priorité | Titre | Points |
|---|---|---|---|
| US-001 | Critical | Visualisation 3D bâtiments (région → bâtiment) | 8 |
| US-002 | Critical | Assistant IA conversationnel (RAG + streaming) | 10 |
| US-003 | Critical | Pipeline données multi-sources (DVF, INSEE, DPE, OSM, GTFS) | 12 |
| US-004 | High | Filtres personnalisables + alertes | 8 |
| US-005 | Critical | Authentification JWT + comptes utilisateurs | 10 |
| US-006 | High | Analyse textuelle avis quartiers (sentiment + word cloud) | 6 |
| US-007 | High | Score investissement par commune (MLflow) | 8 |
| US-008 | High | Isochrones transport (accessibilité en X minutes) | 6 |
| US-009 | Medium | Comparaison de communes côte à côte | 5 |
| US-010 | Low | Guided tour premier lancement | 2 |
| US-011 | Low | Favoris et partage | 3 |

---

## Livrables Epitech (Checklist)

| Livrable | Couvert par | Statut |
|---|---|---|
| Data gathering multi-niveaux | Phase 2 (DVF France entière, INSEE, OSM, DPE, GTFS) | ⬜ |
| Base relationnelle | Phase 4.1 (PostgreSQL + PostGIS) | ⬜ |
| Base non-relationnelle | Phase 4.3 (MongoDB) + Phase 4.4 (ChromaDB) | ⬜ |
| Big Data Processing Hadoop+Spark | Phase 3 (Databricks HDFS + PySpark) | ⬜ |
| Cluster de machines | Databricks multi-workers configuré Phase 1 | ⬜ |
| Analyse statistique | Phase 3.2 + Phase 7.4 | ⬜ |
| Visualisation cartographique | Phase 7.3 (choroplèthe MVT, 3D, bubble, isochrones) | ⬜ |
| Visualisation tabulaire | Phase 7.4 (Recharts, tableau trié) | ⬜ |
| Analyse textuelle / AI | Phase 6.2 (sentiment CamemBERT + word cloud) | ⬜ |
| Schéma BDD documenté | `docs/schema_db.md` | ⬜ |
| Méthodologie nettoyage | `docs/data_cleaning.md` | ⬜ |
| RGPD / conformité données | `docs/rgpd.md` | ⬜ |
| App interactive déployée | Phase 8.2 | ⬜ |

### Bonus
- [ ] Déploiement online Azure (Container Apps + Static Web Apps)
- [ ] Authentification JWT + comptes utilisateurs
- [ ] Sécurité (HTTPS, rate limit, Key Vault)
- [ ] Admin view + monitoring Azure
- [ ] Real-time updates (Delta Live Tables refresh automatique)
- [ ] Guided tour (react-joyride)
- [ ] Extension autres régions France (hors IDF)
- [ ] Streamlit prototype pour soutenance

---

## Stack Résumé

| Couche | Technologie | Justification |
|---|---|---|
| Dev local | docker-compose + DuckDB | Évite les coûts Azure en développement |
| Ingestion | Python 3.11 — pandas, osmnx, GDAL, py3dtiles | Open source, bien supporté |
| Stockage brut | Azure Data Lake Gen2 — Delta Lake (HDFS) | Répond critère Hadoop Epitech |
| Processing | Azure Databricks — PySpark, GeoPandas, NetworkX | Cluster distribué, MLflow intégré |
| ML | MLflow (intégré Databricks) — XGBoost | Tracking, registry, serving |
| DB relationnelle | PostgreSQL 16 + PostGIS (Azure) | Standard géospatial |
| Tuiles vectorielles | pg_tileserv ou Martin (MVT) | 10x plus léger que GeoJSON brut |
| DB documents | MongoDB Atlas | Non-relationnel, Atlas Search |
| DB vecteurs | ChromaDB | RAG embeddings français |
| Cache | Redis (Azure Cache) | Performances requêtes PostGIS |
| **Backend API** | **Go 1.22 + Gin** (Azure Container Apps) | Performance, typage fort, concurrent |
| Routing / isochrones | Valhalla (Azure Container Instances) | Open source, OSM natif |
| Service RAG | Python + FastAPI + CamemBERT + Mistral | Modèles français |
| Proto démo | Streamlit | Demandé par Epitech |
| Frontend | React 18 + TypeScript + CesiumJS + MapLibre GL | Compatible Mapbox (Epitech) |
| CI/CD | GitHub Actions → Azure Container Registry | Standard |
| IaC | Bicep (Azure resources) | Natif Azure |
