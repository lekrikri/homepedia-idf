FROM python:3.11-slim

WORKDIR /app

# Dépendances système pour llama-cpp-python (compilation C++)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ cmake make \
    && rm -rf /var/lib/apt/lists/*

# llama-cpp-python CPU-only (pas de CUDA)
ENV CMAKE_ARGS="-DGGML_BLAS=OFF -DGGML_CUDA=OFF"
ENV FORCE_CMAKE=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Le modèle sera téléchargé au premier démarrage depuis HuggingFace
# (ou monté via volume en prod)
RUN mkdir -p models

ENV PORT=8080
ENV DISABLE_LLM=false

# Gunicorn : 1 worker (modèle en mémoire partagé impossible avec fork)
CMD ["gunicorn", "chat_api:app", \
     "--bind", "0.0.0.0:8080", \
     "--workers", "1", \
     "--timeout", "120", \
     "--preload"]
