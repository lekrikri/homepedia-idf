# HomePedia IDF — Axes d'Amélioration
> Classés du **plus réaliste en contexte académique Epitech** au **plus complexe/ambitieux**
> Sources : analyse interne + réponse Gemini

---

## Légende

| Indicateur | Signification |
|---|---|
| ⚡ Complexité | Faible / Moyenne / Élevée |
| 🎯 Impact | Valeur ajoutée produit |
| 🎓 Faisabilité Epitech | Réaliste dans un contexte étudiant |
| ⏱ Délai estimé | Ordre de grandeur |

---

## Tier 1 — Quick Wins : faisable, impact immédiat

### 1. Delta Lake Change Data Feed (CDF)
> Ne recalculer que les agrégations Gold impactées par de nouvelles données Bronze, au lieu de tout écraser à chaque run.

- ⚡ Complexité : Faible (config DLT + `readChangeFeed()` PySpark)
- 🎯 Impact : Réduction des coûts Azure Databricks + fraîcheur des données
- 🎓 Faisabilité Epitech : Excellente — c'est une feature native Delta Lake, un TP de 2h
- ⏱ Délai : 1–2 jours
- **Techno :** `spark.readStream.format("delta").option("readChangeFeed", "true")`

---

### 2. Data Quality Framework (Great Expectations / Deequ)
> Valider automatiquement la qualité des données à chaque couche (bronze/silver/gold) : détecter les nulls, les valeurs aberrantes, les jointures ratées.

- ⚡ Complexité : Faible
- 🎯 Impact : Crédibilité du score investissement — une jointure IRIS ratée peut fausser les prix médians de toute une commune
- 🎓 Faisabilité Epitech : Excellente — Great Expectations s'intègre en quelques lignes dans les notebooks PySpark existants
- ⏱ Délai : 2–3 jours
- **Techno :** `great_expectations` ou `deequ` (AWS, fonctionne sur Databricks)

---

### 3. Cache sémantique RAG
> Vectoriser les questions posées à l'assistant et retourner la réponse en cache si une question sémantiquement proche a déjà été posée — bien plus efficace que le cache Redis exact.

- ⚡ Complexité : Faible
- 🎯 Impact : Latence RAG divisée par 3-5 pour les questions fréquentes, coût LLM réduit
- 🎓 Faisabilité Epitech : Excellente — ChromaDB est déjà en place, il suffit d'indexer les questions
- ⏱ Délai : 2–3 jours
- **Techno :** ChromaDB (collection `questions_cache`) + seuil cosine similarity ~0.92

---

### 4. Export rapport PDF automatique
> Génération d'un rapport PDF complet par commune (fiche, graphiques, score, avis) — livrable directement présentable à un banquier ou notaire.

- ⚡ Complexité : Faible
- 🎯 Impact : Fort pour la démo soutenance et la valeur perçue produit
- 🎓 Faisabilité Epitech : Excellente
- ⏱ Délai : 2–4 jours
- **Techno :** `WeasyPrint` (Python, HTML→PDF) ou `Puppeteer` (Node.js, screenshot React→PDF)

---

### 5. Timeline animée sur la carte
> Slider temporel animé montrant l'évolution des choroplèthes de prix entre 2019 et 2024 — différenciateur visuel fort.

- ⚡ Complexité : Faible
- 🎯 Impact : Effet "wow" garanti en soutenance, illustre parfaitement la valeur des 5 années de DVF
- 🎓 Faisabilité Epitech : Excellente — MapLibre GL supporte les transitions de données nativement
- ⏱ Délai : 3–5 jours
- **Techno :** MapLibre GL `setData()` + `requestAnimationFrame` ou `d3.timer`

---

### 6. Intégration données loyers (CLAMEUR / OLAP)
> Ajouter les loyers médians par commune pour calculer le rendement locatif brut réel (US-04.2 prévu mais sans source).

- ⚡ Complexité : Faible
- 🎯 Impact : Complète la fonctionnalité rendement locatif qui est déjà dans le scope
- 🎓 Faisabilité Epitech : Bonne — données CLAMEUR disponibles en open data partiel, OLAP en accès académique
- ⏱ Délai : 3–5 jours
- **Source :** [Observatoire des Loyers](https://www.observatoire-des-loyers.fr/) + [DRIHL IDF](https://www.drihl.ile-de-france.developpement-durable.gouv.fr/)

---

## Tier 2 — Moyen terme : valeur forte, effort significatif

### 7. PLU (Plan Local d'Urbanisme) via le Géoportail de l'Urbanisme
> Intégrer les zones PLU (Ua, AU, N...) pour détecter le potentiel de densification : surélévation possible ? Division parcellaire autorisée ?

- ⚡ Complexité : Moyenne (données GeoJSON hétérogènes, normalisation difficile — chaque commune a son propre PLU)
- 🎯 Impact : Très fort pour les investisseurs pros — un bien en zone "UC" avec COS élevé vaut 30% de plus
- 🎓 Faisabilité Epitech : Bonne — les données GPU sont open data et en GeoJSON/WFS
- ⏱ Délai : 1–2 semaines
- **Source :** [Géoportail de l'Urbanisme](https://www.geoportail-urbanisme.gouv.fr/) — API WFS publique

---

### 8. Risques environnementaux (ERRIAL / BRGM)
> Intégrer le retrait-gonflement des argiles (RGA), les zones inondables (PPRI) et les sols pollués (BASIAS) comme features supplémentaires du score investissement.

- ⚡ Complexité : Moyenne
- 🎯 Impact : Fort — une maison en zone RGA forte perd 15-20% de valeur, aucun concurrent ne l'affiche
- 🎓 Faisabilité Epitech : Bonne — données BRGM et géorisques.gouv.fr open data et bien documentées
- ⏱ Délai : 1 semaine
- **Source :** [Géorisques](https://www.georisques.gouv.fr/api-georisques) + [BRGM](https://infoterre.brgm.fr/)

---

### 9. Permis de construire (SITADEL)
> Intégrer les données du Ministère sur les permis de construire délivrés pour anticiper l'offre future et détecter les zones de tension.

- ⚡ Complexité : Moyenne
- 🎯 Impact : Signal d'investissement fort — une commune avec 500 permis/an va voir son parc se rénover
- 🎓 Faisabilité Epitech : Bonne — données SITADEL disponibles sur data.gouv.fr en CSV mensuel
- ⏱ Délai : 1 semaine
- **Source :** [SITADEL](https://www.data.gouv.fr/fr/datasets/sitadel/) sur data.gouv.fr

---

### 10. Modèle prédictif temporel des prix (Prophet / N-BEATS)
> Remplacer le score statique XGBoost par une prédiction d'évolution à 6/12/24 mois par commune, basée sur les séries temporelles de prix DVF.

- ⚡ Complexité : Moyenne
- 🎯 Impact : Très fort — passer de "ce quartier vaut X€/m²" à "ce quartier vaudra X+Y% dans 12 mois"
- 🎓 Faisabilité Epitech : Bonne — Prophet (Meta) s'utilise en quelques lignes, données DVF 5 ans disponibles
- ⏱ Délai : 1–2 semaines
- **Techno :** `prophet` (Python) ou `neuralforecast` (N-BEATS/NHITS), intégré MLflow
- **Attention :** Bien communiquer les intervalles de confiance pour éviter un faux sentiment de précision

---

### 11. Détection d'anomalies de prix (DVF)
> Identifier les transactions atypiques dans le DVF (ventes entre proches, ventes forcées, erreurs cadastrales) pour améliorer la qualité du gold.

- ⚡ Complexité : Moyenne
- 🎯 Impact : Améliore la crédibilité du score — un prix médian faussé par des ventes familiales à 1€ ruine le modèle
- 🎓 Faisabilité Epitech : Bonne — Isolation Forest ou DBSCAN sur les features (prix/m², surface, commune)
- ⏱ Délai : 1 semaine
- **Techno :** `sklearn.ensemble.IsolationForest` ou `pyspark.ml.clustering.BisectingKMeans`

---

### 12. Recommandation personnalisée
> Basée sur le profil investisseur (budget, horizon, critères) et la navigation, proposer des communes "similaires à celles qui vous intéressent".

- ⚡ Complexité : Moyenne
- 🎯 Impact : Fort pour la rétention utilisateur et la personnalisation
- 🎓 Faisabilité Epitech : Correcte — content-based filtering sur les features communes (sans cold start problem si profil renseigné)
- ⏱ Délai : 1–2 semaines
- **Techno :** Similarité cosinus entre vecteurs de features communes (sklearn) ou KNN sur PostgreSQL avec `pgvector`

---

### 13. Simulateur crédit immobilier
> Calculateur de capacité d'emprunt intégré (taux OAT 10 ans, durée, apport) qui s'adapte à la commune sélectionnée et au prix médian.

- ⚡ Complexité : Faible côté logique, Moyenne côté UX
- 🎯 Impact : Fort — fonctionnalité que les particuliers utilisent systématiquement avant un achat
- 🎓 Faisabilité Epitech : Bonne — calcul purement mathématique + API taux OAT (Banque de France)
- ⏱ Délai : 1 semaine
- **Source taux :** API [Banque de France SDMX](https://webstat.banque-france.fr/)

---

### 14. Extension nationale complète (toutes régions)
> Étendre le gold à toutes les régions françaises — les données bronze DVF France entière sont déjà disponibles.

- ⚡ Complexité : Moyenne (volumétrie × 10, performances PostGIS à revoir)
- 🎯 Impact : Fort — ouvre un marché bien plus large que l'IDF
- 🎓 Faisabilité Epitech : Correcte — le pipeline est déjà généralisé, c'est surtout une question de budget Azure
- ⏱ Délai : 1–2 semaines (si budget Azure disponible)
- **Attention :** Partitionner les tables PostgreSQL par département (`PARTITION BY LIST`)

---

### 15. Détection de signaux faibles de gentrification
> Alertes sur les zones en gentrification : forte augmentation de commerces "bio/café" via OSM couplée à une stagnation des prix — signal d'achat avant la hausse.

- ⚡ Complexité : Moyenne
- 🎯 Impact : Fort différenciateur — aucun outil grand public ne fait cela
- 🎓 Faisabilité Epitech : Correcte — OSM est re-ingéré, il suffit de tracker l'évolution des catégories de POI dans le temps
- ⏱ Délai : 2 semaines
- **Techno :** Snapshots OSM historiques (`planet.osm` ou Overpass diff) + comparaison temporelle PySpark

---

---

## Tier 1 (suite) — Quick Wins supplémentaires

### 25. Explainable AI (XAI) — Score XGBoost transparent avec SHAP
> Le score investissement est actuellement une boîte noire. Ajouter des explications locales SHAP affiche pour chaque commune les facteurs qui tirent le score vers le haut ou vers le bas ("CAGR +12 pts, DPE −5 pts"). Indispensable pour la crédibilité et la démonstration ML en soutenance.

- ⚡ Complexité : Faible
- 🎯 Impact : Très fort — transparence, confiance utilisateur, démonstration maîtrise ML
- 🎓 Faisabilité Epitech : Excellente — `shap.TreeExplainer` sur le modèle XGBoost exporté, 2 lignes Python
- ⏱ Délai : 3–5 jours
- **Techno :** `shap` (Python) dans le notebook Databricks Gold + endpoint Go qui sert les valeurs SHAP par commune

---

### 26. Tuiles Vectorielles MVT (PostGIS → MapLibre)
> Remplacer les GeoJSON lourds par des tuiles vectorielles générées à la volée par PostGIS (`ST_AsMVT`). Divise le payload réseau par ~10 et rend le rendu choroplèthe ultra-fluide sur mobile.

- ⚡ Complexité : Faible
- 🎯 Impact : Temps de chargement carte divisé par 4, RAM navigateur réduite drastiquement
- 🎓 Faisabilité Epitech : Excellente — PostGIS déjà actif sur Supabase, route Gin simple `/api/v1/tiles/{z}/{x}/{y}`
- ⏱ Délai : 3–5 jours
- **Techno :** `ST_AsMVT` + `ST_AsMVTGeom` (PostGIS), source `vector` MapLibre GL JS

---

### 27. Panel "Pourquoi cette commune ?" — Comparaison auto vs moyenne régionale
> Un panneau dans la fiche commune compare automatiquement ses métriques clés à la moyenne IDF et aux communes du même département. Affiche en langage naturel : "Montreuil a un rendement +12% vs moyenne petite couronne, mais une criminalité 1.4× supérieure." Aucune expertise immobilière requise.

- ⚡ Complexité : Faible
- 🎯 Impact : Très fort pour la compréhension utilisateur — transforme des chiffres en décision
- 🎓 Faisabilité Epitech : Excellente — calcul Go + template JSON prêt côté React
- ⏱ Délai : 3–5 jours
- **Techno :** Agrégats IDF pré-calculés en Gold, composant React `InsightPanel`

---

### 28. Auto-évaluation de confiance des réponses chatbot (RAGAS)
> Après génération, le chatbot attribue un score de confiance visible (ex: "85% — basé sur 3 sources DVF vérifiées"). Les réponses sous 60% affichent un avertissement. Démontre une approche responsable de l'IA.

- ⚡ Complexité : Faible/Moyenne
- 🎯 Impact : Fort — différenciant sur la fiabilité perçue, sujet très actuel IA responsable
- 🎓 Faisabilité Epitech : Bonne — `ragas` s'intègre comme middleware FastAPI post-génération
- ⏱ Délai : 5–7 jours
- **Techno :** `ragas` (Python) — métriques *Answer Relevance* + *Faithfulness* + *Context Precision*

---

### 29. Journal d'audit + RGPD rétention conversations chatbot
> Les requêtes chatbot (potentiellement avec données personnelles) ne sont actuellement pas tracées ni expirées. Ajouter un journal d'audit des actions sensibles (login, favoris, requêtes IA) + politique de suppression automatique des conversations à 30 jours.

- ⚡ Complexité : Faible
- 🎯 Impact : Conformité RGPD "Privacy by Design" — indispensable avant tout déploiement sérieux
- 🎓 Faisabilité Epitech : Excellente — table `audit_logs` Supabase + middleware Gin + cron de purge
- ⏱ Délai : 4–6 jours
- **Techno :** PostgreSQL `audit_logs` + middleware Go + `pg_cron` ou Cloud Scheduler

---

## Tier 2 (suite) — Moyen terme supplémentaire

### 30. Filtre par Isochrones — Temps de trajet réel GTFS
> Remplacer la distance géographique par le temps de trajet : "communes à moins de 40 minutes de La Défense en transports." L'attractivité locative dépend du maillage RER/Métro, pas du rayon kilométrique.

- ⚡ Complexité : Moyenne
- 🎯 Impact : Très fort métier — fonctionnalité que les comparateurs (SeLoger, MeilleursAgents) n'offrent pas directement
- 🎓 Faisabilité Epitech : Bonne — GTFS IDFM déjà ingéré, polygones isochrones pré-calculés Databricks ou API tierce
- ⏱ Délai : 1–2 semaines
- **Techno :** API Navitia.io (SNCF, gratuite) ou OpenTripPlanner + `ST_Intersects` PostGIS pour filtre côté Go

---

### 31. Fine-tuning Qwen2.5 avec LoRA — Corpus immobilier français
> Qwen2.5-0.5B généraliste hallucine sur le jargon notarial, la fiscalité LMNP/SCI et les nuances DPE. Un fine-tuning LoRA léger sur un corpus synthétique + documents métier améliore la précision et réduit les formulations approximatives.

- ⚡ Complexité : Moyenne
- 🎯 Impact : Très fort sur la qualité perçue — les réponses deviennent expertes en immobilier français
- 🎓 Faisabilité Epitech : Bonne — Unsloth + PEFT sur Colab A100 gratuit ou Databricks GPU
- ⏱ Délai : 2–3 semaines
- **Techno :** `unsloth` + `peft` (LoRA) + dataset synthétique généré depuis HomePedia + corpus notarial open source

---

### 32. RAG Adaptatif — Routing dynamique SQL / BM25 / ChromaDB
> Toutes les questions ne nécessitent pas le même pipeline. Router automatiquement : questions chiffrées → SQL direct (rapide), questions conceptuelles → ChromaDB, questions comparatives multi-critères → hybride BM25+SQL. Réduit la latence de 40% sur les cas simples.

- ⚡ Complexité : Moyenne
- 🎯 Impact : Très fort — précision + vitesse — valorise l'architecture IA existante
- 🎓 Faisabilité Epitech : Bonne — le classifieur d'intent MiniLM est déjà là, il suffit d'ajouter des routes de dispatch
- ⏱ Délai : 1 semaine
- **Techno :** Extension du classifieur `intent_detection.py` avec 4 catégories de routing + A/B test sur benchmark

---

### 33. Villes Jumelles — Clustering HDBSCAN "similaire mais moins chère"
> "Trouvez une commune avec la même qualité de vie que Vincennes mais 20% moins chère." Clustering offline Gold (HDBSCAN sur DPE+IPS+Crime+Transport) — chaque commune reçoit sa liste de jumelles dans le même cluster avec décote de prix.

- ⚡ Complexité : Moyenne
- 🎯 Impact : Fort pour les primo-accédants qui cherchent un "marché de report"
- 🎓 Faisabilité Epitech : Bonne — traitement Databricks offline, frontend lit juste `similar_cities[]` de la Gold
- ⏱ Délai : 1 semaine
- **Techno :** PySpark MLlib HDBSCAN (ou sklearn) + ACP pour réduction dimensionnelle + colonne `similar_cities JSONB`

---

### 34. Portfolio Investisseur — Cash-flow net & Yield dynamique
> L'utilisateur ajoute des communes à son portfolio (favoris enrichis) et renseigne ses paramètres de prêt (apport, taux, durée). Le frontend calcule en temps réel le cash-flow mensuel net estimé et la rentabilité brute/nette du portefeuille consolidé.

- ⚡ Complexité : Moyenne
- 🎯 Impact : Très fort pour la rétention — passage d'outil d'exploration à tableau de bord financier
- 🎓 Faisabilité Epitech : Excellente — majoritairement logique React + formules d'amortissement, sauvegarde Supabase
- ⏱ Délai : 1–2 semaines
- **Techno :** React Context + formule `PMT` d'amortissement + table `portfolio` Supabase Auth

---

### 35. Pare-feu RAG — Désidentification PII & Anti-Prompt Injection
> Les utilisateurs communiquent parfois des données personnelles au chatbot. Intercepter la requête, masquer les PII (adresses, revenus, noms) avant envoi au LLM, et bloquer les tentatives de jailbreak avec heuristiques légères.

- ⚡ Complexité : Moyenne
- 🎯 Impact : Conformité RGPD stricte — indispensable en contexte professionnel / production
- 🎓 Faisabilité Epitech : Bonne — middleware FastAPI, librairie locale sans coût cloud
- ⏱ Délai : 1 semaine
- **Techno :** `presidio-analyzer` (Microsoft, Python local) pour PII + liste noire de patterns injection

---

### 36. Alertes Intelligentes sur Critères Immobiliers
> L'utilisateur configure des règles métier : "Préviens-moi quand une commune passe dans le Top 10 avec DPE ≤ C et rendement > 5%." Cron quotidien qui évalue les règles et envoie une notification e-mail.

- ⚡ Complexité : Moyenne
- 🎯 Impact : Fort — fidélisation utilisateur, ouvre la porte à des fonctionnalités premium
- 🎓 Faisabilité Epitech : Bonne
- ⏱ Délai : 1–2 semaines
- **Techno :** Table `alert_rules` Supabase + Cloud Scheduler (GCP) + SendGrid ou Resend pour les e-mails

---

### 37. Exploration Multicritère — Visualisation Pareto Front
> Plutôt qu'un score unique, visualiser les communes sur un plan 2D (ex: Rentabilité vs Risque) et surligner le front de Pareto — les communes optimales sur plusieurs critères simultanément. L'utilisateur clique sur un point et explore le compromis sans qu'un algorithme décide à sa place.

- ⚡ Complexité : Moyenne
- 🎯 Impact : Fort — aide à la décision réelle, évite d'écraser les préférences de l'utilisateur dans un score opaque
- 🎓 Faisabilité Epitech : Bonne
- ⏱ Délai : 1–2 semaines
- **Techno :** D3.js scatter plot + calcul Pareto Go ou Python offline + axes configurables côté React

---

### 38. Moteur de Scénarios "What-If" XGBoost
> L'utilisateur ajuste virtuellement des paramètres (hausse des taux +1%, amélioration DPE C→B, nouveau métro) et observe l'impact sur le score investissement en temps réel. Transforme HomePedia d'outil descriptif en outil prospectif.

- ⚡ Complexité : Élevée
- 🎯 Impact : Très fort — différenciation produit nette, aucun concurrent n'offre ça
- 🎓 Faisabilité Epitech : Correcte — le modèle XGBoost est déjà exporté, l'inférence est rapide
- ⏱ Délai : 2–3 semaines
- **Techno :** Endpoint Go `/api/v1/simulate` + XGBoost inference Python (sidecar FastAPI) + sliders React

---

## Tier 3 — Ambitieux : fort impact commercial, complexité élevée

### 16. Graph Neural Networks (GNN) sur les communes
> Modéliser les communes comme un graphe (voisinage, lignes de transport) pour capturer la propagation de prix entre zones — un nouveau métro influence ses communes adjacentes.

- ⚡ Complexité : Élevée
- 🎯 Impact : Très fort — XGBoost traite chaque commune indépendamment, le GNN capture les effets de réseau
- 🎓 Faisabilité Epitech : Difficile mais pas impossible si quelqu'un de l'équipe a des bases en deep learning
- ⏱ Délai : 3–4 semaines
- **Techno :** `PyG` (PyTorch Geometric) ou `DGL` — graphe : nœuds = communes, arêtes = voisinage géographique + lignes GTFS

---

### 17. OpenTelemetry — Observabilité end-to-end
> Tracer une requête utilisateur depuis le frontend React jusqu'à la requête ChromaDB du RAG, en passant par le backend Go.

- ⚡ Complexité : Moyenne/Élevée (instrumentation de toute la stack)
- 🎯 Impact : Moyen pour une démo, très fort en production pour le debug
- 🎓 Faisabilité Epitech : Correcte mais chronophage
- ⏱ Délai : 1–2 semaines
- **Techno :** `opentelemetry-go` + `opentelemetry-python` + Azure Monitor (Jaeger en local)

---

### 18. API publique documentée (Swagger + rate limiting)
> Exposer une API REST publique permettant à d'autres applications (agences, startups proptech) de consommer les données HomePedia.

- ⚡ Complexité : Moyenne
- 🎯 Impact : Fort pour la crédibilité et la monétisation DaaS
- 🎓 Faisabilité Epitech : Bonne techniquement (Swagger UI avec gin-swagger est quasi automatique)
- ⏱ Délai : 1 semaine
- **Techno :** `swaggo/swag` pour Go (génération automatique depuis les commentaires) + clés API dans Key Vault

---

### 19. Computer Vision sur photos d'annonces
> Scorer l'état intérieur d'un bien (neuf / à rénover / luxe) à partir des photos d'annonces SeLoger/PAP via un modèle ViT ou ResNet.

- ⚡ Complexité : Élevée (scraping légalement risqué + infrastructure GPU + labeling)
- 🎯 Impact : Très fort — l'état intérieur explique 15-20% de l'écart par rapport au prix médian
- 🎓 Faisabilité Epitech : Difficile — scraping SeLoger exposé juridiquement (CGU, robots.txt), nécessite un GPU
- ⏱ Délai : 4–6 semaines
- **Alternative légale :** Utiliser les photos DPE (disponibles via API ADEME) — moins riches mais 100% légales

---

### 20. Simulateur de Bilan d'Aménagement (IRR / Cash-on-Cash)
> Calculer le Taux de Rentabilité Interne (IRR) en intégrant frais de notaire, travaux estimés et levier bancaire — outil pour promoteurs immobiliers.

- ⚡ Complexité : Élevée (côté UX/finance, nécessite des données de coûts de construction)
- 🎯 Impact : Très fort pour la cible B2B pro (promoteurs, foncières)
- 🎓 Faisabilité Epitech : Difficile sans partenariat avec un professionnel de l'immobilier pour valider les hypothèses
- ⏱ Délai : 4–6 semaines
- **Références :** Coûts de construction COPREC, base BATIPRIX

---

## Tier 4 — Post-startup : hors scope académique

### 21. Streaming temps réel (Azure Event Hubs + Spark Streaming)
> Pipeline streaming pour une fraîcheur quasi-quotidienne des données, remplacing l'ingestion batch mensuelle DVF.

- ⚡ Complexité : Très élevée
- 🎓 Faisabilité Epitech : Non réaliste — DVF n'a pas d'API temps réel, le streaming n'apporte rien sans source fraîche
- **Intérêt :** Uniquement si couplé à un partenariat avec des réseaux d'agences (Century 21, FNAIM)

---

### 22. Feature Store centralisé (Databricks Feature Store)
> Centraliser toutes les features ML (score transport, CAGR, DPE moyen...) pour partager entre les modèles sans recalcul.

- ⚡ Complexité : Élevée
- 🎓 Faisabilité Epitech : Inutile avec 1-2 modèles — n'apporte de la valeur qu'à partir de 5+ modèles en production

---

### 23. Graph Database (Neo4j) — Relations propriétaires/transactions
> Modéliser les chaînes de ventes, les propriétaires en série, les SCI... pour détecter les marchands de biens.

- ⚡ Complexité : Très élevée
- 🎓 Faisabilité Epitech : Non réaliste — DVF ne contient plus les noms (anonymisation RGPD obligatoire)
- **Intérêt :** Uniquement avec accès aux données FICOVIE ou FICP (accès réservé aux notaires/banques)

---

### 24. Expansion européenne (Berlin, Amsterdam, Madrid)
> Étendre la comparaison à d'autres marchés européens majeurs.

- ⚡ Complexité : Très élevée (chaque pays a ses propres formats de données cadastrales et transactionnelles)
- 🎓 Faisabilité Epitech : Non réaliste — les équivalents DVF n'existent pas partout ou sont payants

---

---

### 39. Pipeline MLOps — RAG Évaluateur (LLM-as-a-Judge en CI/CD)
> À chaque PR modifiant le code RAG ou les chunks ChromaDB, un job Cloud Build lance un benchmark de 100 questions et utilise un modèle évaluateur (Gemini Flash ou GPT-4o-mini) pour scorer automatiquement la précision. Le build échoue si le score régressse sous le seuil.

- ⚡ Complexité : Élevée
- 🎯 Impact : Garantie qualité continue — zéro régression RAG non détectée
- 🎓 Faisabilité Epitech : Bonne — démontre des compétences MLOps pointues très recherchées
- ⏱ Délai : 2 semaines
- **Techno :** `ragas` + Cloud Build `cloudbuild-rag-eval.yaml` + seuil configurable (ex: faithfulness > 0.80)

---

### 40. Agent IA Multi-étapes — Parcours Investissement Complet (LangGraph)
> Le chatbot répond à des questions isolées mais ne guide pas un parcours complet. Un agent avec mémoire d'état guide l'utilisateur de "je cherche à investir" à "voici votre simulation crédit + cash-flow sur Montreuil vs Noisy-le-Grand", en enchaînant autonomement les appels SQL, ChromaDB et calculs financiers.

- ⚡ Complexité : Élevée
- 🎯 Impact : Très fort — outil de conversion décisionnelle, passage d'une interface à un conseiller
- 🎓 Faisabilité Epitech : Correcte
- ⏱ Délai : 4–5 semaines
- **Techno :** `langgraph` (Python) + tools (SQL executor, calcul PMT, RAG retriever) + état persisté Supabase

---

### 41. DuckDB-WASM — Filtrage OLAP Zéro-Latence Côté Client
> Exporter la table `communes_agregat` (~3 Mo compressés) en Parquet sur Cloud Storage. Le navigateur charge ce fichier et filtre via un moteur SQL local (DuckDB-WASM dans un Web Worker). Les sliders de prix, DPE, IPS deviennent instantanés à 60fps — sans aucune requête réseau.

- ⚡ Complexité : Élevée
- 🎯 Impact : Architecture avant-garde — UX instantanée, coûts API effondrés, preuve de concept impressionnante
- 🎓 Faisabilité Epitech : Difficile mais très valorisante
- ⏱ Délai : 3–4 semaines
- **Techno :** `@duckdb/duckdb-wasm` dans Web Worker React + Parquet généré Databricks + `@apache-arrow/es2015-esm`

---

### 42. Analyse de Sentiment NLP — e-Réputation des Communes (CamemBERT)
> Scraper les avis textuels publics des habitants (forums, Google Maps, données open data citoyens) et appliquer CamemBERT pour extraire un "Score de sentiment" et des tags qualitatifs ("Bouchons", "Verdure", "Ambiance village"). Données qualitatives absentes de tous les agrégateurs.

- ⚡ Complexité : Élevée (ingestion non structurée + ML)
- 🎯 Impact : Différenciation forte — aucun concurrent grand public ne croise avis citoyens et prix
- 🎓 Faisabilité Epitech : Correcte — Scrapy/BeautifulSoup + CamemBERT HuggingFace inféré sur Databricks
- ⏱ Délai : 3 semaines
- **Techno :** `scrapy` + `transformers` (CamemBERT sentiment) + colonne `sentiment_score FLOAT` + tags `JSONB` Gold

---

## Récapitulatif

| # | Axe | Tier | Complexité | Délai |
|---|---|---|---|---|
| 1 | Delta Lake Change Data Feed | Quick Win | Faible | 1–2j |
| 2 | Data Quality (Great Expectations) | Quick Win | Faible | 2–3j |
| 3 | Cache sémantique RAG | Quick Win | Faible | 2–3j |
| 4 | Export PDF rapport commune | Quick Win | Faible | 2–4j |
| 5 | Timeline animée carte | Quick Win | Faible | 3–5j |
| 6 | Données loyers CLAMEUR | Quick Win | Faible | 3–5j |
| 7 | PLU (Géoportail Urbanisme) | Moyen terme | Moyenne | 1–2sem |
| 8 | Risques environnementaux BRGM | Moyen terme | Moyenne | 1sem |
| 9 | Permis construire SITADEL | Moyen terme | Moyenne | 1sem |
| 10 | Prédiction temporelle Prophet | Moyen terme | Moyenne | 1–2sem |
| 11 | Détection anomalies DVF | Moyen terme | Moyenne | 1sem |
| 12 | Recommandation personnalisée | Moyen terme | Moyenne | 1–2sem |
| 13 | Simulateur crédit immobilier | Moyen terme | Faible/Moyenne | 1sem |
| 14 | Extension nationale | Moyen terme | Moyenne | 1–2sem |
| 15 | Signaux faibles gentrification | Moyen terme | Moyenne | 2sem |
| 16 | Graph Neural Networks (GNN) | Ambitieux | Élevée | 3–4sem |
| 17 | OpenTelemetry observabilité | Ambitieux | Élevée | 1–2sem |
| 18 | API publique Swagger | Ambitieux | Moyenne | 1sem |
| 19 | Computer Vision photos annonces | Ambitieux | Élevée | 4–6sem |
| 20 | Simulateur IRR bilan aménagement | Ambitieux | Élevée | 4–6sem |
| 21 | Streaming Event Hubs | Post-startup | Très élevée | — |
| 22 | Feature Store | Post-startup | Élevée | — |
| 23 | Graph DB Neo4j propriétaires | Post-startup | Très élevée | — |
| 24 | Expansion européenne | Post-startup | Très élevée | — |
| 25 | Explainable AI SHAP (score XGBoost) | Quick Win | Faible | 3–5j |
| 26 | Tuiles Vectorielles MVT (PostGIS) | Quick Win | Faible | 3–5j |
| 27 | "Pourquoi cette commune ?" (comparaison auto) | Quick Win | Faible | 3–5j |
| 28 | Auto-évaluation confiance chatbot (RAGAS) | Quick Win | Faible/Moyenne | 5–7j |
| 29 | Journal d'audit + RGPD rétention chatbot | Quick Win | Faible | 4–6j |
| 30 | Filtre par isochrones (temps de trajet GTFS) | Moyen terme | Moyenne | 1–2sem |
| 31 | Fine-tuning Qwen2.5 LoRA (immobilier FR) | Moyen terme | Moyenne | 2–3sem |
| 32 | RAG adaptatif (routing SQL/BM25/ChromaDB) | Moyen terme | Moyenne | 1sem |
| 33 | Villes Jumelles HDBSCAN (similaire −20%) | Moyen terme | Moyenne | 1sem |
| 34 | Portfolio Investisseur (cash-flow + yield) | Moyen terme | Moyenne | 1–2sem |
| 35 | Pare-feu RAG PII (Presidio) + anti-injection | Moyen terme | Moyenne | 1sem |
| 36 | Alertes intelligentes critères immobiliers | Moyen terme | Moyenne | 1–2sem |
| 37 | Exploration multicritère Pareto Front | Moyen terme | Moyenne | 1–2sem |
| 38 | Moteur scénarios "What-If" XGBoost | Ambitieux | Élevée | 2–3sem |
| 39 | Pipeline MLOps RAG Évaluateur LLM-as-a-Judge | Ambitieux | Élevée | 2sem |
| 40 | Agent IA multi-étapes LangGraph | Ambitieux | Élevée | 4–5sem |
| 41 | DuckDB-WASM filtrage OLAP zéro-latence | Ambitieux | Élevée | 3–4sem |
| 42 | Sentiment NLP avis citoyens (CamemBERT) | Ambitieux | Élevée | 3sem |

---

> *Document mis à jour — analyse interne + Gemini + ChatGPT + Claude — Juillet 2026*
