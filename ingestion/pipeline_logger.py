"""
ingestion/pipeline_logger.py
============================
Crée la table pipeline_runs si elle n'existe pas, puis insert/update
un enregistrement de run. Utilisé par entrypoint.sh.

Usage :
    python3 ingestion/pipeline_logger.py start  --annee 2025
    python3 ingestion/pipeline_logger.py finish --id 42 --status success \
        --duration 340 --nb-communes 1253 --nb-transactions 332000 \
        --steps '{"gold":12,"transactions":280,"enrichments":40,"scores":8}'
    python3 ingestion/pipeline_logger.py finish --id 42 --status error \
        --error "dbt run failed"
"""

import os, sys, json, argparse
import psycopg2

PG_HOST     = os.getenv("POSTGRES_HOST", "aws-0-eu-west-1.pooler.supabase.com")
PG_PORT     = int(os.getenv("POSTGRES_PORT", 5432))
PG_DB       = os.getenv("POSTGRES_DB", "postgres")
PG_USER     = os.getenv("POSTGRES_USER", "postgres")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "")

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id                      SERIAL PRIMARY KEY,
    job_name                TEXT NOT NULL DEFAULT 'homepedia-pipeline',
    execution_id            TEXT,
    started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at             TIMESTAMPTZ,
    annee                   INTEGER,
    status                  TEXT NOT NULL DEFAULT 'running',
    duration_s              INTEGER,
    nb_communes_exported    INTEGER,
    nb_transactions_exported INTEGER,
    steps_duration          JSONB,
    error_message           TEXT
);
"""

def connect():
    return psycopg2.connect(
        host=PG_HOST, port=PG_PORT, dbname=PG_DB,
        user=PG_USER, password=PG_PASSWORD,
        sslmode="require", options="-c statement_timeout=10000"
    )

def cmd_start(annee, execution_id):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute(CREATE_TABLE)
        cur.execute(
            """INSERT INTO pipeline_runs (job_name, execution_id, annee, status)
               VALUES ('homepedia-pipeline', %s, %s, 'running')
               RETURNING id""",
            (execution_id, annee)
        )
        run_id = cur.fetchone()[0]
    conn.commit()
    conn.close()
    print(run_id)  # stdout → capturé par entrypoint.sh

def cmd_finish(run_id, status, duration, nb_communes, nb_transactions, steps, error):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE pipeline_runs SET
                status                   = %s,
                finished_at              = NOW(),
                duration_s               = %s,
                nb_communes_exported     = %s,
                nb_transactions_exported = %s,
                steps_duration           = %s,
                error_message            = %s
               WHERE id = %s""",
            (status, duration, nb_communes, nb_transactions,
             json.dumps(steps) if steps else None, error, run_id)
        )
    conn.commit()
    conn.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd")

    s = sub.add_parser("start")
    s.add_argument("--annee", type=int, default=2025)
    s.add_argument("--execution-id", default="")

    f = sub.add_parser("finish")
    f.add_argument("--id", type=int, required=True)
    f.add_argument("--status", choices=["success","error"], required=True)
    f.add_argument("--duration", type=int, default=0)
    f.add_argument("--nb-communes", type=int, default=0)
    f.add_argument("--nb-transactions", type=int, default=0)
    f.add_argument("--steps", default=None)
    f.add_argument("--error", default=None)

    args = parser.parse_args()
    if args.cmd == "start":
        cmd_start(args.annee, args.execution_id)
    elif args.cmd == "finish":
        steps = json.loads(args.steps) if args.steps else None
        cmd_finish(args.id, args.status, args.duration,
                   args.nb_communes, args.nb_transactions, steps, args.error)
    else:
        parser.print_help()
        sys.exit(1)
