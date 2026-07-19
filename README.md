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
| Transactions enrichies DPE (classe énergie) | **1 899 179** |
| IPS écoles agrégé par commune | **989 communes** couvertes |
| Communes avec loyer médian | **1 266 / 1 266** (100%) |
| Indicateurs par commune | **40+** |
| Prévisions Prophet 2025-2026 | **1 274 communes** modélisées |
| Benchmark chatbot RAG | **12/12 questions** correctes |
| Latence API (cache chaud) | **< 50 ms** |
| Pipeline CI/CD | **Cloud Build → Cloud Run** (~3 min) |
| Modules gestion locative | **Biens · Locataires · Loyers · Quittances PDF · IRL** |
| Espace locataire | **Portail dédié · invitation · quittances autonomes** |
| Aide à l'achat | **Recherche multi-communes · estimation au percentile · rapports PDF** |
| Aide à la location | **Loyer de marché · encadrement des loyers · arbitrage louer/acheter** |
| Corpus juridique RAG | **64 chunks** (droit du logement + méthode d'achat) |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          DATA SOURCES                                │
│  DVF · DPE ADEME · INSEE · IPS DEPP · SSMSI · ENEDIS · OSM POI     │
│  BRGM Géorisques (argile + inondation)                               │
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
│  transactions (1.9M, DPE enrichi) · prix_forecast (Prophet 2025-26) │
└────────┬───────────────────────────────────────────────┬─────────────┘
         │                                               │
         ▼                                               ▼
┌─────────────────────────┐               ┌─────────────────────────────┐
│  BACKEND — Go 1.22 Gin  │               │  CHATBOT — Flask Python     │
│  Google Cloud Run       │               │  Google Cloud Run (2Gi)     │
│  Cache RAM + ETag       │               │  Qwen2.5-0.5B Q4_K_M        │
│  MVT PostGIS tiles      │               │  MiniLM-L12-v2 sémantique   │
│  OpenAPI 3.0 embedded   │               │  SSE streaming              │
└─────────────────────────┘               └─────────────────────────────┘
         │                                               │
         └───────────────────┬───────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  FRONTEND — React 18 + Vite                          │
│   MapLibre GL (2D/3D Cesium) · Timeline animée 2021-2026             │
│   Pareto Front Recharts · Chatbot SSE · Isochrones · Heatmap         │
│   Risques BRGM · Villes Jumelles · Portfolio · Comparateur           │
│   Gestion Locative (biens, loyers, quittances PDF, IRL, CSV)         │
│   Espace Locataire (portail dédié, invitation, téléchargements)      │
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
| **Backend API** | Go 1.22 + Gin | REST, cache RAM 1h, gzip, ETag, MVT PostGIS, OpenAPI embedded |
| **Chatbot** | Flask + llama-cpp-python | Qwen2.5-0.5B Q4_K_M, streaming SSE réel |
| **Intent detection** | MiniLM-L12-v2 + regex | Hybride cosine + 16 patterns prioritaires |
| **Carte** | MapLibre GL + CesiumJS | 2D choroplèthes + 3D OSM Buildings + timeline animée |
| **Frontend** | React 18 + Vite + Recharts | SSE streaming, Pareto Front, markdown renderer |
| **CI/CD** | Google Cloud Build + Cloud Run | 3 services Docker, ~3 min + pipeline MLOps éval RAG |

---

## Fonctionnalités

### Recherche multi-communes (`/dossier`)
Répond à la question posée avant toute visite : *où chercher ?*

- Classement des communes selon le critère prioritaire de l'utilisateur — prix,
  performance énergétique du parc, transports, cadre de vie ou sécurité — sous
  contrainte de budget
- Seuil de **40 ventes comparables** minimum par commune : en dessous, les
  percentiles ne sont plus significatifs
- Signalement des communes dont moins de 2 % du parc est classé A, B ou C
- Dossier imprimable : sélection, grille de visite et méthode de négociation

### Estimation d'un bien (`/estimation`)
Répond à la question suivante : *ce prix est-il justifié ?*

- Distribution des ventes comparables (p10 → p90) et position du prix demandé
- Cible de négociation chiffrée, du prix médian au premier quartile
- Prévision de prix (Prophet) et risques naturels de la commune
- Capacité d'emprunt (règle des 35 %, assurance et frais de notaire déduits)
- Coût des travaux énergétiques, MaPrimeRénov' et CEE déduits
- Rapport PDF et lecture guidée adaptée au percentile obtenu

### Contrôle de loyer (`/loyer`)
Pendant locatif de l'estimation, pour le locataire avant signature.

- Loyer de marché pour une surface donnée et positionnement du loyer demandé
- Signalement de l'encadrement des loyers (Paris, Plaine Commune, Est Ensemble),
  où un dépassement du loyer de référence majoré est récupérable
- Comparaison avec une mensualité de crédit pour un bien équivalent

### Carte interactive
- **Choroplèthes MVT** : tuiles vectorielles PostGIS (`ST_AsMVT`), couleurs par prix médian ou indicateur
- **Timeline animée 2021–2026** : slider + bouton play sur la heatmap, données `prix_forecast` (réel 2021-2024, prévision 2025-2026)
- **Vue 3D CesiumJS** : bâtiments OSM Buildings colorés par DPE, toggle 2D/3D
- **Isochrones ORS** : zones d'accessibilité 15/30/45 min (voiture · vélo · piéton) via OpenRouteService
- **Heatmap prix IDF** : overlay 1266 points avec couleurs gradient bleu→rouge
- **POI OpenStreetMap** : restaurants, écoles, parcs, transports, commerces — cache 3 niveaux (<50ms)
- Hover commune → surbrillance + lock · Clic → panel détaillé

### Fiche commune (panel droit)
- **Graphique Prophet** : historique DVF 2019–2024 + prévisions 2025–2026 avec intervalles de confiance 80%
- **Score expliqué** : 5 axes pondérés (Prix 35%, DPE 20%, IPS 20%, Transport 15%, Sécurité 10%)
- **Risques BRGM** : retrait-gonflement argile (0→3) + inondation (0→3) + badge score global
- **Villes jumelles** : communes similaires mais −8% minimum sur le prix au m² (distance euclidienne 5D)
- Communes similaires (5D euclidien) · Insights vs moyenne IDF
- Export PDF · Favoris avec surveillance variation prix · Boutons CTA vers Transactions/Portfolio

### Pareto Front multicritère (`/pareto`)
- **Scatter plot interactif** : 1264 communes sur axes rendement locatif vs score de risque
- **Front de Pareto calculé** : points non dominés (maximiser rendement, minimiser risque) surlignés et reliés
- Filtre par département (8 couleurs) · Points cliquables → navigate vers la commune
- Top communes du front optimal listées avec rendement

### Assistant IA HomePedia
- **16 intents** détectés (investissement, DPE, sécurité, rendement, risques, multi-critères, prévisions...)
- **Intent risques** : inondation BRGM, argile, géorisques, score environnemental par commune
- **Comparaison structurée** : table emoji côte-à-côte avec score gagnant automatique
- **Cache sémantique** : MiniLM cosine ≥ 0.92 — latence ÷3 pour questions similaires
- Streaming SSE token-par-token · Anti-hallucination post-stream

### Dashboard · Comparateur · Portfolio
- **Dashboard** : 3 niveaux macro→méso→micro (IDF → département → commune), distribution DPE
- **Comparateur** : top 5 communes par critère professionnel, scores expliqués côte-à-côte
- **Portfolio investisseur** : simulateur cash-flow (prix, apport, taux, durée, loyer, charges), graphique SVG 20 ans

### Gestion locative — Mon Patrimoine (`/gestion`)
Module propriétaire bailleur complet, sans abonnement, sans logiciel.

- **Biens** : ajout/modification/suppression, type, surface, loyer, dépôt de garantie
- **Locataires** : fiche locataire (prenom, nom, email, type bail, date entrée), modifier/désactiver
- **Suivi loyers** : grille 12 mois — clic pour marquer payé, clic long pour marquer impayé
- **Quittances PDF** : génération A4 instantanée conforme à l'art. 21 loi 89-462, impression navigateur
- **Calcul IRL** : indexation automatique avec valeurs INSEE T1-2023 → T2-2025
- **Export CSV** : récapitulatif comptable annuel (BOM UTF-8, compatible Excel)
- **Dashboard** : stats agrégées (nb biens, loyers mensuels, impayés)

### Espace locataire — Mon logement (`/mon-logement`)
Portail dédié accessible après invitation du bailleur.

- **Invitation** : le proprio génère un mot de passe temporaire depuis la fiche bien (1 clic)
- **Connexion** : le locataire se connecte et est redirigé automatiquement vers son espace
- **Fiche logement** : adresse, surface, type de bail, loyer HC + charges + total CC
- **Historique** : grille 12 mois avec statut payé/non payé
- **Quittances** : téléchargement PDF autonome pour chaque mois payé
- **Contact** : email du bailleur accessible directement

---

## Pipeline de données

```
DVF (DGFiP)       → prix/m² médian par commune/année (2019-2024), ~1.9M transactions
DPE (ADEME API)   → classe énergie A→G, enrichissement de 1 899 179 transactions
INSEE             → population, revenus médians
IPS (DEPP)        → indice position sociale par école, agrégé par commune (989/1266 communes)
SSMSI             → taux cambriolages/violence par département
ENEDIS/GRDF       → conso résidentielle MWh/logement
OSM (Overpass)    → poi_communes JSONB (restaurants, écoles, transports...)
BRGM Géorisques   → risque_argile, risque_inondation (0→3) pour 1266 communes

→ Azure Data Lake Gen2 (bronze/silver/gold)
→ Databricks PySpark (nettoyage, normalisation, scores composites)
→ Supabase PostgreSQL (communes_agregat 40+ cols, poi_communes)
→ Prophet (Meta) : prévisions 2025-2026 pour 1274 communes
```

---

## Prévisions Prophet

Le script `ingestion/forecast_prophet.py` entraîne un modèle Prophet par commune :
- **Données** : prix médian/m² DVF 2019–2024 (min 3 ans requis)
- **Paramètres** : `growth=linear`, `changepoint_prior_scale=0.05`, `interval_width=0.80`
- **Résultat** : historique + prévisions dans `prix_forecast` (1274 communes × 2021-2026)
- **Timeline carte** : `GET /api/v1/heatmap?year=2022` → données `prix_forecast` pour cette année

```bash
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
detect_intent()  [hybride MiniLM + 16 patterns regex]
       │
       ├── forecast_prix    → SQL prix_forecast JOIN communes_agregat → _forecast_fallback()
       ├── comparaison      → SQL communes_agregat WHERE city = ANY([...]) → _comparaison_table()
       ├── commune_detail   → SQL communes_agregat → _commune_detail_card() (Python pur, sans LLM)
       ├── risques          → SQL risque_argile, risque_inondation, score_risques → Qwen
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
| `GET /api/v1/communes/:code/agregat` | 40+ indicateurs agrégés (prix, scores, risques, IPS) |
| `GET /api/v1/communes/:code/insights` | Comparaisons textuelles vs IDF |
| `GET /api/v1/communes/:code/prix-historique` | Prix médian/m² par année (DVF) |
| `GET /api/v1/communes/:code/forecast` | Prévisions Prophet 2025-2026 + CAGR |
| `GET /api/v1/communes/:code/similaires` | Top 5 communes proches (5D euclidien) |
| `GET /api/v1/communes/:code/jumelles` | Communes similaires mais −8% sur le prix |
| `GET /api/v1/pareto` | Données Pareto Front (rendement vs risque, 1264 communes) |
| `GET /api/v1/heatmap[?year=2021..2026]` | Centroïdes + prix (actuel ou historique/prévision) |
| `GET /api/v1/tiles/:z/:x/:y` | Tuiles MVT PostGIS (MapLibre vector) |
| `GET /api/v1/isochrone` | Zone accessibilité ORS (GeoJSON) |
| `GET /api/v1/poi/:code` | POI OSM par commune (JSONB) |
| `GET /openapi.json` | Spec OpenAPI 3.0.3 complète |
| `GET /docs` | Swagger UI (redirect CDN) |
| `GET /api/v1/estimation` | Position d'un bien dans les ventes comparables (percentiles, tendance, prévision, risques) |
| `GET /api/v1/loyer` | Loyer de marché, encadrement des loyers, arbitrage louer/acheter |
| `GET /api/v1/dossier` | Short-list de communes selon budget et critère prioritaire |
| `POST /api/v1/rag/query` | Chatbot RAG (JSON) |
| `POST /api/v1/rag/query/stream` | Chatbot SSE streaming |

---

## Pipeline MLOps — LLM-as-a-Judge (#39)

Évalue automatiquement la qualité du chatbot RAG sur 12 cas de test :

```bash
# Lancer l'évaluation (URL prod par défaut)
python eval/rag_eval.py

# Lancer via Cloud Build
gcloud builds submit --config cloudbuild-rag-eval.yaml . --project=homepedia-493013
```

- **12 cas de test** couvrant tous les intents (prix, rendement, sécurité, risques, hors-scope...)
- **Règles déterministes** : prix plausibles IDF (800-16 000 €/m²), rendement réaliste (1-9%), pas de fuite SQL
- **Seuil configurable** : `RAG_PASS_THRESHOLD=0.83` (10/12 = 83%)
- **Rapport JSON** archivé automatiquement dans GCS après chaque run

---

## Déploiement

```bash
# Frontend + Backend Go (~3 min)
gcloud builds submit --config cloudbuild.yaml . --project=homepedia-493013

# Chatbot Python — uniquement si chatbot/ modifié (~40 min, E2_HIGHCPU_8)
gcloud builds submit --config cloudbuild-chatbot.yaml . --project=homepedia-493013

# Évaluation RAG (LLM-as-a-Judge)
gcloud builds submit --config cloudbuild-rag-eval.yaml . --project=homepedia-493013
```

**Cloud Run** (europe-west1) :
- `homepedia-frontend` — React Vite, nginx, port 8080
- `homepedia-backend` — Go Gin, 512Mi RAM, cache RAM 1h
- `homepedia-chat` — Flask + Qwen 2Gi RAM, gunicorn --preload

---

## Structure

```
T-DAT-902-PAR_3/
├── ingestion/              # Python ETL (DVF, DPE ADEME, INSEE, IPS, SSMSI, ENEDIS, POI)
│   └── forecast_prophet.py # Prévisions Prophet 2025-2026 par commune
├── databricks/             # Notebooks PySpark Bronze→Silver→Gold
├── docs/
│   └── openapi.json        # Spec OpenAPI 3.0.3 (auto-servie via /openapi.json)
├── eval/
│   └── rag_eval.py         # Pipeline MLOps LLM-as-a-Judge (12 cas de test, exit 1 si régression)
├── backend/                # Go 1.22 + Gin
│   ├── internal/
│   │   ├── handlers/       # communes, poi, forecast, tiles, isochrones, similaires, jumelles, pareto
│   │   └── spec/           # openapi.json embedded (//go:embed)
│   └── migrations/         # SQL Supabase
├── chatbot/                # Flask + Qwen2.5-0.5B
│   ├── intent_detector.py  # MiniLM + 16 patterns regex + templates SQL
│   └── chat_api.py         # SSE streaming, cache sémantique, anti-hallucination
├── frontend/               # React 18 + Vite
│   └── src/components/
│       ├── MapView.jsx      # MapLibre GL + Cesium 3D + timeline animée + BRGM + villes jumelles
│       ├── ParetoFront.jsx  # Scatter plot Pareto rendement vs risque (Recharts)
│       ├── ChatWidget.jsx   # Dark theme, SSE, markdown renderer
│       └── Portfolio.jsx    # Simulateur cash-flow 20 ans
├── cloudbuild.yaml          # Frontend + Backend (~3 min)
├── cloudbuild-chatbot.yaml  # Chatbot Qwen (~40 min)
└── cloudbuild-rag-eval.yaml # Pipeline MLOps évaluation RAG
```

---

## Collaborateurs

- **Christophe** — Backend Go, chatbot IA, pipeline données, frontend carte/dashboard
- **Ludovic** — Notebooks Databricks Silver→Gold (DVF, DPE, INSEE, OSM, communes)
