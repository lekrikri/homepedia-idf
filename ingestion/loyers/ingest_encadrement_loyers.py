#!/usr/bin/env python3
"""Plafonds d'encadrement des loyers.

L'application signalait qu'une commune était soumise à l'encadrement sans pouvoir
dire si un loyer donné le respectait. Avec les loyers de référence majorés, elle
peut chiffrer le dépassement — un montant récupérable par le locataire, au besoin
devant la commission départementale de conciliation.

Le plafond dépend du quartier, du nombre de pièces, de l'époque de construction
et du caractère meublé. Il ne suffit donc pas d'une valeur par commune : la
table conserve ces quatre dimensions.

Source : opendata.paris.fr, dataset « logement-encadrement-des-loyers » (Paris).
Plaine Commune et Est Ensemble relèvent d'arrêtés préfectoraux distincts, non
encore publiés en open data sous ce format ; le script les accepte dès qu'une
source équivalente est ajoutée à SOURCES.

Usage :
    export SUPABASE_PASSWORD='...'
    python3 ingest_encadrement_loyers.py [--annee 2025]
"""
import argparse
import logging
import os
import sys
import time
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

SOURCES = [
    {
        "nom": "Paris",
        "url": "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/"
               "logement-encadrement-des-loyers/records",
        "code_commune": "75056",
    },
]
PAGE = 100


def mot_de_passe():
    mdp = os.environ.get("SUPABASE_PASSWORD") or os.environ.get("POSTGRES_PASSWORD")
    if not mdp:
        raise SystemExit(
            "SUPABASE_PASSWORD manquant. Exportez-le avant de lancer ce script :\n"
            "  export SUPABASE_PASSWORD='<mot de passe Supabase>'"
        )
    return mdp


def collecter(source, annee):
    lignes, offset = [], 0
    while True:
        r = requests.get(
            source["url"],
            params={
                "limit": PAGE,
                "offset": offset,
                "where": f'annee="{annee}"',
                "select": "annee,id_zone,id_quartier,nom_quartier,piece,epoque,"
                          "meuble_txt,ref,max,min,code_grand_quartier",
            },
            timeout=90,
        )
        if r.status_code == 400 and offset > 0:
            break  # plafond de pagination de l'API
        r.raise_for_status()
        data = r.json()
        lots = data.get("results", [])
        if not lots:
            break

        for x in lots:
            # Le loyer majoré est le plafond opposable ; c'est lui qui sert au
            # contrôle, la référence seule ne suffit pas.
            if x.get("max") is None or x.get("piece") is None:
                continue
            lignes.append((
                source["code_commune"],
                str(x.get("code_grand_quartier") or ""),
                (x.get("nom_quartier") or "").strip(),
                int(x["piece"]),
                (x.get("epoque") or "").strip(),
                # Le champ vaut « meublé » ou « non meublé » : on le ramène à un booléen.
                "non" not in (x.get("meuble_txt") or "").lower(),
                float(x["ref"]) if x.get("ref") is not None else None,
                float(x["max"]),
                float(x["min"]) if x.get("min") is not None else None,
                int(x["annee"]),
            ))

        offset += PAGE
        if offset >= data.get("total_count", 0):
            break
        time.sleep(0.05)
    return lignes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--annee", type=int, default=2025)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    toutes = []
    for source in SOURCES:
        log.info(f"Collecte {source['nom']} — millésime {args.annee}…")
        lignes = collecter(source, args.annee)
        log.info(f"  {len(lignes)} plafonds récupérés")
        toutes.extend(lignes)

    if not toutes:
        raise SystemExit("Aucun plafond récupéré : vérifier le millésime demandé.")

    quartiers = len({l[1] for l in toutes})
    plafonds = sorted(l[7] for l in toutes)
    log.info(
        f"Total {len(toutes)} plafonds sur {quartiers} quartiers | "
        f"loyer majoré de {plafonds[0]} à {plafonds[-1]} €/m²"
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
            cur.execute("""
                CREATE TABLE IF NOT EXISTS encadrement_loyers (
                    code_commune   VARCHAR(6)  NOT NULL,
                    code_quartier  VARCHAR(12) NOT NULL,
                    nom_quartier   VARCHAR(120),
                    nb_pieces      SMALLINT    NOT NULL,
                    epoque         VARCHAR(30) NOT NULL,
                    meuble         BOOLEAN     NOT NULL,
                    loyer_reference        NUMERIC(6,2),
                    loyer_reference_majore NUMERIC(6,2) NOT NULL,
                    loyer_reference_minore NUMERIC(6,2),
                    annee          SMALLINT    NOT NULL,
                    PRIMARY KEY (code_quartier, nb_pieces, epoque, meuble, annee)
                );
                CREATE INDEX IF NOT EXISTS idx_encadrement_commune
                    ON encadrement_loyers(code_commune, annee);
            """)
            execute_values(
                cur,
                """
                INSERT INTO encadrement_loyers
                    (code_commune, code_quartier, nom_quartier, nb_pieces, epoque, meuble,
                     loyer_reference, loyer_reference_majore, loyer_reference_minore, annee)
                VALUES %s
                ON CONFLICT (code_quartier, nb_pieces, epoque, meuble, annee) DO UPDATE SET
                    loyer_reference        = EXCLUDED.loyer_reference,
                    loyer_reference_majore = EXCLUDED.loyer_reference_majore,
                    loyer_reference_minore = EXCLUDED.loyer_reference_minore
                """,
                toutes,
                page_size=500,
            )
            conn.commit()

            cur.execute("""
                SELECT annee, count(*), count(DISTINCT code_quartier),
                       min(loyer_reference_majore), max(loyer_reference_majore)
                FROM encadrement_loyers GROUP BY annee ORDER BY annee
            """)
            for annee, n, q, mini, maxi in cur.fetchall():
                log.info(f"  {annee} : {n} plafonds, {q} quartiers, de {mini} à {maxi} €/m²")


if __name__ == "__main__":
    sys.exit(main())
