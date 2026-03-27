# HomePedia IDF — Jumeau Numérique de l'Immobilier Francilien

> **Epitech Paris · T-DAT-902 · Big Data Housing**
> Issu du projet ITP "Jumeau Numérique de l'Immobilier Francilien"

---

## Vision Produit

**HomePedia IDF** est une application web de visualisation 3D du marché immobilier en France, avec focus sur l'Île-de-France. L'utilisateur navigue fluidement depuis la vue régionale jusqu'au bâtiment individuel — chaque bâtiment rendu en 3D à partir des données OSM et du Cadastre IGN.

Un assistant conversationnel IA intégré (RAG) permet d'interroger les données en langage naturel : prix au m², comparaison de quartiers, impact des transports, tendances par période.

**Différenciateurs clés :**
- Visualisation 3D bâtiment par bâtiment (CesiumJS + 3D Tiles)
- Assistant IA conversationnel sur les données immobilières
- Pipeline open data complet : DVF · INSEE · ADEME DPE · OSM · GTFS IDFM
- Stack Big Data industrielle : Azure Data Lake → Databricks/Spark → PostgreSQL/PostGIS

---

## Architecture Globale

```
┌──────────────────────────────────────────────────────────────────────┐
│                          DATA SOURCES                                │
│   DVF (France)  │  INSEE  │  ADEME DPE  │  OSM/IGN  │  GTFS IDFM   │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │  Python scripts (ingestion/)
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│              AZURE DATA LAKE STORAGE GEN2 — homepediadatalake        │
│   /bronze (raw Parquet)  /silver (nettoyé)  /gold (enrichi IDF)     │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │  Azure Databricks (PySpark)
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│                 AZURE DATABRICKS — homepedia-dbx                     │
│   bronze→silver (nettoyage)  silver→gold (enrichissement spatial)    │
│   MLflow (score investissement XGBoost)  Delta Live Tables           │
└──────────┬─────────────────────────────────────────────┬─────────────┘
           │                                             │
           ▼                                             ▼
┌─────────────────────────┐               ┌─────────────────────────────┐
│  PostgreSQL 17 + PostGIS│               │   MongoDB Atlas             │
│  homepedia-postgres     │               │   avis_quartiers            │
│  transactions DVF       │               │   rapports_marche           │
│  communes / IRIS / géom │               └──────────────┬──────────────┘
│  stats gold             │                              │ embeddings
└──────────┬──────────────┘               ┌─────────────▼──────────────┐
           │  pg_tileserv (MVT)           │   ChromaDB (vecteurs RAG)  │
           │                              │   CamemBERT embeddings      │
           ▼                              └─────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│             BACKEND — Go 1.22 (Gin) + Redis L2 cache                 │
│                  Azure Container Apps                                │
│  /api/communes  /api/transactions  /api/batiments/:id               │
│  /api/score     /api/rag/query     /api/tiles/{z}/{x}/{y}.mvt       │
│  /api/isochrone /api/stats/heatmap /api/stats/evolution             │
└────────────────────────────────┬─────────────────────────────────────┘
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│               FRONTEND — React 18 + TypeScript                       │
│   CesiumJS (3D bâtiments)  MapLibre GL (choroplèthes MVT)           │
│   Recharts (statistiques)  Chat RAG (assistant IA)                  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Stack Technique

| Couche | Technologie | Usage |
|--------|-------------|-------|
| **Ingestion** | Python 3.11 + pandas + requests | Scripts ETL open data |
| **Stockage brut** | Azure Data Lake Gen2 (Parquet) | Bronze / Silver / Gold |
| **Big Data** | Azure Databricks + PySpark | Transformations distribuées |
| **Format** | Delta Lake | Transactions ACID + versioning |
| **BDD relationnelle** | PostgreSQL 17 + PostGIS 3.6 | Données géospatiales |
| **BDD documents** | MongoDB Atlas | Avis quartiers + rapports |
| **Vecteurs RAG** | ChromaDB | Embeddings CamemBERT |
| **Cache** | Redis (Azure Cache) | Requêtes PostGIS lentes |
| **Backend API** | Go 1.22 + Gin | REST + MVT |
| **ML** | XGBoost + MLflow | Score investissement |
| **Frontend** | React 18 + TypeScript | UI principale |
| **3D** | CesiumJS + 3D Tiles | Visualisation bâtiments |
| **Cartes** | MapLibre GL | Choroplèthes vectorielles |
| **NLP** | CamemBERT (sentence-transformers) | Embeddings français |
| **Déploiement** | Azure Container Apps + ACR | CI/CD Docker |

---

## Infrastructure Azure

| Ressource | Nom | Région |
|-----------|-----|--------|
| Resource Group | `homepedia-rg` | Sweden Central |
| Data Lake Gen2 | `homepediadatalake` | Sweden Central |
| Databricks | `homepedia-dbx` | Sweden Central |
| PostgreSQL 17 | `homepedia-postgres` | Sweden Central |
| Redis | `homepedia-redis` | Sweden Central |
| Key Vault | `homepedia-kv` | Sweden Central |
| Container Registry | `homepediaacr` | Sweden Central |

**Containers Data Lake :**
- `raw/` — fichiers source bruts avant traitement
- `bronze/` — Parquet partitionné, données nettoyées minimalement
- `silver/` — nettoyé, normalisé, anonymisé RGPD
- `gold/` — enrichi, agrégé, prêt pour l'API (focus IDF)

---

## Structure du Projet

```
homepedia/
├── ingestion/                     # Scripts Python d'ingestion (Phase 2)
│   ├── .env                       # Variables d'env partagées (NE PAS COMMITTER)
│   ├── .env.example               # Template variables d'environnement
│   ├── dvf/
│   │   ├── download.py            # DVF France entière → bronze/dvf/
│   │   └── requirements.txt
│   ├── insee/
│   │   └── download.py            # Populations + revenus → bronze/insee/
│   ├── ademe_dpe/
│   │   └── download.py            # DPE IDF → bronze/dpe/
│   ├── osm/
│   │   └── extract.py             # POI IDF via Overpass → bronze/osm/
│   ├── gtfs_idfm/
│   │   └── download.py            # Transports IDF → bronze/gtfs/
│   ├── tiles/
│   │   └── generate_3dtiles.py    # 3D Tiles depuis OSM (TODO)
│   └── load_postgres.py           # Parquet gold → PostgreSQL (TODO)
│
├── databricks/                    # Notebooks PySpark (Phase 3)
│   ├── bronze_to_silver/
│   │   ├── dvf_cleaning.py
│   │   ├── insee_cleaning.py
│   │   ├── dpe_cleaning.py
│   │   └── osm_cleaning.py
│   ├── silver_to_gold/
│   │   ├── spatial_joins.py
│   │   ├── aggregations.py
│   │   └── network_analysis.py
│   ├── ml/
│   │   ├── investment_score.py    # XGBoost + MLflow
│   │   └── serve_score.py
│   └── pipelines/
│       └── homepedia_dlt.py       # Delta Live Tables
│
├── backend/                       # API Go (Phase 5)
│   ├── cmd/server/main.go
│   ├── internal/
│   │   ├── handlers/              # HTTP handlers (communes, transactions, rag...)
│   │   ├── repository/            # Accès BDD (PostgreSQL, MongoDB, Redis)
│   │   ├── services/              # Logique métier
│   │   └── models/                # Structs Go
│   ├── go.mod
│   └── Dockerfile
│
├── rag/                           # Service RAG Python (Phase 6)
│   ├── embeddings/generate.py     # CamemBERT → ChromaDB
│   ├── query/rag_query.py         # Query RAG + LLM
│   └── Dockerfile
│
├── frontend/                      # React 18 (Phase 7)
│   ├── src/
│   │   ├── pages/
│   │   │   ├── LandingPage.tsx
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── MapPage.tsx
│   │   │   └── LoginPage.tsx
│   │   ├── components/
│   │   │   ├── map/               # CesiumJS 3D + MapLibre choroplèthes
│   │   │   ├── charts/            # Recharts statistiques
│   │   │   └── rag/               # Chat panel assistant IA
│   │   └── lib/api.ts
│   └── Dockerfile
│
├── streamlit/                     # Prototype démo soutenance
│   └── app.py
│
├── infra/
│   ├── bicep/                     # IaC Azure (Bicep)
│   └── docker-compose.yml         # Env de dev local complet
│
├── docs/
│   ├── schema_db.md               # Schéma BDD (livrable Epitech)
│   ├── data_cleaning.md           # Méthodologie nettoyage (livrable Epitech)
│   ├── rgpd.md                    # Conformité RGPD
│   └── hadoop_spark.md            # Justification Hadoop/Spark/HDFS
│
└── README.md                      # Ce fichier
```

---

## Données Ingérées (Phase 2 — Terminée ✅)

### État Azure Data Lake — container `bronze/`

| Source | Données | Volume | Statut |
|--------|---------|--------|--------|
| **DVF** | Transactions immobilières France entière 2020–2024 | 500 fichiers Parquet | ✅ Uploadé |
| **INSEE Populations** | 34 970 communes — populations légales 2021 | 796 KB Parquet | ✅ Uploadé |
| **INSEE Revenus** | Filosofi — revenus médians par commune | — | ⚠️ Manuel requis |
| **ADEME DPE** | 800 000 DPE logements IDF (8 depts) | ~19 MB Parquet | ✅ Uploadé |
| **OSM POI** | 172 911 points d'intérêt IDF (7 catégories) | ~6 MB Parquet | ✅ Uploadé |
| **GTFS IDFM** | Arrêts + lignes Île-de-France Mobilités | — | Script prêt |

### Sources des données

| Dataset | Source | Licence |
|---------|--------|---------|
| DVF — Demandes de Valeurs Foncières | [data.gouv.fr](https://www.data.gouv.fr/fr/datasets/demandes-de-valeurs-foncieres/) | Licence Ouverte 2.0 |
| INSEE — Populations légales | [insee.fr](https://www.insee.fr/fr/statistiques/7739582) | Licence Ouverte 2.0 |
| INSEE — Filosofi revenus | [insee.fr](https://www.insee.fr/fr/statistiques/7233950) | Licence Ouverte 2.0 |
| ADEME — DPE logements | [data.ademe.fr](https://data.ademe.fr/datasets/dpe-v2-logements-existants) | Licence Ouverte 2.0 |
| OSM — Points d'intérêt | [OpenStreetMap](https://www.openstreetmap.org) via Overpass API | ODbL |
| GTFS IDFM — Transports | [IDFM Open Data](https://data.iledefrance-mobilites.fr) | Licence Ouverte 2.0 |

### RGPD — Anonymisation DVF

Les fichiers DVF contiennent historiquement des noms d'acheteurs/vendeurs. Notre script supprime automatiquement à l'ingestion les colonnes :
`nom_vendeur`, `nom_acheteur`, `prenom_vendeur`, `prenom_acheteur`

Aucune donnée nominative n'est stockée sur Azure.

---

## User Stories — Fonctionnalités IHM

### Epics

```
EP-01  Exploration cartographique 3D
EP-02  Analyse du marché immobilier
EP-03  Assistant IA conversationnel (RAG)
EP-04  Score d'investissement
EP-05  Gestion de compte utilisateur
EP-06  Alertes et favoris
```

---

### EP-01 — Exploration Cartographique 3D

**US-01.1** — Navigation multi-niveaux
> En tant qu'utilisateur, je veux naviguer de la vue France entière jusqu'au bâtiment individuel, afin de comprendre le marché à différentes granularités.

**Critères d'acceptance :**
- Zoom 1 : France → régions colorées par prix médian/m²
- Zoom 2 : région → départements (choroplèthe)
- Zoom 3 : département → communes (choroplèthe + données au survol)
- Zoom 4 : commune → IRIS (maille fine)
- Zoom 5 : bâtiment → rendu 3D individuel + fiche détaillée

---

**US-01.2** — Visualisation 3D des bâtiments
> En tant qu'utilisateur, je veux voir les bâtiments en 3D avec leur vraie hauteur, afin d'avoir une représentation fidèle du tissu urbain.

**Critères d'acceptance :**
- Bâtiments rendus depuis 3D Tiles (CesiumJS)
- Hauteur réelle depuis OSM / BD TOPO IGN
- Couleur des bâtiments selon DPE (A=vert foncé … G=rouge)
- Clic sur bâtiment → fiche : adresse, DPE, transactions récentes, prix/m²

---

**US-01.3** — Filtres cartographiques
> En tant qu'utilisateur, je veux filtrer la carte par critères, afin de trouver les zones correspondant à mon projet.

**Critères d'acceptance :**
- Filtre par type de bien : appartement / maison / tous
- Filtre par fourchette de prix : slider min–max €/m²
- Filtre par période : 2020, 2021, 2022, 2023, 2024
- Filtre par DPE : A/B/C/D/E/F/G (multi-sélection)
- Filtre par score investissement : slider 0–100
- Réinitialisation en un clic

---

**US-01.4** — Couches cartographiques
> En tant qu'utilisateur, je veux activer/désactiver des couches d'information, afin de personnaliser ma vue.

**Critères d'acceptance :**
- Couche transport : lignes métro/RER/tram (GTFS)
- Couche POI : écoles, hôpitaux, commerces, parcs
- Couche isochrones : zones accessibles en X minutes depuis un point
- Couche heatmap transactions : densité des ventes récentes
- Toggle on/off par couche avec légende

---

### EP-02 — Analyse du Marché Immobilier

**US-02.1** — Fiche commune
> En tant qu'utilisateur, je veux accéder à une fiche détaillée d'une commune, afin d'analyser le marché local.

**Contenu de la fiche :**
```
┌──────────────────────────────────────────────────────────┐
│  Vincennes (94300)                        Score : 78/100 │
├──────────────────────────────────────────────────────────┤
│  Prix médian : 6 850 €/m²   Tendance : +3.2% /an        │
│  Nb transactions 2024 : 342  Surface médiane : 58 m²     │
├──────────────────────────────────────────────────────────┤
│  [Graphique] Évolution prix 2020–2024                    │
│  [Graphique] Distribution DPE                            │
│  [Graphique] Répartition types de biens                  │
├──────────────────────────────────────────────────────────┤
│  Population : 48 000 hab.  Revenu médian : 32 500 €/an   │
│  Taux pauvreté : 8.2%                                    │
├──────────────────────────────────────────────────────────┤
│  Transport : RER A (3 min), Métro 1 (8 min)              │
│  Score accessibilité : 9.2/10                            │
└──────────────────────────────────────────────────────────┘
```

---

**US-02.2** — Comparaison de communes
> En tant qu'utilisateur, je veux comparer jusqu'à 3 communes côte à côte, afin de choisir où investir.

**Critères d'acceptance :**
- Sélection de 2 à 3 communes via la carte ou la recherche
- Tableau comparatif : prix/m², tendance, DPE moyen, transport, score
- Graphique en barres superposées pour la comparaison visuelle
- Export PDF du comparatif

---

**US-02.3** — Évolution temporelle
> En tant qu'utilisateur, je veux visualiser l'évolution des prix sur 5 ans, afin de détecter les tendances.

**Critères d'acceptance :**
- Graphique ligne : prix médian/m² par trimestre 2020–2024
- Filtrable par département / commune / IRIS
- Affichage du CAGR (taux de croissance annuel composé)
- Mise en évidence des événements marquants (COVID, taux directeurs)

---

**US-02.4** — Recherche textuelle
> En tant qu'utilisateur, je veux rechercher une commune ou une adresse, afin d'accéder directement à l'information.

**Critères d'acceptance :**
- Barre de recherche avec autocomplétion (debounce 300ms)
- Recherche par nom de commune, code postal, arrondissement
- Zoom automatique sur la zone sélectionnée
- Suggestions triées par pertinence

---

### EP-03 — Assistant IA Conversationnel (RAG)

**US-03.1** — Questions en langage naturel
> En tant qu'utilisateur, je veux poser des questions en français sur le marché immobilier, afin d'obtenir des réponses précises sans connaître les données.

**Exemples de questions supportées :**
```
"Quel est le prix moyen au m² dans le 13ème arrondissement ?"
"Quels sont les 5 arrondissements les plus abordables de Paris ?"
"Comment ont évolué les prix à Montreuil depuis 2020 ?"
"Quelle commune IDF offre le meilleur rapport prix/transport ?"
"Les appartements avec DPE A se vendent-ils plus cher ?"
"Quel est l'impact du RER A sur les prix immobiliers ?"
```

**Critères d'acceptance :**
- Réponse en < 3 secondes pour les questions fréquentes (cache Redis)
- Sources citées dans la réponse (données DVF, INSEE, etc.)
- Gestion des questions hors périmètre (réponse gracieuse)
- Historique de conversation dans la session

---

**US-03.2** — Suggestions contextuelles
> En tant qu'utilisateur, je veux recevoir des suggestions de questions en fonction de ma navigation, afin d'explorer les données plus facilement.

**Critères d'acceptance :**
- Si sur Paris 13 → suggestion : "Comparer avec le 14ème ?"
- Si sur une commune avec forte tendance → "Pourquoi les prix montent ici ?"
- 3 suggestions max affichées sous la carte

---

### EP-04 — Score d'Investissement

**US-04.1** — Score par commune
> En tant qu'investisseur, je veux voir un score d'investissement sur 100 pour chaque commune, afin d'identifier rapidement les meilleures opportunités.

**Calcul du score (XGBoost) :**
```
Features :
  - Tendance prix 3 ans (CAGR)          — poids ~25%
  - Accessibilité transport              — poids ~20%
  - DPE moyen du parc immobilier        — poids ~15%
  - Revenus médians de la commune       — poids ~15%
  - Taux de vacance logements           — poids ~10%
  - Croissance démographique            — poids ~10%
  - Proximité POI stratégiques          — poids ~5%

Output : score 0–100 par commune + IRIS
```

**Critères d'acceptance :**
- Score visible sur la fiche commune
- Carte choroplèthe "score investissement" activable
- Explication du score : top 3 facteurs positifs/négatifs
- Historique : évolution du score sur 2 ans

---

**US-04.2** — Comparateur rendement locatif
> En tant qu'investisseur, je veux estimer le rendement locatif brut d'un bien, afin de valider une décision d'achat.

**Formule :**
```
Rendement brut = (loyer mensuel estimé × 12) / prix acquisition × 100

Paramètres utilisateur :
  - Surface souhaitée (m²)
  - Type de bien (appartement / maison)
  - Budget d'achat (€)

Sources loyers : données CLAMEUR / OLAP (à intégrer en Phase 2.7)
```

---

### EP-05 — Gestion de Compte

**US-05.1** — Inscription / Connexion
> En tant qu'utilisateur, je veux créer un compte et me connecter, afin de sauvegarder mes recherches et favoris.

**Critères d'acceptance :**
- Inscription : email + mot de passe (bcrypt, min 8 chars)
- Connexion JWT (access token 1h + refresh token 7j)
- Déconnexion avec invalidation du token
- Réinitialisation mot de passe par email
- Auth Google OAuth2 (optionnel, Phase 2)

---

**US-05.2** — Profil utilisateur
> En tant qu'utilisateur, je veux configurer mon profil d'investissement, afin de recevoir des recommandations personnalisées.

**Champs profil :**
```
- Budget max : _______ €
- Type bien préféré : [Appartement] [Maison] [Les deux]
- Horizon investissement : [Court <2 ans] [Moyen 2-5 ans] [Long >5 ans]
- Critères prioritaires : [Transport] [Écoles] [Commerces] [Calme]
- Zones d'intérêt : Paris | Petite Couronne | Grande Couronne
```

---

### EP-06 — Alertes et Favoris

**US-06.1** — Favoris
> En tant qu'utilisateur, je veux sauvegarder des communes en favoris, afin de suivre leur évolution.

**Critères d'acceptance :**
- Bouton "♥ Ajouter aux favoris" sur chaque fiche commune
- Page "Mes favoris" : liste des communes suivies
- Indicateur de variation depuis l'ajout en favori

---

**US-06.2** — Alertes prix
> En tant qu'utilisateur, je veux créer des alertes sur des zones, afin d'être notifié quand les prix passent un seuil.

**Critères d'acceptance :**
- Créer une alerte : zone + seuil (ex: "Paris 13 < 8 000 €/m²")
- Notification email hebdomadaire si condition remplie
- Dashboard alertes : actives / déclenchées / désactivées

---

## Maquettes IHM (Wireframes)

### Page principale — Dashboard

```
┌─────────────────────────────────────────────────────────────────────────┐
│  🏠 HomePedia IDF          [Rechercher une commune...]     [👤 Mon compte]│
├─────────────────────────────────────────────────────────────────────────┤
│  FILTRES                   │                                            │
│  ┌─────────────────────┐   │              CARTE 3D                      │
│  │ Type : [App][Mais]  │   │         (CesiumJS / MapLibre)              │
│  │ Prix : 3k──────15k  │   │                                            │
│  │ Période : [2024 ▼]  │   │   [Bâtiments 3D colorés par DPE]          │
│  │ DPE : [A][B][C]...  │   │   [Choroplèthe prix par commune]          │
│  │ Score : 50────100   │   │                                            │
│  └─────────────────────┘   │                                            │
│                            │                                            │
│  COUCHES                   │                                            │
│  [✓] Transport             │                                            │
│  [ ] POI                   │                                            │
│  [ ] Isochrones            │                                            │
│  [ ] Heatmap               ├────────────────────────────────────────────┤
│                            │  💬 Assistant IA                           │
│  TOP COMMUNES              │  ┌──────────────────────────────────────┐  │
│  1. Vincennes   78/100     │  │ "Quel est le prix moyen à Vincennes?"│  │
│  2. Nogent      75/100     │  └──────────────────────────────────────┘  │
│  3. Montreuil   71/100     │  [Prix médian à Vincennes en 2024 :       │
│                            │   6 850 €/m², en hausse de +3.2%/an...]  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Fiche Commune

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← Retour carte         Vincennes (94300)          ♥ Favoris  📄 Export│
├──────────────────────────────────┬──────────────────────────────────────┤
│  PRIX AU M²                      │  SCORE INVESTISSEMENT                │
│  ████████████████ 6 850 €        │              78                      │
│  Tendance : ▲ +3.2% /an          │         ████████░░                  │
│  vs IDF :  +0.8 pts              │  ✅ Transport excellent (9.2/10)     │
│                                  │  ✅ Tendance haussière               │
│  [Graphique évolution 2020-2024] │  ⚠️  DPE moyen : D                  │
│                                  │  ❌ Prix élevé vs budget médian      │
├──────────────────────────────────┼──────────────────────────────────────┤
│  TRANSACTIONS 2024               │  DÉMOGRAPHIE                         │
│  Nb ventes : 342                 │  Population : 48 200 hab.            │
│  Surface médiane : 58 m²         │  Revenu médian : 32 500 €/an         │
│  Prix médian achat : 398 000 €   │  Taux pauvreté : 8.2%               │
│                                  │                                      │
│  [Distribution DPE : A=12% B=18%]│  ACCESSIBILITÉ TRANSPORT            │
│  [Répartition : 68% App 32% Mais]│  🚇 RER A : Vincennes (3 min)       │
│                                  │  🚇 Métro 1 : Château de Vincennes  │
│                                  │  Score : ████████████ 9.2/10        │
├──────────────────────────────────┴──────────────────────────────────────┤
│  POI PROCHE                                                             │
│  🏫 12 écoles   🏥 3 hôpitaux   🛒 8 supermarchés   🌳 Bois de Vincennes│
└─────────────────────────────────────────────────────────────────────────┘
```

### Chat IA

```
┌─────────────────────────────────────────────────────┐
│  🤖 Assistant HomePedia                         [×] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Vous : "Comparer Vincennes et Montreuil"           │
│                                                     │
│  🤖 Voici la comparaison :                          │
│                                                     │
│  ┌──────────────┬────────────┬───────────┐         │
│  │              │ Vincennes  │ Montreuil │         │
│  ├──────────────┼────────────┼───────────┤         │
│  │ Prix/m²      │ 6 850 €    │ 4 120 €   │         │
│  │ Tendance     │ +3.2%/an   │ +5.1%/an  │         │
│  │ Transport    │ 9.2/10     │ 7.8/10    │         │
│  │ Score inv.   │ 78/100     │ 71/100    │         │
│  └──────────────┴────────────┴───────────┘         │
│                                                     │
│  Montreuil offre un meilleur potentiel de          │
│  plus-value (+5.1%/an) à un prix d'entrée          │
│  40% plus accessible.                              │
│                                                     │
│  📊 Sources : DVF 2024, INSEE 2021, GTFS IDFM      │
│                                                     │
├─────────────────────────────────────────────────────┤
│  [Vous : Tapez votre question...]         [Envoyer] │
└─────────────────────────────────────────────────────┘
```

---

## API Backend — Endpoints Go (v1 — opérationnels)

> Base URL : `http://localhost:8080/api/v1`

### Santé

```http
GET /api/v1/health
```

### Authentification

```http
POST /api/v1/auth/register   # { email, password, full_name }
POST /api/v1/auth/login      # { email, password } → { token, user }
GET  /api/v1/auth/me         # Bearer token requis → user courant
```

### Communes

```http
GET /api/v1/communes
  ?limit=1300

GET /api/v1/communes/:code_insee
  # Retourne commune (nom, departement, population...)

GET /api/v1/communes/gold           # ← NOUVEAU — métriques agrégées
  ?limit=1300
  # Retourne les 1288 communes IDF avec :
  #   nb_transactions, prix_m2_median, prix_m2_moyen,
  #   score_dpe_moyen, dpe_dominant, pct_appartements, surface_moyenne

GET /api/v1/communes/:code_insee/gold   # ← NOUVEAU — une commune
```

### Transactions DVF

```http
GET /api/v1/transactions
  ?commune=75115        # code INSEE
  &type_local=Appartement
  &annee=2024
  &limit=100
  # Retourne id, date_mutation, valeur_fonciere, surface_reelle_bati,
  #   type_local, nombre_pieces, classe_energie, longitude, latitude...

GET /api/v1/transactions/:id
```

### Statistiques agrégées

```http
GET /api/v1/stats
  # Prix médian IDF, volume total, nb transactions
```

### Endpoints à venir (Phase 6+)

```http
POST /api/v1/rag/query          # Assistant IA (Gaspard)
GET  /api/v1/tiles/{z}/{x}/{y}.mvt   # MVT vectorielles (pg_tileserv)
GET  /api/v1/transport/isochrone
```

---

## Schéma Base de Données — PostgreSQL + PostGIS

```sql
-- Utilisateurs
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role         TEXT DEFAULT 'user',          -- 'user' | 'admin'
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Communes (données agrégées gold)
CREATE TABLE communes (
  code_insee        TEXT PRIMARY KEY,        -- ex: "94300"
  nom               TEXT NOT NULL,
  departement       TEXT NOT NULL,
  region            TEXT NOT NULL,
  prix_median_m2    NUMERIC,
  nb_transactions   INT,
  tendance_annuelle NUMERIC,                 -- CAGR % sur 3 ans
  score_investissement NUMERIC,             -- 0-100
  population        INT,
  revenu_median     NUMERIC,
  taux_pauvrete     NUMERIC,
  dpe_moyen         TEXT,                   -- lettre A-G
  score_transport   NUMERIC,
  geom              GEOMETRY(MultiPolygon, 4326)
);
CREATE INDEX idx_communes_geom ON communes USING GIST(geom);

-- IRIS (maille fine)
CREATE TABLE iris (
  code_iris    TEXT PRIMARY KEY,
  code_commune TEXT REFERENCES communes,
  nom          TEXT,
  prix_median_m2 NUMERIC,
  population   INT,
  geom         GEOMETRY(MultiPolygon, 4326)
);
CREATE INDEX idx_iris_geom ON iris USING GIST(geom);

-- Transactions DVF
CREATE TABLE transactions (
  id              BIGSERIAL PRIMARY KEY,
  id_mutation     TEXT,
  date_mutation   DATE NOT NULL,
  nature_mutation TEXT,                      -- Vente, VEFA...
  valeur_fonciere NUMERIC NOT NULL,
  surface_m2      NUMERIC,
  nb_pieces       INT,
  type_local      TEXT,                      -- Appartement, Maison...
  code_commune    TEXT REFERENCES communes,
  code_departement TEXT,
  dpe_classe      TEXT,
  annee           INT NOT NULL,
  geom            GEOMETRY(Point, 4326)
);
CREATE INDEX idx_transactions_geom     ON transactions USING GIST(geom);
CREATE INDEX idx_transactions_commune  ON transactions(code_commune);
CREATE INDEX idx_transactions_annee    ON transactions(annee);
CREATE INDEX idx_transactions_type     ON transactions(type_local);

-- Bâtiments (OSM + IGN BD TOPO)
CREATE TABLE batiments (
  id          TEXT PRIMARY KEY,
  osm_id      TEXT UNIQUE,
  code_commune TEXT REFERENCES communes,
  nom          TEXT,
  nb_etages    INT,
  hauteur_m    NUMERIC,
  dpe_classe   TEXT,
  annee_construction INT,
  tiles_url    TEXT,
  geom         GEOMETRY(Polygon, 4326)
);
CREATE INDEX idx_batiments_geom    ON batiments USING GIST(geom);
CREATE INDEX idx_batiments_commune ON batiments(code_commune);

-- POI (Points d'Intérêt)
CREATE TABLE poi (
  id          BIGSERIAL PRIMARY KEY,
  osm_id      BIGINT,
  category    TEXT,                          -- education, sante, commerce...
  name        TEXT,
  amenity     TEXT,
  shop        TEXT,
  latitude    NUMERIC,
  longitude   NUMERIC,
  geom        GEOMETRY(Point, 4326)
);
CREATE INDEX idx_poi_geom     ON poi USING GIST(geom);
CREATE INDEX idx_poi_category ON poi(category);

-- Arrêts de transport
CREATE TABLE transport_stops (
  stop_id         TEXT PRIMARY KEY,
  stop_name       TEXT NOT NULL,
  transport_type  TEXT,                      -- metro, rer, tram, bus
  lignes          TEXT,                      -- ex: "A,RER B"
  latitude        NUMERIC,
  longitude       NUMERIC,
  geom            GEOMETRY(Point, 4326)
);
CREATE INDEX idx_transport_geom ON transport_stops USING GIST(geom);

-- Scores accessibilité zones
CREATE TABLE accessibility_zones (
  id                    BIGSERIAL PRIMARY KEY,
  lat_zone              NUMERIC,
  lon_zone              NUMERIC,
  score_transport       NUMERIC,
  score_transport_norm  NUMERIC,             -- 0-10
  nb_arrets             INT,
  types_transport       TEXT,
  geom                  GEOMETRY(Point, 4326)
);

-- Favoris utilisateurs
CREATE TABLE favorites (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES users ON DELETE CASCADE,
  code_commune TEXT REFERENCES communes,
  prix_at_save NUMERIC,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, code_commune)
);

-- Alertes prix
CREATE TABLE alerts (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID REFERENCES users ON DELETE CASCADE,
  code_commune   TEXT REFERENCES communes,
  prix_seuil     NUMERIC NOT NULL,
  condition      TEXT NOT NULL,              -- 'below' | 'above'
  active         BOOLEAN DEFAULT true,
  last_triggered TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);
```

---

## Pipeline Databricks (Phase 3)

### Bronze → Silver (Nettoyage PySpark)

```python
# Exemple : dvf_cleaning.py
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, when, regexp_replace

spark = SparkSession.builder.appName("dvf-silver").getOrCreate()

# Lire depuis le Data Lake
df = spark.read.parquet("abfss://bronze@homepediadatalake.dfs.core.windows.net/dvf/")

# 1. Supprimer doublons sur id_mutation
df = df.dropDuplicates(["id_mutation"])

# 2. Filtrer valeurs aberrantes
df = df.filter(
    (col("valeur_fonciere") > 10_000) &
    (col("valeur_fonciere") < 50_000_000) &
    (col("surface_reelle_bati") > 5) &
    (col("surface_reelle_bati") < 2_000)
)

# 3. Calculer prix/m²
df = df.withColumn("prix_m2", col("valeur_fonciere") / col("surface_reelle_bati"))

# 4. Normaliser types
df = df.withColumn("type_local",
    when(col("type_local") == "Appartement", "APPARTEMENT")
    .when(col("type_local").isin("Maison", "Maison individuelle"), "MAISON")
    .otherwise("AUTRE")
)

# Écrire en silver avec Delta
df.write.format("delta").mode("overwrite").save(
    "abfss://silver@homepediadatalake.dfs.core.windows.net/dvf/"
)
```

### Silver → Gold (Enrichissement spatial)

```python
# spatial_joins.py — focus IDF uniquement en gold
IDF_DEPTS = ["75", "77", "78", "91", "92", "93", "94", "95"]

df_dvf = spark.read.format("delta").load("abfss://silver/.../dvf/")
df_iris = spark.read.format("delta").load("abfss://silver/.../iris/")

# Focus IDF
df_idf = df_dvf.filter(col("code_departement").isin(IDF_DEPTS))

# Jointure spatiale DVF ↔ IRIS (via GeoPandas sur workers Databricks)
# Agrégations prix médian par commune + IRIS
df_gold = df_idf.groupBy("code_commune", "annee").agg(
    percentile_approx("prix_m2", 0.5).alias("prix_median_m2"),
    count("*").alias("nb_transactions"),
    avg("surface_reelle_bati").alias("surface_moyenne"),
)
```

---

## ML — Score Investissement (XGBoost + MLflow)

```python
# investment_score.py
import mlflow
import xgboost as xgb
from sklearn.preprocessing import MinMaxScaler

# Features
FEATURES = [
    "cagr_3ans",              # Taux croissance annuel composé prix
    "score_transport",         # Accessibilité transport 0-10
    "dpe_score",               # Score énergétique (A=7, B=6...G=1)
    "revenu_median",           # Revenus médians commune
    "taux_vacance",            # % logements vacants
    "croissance_pop_5ans",     # Croissance démographique
    "distance_paris_km",       # Distance au centre de Paris
    "nb_poi_500m",             # Nb POI dans rayon 500m
]

with mlflow.start_run():
    model = xgb.XGBRegressor(n_estimators=200, max_depth=6)
    model.fit(X_train, y_train)

    mlflow.xgboost.log_model(model, "investment_score_model")
    mlflow.log_metric("rmse", rmse)

    # Enregistrer dans MLflow Model Registry
    mlflow.register_model(
        f"runs:/{mlflow.active_run().info.run_id}/investment_score_model",
        "HomePedia-InvestmentScore"
    )
```

---

## Installation & Démarrage

### Prérequis

- Python 3.11+
- Go 1.22+
- Node.js 20+
- Docker + Docker Compose
- WSL2 Ubuntu (Windows)

### Variables d'environnement

Copier et remplir `ingestion/.env.example` → `ingestion/.env` :

```bash
ADLS_ACCOUNT_NAME=homepediadatalake
ADLS_ACCOUNT_KEY=<clé_azure_portal>
LOCAL_DATA_DIR=/tmp/dvf
```

### Lancer l'ingestion

```bash
# DVF — un département (test)
cd ingestion/dvf
python3 download.py --mode dept --dept 75 --year 2024

# DVF — France entière
python3 download.py --mode full --years 2020,2021,2022,2023,2024

# INSEE
cd ingestion/insee
python3 download.py

# DPE ADEME — IDF complet
cd ingestion/ademe_dpe
python3 download.py

# OSM — tous POI IDF
cd ingestion/osm
python3 extract.py

# GTFS IDFM
cd ingestion/gtfs_idfm
python3 download.py

# Test local sans Azure (--no-upload)
python3 download.py --no-upload
```

### Dev local (docker-compose)

```bash
# Démarrer tous les services localement
cd backend
docker compose up -d

# Services disponibles :
# PostgreSQL 17 + PostGIS : localhost:5433  (db: homepedia / user: homepedia / pw: homepedia)
# ChromaDB                : localhost:8001  (vide, prêt pour RAG Gaspard)
# Redis                   : localhost:6379
# Backend Go              : localhost:8080  → http://localhost:8080/api/v1/health
# Frontend React (nginx)  : localhost:3000  → http://localhost:3000
```

### Peupler la base depuis Azure Silver (après docker compose up)

```bash
# Prérequis : avoir les credentials Azure ADLS dans data/silver_to_postgres.py
cd data
pip install azure-storage-blob pyarrow pandas psycopg2-binary
python3 silver_to_postgres.py

# Résultat attendu : 1288 communes, ~50050 transactions, DPE enrichi
```

### Backend Go

```bash
cd backend
go mod download

# Dev avec hot-reload
air

# Production
go build -o server ./cmd/server
./server
```

### Frontend React

```bash
cd frontend
npm install
npm run dev     # localhost:3000
npm run build   # Production build
```

---

## État Actuel du Projet

> Dernière mise à jour : **Mars 2026** — commit `6893bce`

### Roadmap des Phases

| Phase | Description | Statut | Responsable |
|-------|-------------|--------|-------------|
| **Phase 0** | Dev local (docker-compose) | ✅ **Terminée** | Équipe |
| **Phase 1** | Infrastructure Azure + CI/CD | ✅ **Terminée** | Équipe |
| **Phase 2** | Ingestion données (DVF, INSEE, DPE, OSM, GTFS) | ✅ **Terminée** | Christophe |
| **Phase 3** | Big Data Databricks (bronze→silver) | ✅ **Terminée** | Ludovic |
| **Phase 4** | Pipeline Silver → PostgreSQL + métriques Gold | ✅ **Terminée** | Christophe |
| **Phase 5** | Backend Go (API REST + endpoints Gold) | ✅ **Terminée** | Christophe |
| **Phase 6** | RAG — Assistant IA (CamemBERT + ChromaDB) | ⏳ À faire | Gaspard |
| **Phase 7** | Frontend React (CesiumJS 3D + MapLibre) | 🚧 **En cours** | Christophe |
| **Phase 8** | Déploiement Azure Container Apps | ⏳ À faire | Équipe |

---

### Tâches réalisées — Christophe

#### Phase 2 — Ingestion (✅ Terminée)
- [x] Script `ingestion/dvf/download.py` — DVF France entière 2020–2024 → Azure `bronze/dvf/`
- [x] Script `ingestion/insee/download.py` — 34 970 communes → `bronze/insee/`
- [x] Script `ingestion/ademe_dpe/download.py` — 800k DPE IDF → `bronze/dpe/`
- [x] Script `ingestion/osm/extract.py` — 172 911 POI IDF via Overpass → `bronze/osm/`
- [x] Anonymisation RGPD automatique à l'ingestion (suppression colonnes nominatives DVF)

#### Phase 4 — Silver → PostgreSQL (✅ Terminée)
- [x] Script `data/silver_to_postgres.py` — lecture Parquet Azure ADLS Silver → PostgreSQL local
  - Étape 1 : `insee_populations` → table `communes` (1 288 communes IDF)
  - Étape 2 : `dvf_transactions` → table `transactions` (50 050 transactions)
  - Étape 3 : jointure DPE → mise à jour `classe_energie` (50 042 transactions enrichies)
- [x] Calcul des métriques Gold directement en SQL PostgreSQL (PERCENTILE_CONT, MODE, AVG CASE)

#### Phase 5 — Backend Go (✅ Terminée)
- [x] Structure Go + Gin opérationnelle (`cmd/server/main.go`)
- [x] Authentification JWT (register / login / me)
- [x] Endpoints communes : `GET /api/v1/communes`, `GET /api/v1/communes/:code`
- [x] **Nouveaux** endpoints Gold : `GET /api/v1/communes/gold`, `GET /api/v1/communes/:code/gold`
  - Métriques : `nb_transactions`, `prix_m2_median`, `prix_m2_moyen`, `score_dpe_moyen`, `dpe_dominant`, `pct_appartements`, `surface_moyenne`
- [x] Endpoints transactions : `GET /api/v1/transactions`, `GET /api/v1/transactions/:id`
  - Filtres : `?commune=`, `?type_local=`, `?annee=`, `?limit=`
- [x] Endpoint stats agrégées : `GET /api/v1/stats`
- [x] Fix Dockerfile (`GOTOOLCHAIN=auto` pour Go 1.24/1.25)
- [x] `docker-compose` complet (postgres, redis, chromadb, backend, frontend)

#### Phase 7 — Frontend React (🚧 En cours)
- [x] Architecture React + MapLibre GL (2D) + CesiumJS (3D) fonctionnelle
- [x] Header avec autocomplete adresse (api-adresse.data.gouv.fr, debounce 300ms)
- [x] MapView connectée aux données Gold réelles (1 288 communes)
- [x] Filtres actifs (type de bien, année de vente) — rechargement API à chaque changement
- [x] Tri des transactions par prix (croissant/décroissant)
- [x] FlyTo dynamique depuis centroïde des transactions (plus de coords hardcodées)
- [x] Recherche adresse → pin rouge sur la carte + navigation `/carte?lat=X&lng=Y`
- [x] Synchronisation position 2D ↔ 3D au basculement de vue
- [x] Propagation recherche adresse vers Cesium (flyTarget)
- [x] Panel bâtiment 3D (clic OSM) : infos OSM + **transactions DVF à proximité** (rayon 120m, `globe.pick`)
- [x] Page Transactions avec filtres type/année connectés à l'API (suppression mock data)
- [x] Authentification utilisateur (JWT localStorage, initiales avatar)

---

### Tâches réalisées — Ludovic (Phase 3 Databricks)

#### Bronze → Silver (✅ Terminé — `silver_finis`)
- [x] Notebook `dvf_cleaning.py` — nettoyage DVF : déduplication, filtrage valeurs aberrantes, calcul prix/m², focus IDF
- [x] Notebook `insee_cleaning.py` — populations légales par commune, normalisation codes INSEE
- [x] Notebook `dpe_cleaning.py` — classe DPE par logement, jointure sur adresse/parcelle
- [x] Notebook `osm_cleaning.py` — POI IDF normalisés par catégorie (éducation, santé, commerce, transport)
- [x] Notebook `communes_cleaning.py` — référentiel communes IDF avec codes INSEE/postaux
- [x] Toutes les données Silver disponibles sur Azure ADLS `silver/` en format Parquet/Delta
- [x] Jointure spatiale DVF ↔ communes via **H3** (résolution 9, ~175m) — remplacement Apache Sedona

---

### Ce qui reste à faire

#### Gaspard — Phase 6 RAG
- [ ] Génération embeddings (CamemBERT) depuis données Silver
- [ ] Indexation ChromaDB (disponible sur `localhost:8001`)
- [ ] Service RAG Python (`rag/embeddings/generate.py`, `rag/query/rag_query.py`)
- [ ] Endpoint `POST /api/rag/query` dans le backend Go
- [ ] Panel chat IA dans le frontend

#### Équipe — Phase 7 (suite)
- [ ] Page Statistiques / Dashboard avec graphiques Recharts
- [ ] Couches cartographiques (transport GTFS, heatmap, isochrones)
- [ ] Score investissement XGBoost + MLflow (Phase ML)

#### Équipe — Phase 8 Déploiement
- [ ] Déploiement Azure Container Apps
- [ ] CI/CD GitHub Actions → ACR → Container Apps

Voir [ROADMAP.md](ROADMAP.md) et [AXES_AMELIORATION.md](AXES_AMELIORATION.md) pour le détail et les pistes d'amélioration.

---

## Conformité RGPD

- **DVF** : colonnes `nom_vendeur`, `nom_acheteur`, `prenom_*` supprimées à l'ingestion
- **Aucune donnée nominative** stockée sur Azure Data Lake
- **Données agrégées** uniquement en gold (prix médian, pas de transactions individuelles nominatives)
- **Logs** : pas de conservation des requêtes utilisateur nominatives
- **Comptes** : mot de passe hashé (bcrypt, coût 12), pas de stockage en clair

---

## Équipe

Projet Epitech Paris — T-DAT-902 · 2025–2026

---

## Licence

Les scripts d'ingestion et le code applicatif sont propriété de l'équipe projet.

Les données utilisées sont open data sous **Licence Ouverte 2.0** (Etalab) et **ODbL** (OpenStreetMap).
