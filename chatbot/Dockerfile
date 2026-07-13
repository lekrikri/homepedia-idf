FROM python:3.11-slim

WORKDIR /app

# Dépendances système pour llama-cpp-python
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ cmake make curl \
    && rm -rf /var/lib/apt/lists/*

# llama-cpp-python CPU-only (pas de CUDA)
ENV CMAKE_ARGS="-DGGML_BLAS=OFF -DGGML_CUDA=OFF"
ENV FORCE_CMAKE=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Modèle pré-copié dans le build context par cloudbuild-chatbot.yaml (gsutil cp depuis GCS)
# HuggingFace bloque les connexions TLS depuis les IPs GCP → modèle stocké dans homepedia-datalake
COPY models/qwen2.5-0.5b.gguf models/qwen2.5-0.5b.gguf
RUN echo "✅ Qwen2.5-0.5B prêt ($(du -sh models/qwen2.5-0.5b.gguf | cut -f1))"

# MiniLM-L12-v2 pré-copié depuis GCS (structure cache HF conservée)
# cloudbuild-chatbot.yaml télécharge depuis GCS → ./chatbot/models/minilm/
COPY models/minilm/ /root/.cache/huggingface/hub/models--sentence-transformers--paraphrase-multilingual-MiniLM-L12-v2/
RUN python -c "\
from sentence_transformers import SentenceTransformer; \
m = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2'); \
print('✅ MiniLM-L12-v2 prêt')"

COPY . .

ENV PORT=8080
ENV DISABLE_LLM=false

# 1 worker : modèle chargé une seule fois en mémoire (preload)
CMD ["gunicorn", "chat_api:app", \
     "--bind", "0.0.0.0:8080", \
     "--workers", "1", \
     "--timeout", "120", \
     "--preload"]
