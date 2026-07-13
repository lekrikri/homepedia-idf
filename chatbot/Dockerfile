FROM python:3.11-slim

WORKDIR /app

# Dépendances système pour llama-cpp-python
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ cmake make wget \
    && rm -rf /var/lib/apt/lists/*

# llama-cpp-python CPU-only (pas de CUDA)
ENV CMAKE_ARGS="-DGGML_BLAS=OFF -DGGML_CUDA=OFF"
ENV FORCE_CMAKE=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Télécharger Qwen2.5-0.5B Q4_K_M au build time → 0 cold start download
# Le modèle (~491MB) est inclus dans l'image Docker
RUN mkdir -p models && \
    wget -q --show-progress \
      "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf" \
      -O models/qwen2.5-0.5b.gguf && \
    echo "✅ Qwen2.5-0.5B téléchargé ($(du -sh models/qwen2.5-0.5b.gguf | cut -f1))"

# Pré-télécharger MiniLM-L12-v2 (~120MB) → 0 cold start download
# Stocké dans /root/.cache/huggingface/hub/ à l'intérieur de l'image
RUN python -c "\
from sentence_transformers import SentenceTransformer; \
m = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2'); \
print('✅ MiniLM-L12-v2 pré-chargé')"

COPY . .

ENV PORT=8080
ENV DISABLE_LLM=false

# 1 worker : modèle chargé une seule fois en mémoire (preload)
CMD ["gunicorn", "chat_api:app", \
     "--bind", "0.0.0.0:8080", \
     "--workers", "1", \
     "--timeout", "120", \
     "--preload"]
