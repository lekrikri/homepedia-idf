# HomePedia IDF — Jumeau Numérique de l'Immobilier Francilien

> Plateforme de data visualisation et d'IA conversationnelle sur le marché immobilier en Île-de-France.  
> **Epitech Paris · T-DAT-902 · Big Data Engineering**

![Go](https://img.shields.io/badge/Go-1.22-00ADD8?logo=go&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Cloud Run](https://img.shields.io/badge/Cloud_Run-GCP-4285F4?logo=googlecloud&logoColor=white)
![Databricks](https://img.shields.io/badge/Databricks-PySpark-FF3621?logo=databricks&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase&logoColor=white)

---

## Points forts

| Métrique | Valeur |
|----------|--------|
| Communes IDF couvertes | **1 266** (100%) |
| Sources de données intégrées | **7** (DVF, DPE, INSEE, IPS, SSMSI, ENEDIS, OSM) |
| Transactions DVF indexées | **~1 900 000** (2019–2024) |
| IPS écoles agrégé par commune | **989 communes** couvertes |
| Indicateurs par commune | **40+** |
| Prévisions Prophet 2025-2026 | **1 274 communes** modélisées |
| Benchmark chatbot RAG | **12/12 questions** correctes |
| Latence API (cache chaud) | **< 50 ms** |
| Pipeline CI/CD | **Cloud Build → Cloud Run** (~3 min) |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          DATA SOURCES                                │
│  DVF · DPE ADEME · INSEE · IPS DEPP · SSMSI · ENEDIS · OSM POI     │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │  Python ingestion/ scripts
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│              AZURE DATA LAKE GEN2 — homepediadatalake                │
│       /bronze (raw Parquet) · /silver (nettoyé) · /gold (IDF)       │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │  Azure Databricks (PySpark)
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      SUPABASE POSTGRESQL                             │
│  communes_agregat (1266 communes, 40+ cols)  poi_communes JSONB      │
│  transactions · dpe · prix_forecast (Prophet 2025-2026)              │
└────────┬───────────────────────────────────────────────┬─────────────┘
         │                                               │
         ▼                                               ▼
┌─────────────────────────┐               ┌─────────────────────────────┐
│  BACKEND — Go 1.22 Gin  │               │  CHATBOT — Flask Python     │
│  Google Cloud Run       │               │  Google Cloud Run (2Gi)     │
│  Cache RAM + ETag       │               │  Qwen2.5-0.5B Q4_K_M        │
│  MVT PostGIS tiles      │               │  MiniLM-L12-v2 sémantique   │
│  Proxy ORS isochrones   │               │  SSE streaming              │
└─────────────────────────┘               └─────────────────────────────┘
         │                                               │
         └───────────────────┬───────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  FRONTEND — React 18 + Vite                          │
│   MapLibre GL (2D/3D Cesium) · Prophet charts · Chatbot SSE          │
│   Isochrones · Heatmap · Portfolio simulateur · Comparateur          │
│   Google Cloud Run                                                   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Stack Technique

| Couche | Technologie | Détail |
|--------|-------------|--------|
| **Ingestion** | Python 3.11 · psycopg2 · requests | ETL 7 sources → Supabase |
| **Big Data** | Azure Data Lake Gen2 + Databricks PySpark | Bronze → Silver → Gold |
| **BDD** | Supabase PostgreSQL + PostGIS | 1266 communes, 40+ indicateurs, MVT tiles |
| **Prévisions** | Prophet (Meta/Facebook) | Time-series bayésien par commune, intervalles 80% |
| **Backend API** | Go 1.22 + Gin | REST, cache RAM 1h, gzip, ETag, MVT PostGIS |
| **Chatbot** | Flask + llama-cpp-python | Qwen2.5-0.5B Q4_K_M, streaming SSE réel |
| **Intent detection** | MiniLM-L12-v2 + regex | Hybride cosine + 15 patterns prioritaires |
| **Carte** | MapLibre GL + CesiumJS | 2D choroplèthes + 3D OSM Buildings |
| **Frontend** | React 18 + Vite + Recharts | SSE streaming, markdown renderer |
| **CI/CD** | Google Cloud Build + Cloud Run | 3 services Docker, ~3 min pipeline |

---

## Fonctionnalités

### Carte interactive
- **Choroplèthes MVT** : tuiles vectorielles PostGIS (`ST_AsMVT`), couleurs par prix médian ou indicateur
- **Vue 3D CesiumJS** : bâtiments OSM Buildings colorés par DPE, toggle 2D/3D
- **Isochrones ORS** : zones d'accessibilité 15/30/45 min (voiture · vélo · piéton) via OpenRouteService
- **Heatmap prix IDF** : overlay 1266 points sur la carte complète
- **POI OpenStreetMap** : restaurants, écoles, parcs, transports, commerces — cache 3 niveaux (<50ms)
- Hover commune → surbrillance + lock · Clic → panel détaillé

### Fiche commune (panel droit)
- **Graphique Prophet** : historique DVF 2019–2024 + prévisions 2025–2026 avec intervalles de confiance 80%  
  *(zone grisée yhat_lower/yhat_upper, séparateur historique/forecast, tendance ±%)*
- **Score expliqué** : 5 axes pondérés (Prix 35%, DPE 20%, IPS 20%, Transport 15%, Sécurité 10%)
- Insights automatiques vs moyenne IDF · Communes similaires (distance euclidienne 5D)
- Export PDF · Favoris avec surveillance variation prix · Boutons CTA vers Transactions/Portfolio

### Assistant IA HomePedia
- **15 intents** détectés (investissement, DPE, sécurité, rendement, multi-critères, prévisions...)
- **Comparaison structurée** : table emoji côte-à-côte avec score gagnant automatique
- **Intent forecast_prix** : réponse Prophet directe (sans LLM) — précise et rapide
- **Co-référence contextuelle** : "et Bagnolet ?" reconnu après une question sur une autre commune
- **Cache sémantique** : MiniLM cosine ≥ 0.92 — latence ÷3 pour questions similaires
- Streaming SSE token-par-token · Score de confiance 0–100 par réponse
- Anti-hallucination : validation post-stream des nombres, remplacement si invalide

### Dashboard · Comparateur · Portfolio
- **Dashboard** : 3 niveaux macro→méso→micro (IDF → département → commune), distribution DPE
- **Comparateur** : top 5 communes par critère professionnel, scores expliqués côte-à-côte
- **Portfolio investisseur** : simulateur cash-flow (prix, apport, taux, durée, loyer, charges), graphique SVG 20 ans, connecté via query params depuis Carte/Transactions/Comparer

---

## Pipeline de données

```
DVF (DGFiP)     → prix/m² médian par commune/année (2019-2024), ~1.9M transactions
DPE (ADEME)     → performance énergétique A→G, score composite communes + enrichissement transactions
INSEE           → population, revenus médians
IPS (DEPP)      → indice position sociale par école, agrégé par commune (989/1266 communes)
SSMSI           → taux cambriolages/violence par département
ENEDIS/GRDF     → conso résidentielle MWh/logement
OSM (Overpass)  → poi_communes JSONB (restaurants, écoles, transports...)

→ Azure Data Lake Gen2 (bronze/silver/gold)
→ Databricks PySpark (nettoyage, normalisation, scores composites)
→ Supabase PostgreSQL (communes_agregat 40+ cols, poi_communes)
→ Prophet (Meta) : prévisions 2025-2026 pour 1274 communes
```

---

## Prévisions Prophet

Le script `ingestion/forecast_prophet.py` entraîne un modèle Prophet par commune :
- **Données** : prix médian/m² DVF 2019–2024 (min 3 ans requis)
- **Paramètres** : `growth=linear`, `changepoint_prior_scale=0.05`, `interval_width=0.80`, pas de saisonnalité
- **Résultat** : 7 579 lignes en base (1274 communes × 6 années historique + 2 prévisions)
- **Clamping** : prix ≥ 1 000 €/m² et ≤ 3× dernier prix connu

```bash
# Réentraîner les prévisions (venv isolé numpy<2 requis)
cd ingestion/
python3 -m venv .venv_prophet && source .venv_prophet/bin/activate
pip install 'numpy<2' prophet psycopg2-binary pandas
python3 forecast_prophet.py
```

---

## Chatbot RAG — Architecture

```
Question utilisateur
       │
       ├── Knowledge Base (loyer, PTZ, Pinel, DPE...) → réponse directe
       ├── Cache sémantique (MiniLM cosine ≥ 0.92) → réponse cachée
       │
       ▼
detect_intent()  [hybride MiniLM + 15 patterns regex]
       │
       ├── forecast_prix    → SQL prix_forecast JOIN communes_agregat → _forecast_fallback()
       ├── comparaison      → SQL communes_agregat WHERE city = ANY([...]) → _comparaison_table()
       ├── commune_detail   → SQL communes_agregat → _commune_detail_card() (Python pur, sans LLM)
       ├── salutation       → réponse fixe (sans SQL)
       ├── general/hors_scope → réponse fixe
       │
       └── autres intents → SQL template → Qwen2.5-0.5B Q4_K_M → stream SSE
                                              └── anti-hallucination → fallback si invalide
```

---

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/communes` | Liste 1266 communes avec scores |
| `GET /api/v1/communes/:code` | Détail commune |
| `GET /api/v1/communes/:code/insights` | Comparaisons textuelles vs IDF |
| `GET /api/v1/communes/:code/prix-historique` | Prix médian/m² par année |
| `GET /api/v1/communes/:code/forecast` | Prévisions Prophet 2025-2026 + CAGR |
| `GET /api/v1/communes/:code/similaires` | Top 5 communes proches (5D euclidien) |
| `GET /api/v1/isochrone` | Zone accessibilité ORS (GeoJSON) |
| `GET /api/v1/tiles/:z/:x/:y` | Tuiles MVT PostGIS (MapLibre vector) |
| `GET /api/v1/heatmap` | Centroïdes + prix médian pour heatmap |
| `GET /api/v1/poi/:code` | POI OSM par commune (JSONB) |
| `POST /chat/stream` | Chatbot SSE streaming |

---

## Déploiement

```bash
# Frontend + Backend Go (~3 min)
gcloud builds submit --config cloudbuild.yaml . --project=homepedia-493013

# Chatbot Python — uniquement si chatbot/ modifié (~40 min, E2_HIGHCPU_8)
gcloud builds submit --config cloudbuild-chatbot.yaml . --project=homepedia-493013
```

**Cloud Run** (europe-west1) :
- `homepedia-frontend` — React Vite, nginx, port 8080
- `homepedia-backend` — Go Gin, 512Mi RAM, cache RAM 1h
- `homepedia-chat` — Flask + Qwen 2Gi RAM, gunicorn --preload

---

## Structure

```
T-DAT-902-PAR_3/
├── ingestion/              # Python ETL (DVF, DPE, INSEE, IPS, SSMSI, ENEDIS, POI)
│   └── forecast_prophet.py # Prévisions Prophet 2025-2026 par commune
├── databricks/             # Notebooks PySpark Bronze→Silver→Gold
├── backend/                # Go 1.22 + Gin
│   ├── internal/handlers/  # communes, poi, forecast, tiles (MVT), isochrones, similaires
│   └── migrations/         # SQL Supabase (006 = prix_forecast)
├── chatbot/                # Flask + Qwen2.5-0.5B
│   ├── intent_detector.py  # MiniLM + 15 patterns regex + templates SQL
│   └── chat_api.py         # SSE streaming, cache sémantique, anti-hallucination
└── frontend/               # React 18 + Vite
    └── src/components/
        ├── MapView.jsx      # MapLibre GL + Cesium 3D + Prophet chart + isochrones
        ├── ChatWidget.jsx   # Dark theme, SSE, markdown renderer
        └── Portfolio.jsx    # Simulateur cash-flow 20 ans
```

---

## Collaborateurs

- **Christophe** — Backend Go, chatbot IA, pipeline données, frontend carte/dashboard
- **Ludovic** — Notebooks Databricks Silver→Gold (DVF, DPE, INSEE, OSM, communes)
