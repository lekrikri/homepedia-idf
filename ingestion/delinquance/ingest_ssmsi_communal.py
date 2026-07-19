#!/usr/bin/env python3
"""Sécurité par commune — base statistique communale du SSMSI.

Jusqu'ici, le score de sécurité provenait des données départementales : les 507
communes de Seine-et-Marne partageaient une seule et même valeur, ce qui rendait
l'indicateur inutilisable pour comparer deux communes. Le SSMSI publie désormais
les taux à la commune ; ce script les substitue aux valeurs départementales.

Source : data.gouv.fr — « Bases statistiques communale, départementale et
régionale de la délinquance enregistrée par la police et la gendarmerie »

Usage :
    export SUPABASE_PASSWORD='...'
    python3 ingest_ssmsi_communal.py [--annee 2025]
"""
import argparse
import logging
import os
import sys
from urllib.parse import quote_plus

import psycopg2
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
import requests
from psycopg2.extras import execute_values

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

DATASET = "621df2954fa5a3b5a023e23c"
CACHE = "/tmp/ssmsi_communal.parquet"
DEPTS_IDF = ("75", "77", "78", "91", "92", "93", "94", "95")

# Indicateurs retenus et poids dans le score, choisis pour ce qui pèse sur la
# décision d'habiter quelque part. Les atteintes aux véhicules et les stupéfiants
# sont écartés : très inégalement signalés d'une commune à l'autre, ils ajoutent
# du bruit plus qu'ils n'informent.
INDICATEURS = {
    "Cambriolages de logement": 0.35,
    "Violences physiques hors cadre familial": 0.25,
    "Vols violents sans arme": 0.20,
    "Vols sans violence contre des personnes": 0.10,
    "Destructions et dégradations volontaires": 0.10,
}

# Bornes hautes servant à normaliser, en pour mille. Fixées en absolu plutôt
# qu'en relatif à l'Île-de-France : une normalisation intra-régionale ferait
# passer une commune francilienne médiane pour sûre, alors qu'elle ne l'est pas
# nécessairement au regard du reste du pays.
BORNES = {
    "Cambriolages de logement": 20.0,
    "Violences physiques hors cadre familial": 15.0,
    "Vols violents sans arme": 8.0,
    "Vols sans violence contre des personnes": 40.0,
    "Destructions et dégradations volontaires": 25.0,
}


def mot_de_passe():
    mdp = os.environ.get("SUPABASE_PASSWORD") or os.environ.get("POSTGRES_PASSWORD")
    if not mdp:
        raise SystemExit(
            "SUPABASE_PASSWORD manquant. Exportez-le avant de lancer ce script :\n"
            "  export SUPABASE_PASSWORD='<mot de passe Supabase>'"
        )
    return mdp


def url_parquet():
    """Résout l'URL du parquet courant : le millésime change à chaque publication."""
    r = requests.get(
        f"https://www.data.gouv.fr/api/1/datasets/{DATASET}/", timeout=60
    )
    r.raise_for_status()
    for res in r.json().get("resources", []):
        if res.get("format") == "parquet" and "comm" in res.get("url", ""):
            return res["url"]
    raise SystemExit("Ressource parquet communale introuvable dans le dataset.")


def telecharger():
    if os.path.exists(CACHE) and os.path.getsize(CACHE) > 1_000_000:
        log.info(f"Parquet déjà en cache : {CACHE}")
        return CACHE
    url = url_parquet()
    log.info(f"Téléchargement {url[:100]}…")
    with requests.get(url, stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(CACHE, "wb") as f:
            for bloc in r.iter_content(1 << 20):
                f.write(bloc)
    log.info(f"Téléchargé : {os.path.getsize(CACHE) / 1e6:.1f} Mo")
    return CACHE


def charger(chemin, annee):
    table = pq.read_table(
        chemin,
        columns=["CODGEO_2026", "annee", "indicateur", "taux_pour_mille", "nombre", "insee_pop"],
    )

    # Millésime : le plus récent disponible si l'année demandée est absente.
    annees = sorted(pc.unique(table["annee"]).to_pylist())
    if annee not in annees:
        log.warning(f"Année {annee} absente ({annees[0]}–{annees[-1]}), repli sur {annees[-1]}")
        annee = annees[-1]
    log.info(f"Millésime retenu : {annee}")

    masque = pc.and_(
        pc.equal(table["annee"], annee),
        pc.is_in(table["indicateur"], value_set=pa.array(list(INDICATEURS))),
    )
    table = table.filter(masque)

    donnees = {}
    codes = table["CODGEO_2026"].to_pylist()
    inds = table["indicateur"].to_pylist()
    taux = table["taux_pour_mille"].to_pylist()
    pops = table["insee_pop"].to_pylist()

    for code, ind, tx, pop in zip(codes, inds, taux, pops):
        if not code or code[:2] not in DEPTS_IDF:
            continue
        # Les valeurs non diffusées (secret statistique sur petits effectifs)
        # arrivent en None : on les laisse de côté plutôt que de les lire comme 0,
        # ce qui ferait passer une commune pour exemplaire faute de données.
        if tx is None:
            continue
        entree = donnees.setdefault(code, {"taux": {}, "pop": pop})
        entree["taux"][ind] = float(tx)

    log.info(f"Communes IDF avec données : {len(donnees)}")
    return donnees, annee


def score(taux):
    """Score de sécurité sur 100, 100 étant l'absence d'atteintes constatées."""
    total, poids_utilises = 0.0, 0.0
    for ind, poids in INDICATEURS.items():
        if ind not in taux:
            continue
        part = min(taux[ind] / BORNES[ind], 1.0)
        total += (1 - part) * poids
        poids_utilises += poids
    if poids_utilises == 0:
        return None
    # Renormalisation : une commune dont un indicateur manque n'est pas pénalisée.
    return round((total / poids_utilises) * 100)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--annee", type=int, default=2025)
    ap.add_argument("--dry-run", action="store_true", help="n'écrit rien en base")
    args = ap.parse_args()

    donnees, annee = charger(telecharger(), args.annee)

    lignes = []
    for code, e in donnees.items():
        s = score(e["taux"])
        if s is None:
            continue
        lignes.append((
            code,
            e["taux"].get("Cambriolages de logement"),
            e["taux"].get("Violences physiques hors cadre familial"),
            e["taux"].get("Vols violents sans arme"),
            s,
            annee,
        ))

    log.info(f"Communes avec un score calculé : {len(lignes)}")
    if lignes:
        scores = sorted(l[4] for l in lignes)
        log.info(
            f"Score : min {scores[0]} | médiane {scores[len(scores)//2]} | max {scores[-1]} "
            f"| valeurs distinctes {len(set(scores))}"
        )

    if args.dry_run:
        log.info("Mode dry-run : aucune écriture.")
        return

    dsn = (
        f"postgresql://postgres.iugsfmvqddburvufzacy:{quote_plus(mot_de_passe())}"
        "@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require"
    )
    with psycopg2.connect(dsn, connect_timeout=30) as conn:
        with conn.cursor() as cur:
            # Les anciennes colonnes départementales sont conservées : elles
            # servent de point de comparaison et évitent une migration destructive.
            cur.execute("""
                ALTER TABLE communes_agregat
                    ADD COLUMN IF NOT EXISTS taux_cambriolages_commune  NUMERIC(8,3),
                    ADD COLUMN IF NOT EXISTS taux_violences_commune     NUMERIC(8,3),
                    ADD COLUMN IF NOT EXISTS taux_vols_violents_commune NUMERIC(8,3),
                    ADD COLUMN IF NOT EXISTS score_securite_commune     SMALLINT,
                    ADD COLUMN IF NOT EXISTS securite_millesime         SMALLINT
            """)
            execute_values(
                cur,
                """
                UPDATE communes_agregat AS c SET
                    taux_cambriolages_commune  = v.cambrio,
                    taux_violences_commune     = v.violences,
                    taux_vols_violents_commune = v.vols,
                    score_securite_commune     = v.score,
                    securite_millesime         = v.millesime
                FROM (VALUES %s) AS v(code, cambrio, violences, vols, score, millesime)
                WHERE TRIM(c.code_commune) = v.code
                """,
                lignes,
                template="(%s, %s::numeric, %s::numeric, %s::numeric, %s::smallint, %s::smallint)",
            )
            maj = cur.rowcount
            conn.commit()
            log.info(f"Communes mises à jour : {maj}")

            cur.execute("""
                SELECT count(score_securite_commune),
                       count(DISTINCT score_securite_commune),
                       min(score_securite_commune), max(score_securite_commune)
                FROM communes_agregat
            """)
            n, distincts, mini, maxi = cur.fetchone()
            log.info(f"En base : {n} communes, {distincts} scores distincts, de {mini} à {maxi}")
            if distincts and distincts < 20:
                log.warning("Peu de valeurs distinctes : vérifier la source.")


if __name__ == "__main__":
    sys.exit(main())
