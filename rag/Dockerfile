FROM python:3.12-slim

WORKDIR /app

# libpq pour psycopg2
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY 03_rag_server.py .
# Scripts + corpus embarqués pour permettre l'indexation depuis le conteneur :
#   docker compose exec rag python 02_index_pgvector.py
COPY 01_build_corpus.py 02_index_pgvector.py ./
COPY corpus.json legal_corpus.json mock_gold.json ./

EXPOSE 8002

CMD ["python", "03_rag_server.py"]
