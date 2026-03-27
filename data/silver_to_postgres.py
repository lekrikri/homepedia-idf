#!/usr/bin/env python3
"""
silver_to_postgres.py
─────────────────────
Charge les tables Silver depuis Azure ADLS → PostgreSQL local.

Sources Silver (homepediadatalake / container silver) :
  - insee_populations/  → table communes (1287 communes IDF)
  - dvf_transactions/   → table transactions (655k, chargées par batch)
  - dpe/               → colonne classe_energie dans transactions + stats communes

Usage :
  pip install azure-storage-blob pyarrow pandas psycopg2-binary
  python3 silver_to_postgres.py [--limit 50000]
"""

import io
import os
import sys
import logging
import argparse
import pandas as pd
import pyarrow.parquet as pq
import psycopg2
from psycopg2.extras import execute_values
from azure.storage.blob import ContainerClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Config ───────────────────────────────────────────────────────────────────
ADLS_ACCOUNT     = os.getenv("ADLS_ACCOUNT_NAME", "homepediadatalake")
ADLS_KEY         = os.getenv("ADLS_ACCOUNT_KEY", "")
SILVER_CONTAINER = "silver"

PG_DSN = os.getenv(
    "DATABASE_URL",
    "postgresql://homepedia:homepedia@localhost:5433/homepedia"
)

IDF_DEPTS = {"75", "77", "78", "91", "92", "93", "94", "95"}

# ── Helpers ADLS ─────────────────────────────────────────────────────────────
def adls_client(container: str) -> ContainerClient:
    url = f"https://{ADLS_ACCOUNT}.blob.core.windows.net"
    return ContainerClient(url, container_name=container, credential=ADLS_KEY)


def read_silver(client: ContainerClient, prefix: str) -> pd.DataFrame:
    """Lit tous les fichiers Parquet d'un dossier Silver (ignore _delta_log)."""
    blobs = [
        b.name for b in client.list_blobs(name_starts_with=prefix)
        if b.name.endswith(".parquet") and "_delta_log" not in b.name
    ]
    if not blobs:
        raise ValueError(f"Aucun Parquet trouvé dans container={SILVER_CONTAINER}/{prefix}")
    log.info(f"  {len(blobs)} fichier(s) Parquet dans '{prefix}'")

    frames = []
    for i, blob_name in enumerate(blobs, 1):
        log.info(f"  [{i}/{len(blobs)}] Téléchargement {blob_name.split('/')[-1]} ...")
        data = client.get_blob_client(blob_name).download_blob().readall()
        frames.append(pq.read_table(io.BytesIO(data)).to_pandas())

    df = pd.concat(frames, ignore_index=True)
    log.info(f"  → {len(df):,} lignes chargées")
    return df


# ── Loaders PostgreSQL ────────────────────────────────────────────────────────
def load_communes(conn, df_pop: pd.DataFrame) -> int:
    """Peuple la table communes depuis silver insee_populations."""
    log.info("Chargement → communes")

    df = df_pop[["code_commune", "city", "code_departement", "population_municipale"]].copy()
    df["code_commune"]     = df["code_commune"].astype(str).str.strip().str[:5]
    df["code_departement"] = df["code_departement"].astype(str).str.strip().str[:3]
    df = df[df["code_departement"].isin(IDF_DEPTS)]
    df = df.dropna(subset=["code_commune"]).drop_duplicates("code_commune")

    sql = """
        INSERT INTO communes (code_insee, nom, departement, population)
        VALUES %s
        ON CONFLICT (code_insee) DO UPDATE SET
            nom         = EXCLUDED.nom,
            departement = EXCLUDED.departement,
            population  = EXCLUDED.population
    """
    rows = [
        (
            r.code_commune,
            str(r.city) if pd.notna(r.city) else r.code_commune,
            r.code_departement,
            int(r.population_municipale) if pd.notna(r.population_municipale) else None,
        )
        for r in df.itertuples()
    ]
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()
    log.info(f"  ✅ {len(rows)} communes insérées/mises à jour")
    return len(rows)


def load_transactions(conn, df_dvf: pd.DataFrame, limit: int | None = None) -> int:
    """Peuple la table transactions depuis silver dvf_transactions."""
    log.info("Chargement → transactions")

    df = df_dvf.copy()
    df["code_commune"]     = df["code_commune"].astype(str).str.strip().str[:5]
    df["code_departement"] = df["code_departement"].astype(str).str.strip()
    df = df[df["code_departement"].isin(IDF_DEPTS)]
    df = df.drop_duplicates("id_mutation")

    # Filtrer uniquement les communes déjà chargées (FK constraint)
    with conn.cursor() as cur:
        cur.execute("SELECT code_insee FROM communes")
        communes_ok = {r[0] for r in cur.fetchall()}
    df = df[df["code_commune"].isin(communes_ok)]

    if limit:
        df = df.sort_values("date_mutation", ascending=False).head(limit)
        log.info(f"  → Limité à {limit:,} transactions (les plus récentes)")

    sql = """
        INSERT INTO transactions (
            id_mutation, date_mutation, nature_mutation, valeur_fonciere,
            commune, code_commune, type_local,
            surface_reelle_bati, surface_terrain, nombre_pieces,
            longitude, latitude, source_annee
        )
        VALUES %s
        ON CONFLICT (id_mutation, date_mutation, type_local) DO NOTHING
    """

    def _f(v, cast=None):
        if v is None or (not isinstance(v, str) and pd.isna(v)):
            return None
        return cast(v) if cast else v

    rows = [
        (
            str(r.id_mutation),
            r.date_mutation,
            "Vente",
            _f(r.price, float),
            _f(r.city, str),
            r.code_commune,
            _f(r.property_type, str),
            _f(r.building_area, float),
            _f(r.land_area, float) if hasattr(r, "land_area") else None,
            _f(r.rooms_count, int)  if hasattr(r, "rooms_count") else None,
            _f(r.longitude, float),
            _f(r.latitude, float),
            int(r.annee),
        )
        for r in df.itertuples()
    ]

    BATCH = 5_000
    inserted = 0
    with conn.cursor() as cur:
        for i in range(0, len(rows), BATCH):
            execute_values(cur, sql, rows[i : i + BATCH])
            inserted += len(rows[i : i + BATCH])
            log.info(f"  → {inserted:,}/{len(rows):,} lignes traitées...")
    conn.commit()
    log.info(f"  ✅ {len(rows):,} transactions insérées (doublons ignorés)")
    return len(rows)


def update_classe_energie(conn, df_dpe: pd.DataFrame) -> int:
    """Met à jour classe_energie dans transactions depuis silver DPE (jointure lat/lon approx)."""
    log.info("Mise à jour → classe_energie (DPE)")

    # Agrégation DPE : étiquette médiane par commune + type_batiment → classe_energie
    df = df_dpe[["code_commune", "property_type", "etiquette_dpe"]].copy()
    df["code_commune"] = df["code_commune"].astype(str).str.strip().str[:5]
    # Score num pour calculer la médiane
    dpe_order = {"A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "F": 6, "G": 7}
    inv_dpe   = {v: k for k, v in dpe_order.items()}
    df["score"] = df["etiquette_dpe"].map(dpe_order)
    df_agg = (
        df.groupby(["code_commune", "property_type"])["score"]
        .median()
        .round()
        .astype(int)
        .reset_index()
    )
    df_agg["classe_energie"] = df_agg["score"].map(inv_dpe)

    # Map property_type DPE → type_local transactions
    type_map = {"appartement": "Appartement", "maison": "Maison"}
    df_agg["type_local"] = df_agg["property_type"].str.lower().map(type_map)
    df_agg = df_agg.dropna(subset=["type_local"])

    updated = 0
    with conn.cursor() as cur:
        for r in df_agg.itertuples():
            cur.execute(
                """UPDATE transactions SET classe_energie = %s
                   WHERE code_commune = %s AND type_local = %s
                     AND classe_energie IS NULL""",
                (r.classe_energie, r.code_commune, r.type_local),
            )
            updated += cur.rowcount
    conn.commit()
    log.info(f"  ✅ {updated:,} transactions mise à jour avec classe_energie")
    return updated


def print_summary(conn):
    """Affiche un résumé des données chargées."""
    log.info("\n── Résumé Gold local ──────────────────────────────────────────")
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM communes")
        log.info(f"  communes         : {cur.fetchone()[0]:>8,}")

        cur.execute("SELECT COUNT(*) FROM transactions")
        log.info(f"  transactions     : {cur.fetchone()[0]:>8,}")

        cur.execute("""
            SELECT c.nom, COUNT(t.id) AS nb,
                   ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP
                         (ORDER BY t.valeur_fonciere / NULLIF(t.surface_reelle_bati,0))::numeric)
            FROM communes c
            JOIN transactions t ON t.code_commune = c.code_insee
            WHERE t.surface_reelle_bati > 0 AND t.valeur_fonciere > 0
            GROUP BY c.nom ORDER BY nb DESC LIMIT 5
        """)
        log.info("  Top 5 communes par nb transactions :")
        for nom, nb, prix in cur.fetchall():
            log.info(f"    {nom:<25} {nb:>6,} ventes  {int(prix or 0):>7,} €/m²")
    log.info("────────────────────────────────────────────────────────────────")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Silver ADLS → PostgreSQL local")
    parser.add_argument(
        "--limit", type=int, default=50_000,
        help="Nb max de transactions à charger (défaut: 50 000, 0 = tout)"
    )
    parser.add_argument("--skip-dpe", action="store_true", help="Ne pas charger le DPE")
    args = parser.parse_args()

    limit = args.limit if args.limit > 0 else None

    log.info("═══ Silver → PostgreSQL ═══════════════════════════════════════")
    log.info(f"  ADLS   : {ADLS_ACCOUNT} / {SILVER_CONTAINER}")
    log.info(f"  PG DSN : {PG_DSN.split('@')[-1]}")
    log.info(f"  Limit  : {limit:,} transactions" if limit else "  Limit  : toutes")

    client = adls_client(SILVER_CONTAINER)
    conn   = psycopg2.connect(PG_DSN)

    try:
        # 1. Communes (INSEE populations)
        log.info("\n[1/3] INSEE populations → communes")
        df_pop = read_silver(client, "insee_populations/")
        load_communes(conn, df_pop)

        # 2. Transactions DVF
        log.info("\n[2/3] DVF transactions → transactions")
        df_dvf = read_silver(client, "dvf_transactions/")
        load_transactions(conn, df_dvf, limit=limit)

        # 3. DPE → classe_energie
        if not args.skip_dpe:
            log.info("\n[3/3] DPE → classe_energie")
            df_dpe = read_silver(client, "dpe/")
            update_classe_energie(conn, df_dpe)
        else:
            log.info("\n[3/3] DPE → skippé")

        # Résumé
        print_summary(conn)
        log.info("\n✅ Import terminé !")

    except Exception as e:
        conn.rollback()
        log.error(f"Erreur : {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
