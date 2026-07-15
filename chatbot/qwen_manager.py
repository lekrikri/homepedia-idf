#!/usr/bin/env python3
"""
Gestionnaire Qwen2.5-0.5B GGUF pour HomePedia Chat.
"""

import os
import gc
import re
import json
import logging
from decimal import Decimal
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
    """Qwen2.5-0.5B GGUF — Cloud Run CPU + génération réponses immobilières FR."""

    def __init__(self, model_path: str = "./models/qwen2.5-0.5b.gguf"):
        self.model_path = model_path
        self.model: Optional[Any] = None
        self.initialized = False
        self.model_repo = "Qwen/Qwen2.5-0.5B-Instruct-GGUF"
        self.gguf_filename = "qwen2.5-0.5b-instruct-q4_k_m.gguf"

        n_threads = min(os.cpu_count() or 2, int(os.getenv("QWEN_MAX_THREADS", "4")))
        self.llama_config = {
            "n_ctx": 1024,        # réduit pour accélérer le prefill
            "n_batch": 512,       # batch plus grand = prefill plus rapide
            "n_threads": n_threads,
            "use_mmap": True,
            "use_mlock": False,
            "verbose": False,
            "chat_format": "chatml",
        }

    # ── Chargement ─────────────────────────────────────────────────────────────

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

    # ── Anti-hallucination ──────────────────────────────────────────────────────

    def _extract_numbers(self, text: str) -> List[float]:
        clean = re.sub(r'(\d)\s(\d)', r'\1\2', text)
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
        if not sql_data:
            return True
        valid_vals: List[float] = []
        for row in sql_data:
            for v in row.values():
                if isinstance(v, (int, float, Decimal)) and v is not None:
                    valid_vals.append(float(v))
        text_nums = self._extract_numbers(text)
        # Si les données ont des chiffres mais la réponse n'en cite aucun → réponse vague
        if not text_nums and valid_vals:
            logger.warning("⚠️ Réponse sans chiffres malgré des données → fallback")
            return False
        for num in text_nums:
            if not any(abs(num - vv) <= 0.05 * max(abs(vv), 1) for vv in valid_vals):
                logger.warning(f"⚠️ Hallucination détectée: {num} absent des données SQL")
                return False
        return True

    def _fallback_text(self, sql_data: List[Dict], intent: str) -> str:
        if not sql_data:
            return "Aucune donnée disponible pour cette requête."
        lines = [f"Voici les {min(len(sql_data), 6)} premiers résultats :"]
        for i, r in enumerate(sql_data[:6], 1):
            c = r.get("commune", "?")
            d = r.get("dept", "")
            parts = [f"{c} ({d})" if d else c]

            if intent == "ecoles_ips":
                ips = r.get("ips_moyen")
                pct = r.get("pct_ecoles_favorisees")
                p = r.get("prix_m2")
                if ips:
                    parts.append(f"IPS {ips}")
                if pct:
                    parts.append(f"{pct}% écoles favorisées")
                if p:
                    parts.append(f"{int(p):,} €/m²".replace(",", " "))
            elif intent == "rendement":
                rdt = r.get("rendement_pct")
                loyer = r.get("loyer_m2")
                p = r.get("prix_m2")
                if rdt:
                    parts.append(f"{rdt}% rendement brut")
                if loyer:
                    parts.append(f"{loyer} €/m² loyer")
                if p:
                    parts.append(f"{int(p):,} €/m²".replace(",", " "))
            elif intent == "dpe":
                dpe = r.get("score_dpe")
                pct_dpe = r.get("pct_bon_dpe")
                p = r.get("prix_m2")
                if dpe:
                    parts.append(f"DPE score {dpe}")
                if pct_dpe:
                    parts.append(f"{pct_dpe}% bons DPE")
                if p:
                    parts.append(f"{int(p):,} €/m²".replace(",", " "))
            elif intent == "securite":
                cam = r.get("cambriolages_pour_mille")
                sc = r.get("score_securite")
                p = r.get("prix_m2")
                if cam is not None:
                    parts.append(f"{cam}‰ cambriolages")
                if sc:
                    parts.append(f"sécurité {sc}/100")
                if p:
                    parts.append(f"{int(p):,} €/m²".replace(",", " "))
            else:
                p = r.get("prix_m2")
                rdt = r.get("rendement_pct")
                sc = r.get("score_global") or r.get("score_invest") or r.get("qualite_vie")
                if p:
                    parts.append(f"{int(p):,} €/m²".replace(",", " "))
                if rdt:
                    parts.append(f"{rdt}% rdt")
                if sc:
                    parts.append(f"score {sc}")

            lines.append(f"{i}. {' — '.join(parts)}")
        return "\n".join(lines)

    # ── Helpers prompt ─────────────────────────────────────────────────────────

    # Hint par intent : quelle(s) colonne(s) mettre en avant dans la réponse
    _INTENT_FOCUS = {
        "ecoles_ips":       "mets en avant l'IPS et le pourcentage d'écoles favorisées (pct_ecoles_favorisees)",
        "rendement":        "mets en avant le rendement locatif brut (rendement_pct) et le loyer médian (loyer_m2)",
        "dpe":              "mets en avant le score DPE (score_dpe) et le pourcentage de bons DPE (pct_bon_dpe)",
        "securite":         "mets en avant le taux de cambriolages (cambriolages_pour_mille) et le score sécurité",
        "top_investissement": "mets en avant le score investissement (score_invest) et le rendement (rendement_pct)",
        "top_qualite_vie":  "mets en avant le score qualité de vie (qualite_vie) et l'IPS écoles",
        "top_prix":         "mets en avant le prix au m² (prix_m2) et le nombre de transactions",
        "multi_criteria":   "mets en avant le score global et les critères demandés par l'utilisateur",
        "comparaison":      "compare les colonnes clés : prix_m2, rendement_pct, ips_ecoles, cambriolages_pour_mille, dpe_score",
    }

    def _build_messages(self, sql_data: List[Dict], user_query: str, context: str, intent: str = "") -> List[Dict]:
        # Convertir Decimal → float pour que Qwen voie des nombres (pas des strings)
        data_json = json.dumps(sql_data[:6], ensure_ascii=False,
                               default=lambda v: float(v) if isinstance(v, Decimal) else str(v))
        context_block = f"Historique : {context}\n" if context.strip() else ""
        focus = self._INTENT_FOCUS.get(intent, "mets en avant les données les plus pertinentes pour la question")
        return [
            {"role": "system", "content": (
                "Tu es HomePedia, assistant immobilier IDF. "
                "RÈGLES : cite UNIQUEMENT les chiffres du JSON fourni. "
                f"Pour cette question, {focus}. "
                "Réponds en français, 2-4 phrases courtes. "
                "Pas de code ni de LaTeX."
            )},
            {"role": "user", "content": (
                f"{context_block}"
                f"Données : {data_json}\nQuestion : {user_query}"
            )},
        ]

    def _llm_params(self) -> Dict:
        return dict(
            max_tokens=120,
            temperature=0.1,
            top_p=0.9,
            top_k=40,
            repeat_penalty=1.1,
            stop=["<|im_end|>", "<|endoftext|>"],
        )

    @staticmethod
    def _clean(text: str) -> str:
        for tok in ["<|im_end|>", "<|endoftext|>", "<|im_start|>"]:
            text = text.replace(tok, "").strip()
        text = re.sub(r"<[^>]+>", "", text).strip()
        text = re.sub(r"\$[^$]*\$", "", text).strip()
        return text

    # ── Génération ─────────────────────────────────────────────────────────────

    def generate_response(
        self,
        sql_data: List[Dict],
        user_query: str,
        intent: str,
        context: str = "",
    ) -> Optional[str]:
        """Génère une réponse complète (non-streaming)."""
        if not self.initialized:
            return None
        messages = self._build_messages(sql_data, user_query, context, intent=intent)
        try:
            response = self.model.create_chat_completion(messages=messages, **self._llm_params())
            text = self._clean(response["choices"][0]["message"]["content"].strip())
            if len(text) < 15:
                return None
            if not self._valid_numbers(text, sql_data):
                logger.warning("⚠️ Hallucination → fallback déterministe")
                return self._fallback_text(sql_data, intent)
            logger.info(f"✅ Réponse LLM ({len(text)} chars)")
            return text
        except Exception as e:
            logger.error(f"❌ Génération échouée: {e}")
            return None

    def generate_stream(
        self,
        sql_data: List[Dict],
        user_query: str,
        intent: str,
        context: str = "",
    ):
        """Streaming token-par-token via llama-cpp (générateur de str)."""
        if not self.initialized:
            return
        messages = self._build_messages(sql_data, user_query, context, intent=intent)
        try:
            for chunk in self.model.create_chat_completion(
                messages=messages, stream=True, **self._llm_params()
            ):
                delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                if delta:
                    yield self._clean(delta)
        except Exception as e:
            logger.error(f"❌ Stream échoué: {e}")

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
