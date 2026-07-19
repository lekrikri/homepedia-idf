"""
02_index_pgvector.py
Encode les documents du corpus via Ollama et les indexe dans PostgreSQL
(table rag_documents, avec embeddings vector(768) + tsvector full-text FR).

Remplace 02_index_chromadb.py depuis la migration vers pgvector.

Prérequis :
  - PostgreSQL avec extension pgvector (migration 002_rag_pgvector.sql appliquée)
  - Ollama avec nomic-embed-text (ollama pull nomic-embed-text)
  - corpus.json généré par 01_build_corpus.py
"""

import os
import sys
import json
import time
import logging
import requests
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv()

# stdout line-buffered pour voir les logs en temps réel
sys.stdout.reconfigure(line_buffering=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

# ── Config ───────────────────────────────────────────────────────────────────
PG_HOST = os.getenv("POSTGRES_HOST", "localhost")
PG_PORT = int(os.getenv("POSTGRES_PORT", 5433))
PG_DB = os.getenv("POSTGRES_DB", "homepedia")
PG_USER = os.getenv("POSTGRES_USER", "homepedia")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "homepedia")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
BATCH_SIZE = 50


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Encode une liste de textes via Ollama."""
    resp = requests.post(
        f"{OLLAMA_URL}/api/embed",
        json={"model": EMBED_MODEL, "input": texts},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["embeddings"]


def vector_to_pg(vec: list[float]) -> str:
    """Convertit une liste de floats en format pgvector."""
    return "[" + ",".join(f"{v:.6f}" for v in vec) + "]"


def main():
    # Charger le corpus communes
    corpus_path = os.path.join(os.path.dirname(__file__), "corpus.json")
    with open(corpus_path, "r", encoding="utf-8") as f:
        docs = json.load(f)
    log.info(f"Corpus communes chargé : {len(docs)} documents")

    # Charger le corpus légal (bail, loyer, CAF, achat, diagnostics, etc.)
    legal_path = os.path.join(os.path.dirname(__file__), "legal_corpus.json")
    if os.path.exists(legal_path):
        with open(legal_path, "r", encoding="utf-8") as f:
            legal_docs = json.load(f)
        log.info(f"Corpus légal chargé : {len(legal_docs)} documents")
        docs = docs + legal_docs
    else:
        log.warning("legal_corpus.json introuvable — indexation sans corpus légal")

    log.info(f"Total à indexer : {len(docs)} documents")

    # Connexion PostgreSQL
    log.info(f"Connexion PostgreSQL → {PG_HOST}:{PG_PORT}/{PG_DB}")
    conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT, dbname=PG_DB,
        user=PG_USER, password=PG_PASSWORD,
    )

    # Vider la table pour une ré-indexation complète
    log.info("TRUNCATE rag_documents (peut bloquer si une autre connexion tient un lock)...")
    with conn.cursor() as cur:
        cur.execute("SET lock_timeout = '10s'")
        cur.execute("TRUNCATE TABLE rag_documents")
    conn.commit()
    log.info("Table rag_documents vidée")

    # Indexer par batch
    total = len(docs)
    total_batches = (total - 1) // BATCH_SIZE + 1
    inserted = 0
    t_start = time.monotonic()

    for i in range(0, total, BATCH_SIZE):
        batch = docs[i : i + BATCH_SIZE]
        texts = [d["text"] for d in batch]
        batch_num = i // BATCH_SIZE + 1

        # Embeddings via Ollama
        log.info(f"  Batch {batch_num}/{total_batches} — embedding {len(texts)} docs via Ollama…")
        t0 = time.monotonic()
        embeddings = embed_texts(texts)
        t_embed = time.monotonic() - t0

        # Préparer les tuples pour INSERT
        rows = []
        for doc, emb in zip(batch, embeddings):
            meta = doc["metadata"]
            rows.append((
                doc["id"],
                meta.get("type", ""),
                meta.get("code_commune", ""),
                meta.get("city", ""),
                meta.get("departement", "").strip() or "",
                doc["text"],
                vector_to_pg(emb),
            ))

        t1 = time.monotonic()
        with conn.cursor() as cur:
            execute_values(
                cur,
                """
                INSERT INTO rag_documents (id, doc_type, code_commune, city, code_departement, text, embedding)
                VALUES %s
                ON CONFLICT (id) DO UPDATE SET
                    text = EXCLUDED.text,
                    embedding = EXCLUDED.embedding
                """,
                rows,
                template="(%s, %s, %s, %s, %s, %s, %s::vector)",
            )
        conn.commit()
        t_insert = time.monotonic() - t1
        inserted += len(batch)

        elapsed = time.monotonic() - t_start
        eta = elapsed / inserted * (total - inserted)
        log.info(
            f"    → {inserted}/{total} docs — embed {t_embed:.1f}s, insert {t_insert:.1f}s "
            f"— elapsed {elapsed:.0f}s, ETA {eta:.0f}s"
        )

    # Stats finales
    with conn.cursor() as cur:
        cur.execute("SELECT doc_type, COUNT(*) FROM rag_documents GROUP BY doc_type ORDER BY doc_type")
        log.info("Répartition par type :")
        for doc_type, count in cur.fetchall():
            log.info(f"  - {doc_type}: {count}")

    conn.close()
    log.info(f"Indexation terminée : {inserted} documents dans rag_documents")


if __name__ == "__main__":
    main()
