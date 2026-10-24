"""Benchmark d'un re-ranker sur le RAG juridique de HomePedia, suivi dans MLflow.

La recherche reproduit exactement la production (rag/03_rag_server.py) : même modèle
d'embeddings (nomic-embed-text-v1.5), même requête SQL hybride pgvector + tsvector sur
la base Neon, 12 candidats. Le RAG envoie ensuite au LLM les 3 premières fiches
juridiques : c'est ce choix que le re-ranker cherche à améliorer.

Un re-ranker (cross-encoder) lit la question ET chaque candidat ensemble, et leur donne
un score de pertinence. Plus lent qu'un embedding, plus précis : on ne l'applique
qu'aux quelques candidats déjà trouvés.

Connexion en lecture seule. Mot de passe : variable POSTGRES_PASSWORD, sinon lu dans
Secret Manager (homepedia-neon-password) avec gcloud.

Lancement (depuis eval/reranker/) :
    .venv/bin/python benchmark_reranker.py
Interface : .venv/bin/mlflow ui --backend-store-uri sqlite:///mlflow.db --port 5002
"""
import csv
import json
import os
import statistics
import subprocess
import time
from pathlib import Path

import mlflow
import psycopg2
import torch
from psycopg2.extras import RealDictCursor
from sentence_transformers import CrossEncoder, SentenceTransformer

DOSSIER = Path(__file__).resolve().parent
TRACKING_URI = os.environ.get("MLFLOW_TRACKING_URI", f"sqlite:///{DOSSIER / 'mlflow.db'}")
EXPERIMENT = "homepedia-rag-reranker"

PG = {
    "host": os.environ.get("POSTGRES_HOST", "ep-snowy-hill-b9ods1vn.c-7.eu-central-1.aws.neon.tech"),
    "port": int(os.environ.get("POSTGRES_PORT", "5432")),
    "dbname": os.environ.get("POSTGRES_DB", "neondb"),
    "user": os.environ.get("POSTGRES_USER", "neondb_owner"),
    "sslmode": "require",
}
SEMANTIC_WEIGHT = 0.7   # valeur de production
TOP_K = 12              # candidats ramenés en production
MAX_LEGAL_LLM = 3       # fiches juridiques envoyées au LLM en production

# Même requête que hybrid_search() en production, sans filtre de département.
# {tsquery} : la production utilise plainto_tsquery, qui relie tous les mots par ET.
# Une question comme « Combien coûtent les frais de notaire ? » exige alors « combien »
# ET « coutent » dans la fiche : aucune ne correspond, et le score mots-clés vaut 0.
# La variante « ou » relie les mots par OU.
TSQUERY = {
    "et": "plainto_tsquery('french', %(q)s)",
    "ou": "to_tsquery('french', replace(plainto_tsquery('french', %(q)s)::text, '&', '|'))",
}
SQL = """
    WITH ranked AS (
        SELECT id, doc_type, text,
            (1 - (embedding <=> %(vec)s::vector)) AS semantic_score,
            COALESCE(ts_rank_cd(text_fts, {tsquery}), 0) AS fts_score
        FROM rag_documents
        WHERE doc_type = 'summary' OR doc_type = 'legal'
    )
    SELECT id, doc_type, text,
        (%(w)s * semantic_score + %(w_fts)s * LEAST(fts_score * 5, 1.0)) AS hybrid_score
    FROM ranked
    ORDER BY hybrid_score DESC
    LIMIT %(k)s
"""

MINILM = "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1"
BGE = "BAAI/bge-reranker-v2-m3"

# (nom du run, poids sémantique, requête mots-clés, nombre de candidats, re-ranker, appareil)
# Cloud Run n'a pas de GPU : les configurations candidates à la production sont aussi
# mesurées sur CPU, pour une latence réaliste. BGE sur CPU (environ 30 s par question,
# mesuré le 24/10) n'est plus relancé : il est inutilisable sans GPU.
CONFIGURATIONS = [
    ("mots_cles_seuls", 0.0, "et", TOP_K, None, "cuda"),
    ("semantique_seule", 1.0, "et", TOP_K, None, "cuda"),
    ("hybride_production", SEMANTIC_WEIGHT, "et", TOP_K, None, "cuda"),
    ("hybride_rerank_minilm", SEMANTIC_WEIGHT, "et", TOP_K, MINILM, "cuda"),
    ("hybride_rerank_bge", SEMANTIC_WEIGHT, "et", TOP_K, BGE, "cuda"),
    ("hybride_30_rerank_bge", SEMANTIC_WEIGHT, "et", 30, BGE, "cuda"),
    ("mots_cles_ou_seuls", 0.0, "ou", TOP_K, None, "cuda"),
    ("hybride_ou", SEMANTIC_WEIGHT, "ou", TOP_K, None, "cuda"),
    ("hybride_ou_rerank_minilm", SEMANTIC_WEIGHT, "ou", TOP_K, MINILM, "cuda"),
    ("hybride_ou_30_rerank_minilm", SEMANTIC_WEIGHT, "ou", 30, MINILM, "cuda"),
    ("hybride_ou_30_rerank_bge", SEMANTIC_WEIGHT, "ou", 30, BGE, "cuda"),
    ("hybride_ou_30_rerank_minilm_cpu", SEMANTIC_WEIGHT, "ou", 30, MINILM, "cpu"),
]

# Configuration retenue pour la production (CPU, 2 vCPU). La v2 (10 fiches, 256 jetons)
# déployée le 24/10 ajoutait 2,3 s sur Cloud Run. La v3 ne re-note que les 8 premières
# fiches juridiques, textes coupés à 128 jetons : plus précise et 3 fois plus rapide.
PRODUCTION_V2 = ("production_v3", SEMANTIC_WEIGHT, "ou", 30, MINILM, "cpu")
FICHES_RERANKEES_V2 = 8
LONGUEUR_V2 = 128


def mot_de_passe():
    if os.environ.get("POSTGRES_PASSWORD"):
        return os.environ["POSTGRES_PASSWORD"]
    return subprocess.run(
        ["gcloud", "secrets", "versions", "access", "latest", "--secret=homepedia-neon-password"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def connexion():
    return psycopg2.connect(**PG, password=mot_de_passe(), connect_timeout=15,
                            options="-c default_transaction_read_only=on")


def charger_questions():
    donnees = json.loads((DOSSIER / "questions_juridiques.json").read_text(encoding="utf-8"))
    return [{"jeu": jeu, "question": item["q"], "attendus": item["ids"]}
            for jeu in ("benchmark", "langage_courant") for item in donnees[jeu]]


def rechercher(conn, embedder, question, poids, mode, k):
    vecteur = embedder.encode(question, normalize_embeddings=True).tolist()
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(SQL.format(tsquery=TSQUERY[mode]), {"vec": "[" + ",".join(map(str, vecteur)) + "]", "q": question,
                          "w": poids, "w_fts": 1 - poids, "k": k})
        return cur.fetchall()


def reordonner(reranker, question, candidats, limite=None):
    """Re-note les fiches juridiques (les `limite` premières), les communes gardent leur ordre."""
    fiches = [c for c in candidats if c["doc_type"] == "legal"]
    a_noter, reste = (fiches[:limite], fiches[limite:]) if limite else (fiches, [])
    scores = reranker.predict([(question, c["text"]) for c in a_noter], batch_size=16)
    triees = [c for _, c in sorted(zip(scores, a_noter), key=lambda paire: -paire[0])]
    return triees + reste + [c for c in candidats if c["doc_type"] != "legal"]


def mesurer(fiches, attendus, candidats):
    """Mesures sur la liste ordonnée des fiches juridiques, celle qui alimente le LLM."""
    rang = next((i + 1 for i, f in enumerate(fiches) if f in attendus), None)
    return {
        "succes_1": rang == 1,
        "rappel_3": rang is not None and rang <= MAX_LEGAL_LLM,
        "rr": 1 / rang if rang else 0.0,
        "dans_candidats": any(c in attendus for c in candidats),
        "rang": rang,
    }


def resumer(lignes):
    n = len(lignes)
    return {
        "succes_1": 100 * sum(l["succes_1"] for l in lignes) / n,
        "rappel_3": 100 * sum(l["rappel_3"] for l in lignes) / n,
        "mrr": sum(l["rr"] for l in lignes) / n,
        "couverture_candidats": 100 * sum(l["dans_candidats"] for l in lignes) / n,
        "latence_mediane_ms": statistics.median(l["latence_ms"] for l in lignes),
    }


def main():
    questions = charger_questions()
    print(f"{len(questions)} questions ({sum(q['jeu'] == 'benchmark' for q in questions)} du benchmark, "
          f"{sum(q['jeu'] == 'langage_courant' for q in questions)} en langage courant)")

    mlflow.set_tracking_uri(TRACKING_URI)
    if mlflow.get_experiment_by_name(EXPERIMENT) is None:
        mlflow.create_experiment(EXPERIMENT, artifact_location=(DOSSIER / "mlartifacts").as_uri())
    mlflow.set_experiment(EXPERIMENT)

    embedder = SentenceTransformer("nomic-ai/nomic-embed-text-v1.5", trust_remote_code=True)
    rerankers = {}
    conn = connexion()
    tableau = []

    for config in CONFIGURATIONS + [PRODUCTION_V2]:
        nom, poids, mode, k, modele, appareil = config
        v2 = config == PRODUCTION_V2
        longueur = LONGUEUR_V2 if v2 else 512
        limite = FICHES_RERANKEES_V2 if v2 else None
        print(f"- {nom} …", flush=True)
        cle = (modele, appareil, longueur)
        if modele and cle not in rerankers:
            rerankers[cle] = CrossEncoder(modele, max_length=longueur, device=appareil)
        reranker = rerankers.get(cle)
        if appareil == "cpu":
            torch.set_num_threads(2)  # comme Cloud Run
        else:
            torch.set_num_threads(os.cpu_count())

        with mlflow.start_run(run_name=nom):
            mlflow.log_params({"poids_semantique": poids, "requete_mots_cles": mode, "candidats": k, "reranker": modele or "aucun", "appareil_reranker": appareil,
                               "longueur_max": longueur, "fiches_rerankees": limite or "toutes",
                               "embeddings": "nomic-embed-text-v1.5", "fiches_envoyees_llm": MAX_LEGAL_LLM,
                               "nb_questions": len(questions)})
            rechercher(conn, embedder, "échauffement", poids, mode, k)  # charge le modèle et la connexion
            lignes = []
            for item in questions:
                debut = time.perf_counter()
                candidats = rechercher(conn, embedder, item["question"], poids, mode, k)
                if reranker:
                    candidats = reordonner(reranker, item["question"], candidats, limite)
                latence = (time.perf_counter() - debut) * 1000
                fiches = [c["id"] for c in candidats if c["doc_type"] == "legal"]
                mesure = mesurer(fiches, item["attendus"], [c["id"] for c in candidats])
                lignes.append({**item, "attendus": "|".join(item["attendus"]), "configuration": nom,
                               "fiches_envoyees": "|".join(fiches[:MAX_LEGAL_LLM]),
                               "latence_ms": latence, **mesure})

            global_ = resumer(lignes)
            mlflow.log_metrics(global_)
            par_jeu = {}
            for jeu in ("benchmark", "langage_courant"):
                par_jeu[jeu] = resumer([l for l in lignes if l["jeu"] == jeu])
                mlflow.log_metrics({f"{cle}_{jeu}": v for cle, v in par_jeu[jeu].items()})

            fichier = DOSSIER / f"predictions_{nom}.csv"
            with open(fichier, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=list(lignes[0]))
                writer.writeheader()
                writer.writerows(lignes)
            mlflow.log_artifact(str(fichier))
            tableau.append((nom, global_, par_jeu))
            print(f"     rappel@3 {global_['rappel_3']:.1f} %, succès@1 {global_['succes_1']:.1f} %, "
                  f"latence {global_['latence_mediane_ms']:.0f} ms")
    conn.close()

    print("\n" + f"{'configuration':<24}{'succès@1':>10}{'rappel@3':>10}{'MRR':>7}"
          f"{'r@3 bench':>11}{'r@3 courant':>13}{'ms':>7}")
    for nom, g, par in tableau:
        print(f"{nom:<24}{g['succes_1']:>10.1f}{g['rappel_3']:>10.1f}{g['mrr']:>7.2f}"
              f"{par['benchmark']['rappel_3']:>11.1f}{par['langage_courant']['rappel_3']:>13.1f}"
              f"{g['latence_mediane_ms']:>7.0f}")


if __name__ == "__main__":
    main()
