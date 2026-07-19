#!/usr/bin/env python3
"""Taxe foncière par commune — REI (Recensement des Éléments d'Imposition).

L'application chiffrait le prix d'achat mais rien du coût de détention. Or la
taxe foncière varie du simple au double entre communes voisines : 30,7 % à
Aulnay-sous-Bois contre 42,5 % à Drancy sur la même assiette. Sur vingt ans, cet
écart pèse davantage que bien des différences de prix d'achat.

Source : data.ofgl.fr, dataset « rei » (format long : une ligne par variable
et par commune).

Variables utilisées :
    E11  base nette de foncier bâti, part communale
    E12  taux net voté par la commune
    E14  nombre d'articles (locaux imposés)
    E32  taux net intercommunal, quand l'EPCI en vote un
    E52  taux net de taxe spéciale d'équipement

Le montant annuel estimé pour un local moyen vaut :
    (base nette / nombre d'articles) × taux global

Usage :
    export SUPABASE_PASSWORD='...'
    python3 ingest_taxe_fonciere.py [--annee 2024] [--dry-run]
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

API = "https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/rei/records"
DEPTS_IDF = ["75", "77", "78", "91", "92", "93", "94", "95"]
VARIABLES = ["E11", "E12", "E14", "E32", "E52"]
PAGE = 100  # limite de l'API Opendatasoft


def mot_de_passe():
    mdp = os.environ.get("SUPABASE_PASSWORD") or os.environ.get("POSTGRES_PASSWORD")
    if not mdp:
        raise SystemExit(
            "SUPABASE_PASSWORD manquant. Exportez-le avant de lancer ce script :\n"
            "  export SUPABASE_PASSWORD='<mot de passe Supabase>'"
        )
    return mdp


def recuperer(var, dep, annee):
    """Pagine sur l'API pour une variable et un département."""
    sortie, offset = {}, 0
    while True:
        r = requests.get(
            API,
            params={
                "limit": PAGE,
                "offset": offset,
                "where": f'var="{var}" and dep="{dep}" and annee={annee}',
                "select": "idcom,valeur",
            },
            timeout=90,
        )
        if r.status_code == 400 and offset > 0:
            break  # au-delà du plafond de pagination
        r.raise_for_status()
        data = r.json()
        lots = data.get("results", [])
        for ligne in lots:
            code, val = ligne.get("idcom"), ligne.get("valeur")
            if code and val is not None:
                sortie[code] = float(val)
        offset += PAGE
        if offset >= data.get("total_count", 0) or not lots:
            break
        time.sleep(0.1)  # courtoisie envers l'API
    return sortie


def collecter(annee):
    par_var = {v: {} for v in VARIABLES}
    for dep in DEPTS_IDF:
        for var in VARIABLES:
            valeurs = recuperer(var, dep, annee)
            par_var[var].update(valeurs)
        log.info(f"  dépt {dep} : {len(recuperer('E12', dep, annee))} communes avec un taux")
    return par_var


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--annee", type=int, default=2024)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    log.info(f"Collecte REI {args.annee} sur l'Île-de-France…")
    par_var = collecter(args.annee)

    base = par_var["E11"]
    taux_com = par_var["E12"]
    articles = par_var["E14"]
    taux_epci = par_var["E32"]
    taux_tse = par_var["E52"]

    log.info(
        f"Collecté : {len(taux_com)} taux communaux, {len(base)} bases, "
        f"{len(taux_epci)} taux intercommunaux"
    )

    lignes = []
    for code, tc in taux_com.items():
        global_ = tc + taux_epci.get(code, 0.0) + taux_tse.get(code, 0.0)

        # Base moyenne par local imposé : seul moyen d'exprimer la taxe en euros
        # sans connaître la valeur locative du bien visé.
        b, n = base.get(code), articles.get(code)
        base_moy = (b / n) if b and n else None
        # La base nette est déjà la moitié de la valeur locative brute ;
        # le taux s'applique directement dessus.
        montant = round(base_moy * global_ / 100) if base_moy else None

        lignes.append((
            code,
            round(tc, 2),
            round(taux_epci.get(code, 0.0), 2) or None,
            round(global_, 2),
            round(base_moy) if base_moy else None,
            montant,
            args.annee,
        ))

    if lignes:
        taux = sorted(l[3] for l in lignes)
        montants = sorted(l[5] for l in lignes if l[5])
        log.info(
            f"Taux global : min {taux[0]} % | médiane {taux[len(taux)//2]} % | max {taux[-1]} %"
        )
        if montants:
            log.info(
                f"Taxe annuelle estimée par local : min {montants[0]} € | "
                f"médiane {montants[len(montants)//2]} € | max {montants[-1]} €"
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
                ALTER TABLE communes_agregat
                    ADD COLUMN IF NOT EXISTS taux_tf_commune       NUMERIC(6,2),
                    ADD COLUMN IF NOT EXISTS taux_tf_intercommunal NUMERIC(6,2),
                    ADD COLUMN IF NOT EXISTS taux_tf_global        NUMERIC(6,2),
                    ADD COLUMN IF NOT EXISTS base_tf_moyenne       INTEGER,
                    ADD COLUMN IF NOT EXISTS taxe_fonciere_estimee INTEGER,
                    ADD COLUMN IF NOT EXISTS tf_millesime          SMALLINT
            """)
            execute_values(
                cur,
                """
                UPDATE communes_agregat AS c SET
                    taux_tf_commune       = v.tc,
                    taux_tf_intercommunal = v.te,
                    taux_tf_global        = v.tg,
                    base_tf_moyenne       = v.base,
                    taxe_fonciere_estimee = v.montant,
                    tf_millesime          = v.millesime
                FROM (VALUES %s) AS v(code, tc, te, tg, base, montant, millesime)
                WHERE TRIM(c.code_commune) = v.code
                """,
                lignes,
                template="(%s, %s::numeric, %s::numeric, %s::numeric, %s::int, %s::int, %s::smallint)",
            )
            conn.commit()

            cur.execute("""
                SELECT count(taux_tf_global), count(DISTINCT taux_tf_global),
                       min(taux_tf_global), max(taux_tf_global),
                       count(taxe_fonciere_estimee)
                FROM communes_agregat
            """)
            n, distincts, mini, maxi, nb_montants = cur.fetchone()
            log.info(
                f"En base : {n} communes, {distincts} taux distincts, de {mini} % à {maxi} % "
                f"| {nb_montants} montants estimés"
            )


if __name__ == "__main__":
    sys.exit(main())
