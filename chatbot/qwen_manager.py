#!/usr/bin/env python3
"""
Gestionnaire Qwen2.5-0.5B GGUF pour HomePedia Chat.
Ticket 2 : prompt few-shot + validation anti-hallucination + fallback déterministe.
"""

import os
import gc
import re
import json
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

# Exemples few-shot réels ancrés sur le schéma de communes_agregat.
# L'objectif est de montrer à Qwen le format et le niveau de précision attendus.
_FEW_SHOT = """Exemple 1 :
Données: [{"commune": "Massy", "prix_m2": 4200, "rendement_pct": 5.1, "score_invest": 7.8}]
Question: Où investir avec un bon rendement ?
Réponse: Massy (91) se démarque avec un rendement locatif brut de 5,1 % et un prix médian de 4 200 €/m², ce qui en fait une commune intéressante pour l'investissement.

Exemple 2 :
Données: [{"commune": "Versailles", "prix_m2": 8500, "qualite_vie": 9.2, "ips_ecoles": 130}]
Question: Comment est Versailles ?
Réponse: Versailles affiche un prix médian de 8 500 €/m² et une qualité de vie de 9,2/10, avec un IPS scolaire de 130, ce qui en fait une des communes les plus prisées d'IDF.

Exemple 3 :
Données: []
Question: Prix à Trifouilly ?
Réponse: Je n'ai pas de données disponibles pour cette commune dans notre base.
"""


class HomepediaQwenManager:
    """Qwen2.5-0.5B GGUF — Cloud Run CPU + génération réponses immobilières FR."""

    def __init__(self, model_path: str = "./models/qwen2.5-0.5b.gguf"):
        self.model_path = model_path
        self.model: Optional[Any] = None
        self.initialized = False
        self.model_repo = "Qwen/Qwen2.5-0.5B-Instruct-GGUF"
        self.gguf_filename = "qwen2.5-0.5b-instruct-q4_k_m.gguf"

        n_threads = min(os.cpu_count() or 2, int(os.getenv("QWEN_MAX_THREADS", "4")))
        self.llama_config = {
            "n_ctx": 1536,        # réduit vs 2048 pour économiser RAM
            "n_batch": 256,
            "n_threads": n_threads,
            "use_mmap": True,
            "use_mlock": False,
            "verbose": False,
            "chat_format": "chatml",
        }

    # ── Chargement du modèle ──────────────────────────────────────────────────

    def _is_valid_gguf(self, path: str) -> bool:
        try:
            if not os.path.exists(path) or os.path.getsize(path) < 50 * 1024 * 1024:
                return False
            with open(path, "rb") as f:
                return f.read(4) == b"GGUF"
        except Exception:
            return False

    def download_model(self) -> bool:
        try:
            os.makedirs(os.path.dirname(self.model_path) or ".", exist_ok=True)
            if self._is_valid_gguf(self.model_path):
                size_mb = os.path.getsize(self.model_path) // 1024 // 1024
                logger.info(f"✅ Qwen2.5-0.5B présent ({size_mb}MB)")
                return True
            if not HF_HUB_AVAILABLE:
                logger.warning("⚠️ huggingface-hub absent")
                return False
            if os.path.exists(self.model_path):
                os.remove(self.model_path)
            logger.info("📥 Téléchargement Qwen2.5-0.5B Q4_K_M...")
            import shutil
            downloaded = hf_hub_download(
                repo_id=self.model_repo,
                filename=self.gguf_filename,
                cache_dir="./hf_cache",
            )
            if not self._is_valid_gguf(downloaded):
                raise ValueError("Fichier GGUF invalide")
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

    # ── Anti-hallucination ────────────────────────────────────────────────────

    def _extract_numbers(self, text: str) -> List[float]:
        """Extrait les nombres > 10 d'un texte (ignore les petits entiers grammaticaux)."""
        # Gère formats FR : "4 200", "4200", "4,2"
        clean = re.sub(r'(\d)\s(\d)', r'\1\2', text)  # "4 200" → "4200"
        matches = re.findall(r'\b\d+(?:[.,]\d+)?\b', clean)
        result = []
        for m in matches:
            try:
                val = float(m.replace(',', '.'))
                if val > 10:
                    result.append(val)
            except ValueError:
                pass
        return result

    def _valid_numbers(self, text: str, sql_data: List[Dict]) -> bool:
        """
        Vérifie que tout nombre cité dans le texte existe dans les données SQL
        avec une tolérance de ±5%. Retourne True si tout est OK.
        """
        if not sql_data:
            return True

        text_nums = self._extract_numbers(text)
        if not text_nums:
            return True

        valid_vals: List[float] = []
        for row in sql_data:
            for v in row.values():
                if isinstance(v, (int, float)) and v is not None:
                    valid_vals.append(float(v))

        for num in text_nums:
            is_ok = any(
                abs(num - vv) <= 0.05 * max(abs(vv), 1)
                for vv in valid_vals
            )
            if not is_ok:
                logger.warning(f"⚠️ Hallucination détectée: {num} absent des données SQL")
                return False
        return True

    def _fallback_text(self, sql_data: List[Dict], intent: str) -> str:
        """Réponse déterministe construite directement depuis les données SQL — zéro LLM."""
        if not sql_data:
            return "Aucune donnée disponible pour cette requête."

        row = sql_data[0]
        commune = row.get("commune", "?")
        dept = row.get("dept", "")
        prix = row.get("prix_m2")
        score = row.get("score_global") or row.get("score_invest") or row.get("qualite_vie")
        rendement = row.get("rendement_pct")
        dpe = row.get("dpe_score")

        parts = [f"{commune} ({dept})" if dept else commune]
        if prix:
            parts.append(f"prix médian {int(prix):,} €/m²".replace(",", " "))
        if rendement:
            parts.append(f"rendement {rendement}%")
        if score:
            parts.append(f"score {score}/10")
        if dpe:
            parts.append(f"DPE {dpe:.1f}/7")

        header = f"Voici les {min(len(sql_data), 6)} premiers résultats :"
        lines = [header]
        for i, r in enumerate(sql_data[:6], 1):
            c = r.get("commune", "?")
            d = r.get("dept", "")
            p = r.get("prix_m2")
            rdt = r.get("rendement_pct")
            sc = r.get("score_global") or r.get("score_invest") or r.get("qualite_vie")
            line_parts = [f"{c} ({d})" if d else c]
            if p:
                line_parts.append(f"{int(p):,} €/m²".replace(",", " "))
            if rdt:
                line_parts.append(f"{rdt}% rdt")
            if sc:
                line_parts.append(f"score {sc}")
            lines.append(f"{i}. {' — '.join(line_parts)}")
        return "\n".join(lines)

    # ── Génération ────────────────────────────────────────────────────────────

    def generate_response(
        self,
        sql_data: List[Dict],
        user_query: str,
        intent: str,
        context: str = "",
    ) -> Optional[str]:
        """
        Génère une réponse narrative FR depuis les données SQL.
        - sql_data : liste de dicts retournés par execute_template()
        - context  : résumé des 3 derniers échanges (Ticket 3)
        Retourne None si le LLM n'est pas initialisé.
        """
        if not self.initialized:
            return None

        # Limiter les données envoyées au LLM (économise des tokens)
        data_json = json.dumps(sql_data[:8], ensure_ascii=False, default=str)

        context_block = f"Historique récent : {context}\n" if context.strip() else ""

        system_msg = (
            "Tu es HomePedia, un assistant immobilier expert en Île-de-France. "
            "RÈGLES ABSOLUES : "
            "1. Cite UNIQUEMENT les chiffres présents dans les données JSON fournies. "
            "2. Réponds en français, 2-4 phrases courtes et utiles. "
            "3. Si les données sont vides, dis-le honnêtement. "
            "4. Ne génère pas de code, formules, LaTeX ou listes à puces longues. "
            "5. N'invente aucun nom de commune ni aucun chiffre absent du JSON."
        )

        user_msg = (
            f"{context_block}"
            f"Exemples de réponses attendues :\n{_FEW_SHOT}\n"
            f"Données actuelles (JSON) :\n{data_json}\n\n"
            f"Question : {user_query}"
        )

        messages = [
            {"role": "system", "content": system_msg},
            {"role": "user",   "content": user_msg},
        ]

        try:
            response = self.model.create_chat_completion(
                messages=messages,
                max_tokens=150,       # strict — évite les divagations
                temperature=0.1,      # très bas — ancrage factuel
                top_p=0.9,
                top_k=40,
                repeat_penalty=1.1,
                stop=["<|im_end|>", "<|endoftext|>"],
            )
            text = response["choices"][0]["message"]["content"].strip()

            # Nettoyage tokens spéciaux résiduels
            for tok in ["<|im_end|>", "<|endoftext|>", "<|im_start|>"]:
                text = text.replace(tok, "").strip()
            text = re.sub(r"<[^>]+>", "", text).strip()
            text = re.sub(r"\$[^$]*\$", "", text).strip()

            if len(text) < 15:
                return None

            # Validation anti-hallucination (Ticket 2)
            if not self._valid_numbers(text, sql_data):
                logger.warning("⚠️ Hallucination → fallback déterministe")
                return self._fallback_text(sql_data, intent)

            logger.info(f"✅ Réponse LLM ({len(text)} chars)")
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
            "llama_cpp": LLAMA_CPP_AVAILABLE,
        }

    def cleanup(self):
        if self.model:
            del self.model
            self.model = None
        self.initialized = False
        gc.collect()


qwen_manager = HomepediaQwenManager()
