"""Re-ranker cross-encoder au format ONNX quantifié en 8 bits, exécuté par onnxruntime.

Même modèle que la version PyTorch (cross-encoder/mmarco-mMiniLMv2-L12-H384-v1), dans le
fichier `onnx/model_quint8_avx2.onnx` publié avec lui : 119 Mo au lieu de 471, et des
calculs entiers sur 8 bits, plus rapides sur CPU (jeu d'instructions AVX2).
"""
import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from transformers import AutoTokenizer

MODELE = "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1"
FICHIER = "onnx/model_quint8_avx2.onnx"


class CrossEncoderOnnx:
    def __init__(self, modele=MODELE, fichier=FICHIER, max_length=256, threads=None):
        self.tokenizer = AutoTokenizer.from_pretrained(modele)
        options = ort.SessionOptions()
        if threads:
            options.intra_op_num_threads = threads
        self.session = ort.InferenceSession(hf_hub_download(modele, fichier), options,
                                            providers=["CPUExecutionProvider"])
        self.max_length = max_length

    def predict(self, paires, batch_size=16):
        """Même interface que sentence_transformers.CrossEncoder.predict : un score par paire."""
        scores = []
        for debut in range(0, len(paires), batch_size):
            lot = paires[debut:debut + batch_size]
            entrees = self.tokenizer([q for q, _ in lot], [t for _, t in lot], padding=True,
                                     truncation=True, max_length=self.max_length, return_tensors="np")
            logits = self.session.run(None, {"input_ids": entrees["input_ids"].astype(np.int64),
                                             "attention_mask": entrees["attention_mask"].astype(np.int64)})[0]
            scores.extend(logits[:, 0].tolist())
        return np.array(scores)
