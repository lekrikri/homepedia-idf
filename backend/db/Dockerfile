FROM postgis/postgis:16-3.4

# Ajoute l'extension pgvector pour la recherche par embeddings (chatbot RAG)
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*
