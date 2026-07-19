#!/usr/bin/env python3
"""Santé du parc en copropriété — Registre national d'immatriculation (ANAH).

Acheter en copropriété engage bien au-delà du lot : une copropriété fragile, ce
sont des charges qui dérivent, des travaux votés en urgence et une revente
difficile. Le registre national recense les copropriétés immatriculées, dont
celles bénéficiant d'aides publiques ou placées en plan de sauvegarde — les
deux marqueurs publics de difficulté.

Le fichier national pèse 450 Mo ; il est lu en flux et agrégé à la commune, sans
jamais être chargé en mémoire ni stocké.

Source : data.gouv.fr — Registre national d'Immatriculation des Copropriétés

Usage :
    export SUPABASE_PASSWORD='...'
    python3 ingest_rnc.py [--dry-run]
"""
import argparse
import codecs
import csv
import logging
import os
import sys
from collections import defaultdict
from urllib.parse import quote_plus

import psycopg2
import requests
from psycopg2.extras import execute_values

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

DATASET = "62da71c068871f4c54258c7c"
DEPTS_IDF = ("75", "77", "78", "91", "92", "93", "94", "95")


def mot_de_passe():
    mdp = os.environ.get("SUPABASE_PASSWORD") or os.environ.get("POSTGRES_PASSWORD")
    if not mdp:
        raise SystemExit(
            "SUPABASE_PASSWORD manquant. Exportez-le avant de lancer ce script :\n"
            "  export SUPABASE_PASSWORD='<mot de passe Supabase>'"
        )
    return mdp


def url_csv():
    """Le millésime change chaque trimestre : on résout la ressource courante."""
    r = requests.get(f"https://www.data.gouv.fr/api/1/datasets/{DATASET}/", timeout=60)
    r.raise_for_status()
    candidates = [
        res for res in r.json().get("resources", [])
        if res.get("format") == "csv" and "rnc-data-gouv" in res.get("url", "")
    ]
    if not candidates:
        raise SystemExit("Ressource CSV du registre introuvable.")
    return candidates[0]["url"]


def entier(valeur):
    try:
        return int(float(valeur))
    except (TypeError, ValueError):
        return None


def vrai(valeur):
    return (valeur or "").strip().lower() in ("oui", "true", "1", "o")


def agreger():
    """Parcourt le CSV en flux et agrège les copropriétés par commune IDF."""
    url = url_csv()
    log.info(f"Lecture en flux : {url[:95]}…")

    stats = defaultdict(lambda: {
        "nb": 0, "lots_hab": 0, "lots_total": 0,
        "aidees": 0, "sauvegarde": 0, "syndic_benevole": 0,
        "avant_1949": 0, "periodes": defaultdict(int),
    })
    lues = 0

    with requests.get(url, stream=True, timeout=1800) as r:
        r.raise_for_status()
        flux = codecs.iterdecode(r.iter_lines(decode_unicode=False), "utf-8", errors="replace")
        lecteur = csv.DictReader(flux)

        for ligne in lecteur:
            lues += 1
            if lues % 200_000 == 0:
                log.info(f"  {lues:,} lignes lues, {len(stats)} communes IDF")

            code = (ligne.get("code_officiel_commune") or "").strip()
            if len(code) != 5 or code[:2] not in DEPTS_IDF:
                continue

            s = stats[code]
            s["nb"] += 1

            lots_hab = entier(ligne.get("nombre_de_lots_a_usage_d_habitation"))
            lots_tot = entier(ligne.get("nombre_total_de_lots"))
            if lots_hab:
                s["lots_hab"] += lots_hab
            if lots_tot:
                s["lots_total"] += lots_tot

            if vrai(ligne.get("copro_aidee")):
                s["aidees"] += 1
            if vrai(ligne.get("copro_dans_pdp")):
                s["sauvegarde"] += 1

            syndic = (ligne.get("type_de_syndic_benevole_professionnel_non_connu") or "").lower()
            if "bénévole" in syndic or "benevole" in syndic:
                s["syndic_benevole"] += 1

            periode = (ligne.get("periode_de_construction") or "").strip()
            if periode:
                s["periodes"][periode] += 1
                # Le bâti d'avant 1949 concentre les enjeux de rénovation
                # énergétique et de gros travaux structurels.
                if "avant 1949" in periode.lower() or periode.startswith("A"):
                    s["avant_1949"] += 1

    log.info(f"Terminé : {lues:,} lignes lues, {len(stats)} communes IDF")
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    stats = agreger()
    if not stats:
        raise SystemExit("Aucune copropriété IDF trouvée : vérifier le format source.")

    lignes = []
    for code, s in stats.items():
        nb = s["nb"]
        periode_dom = max(s["periodes"], key=s["periodes"].get) if s["periodes"] else None
        lignes.append((
            code,
            nb,
            s["lots_hab"] or None,
            round(s["lots_total"] / nb, 1) if nb else None,
            round(s["aidees"] / nb * 100, 2),
            round(s["sauvegarde"] / nb * 100, 2),
            round(s["syndic_benevole"] / nb * 100, 2),
            round(s["avant_1949"] / nb * 100, 2),
            periode_dom,
        ))

    total = sum(s["nb"] for s in stats.values())
    aidees = sum(s["aidees"] for s in stats.values())
    log.info(
        f"{total:,} copropriétés IDF | {aidees:,} aidées "
        f"({aidees / total * 100:.1f} %) | {len(lignes)} communes"
    )

    if args.dry_run:
        pires = sorted(lignes, key=lambda l: -l[4])[:5]
        log.info("Communes avec le plus de copropriétés aidées :")
        for l in pires:
            log.info(f"    {l[0]} : {l[4]} % sur {l[1]} copropriétés")
        log.info("Mode dry-run : aucune écriture.")
        return

    dsn = (
        f"postgresql://postgres.iugsfmvqddburvufzacy:{quote_plus(mot_de_passe())}"
        "@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require"
    )
    with psycopg2.connect(dsn, connect_timeout=30) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                ALTER TABLE communes_agregat
                    ADD COLUMN IF NOT EXISTS nb_coproprietes        INTEGER,
                    ADD COLUMN IF NOT EXISTS nb_lots_habitation     INTEGER,
                    ADD COLUMN IF NOT EXISTS taille_copro_moyenne   NUMERIC(7,1),
                    ADD COLUMN IF NOT EXISTS pct_copro_aidee        NUMERIC(5,2),
                    ADD COLUMN IF NOT EXISTS pct_copro_sauvegarde   NUMERIC(5,2),
                    ADD COLUMN IF NOT EXISTS pct_syndic_benevole    NUMERIC(5,2),
                    ADD COLUMN IF NOT EXISTS pct_copro_avant_1949   NUMERIC(5,2),
                    ADD COLUMN IF NOT EXISTS periode_construction_dominante VARCHAR(40)
            """)
            execute_values(
                cur,
                """
                UPDATE communes_agregat AS c SET
                    nb_coproprietes      = v.nb,
                    nb_lots_habitation   = v.lots,
                    taille_copro_moyenne = v.taille,
                    pct_copro_aidee      = v.aidee,
                    pct_copro_sauvegarde = v.sauvegarde,
                    pct_syndic_benevole  = v.benevole,
                    pct_copro_avant_1949 = v.ancien,
                    periode_construction_dominante = v.periode
                FROM (VALUES %s) AS v(code, nb, lots, taille, aidee, sauvegarde, benevole, ancien, periode)
                WHERE TRIM(c.code_commune) = v.code
                """,
                lignes,
                template="(%s, %s::int, %s::int, %s::numeric, %s::numeric, %s::numeric, "
                         "%s::numeric, %s::numeric, %s)",
                page_size=300,
            )
            conn.commit()

            cur.execute("""
                SELECT count(nb_coproprietes), sum(nb_coproprietes),
                       round(avg(pct_copro_aidee), 2), max(pct_copro_aidee)
                FROM communes_agregat
            """)
            n, total_copro, moy_aidee, max_aidee = cur.fetchone()
            log.info(
                f"En base : {n} communes, {total_copro:,} copropriétés | "
                f"aidées : {moy_aidee} % en moyenne, {max_aidee} % au maximum"
            )


if __name__ == "__main__":
    sys.exit(main())
