"""
05_index_legal_prod.py
Indexe UNIQUEMENT les chunks légaux dans la DB Supabase de production.
Ne fait pas de TRUNCATE — UPSERT uniquement (ON CONFLICT DO UPDATE).
Utilise Ollama local pour les embeddings.

Usage :
  cd /home/lekrikri/Projects/T-DAT-902-PAR_3/rag
  python3 05_index_legal_prod.py

Prérequis :
  - Ollama local avec nomic-embed-text : ollama pull nomic-embed-text
  - legal_corpus.json dans le même dossier
  - Variables d'env POSTGRES_* pointant vers Supabase prod
    OU modifier les constantes ci-dessous directement
"""

import os
import json
import time
import logging
import sys
import requests
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv()

sys.stdout.reconfigure(line_buffering=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

# ── Config prod Supabase ─────────────────────────────────────────────────────
PG_HOST = os.getenv("POSTGRES_HOST_PROD", "db.iugsfmvqddburvufzacy.supabase.co")
PG_PORT = int(os.getenv("POSTGRES_PORT_PROD", "5432"))
PG_DB = os.getenv("POSTGRES_DB_PROD", "postgres")
PG_USER = os.getenv("POSTGRES_USER_PROD", "postgres")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD_PROD", "@fanfan_gwada_971")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
BATCH_SIZE = 20  # Plus petit pour ne pas saturer Ollama


def embed_texts(texts: list[str]) -> list[list[float]]:
    resp = requests.post(
        f"{OLLAMA_URL}/api/embed",
        json={"model": EMBED_MODEL, "input": texts},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["embeddings"]


def vector_to_pg(vec: list[float]) -> str:
    return "[" + ",".join(f"{v:.6f}" for v in vec) + "]"


def main():
    # legal_corpus  : droit du logement (bail, aides, diagnostics, copropriété)
    # methode_corpus: méthode d'achat et de location (percentiles, négociation,
    #                 visite, budget) — le volet pédagogique que le calcul ne couvre pas
    base = os.path.dirname(__file__)
    docs = []
    for nom in ("legal_corpus.json", "methode_corpus.json"):
        chemin = os.path.join(base, nom)
        if not os.path.exists(chemin):
            log.warning(f"{nom} absent, ignoré")
            continue
        with open(chemin, "r", encoding="utf-8") as f:
            chunks = json.load(f)
        log.info(f"{nom} : {len(chunks)} chunks")
        docs.extend(chunks)
    log.info(f"Corpus total : {len(docs)} chunks")

    log.info(f"Connexion Supabase → {PG_HOST}:{PG_PORT}/{PG_DB}")
    conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT, dbname=PG_DB,
        user=PG_USER, password=PG_PASSWORD,
        connect_timeout=30,
        sslmode="require",
    )
    log.info("Connexion Supabase OK")

    # Vérifier que la table existe et compter les docs existants
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM rag_documents WHERE doc_type = 'legal'")
        existing = cur.fetchone()[0]
        log.info(f"Chunks légaux déjà en base : {existing}")

    total = len(docs)
    total_batches = (total - 1) // BATCH_SIZE + 1
    inserted = 0
    t_start = time.monotonic()

    for i in range(0, total, BATCH_SIZE):
        batch = docs[i: i + BATCH_SIZE]
        texts = [d["text"] for d in batch]
        batch_num = i // BATCH_SIZE + 1

        log.info(f"  Batch {batch_num}/{total_batches} — embedding {len(texts)} chunks…")
        t0 = time.monotonic()
        embeddings = embed_texts(texts)
        t_embed = time.monotonic() - t0

        rows = []
        for doc, emb in zip(batch, embeddings):
            meta = doc["metadata"]
            rows.append((
                doc["id"],
                meta.get("type", "legal"),
                meta.get("code_commune", "00000"),
                meta.get("city", "France"),
                meta.get("departement", "000").strip() or "000",
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
                    embedding = EXCLUDED.embedding,
                    doc_type = EXCLUDED.doc_type
                """,
                rows,
                template="(%s, %s, %s, %s, %s, %s, %s::vector)",
            )
        conn.commit()
        t_insert = time.monotonic() - t1
        inserted += len(batch)

        elapsed = time.monotonic() - t_start
        log.info(f"    → {inserted}/{total} — embed {t_embed:.1f}s, insert {t_insert:.1f}s")

    # Vérification finale
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM rag_documents WHERE doc_type = 'legal'")
        final_count = cur.fetchone()[0]
        log.info(f"Chunks légaux en base après indexation : {final_count}")
        cur.execute("SELECT COUNT(*) FROM rag_documents")
        total_count = cur.fetchone()[0]
        log.info(f"Total rag_documents : {total_count}")

    conn.close()
    elapsed_total = time.monotonic() - t_start
    log.info(f"Indexation légale terminée en {elapsed_total:.0f}s ({inserted} chunks upsertés)")


if __name__ == "__main__":
    main()
