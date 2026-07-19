"""
03_rag_server.py
Serveur FastAPI RAG — chatbot immobilier Île-de-France.

Architecture :
  - Retrieval : pgvector + tsvector (hybrid search SQL natif)
  - Query rewriting : reformulation LLM des follow-up questions
  - LLM : Qwen 2.5 3B via Ollama (CPU-only, local)
  - Streaming : SSE pour affichage token par token (UX ChatGPT-like)

Endpoints :
  - POST /rag/query         → réponse complète (JSON)
  - POST /rag/query/stream  → streaming SSE
  - GET  /rag/health        → status du service
"""

import os
import re
import json
import time
import logging
import threading
import requests
import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

app = FastAPI(title="HomePedia RAG API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# ── Config ────────────────────────────────────────────────────────────────────
PG_HOST = os.getenv("POSTGRES_HOST", "localhost")
PG_PORT = int(os.getenv("POSTGRES_PORT", 5433))
PG_DB = os.getenv("POSTGRES_DB", "homepedia")
PG_USER = os.getenv("POSTGRES_USER", "homepedia")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "homepedia")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
REWRITE_MODEL = os.getenv("OLLAMA_REWRITE_MODEL", "qwen2.5:3b")
EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")

TOP_K = 12
MAX_COMMUNES_SOURCES = 5  # Communes affichées en sources dans le chat (UI)
MAX_COMMUNES_LLM = 3      # Summaries envoyés au LLM (perf prompt processing)
MAX_LEGAL_LLM = 3         # Chunks légaux envoyés au LLM (bail, loyer, CAF…)
NUM_PREDICT = 400
KEEP_ALIVE = "30m"

# Poids de l'hybrid search : plus c'est élevé, plus la recherche sémantique domine
# 0.0 = full-text only, 1.0 = embeddings only, 0.7 = pondéré
SEMANTIC_WEIGHT = 0.7

# ── Mode production (Cloud Run sans Ollama) ───────────────────────────────────
USE_LOCAL_EMBED = os.getenv("USE_LOCAL_EMBED", "false").lower() == "true"
USE_LOCAL_LLM   = os.getenv("USE_LOCAL_LLM", "false").lower() == "true"
LLM_MODEL_PATH  = os.getenv("LLM_MODEL_PATH", "/app/models/qwen2.5-0.5b.gguf")

_local_embed_model = None
_local_llm = None

if USE_LOCAL_EMBED:
    from sentence_transformers import SentenceTransformer
    log.info("Chargement du modèle d'embedding local (nomic-embed-text-v1.5)…")
    _local_embed_model = SentenceTransformer("nomic-ai/nomic-embed-text-v1.5", trust_remote_code=True)
    log.info("Modèle d'embedding local prêt")

if USE_LOCAL_LLM:
    from llama_cpp import Llama
    log.info(f"Chargement du LLM local : {LLM_MODEL_PATH}…")
    _local_llm = Llama(
        model_path=LLM_MODEL_PATH,
        n_ctx=4096,
        n_threads=int(os.getenv("LLM_THREADS", "4")),
        chat_format="chatml",
        verbose=False,
    )
    log.info("LLM local prêt")


# ── Initialisation connexion PostgreSQL ──────────────────────────────────────
def get_pg_conn():
    return psycopg2.connect(
        host=PG_HOST, port=PG_PORT, dbname=PG_DB,
        user=PG_USER, password=PG_PASSWORD,
    )


# Vérifier connexion + compter docs au démarrage
log.info(f"Connexion PostgreSQL → {PG_HOST}:{PG_PORT}/{PG_DB}")
try:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM rag_documents")
            doc_count = cur.fetchone()[0]
            log.info(f"rag_documents : {doc_count} documents indexés")
except Exception as e:
    log.error(f"Impossible de se connecter à PostgreSQL : {e}")
    doc_count = 0

log.info(f"LLM : {OLLAMA_MODEL} via Ollama ({OLLAMA_URL})")


# ── Warmup LLM ────────────────────────────────────────────────────────────────
def warmup_llm():
    """Charge le modèle en RAM au démarrage pour éviter le cold start."""
    if USE_LOCAL_LLM or USE_LOCAL_EMBED:
        log.info("Mode local activé — pas de warmup Ollama nécessaire")
        return
    log.info(f"Warmup du modèle {OLLAMA_MODEL}...")
    t0 = time.time()
    try:
        requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": OLLAMA_MODEL,
                "prompt": "ok",
                "stream": False,
                "options": {"num_predict": 1},
                "keep_alive": KEEP_ALIVE,
            },
            timeout=300,
        )
        requests.post(
            f"{OLLAMA_URL}/api/embed",
            json={"model": EMBED_MODEL, "input": ["ok"], "keep_alive": KEEP_ALIVE},
            timeout=60,
        )
        if REWRITE_MODEL != OLLAMA_MODEL:
            requests.post(
                f"{OLLAMA_URL}/api/generate",
                json={"model": REWRITE_MODEL, "prompt": "ok", "stream": False,
                      "options": {"num_predict": 1}, "keep_alive": KEEP_ALIVE},
                timeout=120,
            )
        log.info(f"Warmup terminé en {int(time.time() - t0)}s — modèle prêt")
    except Exception as e:
        log.warning(f"Warmup échoué : {e}")


threading.Thread(target=warmup_llm, daemon=True).start()


# ── Modèles Pydantic ──────────────────────────────────────────────────────────
class ChatMessage(BaseModel):
    role: str
    content: str


class QueryRequest(BaseModel):
    question: str
    departement: str | None = None
    top_k: int = TOP_K
    history: list[ChatMessage] = []


class Source(BaseModel):
    text: str
    city: str | None = None
    type: str | None = None


class QueryResponse(BaseModel):
    answer: str
    sources: list[Source]
    latency_ms: int


# ── Fonctions Ollama ──────────────────────────────────────────────────────────
def embed_query(text: str) -> list[float]:
    """Encode une question via sentence-transformers (prod) ou Ollama (dev)."""
    if USE_LOCAL_EMBED and _local_embed_model:
        return _local_embed_model.encode(text, normalize_embeddings=True).tolist()
    resp = requests.post(
        f"{OLLAMA_URL}/api/embed",
        json={"model": EMBED_MODEL, "input": [text]},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["embeddings"][0]


def vector_to_pg(vec: list[float]) -> str:
    return "[" + ",".join(f"{v:.6f}" for v in vec) + "]"


def call_llm(messages: list[dict]) -> str:
    if USE_LOCAL_LLM and _local_llm:
        result = _local_llm.create_chat_completion(
            messages=messages,
            max_tokens=NUM_PREDICT,
            temperature=0.3,
        )
        return result["choices"][0]["message"]["content"].strip()
    resp = requests.post(
        f"{OLLAMA_URL}/api/chat",
        json={
            "model": OLLAMA_MODEL,
            "messages": messages,
            "stream": False,
            "options": {"temperature": 0.3, "num_predict": NUM_PREDICT},
            "keep_alive": KEEP_ALIVE,
        },
        timeout=180,
    )
    resp.raise_for_status()
    return resp.json()["message"]["content"].strip()


def call_llm_stream(messages: list[dict]):
    if USE_LOCAL_LLM and _local_llm:
        for chunk in _local_llm.create_chat_completion(
            messages=messages,
            max_tokens=NUM_PREDICT,
            temperature=0.3,
            stream=True,
        ):
            content = chunk["choices"][0].get("delta", {}).get("content", "")
            if content:
                yield content
        return
    with requests.post(
        f"{OLLAMA_URL}/api/chat",
        json={
            "model": OLLAMA_MODEL,
            "messages": messages,
            "stream": True,
            "options": {"temperature": 0.3, "num_predict": NUM_PREDICT},
            "keep_alive": KEEP_ALIVE,
        },
        stream=True,
        timeout=180,
    ) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line:
                continue
            try:
                data = json.loads(line)
                msg = data.get("message", {})
                if msg.get("content"):
                    yield msg["content"]
                if data.get("done"):
                    break
            except json.JSONDecodeError:
                continue


# ── Extraction département depuis la question ────────────────────────────────
DEPT_KEYWORDS = {
    "75": ["75", "paris", "75000", "intra-muros"],
    "77": ["77", "seine-et-marne", "seine et marne"],
    "78": ["78", "yvelines"],
    "91": ["91", "essonne"],
    "92": ["92", "hauts-de-seine", "hauts de seine"],
    "93": ["93", "seine-saint-denis", "seine saint denis", "ssd"],
    "94": ["94", "val-de-marne", "val de marne"],
    "95": ["95", "val-d'oise", "val d'oise", "val doise"],
}


def extract_departement(question: str) -> str | None:
    import re
    q = question.lower()
    match = re.search(r"\b(7[5-8]|9[1-5])\b", q)
    if match:
        return match.group(1)
    for code, keywords in DEPT_KEYWORDS.items():
        for kw in keywords:
            if len(kw) > 2 and kw in q:
                return code
    return None


# ── Query rewriting (pour les follow-up questions) ───────────────────────────
REWRITE_PROMPT = """Tu reformules des questions de follow-up en questions autonomes pour un système de recherche sur l'immobilier en Île-de-France.

Règles :
- Retourne UNIQUEMENT la question reformulée, rien d'autre.
- Pas de guillemets, pas de préambule, pas d'explication.
- Conserve les termes importants (département, commune, critère comme DPE/prix/transport).
- Si la question est déjà autonome, retourne-la telle quelle.
- Si elle est ambiguë (ex: "le pire ?", "et l'inverse ?", "c'est bien ?"), reformule-la en utilisant le contexte.

Exemples :
Historique : "Quelle commune du 92 a le meilleur DPE ?" → "Sèvres"
Question : "Et le pire ?"
Reformulée : Quelle commune du 92 a le pire DPE ?

Historique : "Prix moyen à Montreuil ?" → "5 230€/m²"
Question : "Et à Vincennes ?"
Reformulée : Prix moyen à Vincennes ?"""


def rewrite_query(question: str, history: list[dict]) -> str:
    if not history:
        return question
    if len(question.split()) >= 7 and extract_departement(question):
        return question

    recent = [m for m in history[-4:] if m.get("content")]
    if not recent:
        return question

    history_text = "\n".join(
        f"{'Utilisateur' if m['role'] == 'user' else 'Assistant'} : {m['content'][:300]}"
        for m in recent
    )
    user_msg = f"""Historique de conversation :
{history_text}

Question à reformuler : {question}
Reformulée :"""

    try:
        if USE_LOCAL_LLM and _local_llm:
            result = _local_llm.create_chat_completion(
                messages=[
                    {"role": "system", "content": REWRITE_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=60,
                temperature=0.1,
            )
            rewritten = result["choices"][0]["message"]["content"].strip().strip('"\'«»').strip()
        else:
            resp = requests.post(
                f"{OLLAMA_URL}/api/chat",
                json={
                    "model": REWRITE_MODEL,
                    "messages": [
                        {"role": "system", "content": REWRITE_PROMPT},
                        {"role": "user", "content": user_msg},
                    ],
                    "stream": False,
                    "options": {"temperature": 0.1, "num_predict": 60},
                    "keep_alive": KEEP_ALIVE,
                },
                timeout=30,
            )
            resp.raise_for_status()
            rewritten = resp.json()["message"]["content"].strip().strip('"\'«»').strip()
        if rewritten and len(rewritten) < 300:
            return rewritten
    except Exception as e:
        log.warning(f"Query rewriting échoué : {e}")

    return question


# ── Hybrid Search (pgvector + tsvector) ──────────────────────────────────────
def detect_city(query: str):
    """Détecte un nom de commune dans la question via lookup en base."""
    words = query.lower()
    sql = """
        SELECT DISTINCT city, code_commune, code_departement
        FROM rag_documents
        WHERE LOWER(city) = ANY(%s)
        LIMIT 5
    """
    tokens = []
    parts = words.replace("'", " ").replace("-", " ").split()
    for i in range(len(parts)):
        for j in range(i + 1, min(i + 4, len(parts) + 1)):
            candidate = " ".join(parts[i:j])
            tokens.append(candidate)
            tokens.append(candidate.replace(" ", "-"))
    if not tokens:
        return None
    with get_pg_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (tokens,))
            results = cur.fetchall()
            if results:
                longest = max(results, key=lambda r: len(r["city"]))
                return longest
    return None


def hybrid_search(query: str, departement: str | None, top_k: int):
    """
    Hybrid search SQL natif avec pgvector + tsvector.
    Cherche sur les summaries (filtrés par département) ET les chunks légaux
    (droit du logement, CAF, achat immo — pas de filtre département).
    """
    query_vec = embed_query(query)
    query_vec_pg = vector_to_pg(query_vec)

    sql = """
        WITH ranked AS (
            SELECT
                id, doc_type, code_commune, city, code_departement, text,
                (1 - (embedding <=> %s::vector)) AS semantic_score,
                COALESCE(
                    ts_rank_cd(text_fts, plainto_tsquery('french', %s)),
                    0
                ) AS fts_score
            FROM rag_documents
            WHERE (doc_type = 'summary' AND (%s IS NULL OR code_departement = %s))
               OR doc_type = 'legal'
        )
        SELECT
            id, doc_type, code_commune, city, code_departement, text,
            semantic_score, fts_score,
            (%s * semantic_score + %s * LEAST(fts_score * 5, 1.0)) AS hybrid_score
        FROM ranked
        ORDER BY hybrid_score DESC
        LIMIT %s
    """

    with get_pg_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (
                query_vec_pg,
                query,
                departement, departement,
                SEMANTIC_WEIGHT, 1 - SEMANTIC_WEIGHT,
                top_k,
            ))
            return cur.fetchall()


def get_commune_details(codes_commune: list[str]):
    """Récupère les docs détaillés (commune + dpe + poi) pour l'affichage UI."""
    if not codes_commune:
        return []

    sql = """
        SELECT doc_type, code_commune, city, code_departement, text
        FROM rag_documents
        WHERE code_commune = ANY(%s)
          AND doc_type != 'summary'
        ORDER BY
            array_position(%s::text[], code_commune),
            CASE doc_type
                WHEN 'commune' THEN 1
                WHEN 'dpe' THEN 2
                WHEN 'poi' THEN 3
                ELSE 4
            END
    """
    with get_pg_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (codes_commune, codes_commune))
            return cur.fetchall()


def get_summaries(codes_commune: list[str]):
    """Récupère les summaries pour une liste de communes (dans l'ordre donné)."""
    if not codes_commune:
        return []
    sql = """
        SELECT code_commune, text
        FROM rag_documents
        WHERE code_commune = ANY(%s) AND doc_type = 'summary'
        ORDER BY array_position(%s::text[], code_commune)
    """
    with get_pg_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (codes_commune, codes_commune))
            return cur.fetchall()


# ── Garde-fous hors périmètre ────────────────────────────────────────────────
# Sans eux, le modèle répond avec aplomb à tout : il inventait un prix au m2 pour
# Marseille et interprétait "prix dans 5 ans" comme la commune de Saint-Prix.

SALUTATION_RE = re.compile(
    r"^(salut|bonjour|bonsoir|hello|coucou|hey|hi|ok|super|g[eé]nial|"
    r"parfait|cool|bravo|au revoir|bye|[àa] bient[oô]t|bonne\s+\w+|"
    r"merci(\s+(beaucoup|bien|infiniment|[àa]\s+toi))?|(ok|c.est bon)\s+merci)[\s!.?]*$|"
    r"^(tu peux m.aider|vous pouvez m.aider|aide[z-]?[- ]moi|j.ai besoin d.aide|"
    r"aide moi|peux[- ]tu m.aider|help me)[\s?!.]*$",
    re.I,
)

# Villes hors Île-de-France. Une commune IDF reconnue par detect_city() court-circuite
# ce filtre en amont : "Limoges-Fourches" (77) ne doit pas être bloquée par "limoges".
VILLE_HORS_IDF_RE = re.compile(
    r"\b(lyon|marseille|bordeaux|toulouse|nantes|lille|nice|strasbourg|rennes|"
    r"montpellier|nancy|metz|reims|tours|dijon|grenoble|angers|n[iî]mes|brest|"
    r"clermont[- ]ferrand|limoges|perpignan|besan[cç]on|orl[eé]ans|rouen|caen|"
    r"mulhouse|avignon|poitiers|amiens|toulon|saint[- ][eé]tienne|le havre|"
    r"le mans|aix[- ]en[- ]provence|la rochelle|bayonne|biarritz|annecy|"
    r"chamb[eé]ry|valence)\b",
    re.I,
)

# Sujets sans rapport avec le logement.
# Les frontières de mot sont indispensables : sans elles, "sport" bloquait
# "transports" et "cuisine" bloquait une question sur la loi Carrez. Un garde-fou
# qui refuse de vraies questions fait plus de dégâts que pas de garde-fou.
SUJET_HORS_SCOPE_RE = re.compile(
    r"(m[eé]t[eé]o|quel temps|temps.{0,6}fait.il|qu.il fait dehors|\bpleut\b|"
    r"recette (de )?cuisine|\brecettes?\b|\bfootball\b|\bmatchs?\b|\bsports?\b|"
    r"\bfilms?\b|\bs[eé]ries? t[eé]l[eé]|\bmusique\b|"
    r"\bpolitique\b|[eé]lections?\b|\bbourse\b|\bcrypto|\bbitcoin\b)",
    re.I,
)

REPONSE_SALUTATION = (
    "Bonjour ! Je suis l'assistant HomePedia, spécialisé dans l'immobilier en "
    "Île-de-France. Je peux vous renseigner sur les prix au m², les scores de "
    "qualité de vie, le DPE ou la sécurité des 1266 communes franciliennes, ainsi "
    "que sur le droit du logement (bail, loyer, dépôt de garantie, aides). "
    "Que souhaitez-vous savoir ?"
)

REPONSE_HORS_IDF = (
    "Je suis spécialisé dans l'immobilier en Île-de-France uniquement : ma base "
    "couvre les 1266 communes franciliennes, et je n'ai aucune donnée sur cette "
    "ville. Posez-moi une question sur une commune d'Île-de-France, ou sur le "
    "droit du logement (valable partout en France)."
)

REPONSE_HORS_SCOPE = (
    "Je suis spécialisé dans l'immobilier en Île-de-France : prix, DPE, sécurité, "
    "cadre de vie et droit du logement. Je ne peux pas répondre à cette question, "
    "mais posez-m'en une sur une commune francilienne ou sur vos droits de "
    "locataire ou propriétaire !"
)


def garde_fou(question: str) -> str | None:
    """Retourne une réponse fixe si la question sort du périmètre, sinon None.

    Évite un aller-retour LLM (10-20 s) pour une salutation, et surtout évite
    d'inventer des chiffres sur des villes absentes de la base.
    """
    q = (question or "").strip()
    if not q:
        return None

    if SALUTATION_RE.match(q):
        return REPONSE_SALUTATION

    # Un sujet non-immobilier reste hors périmètre même s'il cite une commune IDF
    # ("Quel temps fait-il à Paris ?") : ce test passe donc avant detect_city().
    if SUJET_HORS_SCOPE_RE.search(q):
        return REPONSE_HORS_SCOPE

    # À l'inverse, une commune francilienne reconnue prime sur la liste des villes
    # hors IDF : c'est ce qui protège des collisions de noms (Limoges-Fourches, 77).
    if detect_city(q):
        return None

    if VILLE_HORS_IDF_RE.search(q):
        return REPONSE_HORS_IDF

    return None


def retrieve_context(question: str, departement: str | None, top_k: int, history: list[dict] | None = None):
    """
    Retrieval complet :
      1. Query rewriting (follow-ups)
      2. Hybrid search sur summaries communes + chunks légaux
      3. Récupération des summaries + docs détaillés des meilleures communes
      4. Chunks légaux passés directement au LLM si pertinents
    """
    search_query = rewrite_query(question, history or [])
    if search_query != question:
        log.info(f"Query reformulée : '{question}' → '{search_query}'")

    if not departement:
        departement = extract_departement(search_query)
        if departement:
            log.info(f"Département détecté : {departement}")

    # Détection de ville dans la question
    city_match = detect_city(search_query)
    if city_match:
        log.info(f"Ville détectée : {city_match['city']} ({city_match['code_commune']})")
        if not departement:
            departement = city_match["code_departement"]

    results = hybrid_search(search_query, departement, top_k)
    if not results:
        return [], [], []

    # Séparer les résultats légaux des summaries communes
    summary_results = [r for r in results if r["doc_type"] == "summary"]
    legal_results = [r for r in results if r["doc_type"] == "legal"]

    matched_communes = [r["code_commune"] for r in summary_results]

    # Si une ville est détectée, la mettre en tête des résultats
    if city_match and city_match["code_commune"] not in matched_communes[:3]:
        matched_communes = [city_match["code_commune"]] + [c for c in matched_communes if c != city_match["code_commune"]]

    log.info(f"Top communes : {matched_communes[:5]} | Légal : {len(legal_results)} chunks")

    # Chunks légaux passés directement au LLM (les plus pertinents en premier)
    legal_chunks = [r["text"] for r in legal_results[:MAX_LEGAL_LLM]]

    # Summaries communes pour le LLM
    summaries = get_summaries(matched_communes[:MAX_COMMUNES_LLM])
    commune_chunks = [s["text"] for s in summaries]

    # Légal en premier : priorité aux réponses juridiques si la question est légale
    llm_chunks = legal_chunks + commune_chunks

    # Pour l'UI : docs détaillés des M premières communes
    ui_docs = get_commune_details(matched_communes[:MAX_COMMUNES_SOURCES])
    ui_chunks = [d["text"] for d in ui_docs]
    ui_metadatas = [
        {"city": d["city"], "type": d["doc_type"], "code_commune": d["code_commune"]}
        for d in ui_docs
    ]

    # Ajouter les chunks légaux comme sources UI
    for r in legal_results[:MAX_LEGAL_LLM]:
        ui_chunks.append(r["text"][:300])
        ui_metadatas.append({"city": "France", "type": "legal", "code_commune": "00000"})

    return llm_chunks, ui_chunks, ui_metadatas


# ── Prompt ────────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """Tu es HomePedia, un assistant spécialisé dans l'immobilier et le droit du logement en France.

Règles impératives :
- Réponds en français, directement, sans préambule.
- Utilise UNIQUEMENT les informations du contexte ci-dessous.
- Pas de bullet points ni de listes numérotées sauf pour les étapes légales ou les listes de critères — réponds en phrases continues.
- Les critères objectifs (DPE, prix, population, transports, superficie) sont des données factuelles : compare les chiffres et classe les communes du meilleur au moins bon. Pour le DPE : score bas = meilleur (1=A, 7=G), donc 3/7 est meilleur que 4/7.
- Réponds toujours avec les données disponibles, même partielles. Ne dis jamais "les données ne permettent pas de répondre" si tu as des chiffres comparables dans le contexte.
- Seules les questions purement subjectives sans aucun critère mesurable (la "plus belle", "la plus agréable") méritent la mention "c'est subjectif".
- Si l'information n'est pas dans le contexte, dis-le en une phrase courte.
- Pas de "Bien sûr", "Voici", "D'après les données", "Il convient de noter" — va directement au fait.
- Pour les questions juridiques (bail, loyer, préavis, dépôt de garantie, APL, CAF, achat, diagnostics, travaux, copropriété), donne une réponse précise avec les montants et délais légaux exacts, puis termine par : "Pour plus de détails ou une situation personnelle, consultez service-public.fr ou un professionnel du droit."
- Maximum 4 phrases courtes pour les questions simples. Pour les questions juridiques ou comparatives détaillées, tu peux aller jusqu'à 6 phrases si nécessaire."""


def build_messages(question: str, chunks: list[str], history: list[dict] | None = None) -> list[dict]:
    context = "\n\n".join(f"[Source {i+1}] {c}" for i, c in enumerate(chunks))
    user_message = f"""CONTEXTE :
{context}

QUESTION : {question}"""

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": user_message})
    return messages


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.post("/rag/query", response_model=QueryResponse)
async def rag_query(req: QueryRequest):
    t0 = time.time()
    history_dicts = [{"role": m.role, "content": m.content} for m in req.history]

    refus = garde_fou(req.question)
    if refus:
        log.info(f"Garde-fou déclenché : '{req.question[:60]}'")
        return QueryResponse(
            answer=refus, sources=[], latency_ms=int((time.time() - t0) * 1000)
        )

    try:
        llm_chunks, ui_chunks, ui_metadatas = retrieve_context(
            req.question, req.departement, req.top_k, history_dicts
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Erreur retrieval : {e}")

    if not llm_chunks:
        return QueryResponse(
            answer="Je n'ai pas trouvé d'informations pertinentes pour répondre à votre question.",
            sources=[],
            latency_ms=int((time.time() - t0) * 1000),
        )

    messages = build_messages(req.question, llm_chunks, history_dicts)

    try:
        answer = call_llm(messages)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Ollama LLM indisponible : {e}")

    sources = [
        Source(text=chunk[:300], city=meta.get("city"), type=meta.get("type"))
        for chunk, meta in zip(ui_chunks, ui_metadatas)
    ]
    latency = int((time.time() - t0) * 1000)
    log.info(f"Question: '{req.question}' → {latency}ms, {len(sources)} sources")
    return QueryResponse(answer=answer, sources=sources, latency_ms=latency)


@app.post("/rag/query/stream")
async def rag_query_stream(req: QueryRequest):
    """Endpoint streaming SSE : renvoie les tokens en temps réel."""
    t0 = time.time()
    history_dicts = [{"role": m.role, "content": m.content} for m in req.history]

    def event_stream():
        refus = garde_fou(req.question)
        if refus:
            log.info(f"Garde-fou déclenché (stream) : '{req.question[:60]}'")
            yield f"event: sources\ndata: {json.dumps({'sources': []})}\n\n"
            yield f"event: token\ndata: {json.dumps({'text': refus})}\n\n"
            yield f"event: done\ndata: {json.dumps({'latency_ms': int((time.time() - t0) * 1000)})}\n\n"
            return

        try:
            llm_chunks, ui_chunks, ui_metadatas = retrieve_context(
                req.question, req.departement, req.top_k, history_dicts
            )
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
            return

        if not llm_chunks:
            msg = "Je n'ai pas trouvé d'informations pertinentes."
            yield f"event: token\ndata: {json.dumps({'text': msg})}\n\n"
            yield f"event: done\ndata: {json.dumps({'latency_ms': int((time.time() - t0) * 1000)})}\n\n"
            return

        sources = [
            {"text": chunk[:300], "city": meta.get("city"), "type": meta.get("type")}
            for chunk, meta in zip(ui_chunks, ui_metadatas)
        ]
        yield f"event: sources\ndata: {json.dumps({'sources': sources})}\n\n"

        messages = build_messages(req.question, llm_chunks, history_dicts)
        try:
            for token in call_llm_stream(messages):
                yield f"event: token\ndata: {json.dumps({'text': token})}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'error': f'LLM indisponible : {e}'})}\n\n"
            return

        latency = int((time.time() - t0) * 1000)
        log.info(f"[stream] '{req.question}' → {latency}ms")
        yield f"event: done\ndata: {json.dumps({'latency_ms': latency})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/rag/health")
async def health():
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM rag_documents")
                count = cur.fetchone()[0]
        return {
            "status": "ok",
            "docs_indexed": count,
            "backend": "pgvector + tsvector (hybrid search)",
            "llm_mode": "local (llama-cpp)" if USE_LOCAL_LLM else f"ollama ({OLLAMA_MODEL})",
            "embed_mode": "local (sentence-transformers)" if USE_LOCAL_EMBED else f"ollama ({EMBED_MODEL})",
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002, reload=False)
