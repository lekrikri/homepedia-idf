# WORKSHOP — Chatbot IA RAG HomePedia
## Pour : Gaspard | Phase 6 — Assistant Conversationnel

> **Objectif** : Construire un chatbot en langage naturel qui répond aux questions immobilières en interrogeant les données HomePedia via une architecture RAG (Retrieval-Augmented Generation).

---

## 🏗️ Vue d'ensemble de l'architecture RAG

```
Question utilisateur
        │
        ▼
┌────────────────────┐
│  Embedding         │   → encode la question en vecteur
│  (sentence-transf.)│
└────────────┬───────┘
             │ vecteur requête
             ▼
┌────────────────────┐     ┌──────────────────────────────────────────┐
│    ChromaDB        │◄────│ Index de documents pré-indexés           │
│  (localhost:8001)  │     │  • fiches communes (prix, DPE, POI)      │
│  collection:       │     │  • générés depuis gold/communes_agregat/ │
│  communes_idf      │     │  • 1 document = 1 commune IDF            │
└────────────┬───────┘     └──────────────────────────────────────────┘
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

## 📊 Source de données — Table Gold `communes_agregat`

La table Gold est la **seule source de vérité** pour le RAG. Elle est produite par Databricks et stockée dans Azure ADLS Gen2.

### Schéma complet

```
gold/communes_agregat/
│
├── code_commune          string    -- clé principale (INSEE 5 chiffres)
├── city                  string    -- nom de la commune
├── code_departement      string    -- 75, 77, 78, 91, 92, 93, 94, 95
├── centroid_lon          double    -- longitude du centre
├── centroid_lat          double    -- latitude du centre
├── surface_km2           double    -- superficie
│
├── -- INSEE
├── population_totale     long      -- population totale
├── population_municipale long      -- population municipale
├── densite_pop_km2       double    -- habitants/km²
│
├── -- DVF (transactions immobilières)
├── prix_median_m2        double    -- prix médian au m²
├── prix_moyen_m2         double    -- prix moyen au m²
├── nb_transactions       long      -- nombre de ventes
├── surface_moyenne       double    -- surface moyenne des biens vendus
├── prix_median_transaction double  -- prix médian d'une transaction
│
├── -- DPE (performance énergétique)
├── score_dpe_moyen       double    -- 1 (A) à 7 (G)
├── conso_energie_moyenne double    -- kWh/m²/an
├── emission_ges_moyenne  double    -- kgCO2/m²/an
├── nb_dpe                long      -- nombre de DPE
├── pct_dpe_bon           double    -- % de biens classés A ou B
│
└── -- OSM (points d'intérêt)
    ├── nb_poi_total       long
    ├── nb_transport       long
    ├── nb_education       long
    ├── nb_sante           long
    ├── nb_commerce        long
    ├── nb_restauration    long
    ├── nb_parcs           long
    ├── nb_services        long
    └── nb_bio_bobo        long     -- signal gentrification
```

---

## 🗂️ Structure des fichiers à créer

```
T-DAT-902-PAR_3/
├── rag/
│   ├── requirements.txt              # dépendances Python
│   ├── .env.example                  # variables d'env
│   ├── 01_index_from_databricks.py   # Databricks : Gold → ChromaDB (notebook)
│   ├── 02_rag_server.py              # API FastAPI locale /rag/query
│   └── test_rag.py                   # tests manuels
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

```bash
# Tester ChromaDB
curl http://localhost:8001/api/v1/heartbeat
# → {"nanosecond heartbeat": ...}
```

### Environnement Python local (pour le serveur RAG)

```bash
cd T-DAT-902-PAR_3/rag/
python3 -m venv venv
source venv/bin/activate
pip install chromadb sentence-transformers fastapi uvicorn python-dotenv requests
```

---

## Étape 1 — `requirements.txt`

```
chromadb==0.5.0
sentence-transformers==3.0.1
fastapi==0.111.0
uvicorn==0.30.1
python-dotenv==1.0.1
requests==2.32.3
```

---

## Étape 2 — `.env`

Créer `rag/.env` :

```bash
# ChromaDB
CHROMADB_HOST=localhost
CHROMADB_PORT=8001

# LLM — choisir UNE option :
# Option A : Mistral via API Mistral AI (gratuit jusqu'à 1M tokens/mois)
MISTRAL_API_KEY=sk-...

# Option B : Claude Haiku (Anthropic — rapide et pas cher)
ANTHROPIC_API_KEY=sk-ant-...

# Option C : Ollama local (gratuit, hors ligne)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=mistral

# Choisir le provider actif : "mistral" | "claude" | "ollama"
LLM_PROVIDER=mistral
```

---

## Étape 3 — Indexation depuis Databricks (Notebook)

> **À exécuter dans un notebook Databricks** — les données Gold sont dans Azure ADLS Gen2, pas en local.

### `01_index_from_databricks.py` (notebook Databricks)

```python
# Notebook Databricks — indexer gold/communes_agregat/ dans ChromaDB
# Cluster requis : avec sentence-transformers installé
# pip install sentence-transformers chromadb

import chromadb
import pandas as pd
from sentence_transformers import SentenceTransformer
from pyspark.sql import functions as F

# ── Config ────────────────────────────────────────────────────────────────────
GOLD = "abfss://gold@homepediadatalake.dfs.core.windows.net"
CHROMA_HOST = dbutils.secrets.get(scope="homepedia", key="CHROMA_HOST")
# Si pas de secret configuré, utiliser l'IP du poste local en accès réseau
# CHROMA_HOST = "TON_IP_LOCALE"  # ex: "192.168.1.42"
CHROMA_PORT = 8001
COLLECTION_NAME = "communes_idf"
MODEL_NAME = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"

# ── Étape 1 : Lire la table Gold ──────────────────────────────────────────────
print("📖 Lecture de gold/communes_agregat/...")
df_gold = spark.read.format("delta").load(f"{GOLD}/communes_agregat/")
print(f"  → {df_gold.count()} communes")

# ── Étape 2 : Générer les descriptions textuelles ─────────────────────────────
df_text = df_gold.withColumn("description",
    F.concat_ws(" ",
        F.lit("La commune de"), F.col("city"),
        F.lit("dans le département"), F.col("code_departement"),
        F.lit("compte"), F.col("population_totale").cast("string"),
        F.lit("habitants avec une densité de"),
        F.round("densite_pop_km2", 0).cast("string"),
        F.lit("habitants par km²."),

        F.lit("Le prix médian au m² est de"),
        F.round("prix_median_m2", 0).cast("string"),
        F.lit("euros (moyenne :"),
        F.round("prix_moyen_m2", 0).cast("string"),
        F.lit("€/m²)."),
        F.lit("Basé sur"), F.col("nb_transactions").cast("string"),
        F.lit("transactions, la surface moyenne des biens est de"),
        F.round("surface_moyenne", 0).cast("string"),
        F.lit("m²."),

        F.lit("Performance énergétique (DPE) : score moyen"),
        F.round("score_dpe_moyen", 1).cast("string"),
        F.lit("sur 7 (1=A, 7=G),"),
        F.round("conso_energie_moyenne", 0).cast("string"),
        F.lit("kWh/m²/an de consommation,"),
        F.round("emission_ges_moyenne", 1).cast("string"),
        F.lit("kgCO2/m²/an d'émissions."),
        F.round("pct_dpe_bon", 1).cast("string"),
        F.lit("% des biens classés A ou B."),

        F.lit("Équipements : "),
        F.col("nb_transport").cast("string"), F.lit("arrêts de transport,"),
        F.col("nb_education").cast("string"), F.lit("établissements scolaires,"),
        F.col("nb_sante").cast("string"), F.lit("établissements de santé,"),
        F.col("nb_commerce").cast("string"), F.lit("commerces,"),
        F.col("nb_restauration").cast("string"), F.lit("restaurants,"),
        F.col("nb_parcs").cast("string"), F.lit("parcs."),
        F.col("nb_bio_bobo").cast("string"), F.lit("commerces bio/bobo (indicateur gentrification)."),
    )
)

# Aperçu
df_text.select("code_commune", "city", "description").show(3, truncate=False)

# ── Étape 3 : Encoder avec sentence-transformers ──────────────────────────────
print(f"🤖 Chargement modèle : {MODEL_NAME}")
model = SentenceTransformer(MODEL_NAME)

df_pd = df_text.select(
    "code_commune", "city", "code_departement",
    "prix_median_m2", "score_dpe_moyen", "nb_transport", "description"
).toPandas()

print(f"  → Encodage de {len(df_pd)} documents...")
embeddings = model.encode(df_pd["description"].tolist(), show_progress_bar=True).tolist()

# ── Étape 4 : Indexer dans ChromaDB ──────────────────────────────────────────
print(f"🔌 Connexion ChromaDB {CHROMA_HOST}:{CHROMA_PORT}...")
client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)

# Supprimer et recréer la collection (ré-indexation propre)
try:
    client.delete_collection(COLLECTION_NAME)
except Exception:
    pass
collection = client.create_collection(
    name=COLLECTION_NAME,
    metadata={"hnsw:space": "cosine"}
)

# Indexer par batch
BATCH_SIZE = 100
for i in range(0, len(df_pd), BATCH_SIZE):
    batch = df_pd.iloc[i:i + BATCH_SIZE]
    collection.add(
        ids=batch["code_commune"].tolist(),
        documents=batch["description"].tolist(),
        embeddings=embeddings[i:i + BATCH_SIZE],
        metadatas=batch[["code_commune", "city", "code_departement",
                          "prix_median_m2", "score_dpe_moyen", "nb_transport"]
                        ].fillna(0).to_dict("records"),
    )
    print(f"  → Batch {i // BATCH_SIZE + 1} indexé ({len(batch)} docs)")

print(f"\n✅ {collection.count()} communes indexées dans ChromaDB (collection '{COLLECTION_NAME}')")

# ── Étape 5 : Test de recherche ───────────────────────────────────────────────
print("\n🧪 Test : 'commune abordable avec beaucoup de transports dans le 92'")
results = collection.query(
    query_texts=["commune abordable avec beaucoup de transports dans le 92"],
    n_results=3,
)
for i, (doc, meta) in enumerate(zip(results["documents"][0], results["metadatas"][0])):
    print(f"  [{i+1}] {meta['city']} — {doc[:150]}...")
```

> **Note accès ChromaDB depuis Databricks** : ChromaDB tourne en local (Docker). Pour y accéder depuis Databricks, soit tu exposes ChromaDB sur une IP publique, soit tu exécutes ce script localement après avoir exporté les données Gold en Parquet. Voir la section "Alternative locale" ci-dessous.

### Alternative : indexer en local depuis un export Parquet

Si ChromaDB n'est pas accessible depuis Databricks, exporter depuis Databricks :

```python
# Dans Databricks — exporter la table Gold en Parquet local
df_text.select("code_commune", "city", "code_departement",
               "prix_median_m2", "score_dpe_moyen", "nb_transport", "description") \
       .write.mode("overwrite").parquet("/tmp/communes_agregat_for_rag/")
# Puis télécharger avec dbutils.fs.cp ou depuis le portail Azure
```

Puis localement :

```python
# index_local.py — lancer depuis rag/ après téléchargement du Parquet
import pandas as pd
import chromadb
from sentence_transformers import SentenceTransformer

df_pd = pd.read_parquet("communes_agregat_for_rag/")
model = SentenceTransformer("sentence-transformers/paraphrase-multilingual-mpnet-base-v2")
embeddings = model.encode(df_pd["description"].tolist(), show_progress_bar=True).tolist()

client = chromadb.HttpClient(host="localhost", port=8001)
try:
    client.delete_collection("communes_idf")
except Exception:
    pass
collection = client.create_collection("communes_idf", metadata={"hnsw:space": "cosine"})

for i in range(0, len(df_pd), 100):
    batch = df_pd.iloc[i:i+100]
    collection.add(
        ids=batch["code_commune"].tolist(),
        documents=batch["description"].tolist(),
        embeddings=embeddings[i:i+100],
        metadatas=batch[["code_commune", "city", "code_departement",
                          "prix_median_m2", "score_dpe_moyen", "nb_transport"]
                        ].fillna(0).to_dict("records"),
    )
print(f"✅ {collection.count()} communes indexées")
```

---

## Étape 4 — `02_rag_server.py` — API FastAPI locale

Ce serveur tourne en local (port 8002) et est appelé par le backend Go.

```python
"""
02_rag_server.py
API RAG — reçoit une question, cherche dans ChromaDB, appelle un LLM.
Port : 8002
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
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["POST", "GET"], allow_headers=["*"])

CHROMA_HOST = os.getenv("CHROMADB_HOST", "localhost")
CHROMA_PORT = int(os.getenv("CHROMADB_PORT", 8001))
COLLECTION_NAME = "communes_idf"
MODEL_NAME = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "mistral")
TOP_K = 5

print("🔌 Connexion ChromaDB...")
chroma_client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
collection = chroma_client.get_collection(COLLECTION_NAME)

print(f"🤖 Chargement modèle embedding...")
embed_model = SentenceTransformer(MODEL_NAME)
print(f"✅ RAG prêt — {collection.count()} communes indexées")


class QueryRequest(BaseModel):
    question: str
    departement_filter: str | None = None  # ex: "92" pour filtrer sur un département
    top_k: int = TOP_K

class QueryResponse(BaseModel):
    answer: str
    sources: list[dict]
    latency_ms: int


def call_mistral(prompt: str) -> str:
    resp = requests.post(
        "https://api.mistral.ai/v1/chat/completions",
        headers={"Authorization": f"Bearer {os.getenv('MISTRAL_API_KEY')}", "Content-Type": "application/json"},
        json={"model": "mistral-small-latest", "messages": [{"role": "user", "content": prompt}],
              "temperature": 0.2, "max_tokens": 512},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def call_claude(prompt: str) -> str:
    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": os.getenv("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01",
                 "Content-Type": "application/json"},
        json={"model": "claude-haiku-4-5-20251001", "max_tokens": 512,
              "messages": [{"role": "user", "content": prompt}]},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["content"][0]["text"]


def call_ollama(prompt: str) -> str:
    resp = requests.post(
        f"{os.getenv('OLLAMA_URL', 'http://localhost:11434')}/api/generate",
        json={"model": os.getenv("OLLAMA_MODEL", "mistral"), "prompt": prompt, "stream": False},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["response"]


def call_llm(prompt: str) -> str:
    return {"mistral": call_mistral, "claude": call_claude, "ollama": call_ollama}[LLM_PROVIDER](prompt)


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


@app.post("/rag/query", response_model=QueryResponse)
async def rag_query(req: QueryRequest):
    t0 = time.time()

    query_vec = embed_model.encode([req.question]).tolist()

    where_filter = None
    if req.departement_filter:
        where_filter = {"code_departement": req.departement_filter}

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

    prompt = build_prompt(req.question, chunks)

    try:
        answer = call_llm(prompt)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur LLM ({LLM_PROVIDER}) : {e}")

    sources = [
        {"text": chunk[:200] + "...", "metadata": meta, "score": round(1 - dist, 3)}
        for chunk, meta, dist in zip(chunks, metadatas, distances)
    ]

    return QueryResponse(answer=answer.strip(), sources=sources,
                         latency_ms=int((time.time() - t0) * 1000))


@app.get("/rag/health")
async def health():
    return {"status": "ok", "docs_indexed": collection.count(), "llm_provider": LLM_PROVIDER}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002, reload=False)
```

**Lancer :**
```bash
python 02_rag_server.py
# → http://localhost:8002
# → Swagger : http://localhost:8002/docs
```

---

## Étape 5 — Tests manuels

```python
# test_rag.py
import requests

BASE = "http://localhost:8002"

questions = [
    ("Quelle est la commune la plus abordable du 92 ?", "92"),
    ("Où habiter si je veux beaucoup de parcs et de commerces ?", None),
    ("Quelle commune a la meilleure performance énergétique en Seine-Saint-Denis ?", "93"),
    ("Comparaison entre Vincennes et Montreuil ?", None),
    ("Quelles communes ont un fort indicateur de gentrification ?", None),
    ("Où trouver beaucoup d'établissements de santé en banlieue ouest ?", "92"),
]

for question, dept in questions:
    body = {"question": question}
    if dept:
        body["departement_filter"] = dept
    resp = requests.post(f"{BASE}/rag/query", json=body)
    data = resp.json()
    print(f"\n❓ {question}")
    print(f"💬 {data['answer']}")
    print(f"⏱️  {data['latency_ms']}ms | Sources : {[s['metadata']['city'] for s in data['sources']]}")
    print("-" * 80)
```

---

## Étape 6 — Intégration Backend Go

### `backend/internal/handlers/rag.go`

```go
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
    Question           string  `json:"question" binding:"required"`
    DepartementFilter  *string `json:"departement_filter,omitempty"`
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

### Enregistrer la route dans `cmd/server/main.go`

```go
v1.POST("/rag/query", handlers.RAGQuery)
```

### Variable d'env à ajouter dans `.env`

```bash
RAG_SERVICE_URL=http://localhost:8002
```

---

## Étape 7 — Composant React `ChatRAG.jsx`

```jsx
// frontend/src/components/ChatRAG.jsx
import { useState } from "react";

export default function ChatRAG({ departementFilter }) {
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
        body: JSON.stringify({ question, departement_filter: departementFilter || null }),
      });
      const data = await resp.json();
      setMessages(prev => [...prev, {
        role: "assistant",
        text: data.answer,
        sources: data.sources,
      }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", text: "Erreur de connexion au serveur." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "400px", border: "1px solid #ddd", borderRadius: "8px" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            marginBottom: "8px",
            textAlign: m.role === "user" ? "right" : "left",
          }}>
            <span style={{
              display: "inline-block", padding: "8px 12px", borderRadius: "12px",
              background: m.role === "user" ? "#2563eb" : "#f3f4f6",
              color: m.role === "user" ? "white" : "black",
              maxWidth: "80%",
            }}>
              {m.text}
            </span>
            {m.sources && (
              <div style={{ fontSize: "11px", color: "#888", marginTop: "2px" }}>
                Sources : {m.sources.map(s => s.metadata.city).join(", ")}
              </div>
            )}
          </div>
        ))}
        {loading && <div style={{ color: "#888" }}>...</div>}
      </div>
      <div style={{ display: "flex", gap: "8px", padding: "8px", borderTop: "1px solid #ddd" }}>
        <input
          style={{ flex: 1, padding: "8px", borderRadius: "6px", border: "1px solid #ddd" }}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && sendMessage()}
          placeholder="Ex : Quelle commune du 92 est la plus abordable ?"
        />
        <button
          onClick={sendMessage}
          disabled={loading}
          style={{ padding: "8px 16px", background: "#2563eb", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}
        >
          Envoyer
        </button>
      </div>
    </div>
  );
}
```

---

## Étape 8 — Améliorations optionnelles

### Enrichir les descriptions avec d'autres colonnes Gold

Le corpus peut être affiné selon les questions fréquentes. Par exemple :

```python
# Ajouter le score d'investissement (si disponible dans Gold)
F.lit("Score d'attractivité investissement :"),
F.round("score_investissement", 1).cast("string"), F.lit("/ 10.")
```

### Filtrage par commune (pas seulement département)

```python
# Dans la requête ChromaDB, filtrer sur code_commune
where_filter = {"code_commune": "92049"}  # Levallois-Perret
```

### Historique de conversation

Passer les derniers échanges dans le prompt pour des questions de suivi :
```python
history_text = "\n".join(
    f"{'Utilisateur' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
    for m in history[-4:]
)
# Ajouter au prompt : f"HISTORIQUE :\n{history_text}\n\n"
```

---

## Checklist de livraison

- [ ] Notebook Databricks `01_index_from_databricks.py` exécuté — `communes_idf` indexée dans ChromaDB
- [ ] `02_rag_server.py` → serveur FastAPI port 8002 fonctionnel (`/rag/health` répond)
- [ ] `test_rag.py` → toutes les questions reçoivent une réponse pertinente
- [ ] Handler Go `rag.go` créé + route `/api/v1/rag/query` enregistrée dans `main.go`
- [ ] Composant React `ChatRAG.jsx` intégré dans l'interface
- [ ] Test end-to-end : question depuis le frontend → réponse affichée avec sources

---

## Contacts & Ressources

| Qui | Rôle |
|-----|------|
| **Christophe** | Backend Go — pour intégrer la route `/api/v1/rag/query` |
| **Ludo** | Databricks — pour accès à `gold/communes_agregat/` et secrets ChromaDB |

**Ressources :**
- ChromaDB docs : https://docs.trychroma.com
- sentence-transformers : https://www.sbert.net
- Mistral API (gratuit jusqu'à 1M tokens/mois) : https://console.mistral.ai
- Ollama (local, gratuit) : https://ollama.com — `ollama pull mistral`
