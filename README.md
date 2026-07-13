# HomePedia IDF — Jumeau Numérique de l'Immobilier Francilien

> **Epitech Paris · T-DAT-902 · Big Data Housing**

Application web de visualisation et d'analyse du marché immobilier en Île-de-France, avec assistant IA conversationnel intégré.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          DATA SOURCES                                │
│  DVF · DPE ADEME · INSEE · OSM POI · IPS DEPP · SSMSI · ENEDIS     │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │  Python ingestion/ scripts
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│              AZURE DATA LAKE GEN2 — homepediadatalake                │
│   /bronze (raw Parquet)  /silver (nettoyé)  /gold (enrichi IDF)     │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │  Azure Databricks (PySpark)
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   SUPABASE POSTGRESQL                                │
│   communes_agregat (1266 communes IDF, 40+ indicateurs)             │
│   poi_communes (POI JSONB par commune — transports, sécurité, ...)  │
│   dpe, transactions, loyers, scores composites                       │
└──────────┬──────────────────────────────────────────────────────────┘
           │                              │
           ▼                              ▼
┌─────────────────────────┐   ┌──────────────────────────────────────┐
│  BACKEND — Go 1.22 Gin  │   │  CHATBOT — Flask + Qwen2.5-0.5B     │
│  Google Cloud Run       │   │  Google Cloud Run                    │
│  /api/v1/communes       │   │  /chat (JSON)                        │
│  /api/v1/poi/:code      │   │  /chat/stream (SSE)                  │
│  /api/v1/agregat/:code  │   │  Intent detection + SQL templates    │
│  Cache RAM 1h + ETag    │   │  llama-cpp-python Q4_K_M             │
└─────────────────────────┘   └──────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│               FRONTEND — React 18 + Vite                             │
│   MapLibre GL (carte choroplèthes)  Recharts (stats)                │
│   ChatWidget dark theme  Dashboard  Comparateur                     │
│   Google Cloud Run                                                   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Stack Technique

| Couche | Technologie | Usage |
|--------|-------------|-------|
| **Ingestion** | Python 3.11 + psycopg2 + requests | ETL open data → Supabase direct |
| **Big Data** | Azure Data Lake Gen2 + Databricks/PySpark | Bronze → Silver → Gold |
| **BDD** | Supabase PostgreSQL (TimescaleDB) | communes_agregat, poi_communes, DPE |
| **Backend API** | Go 1.22 + Gin | REST API, cache RAM, ETag |
| **LLM** | Qwen2.5-0.5B Q4_K_M (llama-cpp) | Réponses NL français |
| **Intent detection** | MiniLM-L12-v2 + regex | Hybride cosine + patterns prioritaires |
| **Chatbot API** | Flask + psycopg2 | SQL templates → LLM → réponse |
| **Frontend** | React 18 + Vite + MapLibre GL | Carte + chat + stats |
| **CI/CD** | Google Cloud Build + Cloud Run | Pipeline Docker |
| **Registre** | Artifact Registry GCP | Images Docker |

---

## Structure du Projet

```
T-DAT-902-PAR_3/
├── ingestion/                     # Scripts Python ETL
│   ├── dvf/                       # Transactions immobilières
│   ├── insee/                     # Populations + revenus
│   ├── ademe_dpe/                 # DPE logements
│   ├── ips/                       # IPS écoles (DEPP/MEN)
│   ├── delinquance/               # SSMSI cambriolages/violence
│   ├── energie/                   # ENEDIS/GRDF conso résidentielle
│   ├── scores/                    # Scores composites 0-100
│   ├── ingest_poi.py              # POI Overpass → poi_communes JSONB
│   └── run_pipeline.sh            # Orchestration complète
│
├── databricks/                    # Notebooks PySpark
│   ├── raw_to_bronze/             # Téléchargement données sources
│   ├── Bronze_to_silver/          # Nettoyage + normalisation
│   └── export_gold_to_postgres.py # Export Gold → Supabase JDBC
│
├── backend/                       # API Go (Gin)
│   ├── cmd/server/main.go         # Routes + middlewares
│   ├── internal/
│   │   ├── handlers/              # communes.go, poi.go, agregat.go...
│   │   ├── middleware/            # http_cache.go (Cache-Control headers)
│   │   └── cache/                 # Cache RAM en mémoire (TTL 1h)
│   └── migrations/                # SQL migrations Supabase
│
├── chatbot/                       # Assistant IA RAG
│   ├── chat_api.py                # Flask API /chat + /chat/stream
│   ├── intent_detector.py         # MiniLM-L12-v2 + regex prioritaires
│   ├── sql_executor.py            # Templates SQL → psycopg2
│   ├── qwen_manager.py            # llama-cpp Qwen2.5-0.5B
│   └── Dockerfile                 # Image ~800MB (modèle baked)
│
├── frontend/                      # React 18 + Vite
│   ├── src/
│   │   ├── pages/                 # Dashboard, Map, Compare, Landing
│   │   └── components/
│   │       ├── MapView.jsx        # MapLibre GL + POI cache L1
│   │       ├── ChatWidget.jsx     # Dark theme + markdown rendering
│   │       ├── Dashboard.jsx      # Indicateurs commune
│   │       └── Comparer.jsx       # Comparaison multi-communes
│   └── Dockerfile
│
├── cloudbuild.yaml                # Pipeline principal (front + back, ~3 min)
└── cloudbuild-chatbot.yaml        # Pipeline chatbot manuel (E2_HIGHCPU_8, ~40 min)
```

---

## Données Intégrées

### Table `communes_agregat` — 1266 communes IDF

| Source | Données | Statut |
|--------|---------|--------|
| DVF (DGFiP) | Transactions immobilières 2020–2024, prix/m² | ✅ |
| DPE (ADEME) | Performance énergétique logements (A→G) | ✅ |
| INSEE | Populations, revenus médians | ✅ |
| OSM | POI (transports, sécurité, restauration...) | ✅ poi_communes |
| IPS (DEPP/MEN) | Indice position sociale écoles — 989/1266 communes | ✅ |
| SSMSI | Cambriolages + violence par département | ✅ |
| ENEDIS/GRDF | Conso résidentielle MWh/logement | ✅ |
| CLAMEUR | Loyer médian/m², rendement locatif | ✅ |

**Scores composites calculés (0-100) :**
- `score_global` · `score_invest` · `qualite_vie` · `score_securite` · `score_dpe`

---

## Fonctionnalités

### Carte interactive (MapLibre GL)
- Choroplèthes coloriées par indicateur (prix, DPE, sécurité, QdV...)
- Clic commune → panel détaillé (prix, scores, DPE, indicateurs)
- POI par catégorie : transports, hôpitaux, restaurants, écoles, parcs, commerces
- **Cache POI multi-niveaux** : L1 RAM JS → L2 HTTP 24h → L3 Supabase JSONB
- Prefetch hover : POI chargé au survol avant le clic (<50ms vs 1-4s Overpass)

### Assistant IA HomePedia (Chatbot)
- Intents détectés : top communes par prix/rendement/QdV/sécurité/DPE, comparaisons, multi-critères
- Court-circuit salutations (sans SQL → réponse d'aide immédiate)
- Réponse JSON + SSE streaming
- LLM Qwen2.5-0.5B Q4_K_M, ~1-3s warm

### Dashboard & Comparateur
- Indicateurs par commune avec barres DPE, scores 0-100
- Comparaison côte-à-côte de plusieurs communes

---

## Déploiement

### CI/CD Google Cloud Build

```bash
# Pipeline principal (frontend + backend) — auto-déclenché sur push
# Déclencher manuellement :
gcloud builds submit --config cloudbuild.yaml .

# Pipeline chatbot — UNIQUEMENT si chatbot/ modifié
/home/lekrikri/google-cloud-sdk/bin/gcloud builds submit \
  --config cloudbuild-chatbot.yaml . --async
```

### Cloud Run (europe-west1)
- `homepedia-frontend` — React Vite, port 8080
- `homepedia-api` — Go Gin, port 8080, 512Mi RAM
- `homepedia-chat` — Flask + Qwen, port 8080, 2Gi RAM

### Variables d'environnement Backend
```
POSTGRES_HOST=aws-0-eu-west-1.pooler.supabase.com
POSTGRES_PORT=5432
POSTGRES_DB=postgres
POSTGRES_USER=postgres.iugsfmvqddburvufzacy
POSTGRES_SSLMODE=require
# POSTGRES_PASSWORD = secret GCP "homepedia-supabase-password"
```

---

## Ingestion POI (à relancer ~1x/mois)

```bash
cd ingestion/

# Toutes les communes IDF (~32 min)
python3 ingest_poi.py --skip-existing

# Test sur un département
python3 ingest_poi.py --dept 92 --limit 5
```

Le script fait des requêtes GET à l'API Overpass (1.5s délai entre communes) et stocke le résultat classifié en JSONB dans `poi_communes`.

---

## Supabase

- Host : `db.iugsfmvqddburvufzacy.supabase.co` (port 5432)
- DB : `postgres` | User : `postgres`
- MCP configuré dans `.mcp.json` (project_ref=`iugsfmvqddburvufzacy`)

---

## Collaborateurs

- **Ludovic** — notebooks Databricks Silver→Gold
- **Christophe (lekrikri)** — ingestion, backend Go, chatbot, frontend, CI/CD
