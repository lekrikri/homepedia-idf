#!/usr/bin/env python3
"""
Gestionnaire Qwen2.5-0.5B GGUF pour HomePedia Chat
Architecture : SQL templates + LLM compact (~300MB)
Porté depuis virida-eve/phi_manager.py
"""

import os
import gc
import re
import logging
from typing import List, Dict, Any, Optional

try:
    from llama_cpp import Llama
    LLAMA_CPP_AVAILABLE = True
except (ImportError, OSError, Exception) as e:
    LLAMA_CPP_AVAILABLE = False
    Llama = None
    logging.getLogger(__name__).warning(f"⚠️ llama-cpp-python non disponible: {e}")

try:
    from huggingface_hub import hf_hub_download
    HF_HUB_AVAILABLE = True
except ImportError:
    HF_HUB_AVAILABLE = False
    hf_hub_download = None

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class HomepediaQwenManager:
    """Qwen2.5-0.5B GGUF — Cloud Run CPU + génération réponses immobilières FR"""

    def __init__(self, model_path: str = "./models/qwen2.5-0.5b.gguf"):
        self.model_path = model_path
        self.model = None
        self.initialized = False
        self.model_repo = "Qwen/Qwen2.5-0.5B-Instruct-GGUF"
        self.gguf_filename = "qwen2.5-0.5b-instruct-q4_k_m.gguf"

        cpu_count = os.cpu_count() or 2
        n_threads = min(cpu_count, int(os.getenv("QWEN_MAX_THREADS", "4")))

        self.llama_config = {
            'n_ctx': 2048,
            'n_batch': 512,
            'n_threads': n_threads,
            'use_mmap': True,
            'use_mlock': False,
            'verbose': False,
            'chat_format': 'chatml',
        }

    def _is_valid_gguf(self, path: str) -> bool:
        try:
            if not os.path.exists(path):
                return False
            if os.path.getsize(path) < 50 * 1024 * 1024:
                return False
            with open(path, 'rb') as f:
                return f.read(4) == b'GGUF'
        except Exception:
            return False

    def download_model(self) -> bool:
        try:
            if not HF_HUB_AVAILABLE:
                logger.warning("⚠️ huggingface-hub non disponible")
                return False

            os.makedirs(os.path.dirname(self.model_path) or ".", exist_ok=True)

            if self._is_valid_gguf(self.model_path):
                size = os.path.getsize(self.model_path)
                logger.info(f"✅ Qwen2.5-0.5B présent ({size // 1024 // 1024}MB)")
                return True

            if os.path.exists(self.model_path):
                os.remove(self.model_path)

            logger.info(f"📥 Téléchargement Qwen2.5-0.5B Q4_K_M (~300MB)...")
            import shutil
            downloaded = hf_hub_download(
                repo_id=self.model_repo,
                filename=self.gguf_filename,
                cache_dir="./hf_cache"
            )
            if not self._is_valid_gguf(downloaded):
                raise ValueError("Fichier GGUF invalide après téléchargement")

            shutil.copy2(downloaded, self.model_path)
            shutil.rmtree("./hf_cache", ignore_errors=True)
            logger.info(f"✅ Modèle copié → {self.model_path}")
            return True

        except Exception as e:
            logger.error(f"❌ Téléchargement échoué: {e}")
            return False

    def initialize(self) -> bool:
        if self.initialized and self.model:
            return True
        if not LLAMA_CPP_AVAILABLE:
            logger.warning("⚠️ llama-cpp-python absent — mode sans LLM")
            return False
        if not self.download_model():
            return False
        try:
            gc.collect()
            self.model = Llama(model_path=self.model_path, **self.llama_config)
            self.initialized = True
            logger.info("✅ Qwen2.5-0.5B initialisé")
            return True
        except Exception as e:
            logger.error(f"❌ Initialisation échouée: {e}")
            self.initialized = False
            gc.collect()
            return False

    def generate_response(self, sql_data: List[Dict], user_query: str, intent: str) -> Optional[str]:
        """Génère une réponse narrative FR à partir des données SQL"""
        if not self.initialized:
            return None

        # Formater les données en texte lisible pour le LLM
        if sql_data:
            data_text = "\n".join([
                ", ".join([f"{k}: {v}" for k, v in row.items() if v is not None])
                for row in sql_data[:8]
            ])
        else:
            data_text = "Aucune donnée trouvée pour cette requête."

        messages = [
            {
                "role": "system",
                "content": (
                    "Tu es HomePedia, un assistant immobilier expert en Île-de-France. "
                    "RÈGLES ABSOLUES : "
                    "1. Utilise UNIQUEMENT les données fournies. Ne jamais inventer de chiffres. "
                    "2. Réponds en français, 2-4 phrases claires et utiles. "
                    "3. Si les données manquent, dis-le honnêtement. "
                    "4. Cite les communes et chiffres exacts des données. "
                    "5. Ne génère pas de code, formules ou LaTeX."
                )
            },
            {
                "role": "user",
                "content": f"Données immobilières IDF :\n{data_text}\n\nQuestion : {user_query}"
            }
        ]

        try:
            response = self.model.create_chat_completion(
                messages=messages,
                max_tokens=200,
                temperature=0.3,
                top_p=0.9,
                top_k=40,
                repeat_penalty=1.1,
                stop=["<|im_end|>", "<|endoftext|>"],
            )
            text = response['choices'][0]['message']['content'].strip()

            # Nettoyage tokens spéciaux
            for token in ["<|im_end|>", "<|endoftext|>", "<|im_start|>"]:
                text = text.replace(token, "").strip()
            text = re.sub(r'<[^>]+>', '', text).strip()
            text = re.sub(r'\$[^$]*\$', '', text).strip()

            if len(text) < 15:
                return None

            logger.info(f"✅ Réponse générée ({len(text)} chars)")
            return text

        except Exception as e:
            logger.error(f"❌ Génération échouée: {e}")
            return None
        finally:
            gc.collect()

    def get_stats(self) -> Dict:
        return {
            "model": "Qwen2.5-0.5B-Instruct Q4_K_M",
            "status": "ready" if self.initialized else "not_loaded",
            "size": "~300MB",
            "llama_cpp": LLAMA_CPP_AVAILABLE,
        }

    def cleanup(self):
        if self.model:
            del self.model
            self.model = None
        self.initialized = False
        gc.collect()


qwen_manager = HomepediaQwenManager()
