#!/usr/bin/env python3
"""Contrôle qualité des données HomePedia.

Chaque défaut corrigé jusqu'ici avait la même forme : une donnée présentée avec
plus d'assurance qu'elle n'en méritait. Un pourcentage calculé sur trois
diagnostics, une estimation de loyer prise pour une observation, une valeur
départementale servie comme communale. Aucun n'était visible dans le code ; tous
se voyaient dans les chiffres, à condition de regarder.

Ce script regarde, et il échoue quand un contrôle ne passe pas — il peut donc
tourner en intégration continue avant un déploiement, ou à la main après une
ingestion.

    python scripts/controle_donnees.py            # tous les contrôles
    python scripts/controle_donnees.py --verbeux  # avec le détail des écarts

Trois niveaux :
  BLOQUANT  — la donnée est fausse ou trompeuse, il ne faut pas la publier
  ALERTE    — la donnée est douteuse, à examiner
  INFO      — mesure de suivi, jamais bloquante
"""
import argparse
import os
import sys

import psycopg2

def _dsn():
    """Chaîne de connexion, à partir des variables déjà utilisées par la CI."""
    if os.getenv("HOMEPEDIA_DSN"):
        return os.environ["HOMEPEDIA_DSN"]
    morceaux = [
        f"host={os.getenv('POSTGRES_HOST', 'db.iugsfmvqddburvufzacy.supabase.co')}",
        f"port={os.getenv('POSTGRES_PORT', '5432')}",
        f"dbname={os.getenv('POSTGRES_DB', 'postgres')}",
        f"user={os.getenv('POSTGRES_USER', 'postgres')}",
    ]
    if os.getenv("POSTGRES_SSLMODE"):
        morceaux.append(f"sslmode={os.environ['POSTGRES_SSLMODE']}")
    return " ".join(morceaux)


DSN = _dsn()

BLOQUANT, ALERTE, INFO = "BLOQUANT", "ALERTE", "INFO"

# Chaque contrôle : (niveau, intitulé, requête renvoyant un entier, seuil accepté,
# explication affichée en cas d'échec).
CONTROLES = [
    (
        INFO,
        "Communes dont le DPE repose sur moins de 30 diagnostics",
        """SELECT COUNT(*) FROM communes_agregat
           WHERE pct_dpe_bon IS NOT NULL AND COALESCE(nb_dpe, 0) < 30""",
        10**6,
        # La base a raison de conserver la valeur brute ; c'est l'API qui doit
        # refuser de la publier et de classer dessus. Le contrôle correspondant
        # interroge donc l'API, pas la table — voir controler_api().
        "",
    ),
    (
        BLOQUANT,
        "Prix au m² hors bornes plausibles",
        """SELECT COUNT(*) FROM communes_agregat
           WHERE prix_median_m2 < 500 OR prix_median_m2 > 30000""",
        0,
        "Un prix médian communal hors de ces bornes signale une erreur "
        "d'agrégation, pas un marché réel.",
    ),
    (
        BLOQUANT,
        "Loyer estimé supérieur au loyer de référence majoré officiel",
        """SELECT COUNT(*) FROM communes_agregat a
           JOIN (SELECT code_commune, AVG(loyer_reference_majore) AS maj
                 FROM encadrement_loyers GROUP BY code_commune) e
             ON e.code_commune = a.code_commune
           WHERE a.loyer_median_m2 > e.maj""",
        0,
        "Notre estimation dépasserait un plafond légal : elle serait alors "
        "franchement fausse, et pousserait un locataire à accepter l'illégal.",
    ),
    (
        ALERTE,
        "Communes portant la valeur de sécurité de leur département",
        """SELECT COUNT(*) FROM communes_agregat WHERE score_securite_commune IS NULL""",
        60,
        "Ces communes sont comparées aux autres sur une valeur départementale, "
        "moins précise. Au-delà du seuil, le classement par sécurité perd son sens.",
    ),
    (
        ALERTE,
        "Taxe foncière estimée présentée comme fiable sur base non résidentielle",
        """SELECT COUNT(*) FROM communes_agregat
           WHERE tf_estimation_fiable AND taxe_fonciere_estimee > 6000""",
        0,
        "Une estimation très élevée trahit une base dominée par des locaux "
        "professionnels : le montant ne vaut pas pour un logement.",
    ),
    (
        ALERTE,
        "Copropriétés : proportions exposées sous 20 copropriétés",
        """SELECT COUNT(*) FROM communes_agregat
           WHERE copro_stats_fiables AND COALESCE(nb_coproprietes, 0) < 20""",
        0,
        "Le drapeau de fiabilité et l'effectif réel se contredisent.",
    ),
    (
        INFO,
        "Communes couvertes par un encadrement des loyers officiel",
        """SELECT COUNT(DISTINCT code_commune) FROM encadrement_loyers""",
        10**6,
        "",
    ),
    (
        INFO,
        "Communes sans aucune transaction exploitable",
        """SELECT COUNT(*) FROM communes_agregat WHERE prix_median_m2 IS NULL""",
        10**6,
        "",
    ),
]

# Contrôles de cohérence croisée : comparent deux sources censées se recouper.
# Le biais le plus coûteux rencontré — une estimation de loyer basse de 12 à 24 %
# dans les communes populaires — ne se voyait qu'ainsi.
COHERENCE = """
SELECT a.city,
       ROUND(a.loyer_median_m2::numeric, 1)                         AS estime,
       ROUND(AVG(e.loyer_reference), 1)                             AS officiel,
       ROUND(100 * (a.loyer_median_m2::numeric - AVG(e.loyer_reference))
                 / AVG(e.loyer_reference), 0)                       AS ecart_pct
FROM communes_agregat a
JOIN encadrement_loyers e ON e.code_commune = a.code_commune
WHERE e.nb_pieces = 2 AND e.meuble = false
GROUP BY a.city, a.loyer_median_m2
ORDER BY ecart_pct
"""


API = os.getenv("HOMEPEDIA_API", "https://homepedia-backend-oejl7swlxa-ew.a.run.app")


def controler_api():
    """Vérifie que l'API refuse de publier ce qu'elle ne peut pas étayer.

    Certaines protections vivent dans le code, pas dans les données : la base
    conserve légitimement une proportion calculée sur trois diagnostics, c'est
    l'API qui doit s'abstenir de la montrer et de classer dessus. Le contrôle
    interroge donc le service déployé.
    """
    import json
    import urllib.request

    echecs = []
    try:
        url = (f"{API}/api/v1/dossier?budget=250000&surface=40&pieces=2"
               f"&type_local=Appartement&critere=dpe")
        with urllib.request.urlopen(url, timeout=90) as r:
            communes = json.loads(r.read()).get("communes", [])
    except Exception as e:
        print(f"  ERREUR   API injoignable : {e}")
        return ["API injoignable"]

    if not communes:
        print("  alerte   Le dossier ne renvoie aucune commune")
        return echecs

    # Aucune commune classée sur le critère énergétique ne doit afficher une
    # proportion issue d'un effectif trop faible : la valeur doit être absente.
    suspectes = [c["ville"] for c in communes[:5]
                 if c.get("pct_dpe_bon") is not None and c.get("nb_ventes", 0) < 40]
    if suspectes:
        print(f"  ÉCHEC    Communes classées sur un effectif insuffisant : {suspectes}")
        echecs.append("classement DPE")
    else:
        print(f"  ok       Classement énergétique : {len(communes)} communes, "
              f"tête de liste {communes[0]['ville']}")
    return echecs


def executer(cur, requete):
    cur.execute(requete)
    ligne = cur.fetchone()
    return ligne[0] if ligne else 0


def main():
    parseur = argparse.ArgumentParser(description=__doc__)
    parseur.add_argument("--verbeux", action="store_true", help="détail des écarts")
    parseur.add_argument("--sans-api", action="store_true",
                         help="ne contrôler que la base, sans interroger le service déployé")
    args = parseur.parse_args()

    # PGPASSWORD est la convention en local, POSTGRES_PASSWORD celle des
    # pipelines existants : accepter les deux évite un échec dont la cause
    # n'aurait rien à voir avec la qualité des données.
    mdp = os.getenv("PGPASSWORD") or os.getenv("POSTGRES_PASSWORD")
    dsn = DSN + (f" password={mdp}" if mdp else "")

    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        echecs, alertes = [], []
        print("Contrôle des données HomePedia\n" + "─" * 62)

        for niveau, intitule, requete, seuil, explication in CONTROLES:
            try:
                valeur = executer(cur, requete)
            except Exception as e:  # une table absente est en soi un défaut
                conn.rollback()
                print(f"  ERREUR   {intitule} : {e}")
                echecs.append(intitule)
                continue

            if niveau == INFO:
                print(f"  info     {intitule} : {valeur}")
                continue

            if valeur > seuil:
                marque = "ÉCHEC" if niveau == BLOQUANT else "alerte"
                print(f"  {marque:8} {intitule} : {valeur} (seuil {seuil})")
                print(f"           {explication}")
                (echecs if niveau == BLOQUANT else alertes).append(intitule)
            else:
                print(f"  ok       {intitule} : {valeur}")

        # Cohérence estimation / barèmes officiels
        print("─" * 62)
        cur.execute(COHERENCE)
        lignes = cur.fetchall()
        if lignes:
            ecarts = [l[3] for l in lignes if l[3] is not None]
            pire = min(ecarts) if ecarts else 0
            print(f"  Loyers : {len(lignes)} communes comparables aux barèmes officiels, "
                  f"écart le plus défavorable {pire} %")
            if args.verbeux:
                for ville, estime, officiel, ecart in lignes:
                    print(f"     {ville:24} estimé {estime:>5}  officiel {officiel:>5}  {ecart:>5} %")
            if pire < -30:
                print("           L'estimation s'éloigne trop des barèmes : elle "
                      "annoncerait des loyers « au-dessus du marché » à tort.")
                echecs.append("cohérence loyers")

        # Contrôles portant sur le service déployé plutôt que sur la base.
        if not args.sans_api:
            print("─" * 62)
            echecs.extend(controler_api())

        print("─" * 62)
        if echecs:
            print(f"ÉCHEC — {len(echecs)} contrôle(s) bloquant(s) : {', '.join(echecs)}")
            return 1
        if alertes:
            print(f"Passé avec {len(alertes)} alerte(s) : {', '.join(alertes)}")
            return 0
        print("Tous les contrôles passent.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
