# HomePedia IDF — Rapport Technique
## T-DAT-902 · Epitech MSc Pro 2026

---

## 1. Problématique et positionnement

### 1.1 Contexte

Le marché immobilier francilien est le plus actif de France : plus de 160 000 transactions par an en Île-de-France, pour des valeurs allant de 2 000 à 25 000 €/m² selon les communes. Les professionnels de l'immobilier — agents, investisseurs, promoteurs, foncières — disposent aujourd'hui d'outils fragmentés : SeLoger pour les annonces, DVF (Demande de Valeurs Foncières) pour les transactions brutes, MeilleursAgents pour des estimations partielles. Aucun outil ne croise en un seul endroit les données de prix, de qualité de vie, d'énergie, de sécurité et de rendement locatif à l'échelle de la commune.

### 1.2 Problématique

**Comment permettre aux professionnels de l'immobilier de comparer, analyser et qualifier objectivement les communes d'Île-de-France à partir de données publiques hétérogènes ?**

### 1.3 Cible utilisateur

HomePedia IDF s'adresse aux **professionnels** :
- **Agents immobiliers** : argumentation chiffrée face aux clients, comparaison de secteurs
- **Investisseurs** : identification d'opportunités, score de rendement locatif potentiel
- **Promoteurs / foncières** : analyse de territoires pour des décisions d'acquisition
- **Collectivités** : suivi des dynamiques de marché par département

---

## 2. Architecture technique et parcours de la donnée

### 2.1 Sources de données

| Source | Nature | Volume | Mise à jour |
|--------|--------|---------|------------|
| DVF (data.gouv.fr) | Transactions immobilières IDF 2020-2024 | ~5,2 M lignes | Annuelle |
| DPE ADEME | Diagnostics de Performance Énergétique | ~1,1 M logements IDF | Semestrielle |
| INSEE | Population, densité, superficie par commune | 1 300 communes IDF | Annuelle |
| SSMSI | Taux de délinquance par département | 8 départements IDF | Annuelle |
| OSM / Overpass | Points d'intérêt (commerces, santé, transports) | ~120 000 POI | Continue |
| IPS (DEPP/MEN) | Indice de Position Sociale — 1 010 établissements IDF | ~1 010 écoles | Annuelle |
| ENEDIS / GRDF | Consommation énergétique par commune | 1 300 communes | Annuelle |
| CLAMEUR 2022 | Loyers médians observés par département IDF | 8 départements IDF | Annuelle |

### 2.2 Parcours de la donnée (pipeline ETL)

```
┌─────────────────────────────────────────────────────────┐
│                     COUCHE BRONZE                        │
│  DVF (CSV) → Python ingestion → Google Cloud Storage     │
│  DPE, INSEE, IPS, SSMSI, ENEDIS, CLAMEUR → GCS bronze/  │
└───────────────────────┬─────────────────────────────────┘
                        │ dbt / Databricks (bronze → silver)
┌───────────────────────▼─────────────────────────────────┐
│                     COUCHE SILVER                        │
│  BigQuery : nettoyage, déduplication, géocodage          │
│  silver_transactions : ~5,2 M lignes validées            │
│  silver_dpe, silver_communes, silver_poi, silver_loyers  │
│  Validation : Great Expectations (volume, nulls, ranges) │
└───────────────────────┬─────────────────────────────────┘
                        │ dbt / Databricks (silver → gold)
┌───────────────────────▼─────────────────────────────────┐
│                      COUCHE GOLD                         │
│  BigQuery / Delta Lake : agrégation par commune INSEE    │
│  gold_communes_agregat : 1 ligne × 1 300 communes        │
│  ~45 métriques : prix, DPE, IPS, POI, sécurité, loyers  │
│  Delta Lake CDF : recalcul incrémental sur communes      │
│  impactées uniquement (MERGE INTO, watermark JSON)       │
└───────────────────────┬─────────────────────────────────┘
                        │ Export Python (script)
┌───────────────────────▼─────────────────────────────────┐
│              SUPABASE POSTGRESQL (API)                   │
│  communes_agregat : réplique gold pour l'API REST        │
│  transactions : dernières ventes pour la carte           │
│  Requêtes indexées sur code_insee — latence < 50 ms      │
└───────────────────────┬─────────────────────────────────┘
                        │ API Go (Gin) — Cloud Run
┌───────────────────────▼─────────────────────────────────┐
│              FRONTEND REACT (Cloud Run)                  │
│  Carte MapLibre · Dashboard · Comparatif · Pipeline      │
└─────────────────────────────────────────────────────────┘
```

### 2.3 Justification du double système de stockage

Le projet utilise deux bases de données pour des raisons complémentaires :

**BigQuery (Google Cloud)** est un entrepôt analytique conçu pour les requêtes sur des volumes massifs. Il permet d'exécuter les transformations dbt sur 5,2 millions de lignes DVF sans dégradation de performance et sans provisionnement de serveur. Son modèle de tarification à la requête (on-demand) est adapté aux traitements batch occasionnels.

**PostgreSQL / Supabase** sert la couche API temps réel. Une API REST ne doit pas scanner des millions de lignes à chaque appel : on lui expose uniquement les résultats agrégés (1 ligne par commune), avec des index sur `code_insee`. La latence passe de plusieurs secondes (BigQuery) à moins de 50 ms (Postgres indexé).

En résumé : **BigQuery traite, Supabase sert**. Les deux couches ne sont pas redondantes, elles sont spécialisées.

### 2.4 Optimisation des coûts

| Décision | Impact coût |
|----------|-------------|
| Gold = 1 ligne/commune exportée en Postgres | L'API ne touche jamais BigQuery en production → 0 € de query BQ en runtime |
| BigQuery on-demand (pas de slots réservés) | Paiement au Mo scanné uniquement lors des runs dbt (~0,005 €/Go) |
| Delta Lake CDF (Change Data Feed) | Recalcul incrémental uniquement sur les communes touchées → ~80 % de réduction temps de traitement |
| Supabase free tier (500 MB) | 0 € pour la couche API — les 1 300 communes agrégées tiennent en < 5 MB |
| Cloud Run scale-to-zero | 0 instance si pas de trafic — facturation à la requête uniquement |
| DVF, INSEE, IPS, OSM, CLAMEUR : open data | 0 € d'achat de données |
| CI/CD GitHub Actions (free tier) | 2 000 minutes/mois gratuites pour les pipelines de déploiement |

---

## 3. Fonctionnalités, scores et perspectives

### 3.1 Carte interactive

La carte MapLibre affiche les transactions immobilières géolocalisées avec clustering dynamique. Un clic sur une commune ouvre la fiche détaillée (RightPanel) avec 7 sections : prix immobilier, DPE/énergie, équipements, IPS/éducation, sécurité, rendement locatif et consommation énergétique.

Le panneau de contrôle droite expose **6 couches de marqueurs OSM interactifs** (toggle individuel) :
- **Sécurité** (bleu) : police (P), pompiers (F), hôpital (H), pharmacie (Rx) — rayon 3,5 km
- **Transports** (vert) : métro (M), RER (R), tramway (T), bus (B) — rayon 3 km
- **Restaurants** (orange) : restaurants, cafés, bars — rayon 2 km, max 40 marqueurs
- **Écoles** (bleu ciel/jaune) : écoles (É), universités (U), maternelles (M) — rayon 3 km
- **Parcs** (vert lime) : parcs/jardins (P), aires de jeux (J), espaces naturels (N) — rayon 3 km
- **Commerces** (violet) : supermarchés (S), boulangeries (B), commerces (C) — rayon 2 km

Chaque couche génère ses légendes dynamiquement dans la zone bas-gauche. Les données sont chargées à la demande via l'API Overpass OSM (gratuite, sans clé).

### 3.2 Outil de comparaison professionnelle (/comparer)

La page de comparaison permet de sélectionner deux communes et d'analyser côte à côte 35+ métriques réparties en 7 sections : Immobilier, Population & Territoire, Équipements, Énergie & DPE, Sécurité, Éducation & IPS, et **Rendement locatif** (section ajoutée). Un panneau **Top communes** propose des suggestions pré-triées par **6 critères professionnels** :
- Meilleur investissement (score composite)
- Qualité de vie (score composite)
- Prix accessibles (prix médian/m²)
- Marché liquide (volume transactions)
- Sécurité (score SSMSI)
- **Meilleur rendement locatif brut** (loyer annuel / prix m²) — *critère ajouté*

L'URL encode les deux communes sélectionnées pour permettre le partage du comparatif.

### 3.3 Rendement locatif — Intégration CLAMEUR 2022 (Axe 6)

Un nouveau module enrichit chaque commune avec trois métriques locatives :

| Métrique | Description | Source |
|----------|-------------|--------|
| `loyer_median_m2` | Loyer médian observé (€/m²/mois) | CLAMEUR 2022 + gradient géographique IDF |
| `zone_tendue` | Commune sous encadrement des loyers | Décret zonage IDF |
| `rendement_locatif_brut` | `loyer × 12 / prix_m2 × 100` (%) | Calculé |

**Gradient géographique** : le loyer de chaque commune est calculé en fonction de son prix médian relatif au département (`ratio = prix_m2 / prix_médian_dept`), avec un clamp entre 0,5× et 2× le loyer départemental de référence. Cela produit des rendements réalistes : 3,0–3,5 % à Paris, 4,0–5,5 % en grande couronne.

**Visualisation** : dans MapView (RightPanel), une barre dégradée rouge→vert avec curseur positionné sur le rendement (plage 2–8 %) et un badge "Zone tendue" en amber si applicable. Dans Comparer, un critère dédié "Meilleur rendement" et une section "Rendement locatif" côte-à-côte.

### 3.4 Qualité des données — Great Expectations (Axe 2)

Un framework de validation automatique (Great Expectations v0.18.19) est exécuté à chaque étape du pipeline :

- **Bronze DVF** : volume ≥ 500 000 lignes, nulls critiques < 1 %, dates [2019-2024], types valides
- **Silver DVF** : ratio Bronze/Silver ≥ 60 %, outliers prix/m² < 0,5 %, prix médian [3 000–12 000 €], doublons < 0,1 %, présence des 8 départements IDF
- **Silver DPE** : volume ≥ 100 000, étiquettes A–G, consommation > 0
- **Silver INSEE** : volume ≥ 900 communes, IPS [50, 200]
- **Gold** : unicité `code_commune`, couverture 3 scores composites, cohérence loyers

Les résultats sont sauvegardés en JSON dans `Gold/_dq_reports/` et lèvent une exception Python en cas d'erreur critique, bloquant la suite du pipeline.

### 3.5 Pipeline incrémental — Delta Lake Change Data Feed (Axe 1)

Le pipeline silver→gold est optimisé via le **Change Data Feed** de Delta Lake :

1. Activation de `delta.enableChangeDataFeed` sur les tables Silver
2. Lecture seule des changements depuis le dernier watermark (`_cdf_watermarks/`)
3. Identification des `communes_impactées` par les mutations
4. Recalcul des agrégations DVF **uniquement** pour ces communes
5. `MERGE INTO` Gold (upsert) — pas de réécriture complète de la table
6. OPTIMIZE + VACUUM hebdomadaire (lundi) pour les performances de lecture

Cette approche réduit le temps de traitement de ~80 % lors des mises à jour partielles (DVF mensuels) par rapport à un recalcul complet.

### 3.6 Calcul des scores composites

Chaque score est un **percentile IDF** calculé avec `PERCENT_RANK()` SQL, normalisé entre 0 et 10. Un score de 8,5 signifie que la commune se situe dans le top 15 % des communes IDF sur ce critère.

**Score Investissement** (agrège les signaux d'attractivité) :
- 25 % — Volume de transactions (liquidité du marché)
- 25 % — IPS moyen (attractivité résidentielle familles)
- 20 % — % logements DPE A/B (pas de travaux imposés par la loi Énergie-Climat)
- 15 % — Prix médian/m² inversé (potentiel de plus-value relatif)
- 15 % — Commerces bio/premium (indice de gentrification)

**Score Qualité de Vie** :
- 30 % — IPS moyen (environnement scolaire)
- 20 % — % logements DPE A/B
- 20 % — Densité équipements de proximité (POI/km²)
- 15 % — Consommation électricité (inversée — moins = mieux)
- 15 % — % établissements scolaires favorisés

**Score Stabilité DPE** (risque réglementaire locatif) :
- 30 % — Score DPE moyen (inversé)
- 25 % — Consommation énergie primaire (inversée)
- 25 % — Émissions GES (inversées)
- 20 % — % logements classés A/B/C

### 3.7 Pipeline de monitoring

La page Pipeline expose l'historique des exécutions du job Cloud Run (`homepedia-pipeline`), le diagramme de flux bronze→silver→gold→API et les KPIs d'exécution (durée, communes et transactions exportées).

### 3.8 Perspectives

- **Machine Learning (bonus)** : modèle de prédiction de prix au m² par commune et type de bien, entraîné sur l'historique DVF 2020-2024
- **Alertes** : notification email/webhook quand un score d'investissement ou un rendement locatif dépasse un seuil défini par l'utilisateur
- **API publique** : exposition des endpoints gold pour intégration dans des outils tiers (CRM immobilier, tableurs)
- **Données nationales** : extension à l'ensemble du territoire français (DVF France entière disponible)
- **Loyers actualisés** : intégration données CLAMEUR 2023-2024 dès publication + flux OLI (Observatoire des Loyers IDF) via open data

---

*Projet réalisé dans le cadre du module T-DAT-902 — Epitech MSc Pro 2026*  
*Stack : Google BigQuery · Databricks Delta Lake · Great Expectations · dbt · Supabase PostgreSQL · Go (Gin) · React · MapLibre GL · Cloud Run · GitHub Actions · OSM Overpass API · CLAMEUR 2022*
