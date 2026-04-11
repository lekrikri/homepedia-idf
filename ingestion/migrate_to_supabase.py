"""
migrate_to_supabase.py
Migre les données du PostgreSQL local (Docker port 5433) vers Supabase.

Usage :
    pip install psycopg2-binary python-dotenv
    python ingestion/migrate_to_supabase.py

Variables requises dans ingestion/.env :
    SUPABASE_HOST=db.xxxxxxxxxxxx.supabase.co
    SUPABASE_PASSWORD=ton_mot_de_passe_supabase
"""

import os
import sys
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv()

# ── Source : PostgreSQL local (Docker) ────────────────────────────────────────
SRC = dict(
    host="localhost", port=5433,
    dbname="homepedia", user="homepedia", password="homepedia"
)

# ── Destination : Supabase ────────────────────────────────────────────────────
DST = dict(
    host="aws-0-eu-west-1.pooler.supabase.com",
    port=5432,
    dbname="postgres",
    user="postgres.iugsfmvqddburvufzacy",
    password=os.getenv("SUPABASE_PASSWORD"),
    sslmode="require",
)

TABLES_ORDER = [
    "communes",
    "iris",
    "transactions",
    "batiments",
    "communes_agregat",
    "users",
    "favorites",
]

def get_row_count(cur, table):
    try:
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        return cur.fetchone()[0]
    except:
        return 0

def migrate_table(src_conn, dst_conn, table: str):
    src = src_conn.cursor()
    dst = dst_conn.cursor()

    # Compter les lignes source
    src.execute(f"SELECT COUNT(*) FROM {table}")
    total = src.fetchone()[0]
    if total == 0:
        print(f"  ⏭️  {table} : vide, ignoré")
        return

    print(f"  → {table} : {total:,} lignes en cours...")

    # Récupérer les noms de colonnes
    src.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table}' ORDER BY ordinal_position")
    columns = [r[0] for r in src.fetchall()]

    # Vider la table destination
    dst.execute(f"TRUNCATE TABLE {table} CASCADE")
    dst_conn.commit()

    # Copier par batch de 1000
    BATCH = 1000
    src.execute(f"SELECT {', '.join(columns)} FROM {table}")
    cols_str = ", ".join(columns)
    sql = f"INSERT INTO {table} ({cols_str}) VALUES %s ON CONFLICT DO NOTHING"

    count = 0
    while True:
        rows = src.fetchmany(BATCH)
        if not rows:
            break
        execute_values(dst, sql, rows, page_size=BATCH)
        dst_conn.commit()
        count += len(rows)
        print(f"    {count:,}/{total:,}", end="\r")

    print(f"  ✅ {table} : {count:,} lignes migrées")
    src.close()
    dst.close()


def apply_schema(dst_conn):
    """Applique le schéma PostgreSQL sur Supabase avant l'import des données."""
    schema_path = os.path.join(os.path.dirname(__file__), "../backend/db/init.sql")
    migration_path = os.path.join(os.path.dirname(__file__), "../backend/db/migrations/001_communes_agregat.sql")

    with open(schema_path) as f:
        schema_sql = f.read()
    with open(migration_path) as f:
        migration_sql = f.read()

    cur = dst_conn.cursor()
    try:
        cur.execute(schema_sql)
        dst_conn.commit()
        print("  ✅ Schéma init.sql appliqué")
    except Exception as e:
        dst_conn.rollback()
        print(f"  ⚠️  Schéma déjà présent ou erreur : {e}")

    try:
        cur.execute(migration_sql)
        dst_conn.commit()
        print("  ✅ Migration communes_agregat appliquée")
    except Exception as e:
        dst_conn.rollback()
        print(f"  ⚠️  Migration déjà présente ou erreur : {e}")
    cur.close()


def main():
    if not DST["host"] or not DST["password"]:
        print("❌ Variables manquantes dans ingestion/.env :")
        print("   SUPABASE_HOST=db.xxxxxxxxxxxx.supabase.co")
        print("   SUPABASE_PASSWORD=ton_mot_de_passe")
        sys.exit(1)

    print("🔌 Connexion source (PostgreSQL local)...")
    src_conn = psycopg2.connect(**SRC)
    print("✅ Source OK")

    print("🔌 Connexion destination (Supabase)...")
    dst_conn = psycopg2.connect(**DST)
    print("✅ Supabase OK\n")

    print("📋 Application du schéma sur Supabase...")
    apply_schema(dst_conn)

    print("\n📦 Migration des données...\n")
    for table in TABLES_ORDER:
        try:
            migrate_table(src_conn, dst_conn, table)
        except Exception as e:
            print(f"  ❌ {table} : erreur — {e}")
            dst_conn.rollback()

    src_conn.close()
    dst_conn.close()
    print("\n✅ Migration terminée !")


if __name__ == "__main__":
    main()
