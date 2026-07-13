#!/usr/bin/env python3
"""
Exécuteur SQL sécurisé sur Supabase PostgreSQL pour HomePedia Chat.
Connexion read-only, pas de Text-to-SQL : on exécute uniquement les templates prédéfinis.
"""

import os
import logging
from typing import List, Dict, Any, Optional

import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import pool

logger = logging.getLogger(__name__)

# ── Config Supabase ──────────────────────────────────────────────────────────
PG_CONFIG = {
    "host":     os.getenv("POSTGRES_HOST",     "aws-0-eu-west-1.pooler.supabase.com"),
    "port":     int(os.getenv("POSTGRES_PORT", "5432")),
    "dbname":   os.getenv("POSTGRES_DB",       "postgres"),
    "user":     os.getenv("POSTGRES_USER",     "postgres.iugsfmvqddburvufzacy"),
    "password": os.getenv("POSTGRES_PASSWORD", ""),
    "sslmode":  "require",
    "connect_timeout": 10,
}

_pool: Optional[pool.SimpleConnectionPool] = None


def get_pool() -> pool.SimpleConnectionPool:
    global _pool
    if _pool is None:
        try:
            _pool = pool.SimpleConnectionPool(1, 5, **PG_CONFIG)
            logger.info("✅ Pool PostgreSQL initialisé")
        except Exception as e:
            logger.error(f"❌ Pool PostgreSQL échoué: {e}")
            raise
    return _pool


def execute_template(sql: str, params: Dict[str, Any]) -> List[Dict]:
    """
    Exécute un SQL template prédéfini avec les params extraits.
    Retourne une liste de dicts (RealDictCursor).
    """
    p = get_pool()
    conn = None
    try:
        conn = p.getconn()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Gestion spéciale : list Python → ANY(ARRAY[...])
            cleaned_params = {}
            for k, v in params.items():
                if isinstance(v, list):
                    cleaned_params[k] = v  # psycopg2 gère les listes nativement
                else:
                    cleaned_params[k] = v

            cur.execute(sql, cleaned_params)
            rows = cur.fetchall()
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"❌ Erreur SQL: {e}")
        return []
    finally:
        if conn:
            p.putconn(conn)


def format_for_display(rows: List[Dict]) -> str:
    """Formate les résultats en texte lisible pour le LLM."""
    if not rows:
        return "Aucune donnée disponible."
    lines = []
    for i, row in enumerate(rows, 1):
        parts = []
        for k, v in row.items():
            if v is None:
                continue
            label = k.replace("_", " ").capitalize()
            if "prix" in k or "loyer" in k:
                parts.append(f"{label}: {int(v):,}€".replace(",", " "))
            elif "pct" in k or "rendement" in k:
                parts.append(f"{label}: {v}%")
            elif isinstance(v, float):
                parts.append(f"{label}: {v:.1f}")
            else:
                parts.append(f"{label}: {v}")
        lines.append(f"{i}. {' | '.join(parts)}")
    return "\n".join(lines)


def health_check() -> bool:
    try:
        p = get_pool()
        conn = p.getconn()
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        p.putconn(conn)
        return True
    except Exception:
        return False
