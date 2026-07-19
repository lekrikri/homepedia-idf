-- =============================================================================
-- Migration 002 — Table rag_documents pour le chatbot RAG
-- Remplace ChromaDB par pgvector (hybrid search natif avec tsvector + embeddings)
-- =============================================================================

-- Extension pgvector pour les embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Table des documents RAG
-- Chaque ligne = un chunk (summary, commune, dpe, poi) avec son embedding
-- et son index full-text français pour l'hybrid search.
CREATE TABLE IF NOT EXISTS rag_documents (
    id                  TEXT         PRIMARY KEY,  -- ex: "summary_93048", "commune_93048"
    doc_type            VARCHAR(20)  NOT NULL,     -- summary | commune | dpe | poi
    code_commune        CHAR(5)      NOT NULL,
    city                VARCHAR(200) NOT NULL,
    code_departement    CHAR(3)      NOT NULL,
    text                TEXT         NOT NULL,
    embedding           vector(768)  NOT NULL,     -- nomic-embed-text = 768 dims
    text_fts            tsvector     GENERATED ALWAYS AS (to_tsvector('french', text)) STORED,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Index vectoriel HNSW (recherche sémantique rapide, distance cosinus)
CREATE INDEX IF NOT EXISTS rag_documents_embedding_idx
    ON rag_documents USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Index full-text français (pour BM25-like matching)
CREATE INDEX IF NOT EXISTS rag_documents_fts_idx
    ON rag_documents USING GIN (text_fts);

-- Index sur les filtres classiques (type, département)
CREATE INDEX IF NOT EXISTS rag_documents_type_idx       ON rag_documents (doc_type);
CREATE INDEX IF NOT EXISTS rag_documents_dept_idx       ON rag_documents (code_departement);
CREATE INDEX IF NOT EXISTS rag_documents_commune_idx    ON rag_documents (code_commune);
