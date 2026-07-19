# Lancement local — HomePedia (plateforme + chatbot RAG)

Guide pour démarrer toute la stack en local et vérifier que le chatbot RAG
fonctionne. Pensé pour une démo sans serveur de production.

## Prérequis

| Outil | Rôle | Vérifier |
|-------|------|----------|
| **Docker + Docker Compose** | Postgres, backend Go, service RAG, frontend | `docker compose version` |
| **Ollama** (sur la machine hôte) | LLM + embeddings, hors Docker | `ollama list` |

Le service RAG appelle Ollama sur la machine hôte via `host.docker.internal`.
Ollama n'est **pas** dans Docker — il doit tourner nativement.

### Modèles Ollama requis

```bash
ollama pull gemma4:e4b          # LLM principal (génération des réponses)
ollama pull qwen2.5:3b          # LLM léger (reformulation des follow-ups)
ollama pull nomic-embed-text    # embeddings 768 dims (retrieval)
```

## Démarrage en 4 étapes

### 1. Construire et lancer la stack

```bash
docker compose up -d --build
```

Construit 4 images (Postgres+pgvector, backend Go, service RAG, frontend) —
compter quelques minutes la première fois. Au démarrage, Postgres crée
automatiquement la table `rag_documents` (extension pgvector) via la migration
`backend/migrations/007_rag_pgvector.sql`.

Vérifier que tout est up :

```bash
docker compose ps
```

### 2. Indexer le corpus (une seule fois)

Encode les 5053 documents (1266 communes × 4 chunks) en embeddings et les
insère dans pgvector. ~10–13 min sur CPU.

```bash
docker compose exec rag python 02_index_pgvector.py
```

Les embeddings persistent dans le volume `postgres_data` : à refaire seulement
si on reconstruit le volume ou change le corpus.

### 3. Vérifier les services

```bash
# Service RAG — doit renvoyer {"status":"ok","docs_indexed":5053,...}
curl http://localhost:8002/rag/health

# Backend Go
curl http://localhost:8080/api/v1/health
```

### 4. Tester le chatbot

**Via l'interface** : ouvrir http://localhost:3000 → bouton chat flottant en bas
à droite → poser une question (ex : « Parle-moi de Montreuil »). La réponse
s'affiche en streaming, token par token.

> Liste de questions qui marchent bien (et celles à éviter) :
> voir [rag/README.md — Exemples de questions](rag/README.md#exemples-de-questions-démo).

**Via l'API** (sans UI) :

```bash
curl -N -X POST http://localhost:8080/api/v1/rag/query/stream \
  -H "Content-Type: application/json" \
  -d '{"question":"Quel est le prix immobilier à Vincennes ?","history":[]}'
```

## Ports exposés

| Service | Port | URL |
|---------|------|-----|
| Frontend | 3000 | http://localhost:3000 |
| Backend Go | 8080 | http://localhost:8080/api/v1 |
| Service RAG | 8002 | http://localhost:8002/rag/health |
| Postgres | 5433 | `localhost:5433` (user/db : `homepedia`) |

## Routes Gestion Locative (protégées par JWT)

```bash
# Compte
POST   /api/v1/auth/register        # créer un compte (proprio ou locataire)
POST   /api/v1/auth/login           # connexion → token JWT
GET    /api/v1/auth/me              # profil utilisateur courant

# Gestion biens (propriétaire)
GET    /api/v1/gestion/biens        # liste des biens du propriétaire
POST   /api/v1/gestion/biens        # créer un bien
PUT    /api/v1/gestion/biens/:id    # modifier un bien
DELETE /api/v1/gestion/biens/:id    # supprimer un bien

# Gestion locataires (propriétaire)
POST   /api/v1/gestion/biens/:id/locataire   # associer un locataire à un bien
PUT    /api/v1/gestion/locataires/:id        # modifier les informations d'un locataire
DELETE /api/v1/gestion/locataires/:id        # désactiver un locataire (actif=false)
POST   /api/v1/gestion/locataires/:id/inviter # créer un espace locataire (compte + mot de passe temporaire)

# Paiements
GET    /api/v1/gestion/biens/:id/paiements?annee=2026  # historique paiements d'un bien
POST   /api/v1/gestion/paiements    # créer/mettre à jour un paiement (upsert)
DELETE /api/v1/gestion/paiements/:id # supprimer un paiement (marquer comme impayé)

# Dashboard propriétaire
GET    /api/v1/gestion/dashboard    # stats agrégées (nb biens, loyers, impayés)

# Espace locataire
GET    /api/v1/mon-logement         # bien + paiements du locataire connecté
```

**Migration Supabase requise** (si base vierge) :
```sql
ALTER TABLE gestion_locataires
ADD COLUMN IF NOT EXISTS locataire_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
```

## Dépannage

- **`docs_indexed: 0`** → l'indexation (étape 2) n'a pas été faite ou a échoué.
- **Le chatbot ne répond pas / timeout** → vérifier qu'Ollama tourne sur l'hôte
  (`ollama list`) et que les 3 modèles sont présents.
- **Première réponse lente** → cold start du modèle. Le serveur fait un warmup au
  démarrage ; laisser ~30 s après le lancement du conteneur `rag`.
- **Voir les logs** : `docker compose logs -f rag` (ou `backend`, `postgres`).

## Architecture (rappel)

```
Frontend React (ChatRAG) → Backend Go (proxy SSE) → RAG FastAPI (:8002)
                                                      ├─ pgvector (hybrid search)
                                                      └─ Ollama (Gemma 4 + nomic)
```

Détail du pipeline RAG : voir [rag/README.md](rag/README.md).
