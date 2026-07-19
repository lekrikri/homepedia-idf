# RAG HomePedia — Assistant conversationnel immobilier IDF

## Contexte

Ce module implémente le chatbot RAG (Retrieval-Augmented Generation) de HomePedia.
Il permet aux utilisateurs de poser des questions en langage naturel sur l'immobilier en Île-de-France, et d'obtenir des réponses basées sur les vraies données du projet (DVF, DPE, INSEE, OSM, transports).

Le RAG fonctionne en 3 temps :
1. On transforme les données Gold (agrégats par commune) en documents texte (4 chunks par commune : summary, commune, dpe, poi)
2. On encode ces documents dans PostgreSQL via pgvector (hybrid search : embeddings + tsvector full-text français)
3. Quand un utilisateur pose une question, on retrouve les documents les plus pertinents et on les passe à un LLM qui formule la réponse en streaming (SSE)

## Architecture

```
                        ┌──────────────┐
                        │   Frontend   │
                        │  React Chat  │
                        └──────┬───────┘
                               │ SSE stream
                        ┌──────▼───────┐
                        │   Backend    │
                        │   Go / Gin   │
                        └──────┬───────┘
                               │ HTTP proxy
                        ┌──────▼───────┐
                        │  RAG Server  │
                        │   FastAPI    │
                        └──┬───────┬───┘
                  embed/   │       │  generate/stream
                  query    │       │
              ┌────────────▼─┐  ┌──▼──────────┐
              │  PostgreSQL  │  │   Ollama     │
              │  + pgvector  │  │  Gemma 4 e4b │
              └──────────────┘  │  + nomic     │
                                └──────────────┘
```

## Choix techniques

### LLM : Gemma 4 e4b (Google, avril 2026)

Modèle principal pour la génération de réponses. 4B params effectifs, architecture MoE, tourne sur CPU-only (~15-20s par réponse en streaming).

Un second modèle léger (**Qwen 2.5 3B**) est utilisé pour le **query rewriting** (reformulation des follow-up questions) — tâche simple qui ne justifie pas le coût du modèle principal.

### Contrainte hardware

Machine de dev : AMD Ryzen 7 5825U, 16 Go RAM, pas de GPU dédié. Tout tourne en CPU-only via Ollama.

### Embeddings : nomic-embed-text

~274 Mo, vecteurs de 768 dimensions, bon support multilingue. Tout passe par Ollama (LLM + embeddings), une seule dépendance externe.

### Base vectorielle : pgvector (PostgreSQL)

Migration depuis ChromaDB vers pgvector pour un hybrid search natif en SQL :
- **Recherche sémantique** : cosine distance sur les embeddings (index HNSW)
- **Full-text français** : tsvector + plainto_tsquery avec stemming français
- **Score hybride** : `0.7 × semantic + 0.3 × full-text`

Avantage : tout dans PostgreSQL, pas de service vectoriel séparé à maintenir.

### Retrieval

Le pipeline de retrieval inclut :
- **Détection de commune** : lookup en base des noms de ville mentionnés dans la question
- **Détection de département** : regex + mots-clés (ex: "92", "Hauts-de-Seine")
- **Query rewriting** : reformulation des follow-up questions via Qwen 2.5 3B (ex: "et le pire ?" → "Quel commune du 92 a le pire DPE ?")
- **Hybrid search** : combinaison sémantique + full-text sur les summaries

## Données source

Le RAG s'appuie sur la **table Gold `communes_agregat`** produite dans Databricks. Le corpus contient 5053 documents (1266 communes IDF × 4 types de chunks).

Types de chunks :
- **summary** : résumé condensé (prix, population, DPE, transports) — envoyé au LLM
- **commune** : données structurées complètes
- **dpe** : performance énergétique détaillée
- **poi** : points d'intérêt et transports

## Architecture des fichiers

```
rag/
├── README.md               ← ce fichier
├── requirements.txt        ← dépendances Python
├── corpus.json             ← corpus généré (5053 documents)
├── 01_build_corpus.py      ← Gold → documents texte
├── 02_index_pgvector.py    ← corpus.json → embeddings pgvector
├── 03_rag_server.py        ← API FastAPI (port 8002)
└── Dockerfile              ← image Docker du service
```

## Comment lancer

```bash
# 1. Prérequis : Ollama avec les modèles
ollama pull gemma4:e4b
ollama pull qwen2.5:3b
ollama pull nomic-embed-text

# 2. Lancer la stack complète
docker compose up -d

# 3. Indexer le corpus (première fois uniquement, ~13 min)
python -u rag/02_index_pgvector.py

# 4. Le chat est accessible via le frontend sur http://localhost:3000
```

## Stack technique

| Composant | Techno | Rôle |
|-----------|--------|------|
| LLM principal | Gemma 4 e4b via Ollama | Génération des réponses |
| LLM rewriting | Qwen 2.5 3B via Ollama | Reformulation des follow-ups |
| Embeddings | nomic-embed-text via Ollama | Encodage sémantique (768 dims) |
| Base vectorielle | PostgreSQL + pgvector | Hybrid search (HNSW + tsvector) |
| API RAG | FastAPI (port 8002) | Endpoints `/rag/query` et `/rag/query/stream` |
| Backend | Go/Gin (port 8080) | Proxy SSE vers le RAG |
| Frontend | React (composant ChatRAG) | Interface chat streaming |

## Exemples de questions (démo)

Le RAG excelle sur les **fiches communes** et les **comparaisons entre villes nommées** :

```
Parle-moi de Montreuil
Quel est le prix immobilier à Vincennes ?
Est-ce que Versailles est bien desservie en transports ?
Compare les prix entre Montreuil et Vincennes
Vaut-il mieux acheter à Ivry-sur-Seine ou à Villejuif ?
```

Follow-ups à enchaîner pour montrer le **query rewriting** :

```
Quel est le prix à Montreuil ?   →   Et à Bagnolet ?
Parle-moi de Nanterre            →   C'est cher ?
```

À éviter en démo (voir Limites ci-dessous) : superlatifs/classements
("la commune la moins chère du 77"), agrégations ("prix moyen en IDF"),
questions temporelles ("les prix ont-ils augmenté depuis 2020 ?").

## Limites actuelles

Le RAG fonctionne bien pour les **questions factuelles ciblées** : décrire une commune, comparer un critère précis (prix, DPE, transports) sur une ou quelques villes. C'est le cas d'usage principal d'un assistant immobilier.

En revanche, le RAG est limité sur les **questions comparatives / classement** ("quelle est la commune la moins chère du 77 ?"). La recherche vectorielle retrouve les documents les plus *similaires* à la question, pas ceux qui *répondent* à la question — "le plus cher" et "le moins cher" ont quasiment le même embedding. Le modèle ne peut comparer que les communes présentes dans son contexte (3-5 summaries), pas les 507 du département.

Ce sont des limites connues et documentées du RAG naïf, pas un problème d'implémentation.

## Améliorations futures

### Classification de questions

Ajouter un classifieur léger (rule-based ou LLM) qui catégorise la question en amont :
- **Descriptive** ("parle-moi de Montreuil") → pipeline RAG classique
- **Comparative / classement** ("la moins chère du 92") → requête SQL directe
- **Agrégation** ("prix moyen en IDF") → requête SQL avec agrégats

### Requêtes SQL dynamiques pour les classements

Pour les questions de type superlatif/classement, contourner le RAG et interroger directement `communes_agregat` en SQL. Un LLM léger traduit la question en filtre SQL :
- "commune la moins chère du 92" → `SELECT city, prix_median_m2 FROM communes_agregat WHERE code_departement = '92' ORDER BY prix_median_m2 ASC LIMIT 5`
- "meilleur DPE du 93" → `SELECT city, score_dpe_moyen FROM communes_agregat WHERE code_departement = '93' ORDER BY score_dpe_moyen ASC LIMIT 5`

Résultat déterministe, instantané, et toujours correct.

### Re-ranking post-retrieval

Après le hybrid search, ajouter une étape de re-ranking (cross-encoder léger) pour scorer la pertinence réelle de chaque chunk par rapport à la question. Améliore significativement la précision du retrieval sans changer le reste du pipeline.

### Enrichissement du corpus

- Ajouter des chunks comparatifs pré-calculés ("Les 5 communes les moins chères du 92 sont...")
- Générer des chunks de synthèse par département
- Intégrer les données temporelles (évolution des prix)
