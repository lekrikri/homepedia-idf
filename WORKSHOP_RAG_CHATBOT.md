# WORKSHOP — Chatbot IA RAG HomePedia
## Pour : Gaspard | Phase 6 — Assistant Conversationnel

> **Objectif** : Construire un chatbot en langage naturel qui répond aux questions immobilières en interrogeant les données HomePedia (DVF, DPE, communes, transports) via une architecture RAG (Retrieval-Augmented Generation).

---

## 🏗️ Vue d'ensemble de l'architecture RAG

```
Question utilisateur
        │
        ▼
┌────────────────────┐
│  Embedding CamemBERT│   → encode la question en vecteur 768d
│  (sentence-transf.)│
└────────────┬───────┘
             │ vecteur requête
             ▼
┌────────────────────┐     ┌─────────────────────────────────┐
│    ChromaDB        │◄────│ Index de documents pré-indexés  │
│  (localhost:8001)  │     │  • fiches communes (prix, DPE)  │
│  collection:       │     │  • résumés quartiers           │
│  homepedia_docs    │     │  • données transports           │
└────────────┬───────┘     └─────────────────────────────────┘
             │ top-k chunks (k=5)
             ▼
┌────────────────────┐
│  Prompt builder    │   → "Contexte: [chunks] \n Question: [query]"
└────────────┬───────┘
             │
             ▼
┌────────────────────┐
│  LLM (Mistral/     │   → génère la réponse en français
│  Claude/Ollama)    │
└────────────┬───────┘
             │
             ▼
       Réponse JSON → API Go → Frontend React
```

---

## 🗂️ Structure des fichiers à créer

```
T-DAT-902-PAR_3/
├── rag/
│   ├── requirements.txt          # dépendances Python
│   ├── .env.example              # variables d'env
│   ├── 01_build_corpus.py        # extrait données PG → documents texte
│   ├── 02_index_chromadb.py      # encode + indexe dans ChromaDB
│   ├── 03_rag_server.py          # API FastAPI /rag/query
│   └── test_rag.py               # tests manuels
```

---

## Étape 0 — Prérequis

### Services locaux qui tournent déjà

```bash
# Vérifier que Docker est up
docker ps

# Doit afficher :
# homepedia_postgres   → port 5433
# homepedia_chromadb   → port 8001
# homepedia_backend    → port 8080
# homepedia_frontend   → port 3000
```

Si les services ne tournent pas :
```bash
cd /path/to/T-DAT-902-PAR_3
docker compose up -d
```

### Tester ChromaDB

```bash
curl http://localhost:8001/api/v1/heartbeat
# → {"nanosecond heartbeat": ...}
```

### Environnement Python

```bash
cd T-DAT-902-PAR_3/rag/
python3 -m venv venv
source venv/bin/activate

pip install chromadb sentence-transformers psycopg2-binary \
            fastapi uvicorn python-dotenv requests
```

---

## Étape 1 — `requirements.txt`

```
chromadb==0.5.0
sentence-transformers==3.0.1
psycopg2-binary==2.9.9
fastapi==0.111.0
uvicorn==0.30.1
python-dotenv==1.0.1
requests==2.32.3
```

---

## Étape 2 — `.env`

Créer `rag/.env` (copier depuis `.env.example`) :

```bash
# PostgreSQL (même config que le backend)
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_DB=homepedia
POSTGRES_USER=homepedia
POSTGRES_PASSWORD=homepedia123

# ChromaDB
CHROMADB_HOST=localhost
CHROMADB_PORT=8001

# LLM — choisir UNE option :
# Option A : Mistral via API Mistral AI (gratuit jusqu'à 1M tokens/mois)
MISTRAL_API_KEY=sk-...

# Option B : Claude Sonnet (Anthropic)
ANTHROPIC_API_KEY=sk-ant-...

# Option C : Ollama local (mistral:7b, llama3, etc.) — gratuit, hors ligne
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=mistral

# Choisir le provider actif : "mistral" | "claude" | "ollama"
LLM_PROVIDER=mistral
```

---

## Étape 3 — `01_build_corpus.py` — Extraire les données → corpus texte

Ce script lit PostgreSQL et génère des **chunks de texte** (documents) à indexer dans ChromaDB.

```python
"""
01_build_corpus.py
Extrait les données HomePedia depuis PostgreSQL et les formate
en documents texte pour indexation RAG dans ChromaDB.
"""

import os
import json
import psycopg2
from dotenv import load_dotenv

load_dotenv()

def get_pg_conn():
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", 5433)),
        dbname=os.getenv("POSTGRES_DB"),
        user=os.getenv("POSTGRES_USER"),
        password=os.getenv("POSTGRES_PASSWORD"),
    )

def build_commune_docs(conn) -> list[dict]:
    """
    Génère 1 document par commune avec ses métriques agrégées depuis transactions.
    Note : la table commune_gold n'existe pas encore en base locale —
    les métriques sont calculées directement depuis transactions.
    """
    cur = conn.cursor()
    cur.execute("""
        SELECT
            c.code_insee,
            c.nom,
            c.departement,
            c.region,
            c.population,
            COUNT(t.id)                          AS nb_transactions,
            PERCENTILE_CONT(0.5) WITHIN GROUP (
                ORDER BY t.valeur_fonciere / NULLIF(t.surface_reelle_bati, 0)
            )                                    AS prix_m2_median,
            AVG(t.valeur_fonciere / NULLIF(t.surface_reelle_bati, 0)) AS prix_m2_moyen,
            MODE() WITHIN GROUP (ORDER BY t.classe_energie) AS dpe_dominant,
            AVG(CASE t.classe_energie
                WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3
                WHEN 'D' THEN 4 WHEN 'E' THEN 5 WHEN 'F' THEN 6
                WHEN 'G' THEN 7 END)             AS score_dpe_moyen,
            AVG(CASE WHEN t.type_local = 'Appartement' THEN 1.0 ELSE 0.0 END) * 100 AS pct_appartements,
            AVG(t.surface_reelle_bati)           AS surface_moyenne
        FROM communes c
        LEFT JOIN transactions t
            ON t.code_commune = c.code_insee
            AND t.surface_reelle_bati > 9
            AND t.valeur_fonciere > 10000
        WHERE c.departement IN ('75','77','78','91','92','93','94','95')
        GROUP BY c.code_insee, c.nom, c.departement, c.region, c.population
        ORDER BY c.nom
    """)
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description]

    docs = []
    for row in rows:
        r = dict(zip(cols, row))

        # Construire le texte descriptif
        text_parts = [
            f"Commune : {r['nom']} (code INSEE {r['code_insee']})",
            f"Département : {r['departement']}, Région : {r.get('region', 'Île-de-France')}",
        ]
        if r.get('population'):
            text_parts.append(f"Population : {r['population']:,} habitants")
        if r.get('prix_m2_median'):
            text_parts.append(f"Prix médian au m² : {r['prix_m2_median']:.0f} €/m²")
        if r.get('prix_m2_moyen'):
            text_parts.append(f"Prix moyen au m² : {r['prix_m2_moyen']:.0f} €/m²")
        if r.get('nb_transactions'):
            text_parts.append(f"Nombre de transactions DVF : {r['nb_transactions']}")
        if r.get('dpe_dominant'):
            text_parts.append(f"Classe DPE dominante : {r['dpe_dominant']}")
        if r.get('score_dpe_moyen'):
            text_parts.append(f"Score DPE moyen : {r['score_dpe_moyen']:.1f}/7 (1=A, 7=G)")
        if r.get('pct_appartements'):
            text_parts.append(f"Part d'appartements : {r['pct_appartements']:.1f}%")
        if r.get('surface_moyenne'):
            text_parts.append(f"Surface moyenne des biens : {r['surface_moyenne']:.0f} m²")

        docs.append({
            "id": f"commune_{r['code_insee']}",
            "text": ". ".join(text_parts) + ".",
            "metadata": {
                "type": "commune",
                "code_insee": r['code_insee'],
                "nom": r['nom'],
                "departement": r['departement'],
                "prix_m2_median": float(r['prix_m2_median']) if r.get('prix_m2_median') else None,
            }
        })

    print(f"  → {len(docs)} documents communes générés")
    return docs


def build_transaction_summary_docs(conn) -> list[dict]:
    """
    Génère des documents de résumé par commune + type de bien.
    Ex : "Les appartements à Montreuil coûtent en médiane 4 200 €/m²"
    """
    cur = conn.cursor()
    cur.execute("""
        SELECT
            code_commune,
            commune,
            type_local,
            COUNT(*)                          AS nb,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY valeur_fonciere / NULLIF(surface_reelle_bati, 0)) AS prix_m2_median,
            AVG(surface_reelle_bati)           AS surface_moy,
            MIN(source_annee)                  AS annee_min,
            MAX(source_annee)                  AS annee_max
        FROM transactions
        WHERE code_commune IS NOT NULL
          AND surface_reelle_bati > 9
          AND valeur_fonciere > 10000
          AND type_local IN ('Appartement', 'Maison')
        GROUP BY code_commune, commune, type_local
        HAVING COUNT(*) >= 5
        ORDER BY commune, type_local
    """)
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description]

    docs = []
    for row in rows:
        r = dict(zip(cols, row))
        type_label = "appartements" if r['type_local'] == 'Appartement' else "maisons"
        text = (
            f"Marché immobilier des {type_label} à {r['commune']} "
            f"(code INSEE {r['code_commune']}) : "
            f"{r['nb']} transactions recensées entre {r['annee_min']} et {r['annee_max']}. "
        )
        if r.get('prix_m2_median'):
            text += f"Prix médian au m² : {float(r['prix_m2_median']):.0f} €/m². "
        if r.get('surface_moy'):
            text += f"Surface moyenne : {float(r['surface_moy']):.0f} m²."

        docs.append({
            "id": f"tx_{r['code_commune']}_{r['type_local'].lower()}",
            "text": text,
            "metadata": {
                "type": "transaction_summary",
                "code_insee": r['code_commune'],
                "commune": r['commune'],
                "type_local": r['type_local'],
                "nb_transactions": int(r['nb']),
                "prix_m2_median": float(r['prix_m2_median']) if r.get('prix_m2_median') else None,
            }
        })

    print(f"  → {len(docs)} documents résumés transactions générés")
    return docs


def build_dpe_docs(conn) -> list[dict]:
    """
    Génère des documents sur la performance énergétique par commune.
    """
    cur = conn.cursor()
    cur.execute("""
        SELECT
            t.code_commune,
            t.commune,
            t.classe_energie,
            COUNT(*) AS nb
        FROM transactions t
        WHERE t.classe_energie IS NOT NULL
          AND t.code_commune IS NOT NULL
        GROUP BY t.code_commune, t.commune, t.classe_energie
        ORDER BY t.commune, t.classe_energie
    """)
    rows = cur.fetchall()

    # Regrouper par commune
    from collections import defaultdict
    by_commune = defaultdict(list)
    for row in rows:
        by_commune[(row[0], row[1])].append((row[2], row[3]))

    docs = []
    for (code, nom), classes in by_commune.items():
        total = sum(n for _, n in classes)
        top_class = max(classes, key=lambda x: x[1])
        distribution = ", ".join(f"{cl}:{n}" for cl, n in sorted(classes))
        text = (
            f"Performance énergétique (DPE) à {nom} ({code}) : "
            f"sur {total} biens avec DPE renseigné, "
            f"la classe dominante est {top_class[0]}. "
            f"Distribution : {distribution}."
        )
        docs.append({
            "id": f"dpe_{code}",
            "text": text,
            "metadata": {
                "type": "dpe",
                "code_insee": code,
                "commune": nom,
                "dpe_dominant": top_class[0],
            }
        })

    print(f"  → {len(docs)} documents DPE générés")
    return docs


def main():
    print("📚 Construction du corpus RAG HomePedia...")
    conn = get_pg_conn()
    all_docs = []
    all_docs.extend(build_commune_docs(conn))
    all_docs.extend(build_transaction_summary_docs(conn))
    all_docs.extend(build_dpe_docs(conn))
    conn.close()

    # Sauvegarder en JSON pour inspection
    with open("corpus.json", "w", encoding="utf-8") as f:
        json.dump(all_docs, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Corpus total : {len(all_docs)} documents → corpus.json")
    return all_docs


if __name__ == "__main__":
    main()
```

**Lancer :**
```bash
python 01_build_corpus.py
# → corpus.json créé (~1000-5000 documents selon les données en base)
```

---

## Étape 4 — `02_index_chromadb.py` — Encoder + Indexer dans ChromaDB

```python
"""
02_index_chromadb.py
Encode les documents du corpus avec CamemBERT (sentence-transformers)
et les indexe dans ChromaDB pour la recherche vectorielle.
"""

import os
import json
import chromadb
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

load_dotenv()

CHROMA_HOST = os.getenv("CHROMADB_HOST", "localhost")
CHROMA_PORT = int(os.getenv("CHROMADB_PORT", 8001))
COLLECTION_NAME = "homepedia_docs"

# Modèle CamemBERT optimisé pour le français
# Alternative : "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
MODEL_NAME = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"


def main():
    print("🔌 Connexion à ChromaDB...")
    client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)

    # Supprimer la collection si elle existe (pour ré-indexer)
    try:
        client.delete_collection(COLLECTION_NAME)
        print(f"  → Collection '{COLLECTION_NAME}' supprimée (ré-indexation)")
    except Exception:
        pass

    collection = client.create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"}  # distance cosinus pour le texte
    )

    print(f"🤖 Chargement du modèle d'embedding : {MODEL_NAME}")
    model = SentenceTransformer(MODEL_NAME)

    print("📂 Lecture du corpus...")
    with open("corpus.json", "r", encoding="utf-8") as f:
        docs = json.load(f)
    print(f"  → {len(docs)} documents à indexer")

    # Encoder par batch (évite les problèmes mémoire)
    BATCH_SIZE = 100
    for i in range(0, len(docs), BATCH_SIZE):
        batch = docs[i:i + BATCH_SIZE]
        texts = [d["text"] for d in batch]
        ids = [d["id"] for d in batch]
        metadatas = [d["metadata"] for d in batch]

        # Encoder → vecteurs 768d
        embeddings = model.encode(texts, show_progress_bar=False).tolist()

        # Indexer dans ChromaDB
        collection.add(
            ids=ids,
            documents=texts,
            embeddings=embeddings,
            metadatas=metadatas,
        )

        print(f"  → Batch {i//BATCH_SIZE + 1}/{(len(docs)-1)//BATCH_SIZE + 1} indexé ({len(batch)} docs)")

    print(f"\n✅ Indexation terminée : {collection.count()} documents dans ChromaDB")

    # Test rapide
    print("\n🧪 Test de recherche : 'prix appartements Paris 13e'")
    test_embedding = model.encode(["prix appartements Paris 13e"]).tolist()
    results = collection.query(query_embeddings=test_embedding, n_results=3)
    for i, doc in enumerate(results["documents"][0]):
        print(f"  [{i+1}] {doc[:120]}...")


if __name__ == "__main__":
    main()
```

**Lancer :**
```bash
python 02_index_chromadb.py
# Première exécution : télécharge le modèle (~420 MB)
# → Indexation de tous les documents dans ChromaDB
```

---

## Étape 5 — `03_rag_server.py` — API FastAPI

Ce serveur expose `/rag/query` que le backend Go appellera.

```python
"""
03_rag_server.py
Serveur FastAPI RAG — reçoit une question, cherche les chunks pertinents
dans ChromaDB, construit un prompt et appelle un LLM pour générer la réponse.
Port : 8002 (pour ne pas conflter avec ChromaDB:8001 et backend:8080)
"""

import os
import time
import requests
import chromadb
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="HomePedia RAG API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# ─── Config ───────────────────────────────────────────────────────────────────
CHROMA_HOST = os.getenv("CHROMADB_HOST", "localhost")
CHROMA_PORT = int(os.getenv("CHROMADB_PORT", 8001))
COLLECTION_NAME = "homepedia_docs"
MODEL_NAME = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "mistral")
TOP_K = 5  # nombre de chunks récupérés

# ─── Initialisation ───────────────────────────────────────────────────────────
print("🔌 Connexion ChromaDB...")
chroma_client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
collection = chroma_client.get_collection(COLLECTION_NAME)

print(f"🤖 Chargement modèle embedding : {MODEL_NAME}")
embed_model = SentenceTransformer(MODEL_NAME)

print(f"✅ RAG prêt — {collection.count()} documents indexés")


# ─── Modèles Pydantic ─────────────────────────────────────────────────────────
class QueryRequest(BaseModel):
    question: str
    commune_filter: str | None = None   # code_insee optionnel pour filtrer
    top_k: int = TOP_K

class QueryResponse(BaseModel):
    answer: str
    sources: list[dict]
    latency_ms: int


# ─── Fonctions LLM ────────────────────────────────────────────────────────────
def call_mistral(prompt: str) -> str:
    api_key = os.getenv("MISTRAL_API_KEY")
    if not api_key:
        raise ValueError("MISTRAL_API_KEY non défini dans .env")
    resp = requests.post(
        "https://api.mistral.ai/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": "mistral-small-latest",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
            "max_tokens": 512,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def call_claude(prompt: str) -> str:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY non défini dans .env")
    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        json={
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 512,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["content"][0]["text"]


def call_ollama(prompt: str) -> str:
    url = os.getenv("OLLAMA_URL", "http://localhost:11434")
    model = os.getenv("OLLAMA_MODEL", "mistral")
    resp = requests.post(
        f"{url}/api/generate",
        json={"model": model, "prompt": prompt, "stream": False},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["response"]


def call_llm(prompt: str) -> str:
    provider = LLM_PROVIDER.lower()
    if provider == "mistral":
        return call_mistral(prompt)
    elif provider == "claude":
        return call_claude(prompt)
    elif provider == "ollama":
        return call_ollama(prompt)
    else:
        raise ValueError(f"LLM_PROVIDER inconnu : {provider}")


# ─── Construction du prompt ───────────────────────────────────────────────────
def build_prompt(question: str, chunks: list[str]) -> str:
    context = "\n\n".join(f"[{i+1}] {c}" for i, c in enumerate(chunks))
    return f"""Tu es un assistant spécialisé dans l'immobilier en Île-de-France.
Tu réponds uniquement en français, de façon concise et factuelle.
Utilise UNIQUEMENT les informations fournies dans le contexte ci-dessous.
Si la réponse ne figure pas dans le contexte, dis-le clairement.

CONTEXTE :
{context}

QUESTION : {question}

RÉPONSE :"""


# ─── Endpoint principal ───────────────────────────────────────────────────────
@app.post("/rag/query", response_model=QueryResponse)
async def rag_query(req: QueryRequest):
    t0 = time.time()

    # 1. Encoder la question
    query_vec = embed_model.encode([req.question]).tolist()

    # 2. Chercher dans ChromaDB
    where_filter = None
    if req.commune_filter:
        where_filter = {"code_insee": req.commune_filter}

    try:
        results = collection.query(
            query_embeddings=query_vec,
            n_results=req.top_k,
            where=where_filter,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur ChromaDB : {e}")

    chunks = results["documents"][0]
    metadatas = results["metadatas"][0]
    distances = results["distances"][0]

    if not chunks:
        return QueryResponse(
            answer="Je n'ai pas trouvé d'informations pertinentes pour répondre à votre question.",
            sources=[],
            latency_ms=int((time.time() - t0) * 1000),
        )

    # 3. Construire le prompt
    prompt = build_prompt(req.question, chunks)

    # 4. Appeler le LLM
    try:
        answer = call_llm(prompt)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur LLM ({LLM_PROVIDER}) : {e}")

    # 5. Formater les sources
    sources = [
        {
            "text": chunk[:200] + "...",
            "metadata": meta,
            "score": round(1 - dist, 3),  # cosine → similarité
        }
        for chunk, meta, dist in zip(chunks, metadatas, distances)
    ]

    return QueryResponse(
        answer=answer.strip(),
        sources=sources,
        latency_ms=int((time.time() - t0) * 1000),
    )


@app.get("/rag/health")
async def health():
    return {
        "status": "ok",
        "docs_indexed": collection.count(),
        "llm_provider": LLM_PROVIDER,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002, reload=False)
```

**Lancer :**
```bash
python 03_rag_server.py
# → http://localhost:8002
# → Docs Swagger : http://localhost:8002/docs
```

---

## Étape 6 — Tests manuels

### Test via curl

```bash
# Test basique
curl -X POST http://localhost:8002/rag/query \
  -H "Content-Type: application/json" \
  -d '{"question": "Quel est le prix moyen au m² à Montreuil ?"}'

# Test avec filtre commune (93048 = Montreuil)
curl -X POST http://localhost:8002/rag/query \
  -H "Content-Type: application/json" \
  -d '{"question": "Quelle est la classe DPE dominante ?", "commune_filter": "93048"}'
```

### `test_rag.py` — Jeu de tests

```python
"""test_rag.py — Valider le comportement du RAG"""
import requests

BASE = "http://localhost:8002"

questions = [
    "Quel est le prix médian au m² à Vincennes ?",
    "Quelles communes du 93 ont le prix au m² le plus bas ?",
    "Comment est la performance énergétique à Neuilly-sur-Seine ?",
    "Combien de transactions DVF ont eu lieu à Montreuil entre 2020 et 2024 ?",
    "Quel est le prix moyen d'un appartement à Boulogne-Billancourt ?",
    "Quelle est la différence de prix entre Paris et la banlieue ?",
]

for q in questions:
    resp = requests.post(f"{BASE}/rag/query", json={"question": q})
    data = resp.json()
    print(f"\n❓ {q}")
    print(f"💬 {data['answer']}")
    print(f"⏱️  {data['latency_ms']}ms | {len(data['sources'])} sources")
    print("-" * 80)
```

---

## Étape 7 — Intégration avec le backend Go

Une fois le serveur RAG fonctionnel, le backend Go doit lui proxyfier les requêtes.

### Nouveau handler Go à créer : `rag.go`

```go
// backend/internal/handlers/rag.go
package handlers

import (
    "bytes"
    "encoding/json"
    "net/http"
    "os"
    "time"

    "github.com/gin-gonic/gin"
)

type RAGRequest struct {
    Question      string  `json:"question" binding:"required"`
    CommuneFilter *string `json:"commune_filter,omitempty"`
}

type RAGResponse struct {
    Answer    string        `json:"answer"`
    Sources   []interface{} `json:"sources"`
    LatencyMs int           `json:"latency_ms"`
}

// RAGQuery handles POST /api/v1/rag/query
func RAGQuery(c *gin.Context) {
    var req RAGRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }

    ragURL := os.Getenv("RAG_SERVICE_URL")
    if ragURL == "" {
        ragURL = "http://localhost:8002"
    }

    body, _ := json.Marshal(req)
    client := &http.Client{Timeout: 30 * time.Second}
    resp, err := client.Post(ragURL+"/rag/query", "application/json", bytes.NewBuffer(body))
    if err != nil {
        c.JSON(http.StatusBadGateway, gin.H{"error": "RAG service unavailable"})
        return
    }
    defer resp.Body.Close()

    var ragResp RAGResponse
    if err := json.NewDecoder(resp.Body).Decode(&ragResp); err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid RAG response"})
        return
    }

    c.JSON(http.StatusOK, ragResp)
}
```

### Enregistrer la route dans `main.go`

```go
// Dans cmd/server/main.go, ajouter dans le groupe v1 :
v1.POST("/rag/query", handlers.RAGQuery)
```

### Variable d'environnement à ajouter dans `.env`

```bash
RAG_SERVICE_URL=http://localhost:8002
```

---

## Étape 8 — Intégration Frontend React

Ajouter un composant `ChatRAG.jsx` dans `frontend/src/components/` :

```jsx
// frontend/src/components/ChatRAG.jsx
import { useState } from "react";

export default function ChatRAG({ communeFilter }) {
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Bonjour ! Posez-moi vos questions sur l'immobilier en Île-de-France." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const API = import.meta.env.VITE_API_URL || "http://localhost:8080";

  async function sendMessage() {
    if (!input.trim()) return;
    const question = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", text: question }]);
    setLoading(true);

    try {
      const resp = await fetch(`${API}/api/v1/rag/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          commune_filter: communeFilter || null,
        }),
      });
      const data = await resp.json();
      setMessages(prev => [...prev, { role: "assistant", text: data.answer }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", text: "Erreur de connexion au serveur." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat-rag">
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble ${m.role}`}>
            {m.text}
          </div>
        ))}
        {loading && <div className="chat-bubble assistant">...</div>}
      </div>
      <div className="chat-input">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && sendMessage()}
          placeholder="Ex: Quel est le prix au m² à Vincennes ?"
        />
        <button onClick={sendMessage} disabled={loading}>Envoyer</button>
      </div>
    </div>
  );
}
```

---

## Étape 9 — Améliorations optionnelles

Si le temps le permet, voici des axes d'amélioration par ordre de priorité :

### 9.1 — Enrichir le corpus avec les données GTFS transport

```python
# Dans 01_build_corpus.py, ajouter cette fonction :
def build_transport_docs(conn) -> list[dict]:
    """Ajouter des docs sur l'accessibilité transport par commune."""
    cur = conn.cursor()
    cur.execute("""
        SELECT commune, code_commune,
               COUNT(*) FILTER (WHERE transport_type = 'METRO') AS nb_metro,
               COUNT(*) FILTER (WHERE transport_type = 'RER') AS nb_rer,
               COUNT(*) FILTER (WHERE transport_type = 'BUS') AS nb_bus
        FROM transport_stops
        GROUP BY commune, code_commune
    """)
    # ... (une fois que Ludo a intégré les données silver transport dans PG)
```

### 9.2 — Historique de conversation (mémoire des échanges)

Passer l'historique dans le prompt :
```python
def build_prompt_with_history(question, chunks, history):
    history_text = "\n".join(
        f"{'Utilisateur' if m['role'] == 'user' else 'Assistant'} : {m['content']}"
        for m in history[-4:]  # garder les 4 derniers échanges
    )
    return f"""...\nHISTORIQUE :\n{history_text}\n\nCONTEXTE :\n..."""
```

### 9.3 — Re-ranking des chunks

Après récupération ChromaDB (top-k=10), ré-ordonner avec un modèle cross-encoder :
```python
from sentence_transformers import CrossEncoder
reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
scores = reranker.predict([(question, chunk) for chunk in chunks])
# → garder les 5 meilleurs
```

---

## Checklist de livraison

- [ ] `rag/requirements.txt` créé
- [ ] `rag/.env` configuré (clé API LLM)
- [ ] `01_build_corpus.py` → `corpus.json` généré avec >500 documents
- [ ] `02_index_chromadb.py` → collection `homepedia_docs` indexée dans ChromaDB
- [ ] `03_rag_server.py` → serveur FastAPI sur port 8002 fonctionnel
- [ ] `test_rag.py` → toutes les questions de test reçoivent une réponse pertinente
- [ ] Handler Go `rag.go` créé + route `/api/v1/rag/query` enregistrée
- [ ] Composant React `ChatRAG.jsx` intégré dans l'interface
- [ ] Test end-to-end : question depuis le frontend → réponse affichée

---

## Contacts & Ressources

| Qui | Rôle | Contact |
|-----|------|---------|
| **Christophe** | Backend Go + Infrastructure | (à compléter) |
| **Ludo** | Databricks silver GTFS (pour enrichir le corpus transport) | (à compléter) |

**Ressources utiles :**
- ChromaDB docs : https://docs.trychroma.com
- sentence-transformers : https://www.sbert.net
- Mistral API (gratuit) : https://console.mistral.ai
- Ollama (local, gratuit) : https://ollama.com

**Pour démarrer Ollama localement (option gratuite sans clé API) :**
```bash
# Installer Ollama
curl -fsSL https://ollama.com/install.sh | sh
# Télécharger un modèle français (3.8GB)
ollama pull mistral
# Tester
ollama run mistral "Quelle est la capitale de la France ?"
```
