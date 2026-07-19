#!/usr/bin/env python3
"""
ingest_dpe_transactions.py
==========================
Enrichit transactions.classe_energie depuis l'API ADEME DPE.

Stratégie : pour chaque commune IDF, calcule la classe DPE modale
(la plus fréquente) par tranche de surface (±20m²), puis met à jour
les transactions correspondantes.

Usage:
    python3 ingest_dpe_transactions.py
    python3 ingest_dpe_transactions.py --dept 94   # test sur un département
    python3 ingest_dpe_transactions.py --dry-run   # simulation sans UPDATE
"""
import argparse
import time
import requests
import psycopg2
from psycopg2.extras import execute_values
from collections import defaultdict, Counter
import os
from urllib.parse import quote_plus

# Mot de passe Supabase : jamais en dur, ce dépôt est public.
_MDP = os.environ.get("SUPABASE_PASSWORD") or os.environ.get("POSTGRES_PASSWORD")
if not _MDP:
    raise SystemExit(
        "SUPABASE_PASSWORD manquant. Exportez-le avant de lancer ce script :\n"
        "  export SUPABASE_PASSWORD='<mot de passe Supabase>'"
    )
_MDP_URL = quote_plus(_MDP)

DB_URL = os.getenv(
    "DATABASE_URL",
    f"postgresql://postgres.iugsfmvqddburvufzacy:{_MDP_URL}@"
    "aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require"
)

DPE_API = "https://data.ademe.fr/data-fair/api/v1/datasets/meg-83tjwtg8dyz4vv7h1dqe/lines"
# IDF = code_region_ban 11  (requests encode : → %3A automatiquement)
IDF_REGION_FILTER = "code_region_ban:11"
VALID_CLASSES = {"A", "B", "C", "D", "E", "F", "G"}
BATCH_SIZE = 10000
DELAY_S = 0.2


def fetch_dpe_idf() -> dict:
    """
    Retourne {code_commune: {surface_bucket: Counter({classe: count})}}
    Télécharge tous les DPE d'Île-de-France (région 11) en un seul passage paginé.
    """
    print(f"  📥 DPE Île-de-France (region=11)...")
    result = defaultdict(lambda: defaultdict(Counter))
    page = 0
    total_fetched = 0

    # URL initiale — requests encode : en %3A automatiquement dans qs
    first_url = (
        f"{DPE_API}?size={BATCH_SIZE}"
        f"&select=etiquette_dpe,surface_habitable_logement,code_insee_ban"
        f"&qs={IDF_REGION_FILTER.replace(':', '%3A')}"
    )
    next_url = first_url

    while next_url:
        try:
            # Utiliser l'URL directement (évite le double encodage du paramètre after)
            r = requests.get(next_url, timeout=60, headers={"Accept": "application/json"})
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            print(f"    ⚠️ Erreur page {page}: {e} — retry dans 3s")
            time.sleep(3)
            continue

        rows = data.get("results", [])
        if not rows:
            break

        for row in rows:
            classe = row.get("etiquette_dpe", "").strip().upper()
            if classe not in VALID_CLASSES:
                continue
            code = (row.get("code_insee_ban") or "").strip().zfill(5)
            if not code or len(code) != 5:
                continue
            surf_raw = row.get("surface_habitable_logement")
            try:
                surf = int(float(surf_raw) / 10) * 10  # arrondi à 10m²
                surf = max(10, min(surf, 500))
            except (TypeError, ValueError):
                surf = 0

            result[code][surf][classe] += 1

        total_fetched += len(rows)
        page += 1

        # L'API data.fair renvoie l'URL complète suivante dans "next"
        next_url = data.get("next") or ""

        if page % 10 == 0:
            print(f"    ... page {page}, {total_fetched:,} DPE récupérés ({len(result)} communes)")
        time.sleep(DELAY_S)

    print(f"    ✅ {total_fetched:,} DPE IDF, {len(result)} communes")
    return result


def build_commune_surface_map(dpe_data: dict) -> dict:
    """
    Construit {code_commune: {surface_bucket: classe_modale}}
    Et aussi {code_commune: classe_modale_globale} en fallback
    """
    commune_surf = {}
    commune_global = {}

    for code, surf_map in dpe_data.items():
        # Classe modale par tranche surface
        surf_classe = {}
        global_counter = Counter()
        for surf, counter in surf_map.items():
            modal = counter.most_common(1)[0][0]
            surf_classe[surf] = modal
            for cls, cnt in counter.items():
                global_counter[cls] += cnt
        commune_surf[code] = surf_classe
        commune_global[code] = global_counter.most_common(1)[0][0]

    return commune_surf, commune_global


def update_transactions(conn, commune_surf: dict, commune_global: dict, dry_run: bool):
    """Met à jour transactions.classe_energie depuis les données DPE."""
    cur = conn.cursor()

    # Récupérer toutes les transactions sans DPE
    print("  🔍 Chargement des transactions sans classe_energie...")
    cur.execute("""
        SELECT id, code_commune, surface_reelle_bati
        FROM transactions
        WHERE classe_energie IS NULL
          AND code_commune IS NOT NULL
        ORDER BY code_commune
    """)
    rows = cur.fetchall()
    print(f"  → {len(rows):,} transactions à enrichir")

    updates = []
    not_found = 0

    for tx_id, code_commune, surface in rows:
        code = (code_commune or "").strip().zfill(5)
        if code not in commune_global:
            not_found += 1
            continue

        # Trouver la classe : d'abord par tranche surface, sinon globale
        classe = None
        if surface is not None:
            surf_bucket = int(float(surface) / 10) * 10
            surf_bucket = max(10, min(surf_bucket, 500))
            surf_map = commune_surf.get(code, {})
            # Chercher dans ±10m²
            for delta in [0, 10, -10, 20, -20, 30, -30]:
                if surf_bucket + delta in surf_map:
                    classe = surf_map[surf_bucket + delta]
                    break

        if not classe:
            classe = commune_global.get(code)

        if classe:
            updates.append((classe, tx_id))

    print(f"  → {len(updates):,} transactions à mettre à jour ({not_found:,} communes sans DPE ADEME)")

    if dry_run:
        print("  🧪 DRY RUN — pas de modifications en base")
        return len(updates)

    # UPDATE par batch de 5000
    CHUNK = 5000
    total_updated = 0
    for i in range(0, len(updates), CHUNK):
        chunk = updates[i:i+CHUNK]
        execute_values(cur, """
            UPDATE transactions AS t
            SET classe_energie = v.classe
            FROM (VALUES %s) AS v(classe, id)
            WHERE t.id = v.id
        """, chunk, template="(%s, %s)")
        conn.commit()
        total_updated += len(chunk)
        print(f"  ✅ {total_updated:,}/{len(updates):,} mises à jour")

    return total_updated


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Simulation sans UPDATE")
    args = parser.parse_args()

    print("🏠 Ingestion DPE ADEME → transactions.classe_energie")
    print(f"   Périmètre : Île-de-France (code_region_ban=11)")
    print(f"   Mode : {'DRY RUN' if args.dry_run else 'ÉCRITURE'}\n")

    # 1. Téléchargement DPE depuis ADEME (toute l'IDF d'un coup)
    all_dpe = fetch_dpe_idf()
    print(f"\n📊 Total : {len(all_dpe)} communes IDF avec données DPE ADEME")

    # 2. Construire la map commune → classe modale
    commune_surf, commune_global = build_commune_surface_map(all_dpe)

    # Aperçu distribution
    from collections import Counter as C2
    dist = C2(commune_global.values())
    print(f"   Distribution classes modales communes : {dict(dist.most_common())}")

    # 3. Connexion DB et UPDATE
    print("\n🔗 Connexion Supabase...")
    conn = psycopg2.connect(DB_URL)
    print("  ✅ Connecté")

    total = update_transactions(conn, commune_surf, commune_global, args.dry_run)

    # 4. Vérification post-UPDATE
    if not args.dry_run:
        cur = conn.cursor()
        cur.execute("SELECT classe_energie, COUNT(*) FROM transactions WHERE classe_energie IS NOT NULL GROUP BY classe_energie ORDER BY classe_energie")
        print("\n📈 Distribution DPE dans transactions après UPDATE :")
        for row in cur.fetchall():
            print(f"   {row[0]} : {row[1]:,}")

    conn.close()
    print(f"\n✅ Terminé — {total:,} transactions enrichies")


if __name__ == "__main__":
    main()
