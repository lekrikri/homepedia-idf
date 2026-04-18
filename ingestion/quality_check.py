#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════════╗
║  HomePedia — Quality Check PostgreSQL/Supabase                      ║
║                                                                      ║
║  Vérifie la qualité des données dans la table communes_agregat       ║
║  (toutes colonnes, y compris enrichissements post-DBT).              ║
║                                                                      ║
║  Usage :                                                             ║
║    python quality_check.py                    # prod (Supabase)      ║
║    python quality_check.py --local            # local PostgreSQL     ║
║    python quality_check.py --exit-on-error    # échoue si erreurs   ║
║                                                                      ║
║  Intégration CD :                                                    ║
║    Appelé dans cloudbuild.yaml après export BigQuery → PostgreSQL.   ║
╚══════════════════════════════════════════════════════════════════════╝
"""

import os
import sys
import argparse
import psycopg2
from psycopg2.extras import RealDictCursor
from dataclasses import dataclass, field
from typing import Optional

# ── Config ──────────────────────────────────────────────────────────────────
LOCAL_DB = {
    "host": "localhost",
    "port": 5433,
    "dbname": "homepedia",
    "user": "homepedia",
    "password": "homepedia",
}

PROD_DB = {
    "host":     os.getenv("POSTGRES_HOST",     "aws-0-eu-west-1.pooler.supabase.com"),
    "port":     int(os.getenv("POSTGRES_PORT", "5432")),
    "dbname":   os.getenv("POSTGRES_DB",       "postgres"),
    "user":     os.getenv("POSTGRES_USER",     "postgres.iugsfmvqddburvufzacy"),
    "password": os.getenv("POSTGRES_PASSWORD", ""),
    "sslmode":  "require",
}


# ── Résultats ────────────────────────────────────────────────────────────────
@dataclass
class CheckResult:
    name: str
    status: str        # "OK" | "WARN" | "ERROR"
    message: str
    value: Optional[float] = None
    threshold: Optional[str] = None


RESULTS: list[CheckResult] = []


def check(name, condition, ok_msg, fail_msg, severity="ERROR", value=None, threshold=None):
    if condition:
        RESULTS.append(CheckResult(name, "OK", ok_msg, value, threshold))
    else:
        RESULTS.append(CheckResult(name, severity, fail_msg, value, threshold))


# ── Checks ───────────────────────────────────────────────────────────────────
def run_checks(cur):

    # ── 1. Volume général ──────────────────────────────────────────────────
    cur.execute("SELECT COUNT(*) AS n FROM communes_agregat")
    n = cur.fetchone()["n"]
    check(
        "Volume — communes totales",
        n >= 900,
        f"{n} communes (OK ≥ 900)",
        f"Seulement {n} communes ! Attendu ≥ 900 (IDF ≈ 1 300)",
        value=n, threshold="≥ 900",
    )

    # ── 2. Unicité code_commune ───────────────────────────────────────────
    cur.execute("SELECT COUNT(*) - COUNT(DISTINCT code_commune) AS doublons FROM communes_agregat")
    doublons = cur.fetchone()["doublons"]
    check(
        "Unicité — code_commune",
        doublons == 0,
        "Aucun doublon sur code_commune",
        f"{doublons} doublons sur code_commune !",
        value=doublons, threshold="= 0",
    )

    # ── 3. Prix médians ───────────────────────────────────────────────────
    cur.execute("""
        SELECT
            -- Communes sans DVF du tout (enrichissement IPS/énergie uniquement) → WARN acceptable
            COUNT(*) FILTER (WHERE prix_median_m2 IS NULL AND nb_transactions IS NULL) AS sans_dvf,
            -- Communes avec transactions mais sans prix → ERROR
            COUNT(*) FILTER (WHERE prix_median_m2 IS NULL AND nb_transactions IS NOT NULL) AS avec_tx_sans_prix,
            COUNT(*) FILTER (WHERE prix_median_m2 < 1000)            AS trop_bas,
            COUNT(*) FILTER (WHERE prix_median_m2 > 20000)           AS trop_haut,
            ROUND(MIN(prix_median_m2)::numeric, 0)                   AS min_prix,
            ROUND(MAX(prix_median_m2)::numeric, 0)                   AS max_prix,
            ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY prix_median_m2)::numeric, 0) AS median_prix
        FROM communes_agregat
    """)
    r = cur.fetchone()
    check("Prix médian — communes sans DVF",    r["sans_dvf"] <= 10,
          f"{r['sans_dvf']} commune(s) sans DVF (enrichissement IPS/énergie seul — OK ≤ 10)",
          f"{r['sans_dvf']} communes sans aucune donnée DVF — supprimer ou investiguer", severity="WARN")
    check("Prix médian — NULL avec transactions", r["avec_tx_sans_prix"] == 0,
          "0 communes avec transactions mais sans prix médian",
          f"{r['avec_tx_sans_prix']} communes ont des transactions sans prix calculé !")
    check("Prix médian — trop bas",  r["trop_bas"] == 0,  "0 communes < 1 000 €/m²", f"{r['trop_bas']} communes avec prix < 1 000 €/m²", severity="WARN")
    check("Prix médian — trop haut", r["trop_haut"] == 0, "0 communes > 20 000 €/m²", f"{r['trop_haut']} communes avec prix > 20 000 €/m²", severity="WARN")
    print(f"   → Prix : min={r['min_prix']} €/m² | médian={r['median_prix']} €/m² | max={r['max_prix']} €/m²")

    # ── 4. DPE ────────────────────────────────────────────────────────────
    cur.execute("""
        SELECT
            ROUND(100.0 * COUNT(*) FILTER (WHERE score_dpe_moyen IS NOT NULL) / COUNT(*), 1) AS pct_avec_dpe,
            COUNT(*) FILTER (WHERE score_dpe_moyen NOT BETWEEN 1 AND 7)  AS dpe_hors_bornes,
            COUNT(*) FILTER (WHERE pct_dpe_bon NOT BETWEEN 0 AND 1)      AS pct_dpe_invalide
        FROM communes_agregat
    """)
    r = cur.fetchone()
    check("DPE — couverture",     float(r["pct_avec_dpe"]) >= 50, f"{r['pct_avec_dpe']}% avec DPE (OK ≥ 50%)", f"Couverture DPE insuffisante : {r['pct_avec_dpe']}%", severity="WARN")
    check("DPE — bornes 1-7",     r["dpe_hors_bornes"] == 0, "Tous score_dpe_moyen ∈ [1,7]", f"{r['dpe_hors_bornes']} scores DPE hors bornes [1-7]")
    check("DPE — pct_dpe_bon",    r["pct_dpe_invalide"] == 0, "Tous pct_dpe_bon ∈ [0,1]",    f"{r['pct_dpe_invalide']} valeurs pct_dpe_bon hors bornes [0,1]")

    # ── 5. IPS Écoles ─────────────────────────────────────────────────────
    cur.execute("""
        SELECT
            ROUND(100.0 * COUNT(*) FILTER (WHERE ips_moyen IS NOT NULL) / COUNT(*), 1) AS pct_avec_ips,
            COUNT(*) FILTER (WHERE ips_moyen NOT BETWEEN 50 AND 200)                   AS ips_hors_bornes,
            COUNT(*) FILTER (WHERE pct_ecoles_favorisees NOT BETWEEN 0 AND 100)        AS pct_ecoles_invalide,
            ROUND(AVG(ips_moyen)::numeric, 1)                                          AS moy_ips
        FROM communes_agregat
    """)
    r = cur.fetchone()
    check("IPS — couverture",         float(r["pct_avec_ips"]) >= 60,
          f"{r['pct_avec_ips']}% avec IPS (OK ≥ 60%)", f"Couverture IPS insuffisante : {r['pct_avec_ips']}% (attendu ≥ 60%)", severity="WARN")
    check("IPS — bornes [50, 200]",   r["ips_hors_bornes"] == 0,
          "Tous ips_moyen ∈ [50, 200]", f"{r['ips_hors_bornes']} valeurs IPS hors bornes", severity="WARN")
    check("IPS — pct écoles valide",  r["pct_ecoles_invalide"] == 0,
          "Tous pct_ecoles_favorisees ∈ [0, 100]", f"{r['pct_ecoles_invalide']} valeurs pct_ecoles_favorisees invalides")
    if r["moy_ips"]:
        # L'IDF est structurellement plus favorisé que la moyenne nationale (100)
        # La moyenne IDF est typiquement entre 105 et 125 → seuil ajusté
        check("IPS — moyenne IDF cohérente", 100 <= float(r["moy_ips"]) <= 130,
              f"Moyenne IPS IDF = {r['moy_ips']} (cohérent, IDF > moyenne nationale 100)",
              f"Moyenne IPS IDF = {r['moy_ips']} — suspect (attendu entre 100 et 130 pour l'IDF)", severity="WARN")

    # ── 6. Énergie ENEDIS/GRDF ────────────────────────────────────────────
    cur.execute("""
        SELECT
            ROUND(100.0 * COUNT(*) FILTER (WHERE conso_elec_par_logement IS NOT NULL) / COUNT(*), 1) AS pct_avec_elec,
            ROUND(100.0 * COUNT(*) FILTER (WHERE conso_gaz_par_logement  IS NOT NULL) / COUNT(*), 1) AS pct_avec_gaz,
            COUNT(*) FILTER (WHERE conso_elec_par_logement NOT BETWEEN 1 AND 30) AS elec_hors_bornes,
            COUNT(*) FILTER (WHERE conso_gaz_par_logement  NOT BETWEEN 2 AND 60) AS gaz_hors_bornes,
            ROUND(AVG(conso_elec_par_logement)::numeric, 2) AS moy_elec,
            ROUND(AVG(conso_gaz_par_logement)::numeric,  2) AS moy_gaz
        FROM communes_agregat
    """)
    r = cur.fetchone()
    check("Énergie — couverture élec", float(r["pct_avec_elec"]) >= 70,
          f"{r['pct_avec_elec']}% avec données élec (OK ≥ 70%)", f"Couverture ENEDIS insuffisante : {r['pct_avec_elec']}%", severity="WARN")
    check("Énergie — couverture gaz",  float(r["pct_avec_gaz"]) >= 50,
          f"{r['pct_avec_gaz']}% avec données gaz (OK ≥ 50%)", f"Couverture GRDF insuffisante : {r['pct_avec_gaz']}%", severity="WARN")
    check("Énergie — élec bornes [1,30] MWh", r["elec_hors_bornes"] == 0,
          "Toutes conso_elec_par_logement ∈ [1, 30] MWh", f"{r['elec_hors_bornes']} valeurs élec hors fourchette réaliste")
    check("Énergie — gaz bornes [2,60] MWh",  r["gaz_hors_bornes"] == 0,
          "Toutes conso_gaz_par_logement ∈ [2, 60] MWh", f"{r['gaz_hors_bornes']} valeurs gaz hors fourchette réaliste")
    if r["moy_elec"]:
        check("Énergie — moyenne élec cohérente (≈5.1 MWh IDF)", 3 <= float(r["moy_elec"]) <= 10,
              f"Moyenne élec = {r['moy_elec']} MWh (OK, réf IDF ≈ 5.1)",
              f"Moyenne élec = {r['moy_elec']} MWh — suspect (attendu 3-10)", severity="WARN")
    if r["moy_gaz"]:
        check("Énergie — moyenne gaz cohérente (≈12.5 MWh IDF)", 5 <= float(r["moy_gaz"]) <= 25,
              f"Moyenne gaz = {r['moy_gaz']} MWh (OK, réf IDF ≈ 12.5)",
              f"Moyenne gaz = {r['moy_gaz']} MWh — suspect (attendu 5-25)", severity="WARN")

    # ── 7. Scores composites ──────────────────────────────────────────────
    cur.execute("""
        SELECT
            ROUND(100.0 * COUNT(*) FILTER (WHERE
                score_qualite_vie IS NOT NULL AND
                score_investissement IS NOT NULL AND
                score_stabilite IS NOT NULL
            ) / COUNT(*), 1) AS pct_3_scores,
            COUNT(*) FILTER (WHERE score_qualite_vie    NOT BETWEEN 0 AND 100) AS qv_hors_bornes,
            COUNT(*) FILTER (WHERE score_investissement NOT BETWEEN 0 AND 100) AS inv_hors_bornes,
            COUNT(*) FILTER (WHERE score_stabilite      NOT BETWEEN 0 AND 100) AS stab_hors_bornes,
            ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY score_qualite_vie)::numeric, 1)    AS median_qv,
            ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY score_investissement)::numeric, 1) AS median_inv,
            ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY score_stabilite)::numeric, 1)      AS median_stab
        FROM communes_agregat
    """)
    r = cur.fetchone()
    check("Scores — couverture 3 scores", float(r["pct_3_scores"]) >= 80,
          f"{r['pct_3_scores']}% des communes ont les 3 scores (OK ≥ 80%)",
          f"Seulement {r['pct_3_scores']}% avec les 3 scores — vérifier compute_scores.py", severity="WARN")
    check("Scores — Qualité Vie bornes [0,100]",   r["qv_hors_bornes"] == 0,
          "score_qualite_vie ∈ [0, 100]", f"{r['qv_hors_bornes']} scores hors bornes")
    check("Scores — Investissement bornes [0,100]", r["inv_hors_bornes"] == 0,
          "score_investissement ∈ [0, 100]", f"{r['inv_hors_bornes']} scores hors bornes")
    check("Scores — Stabilité DPE bornes [0,100]", r["stab_hors_bornes"] == 0,
          "score_stabilite ∈ [0, 100]", f"{r['stab_hors_bornes']} scores hors bornes")
    # Distribution centrée (percentile-based → médiane attendue ≈ 50 ± 20)
    if r["median_qv"] is not None:
        check("Scores — distribution centrée (médiane ≈ 50)", all(
            30 <= float(r[f"median_{k}"]) <= 70
            for k in ("qv", "inv", "stab") if r[f"median_{k}"] is not None
        ), f"Médianes QV={r['median_qv']} INV={r['median_inv']} STAB={r['median_stab']} (OK ∈ [30,70])",
              f"Scores mal distribués — médianes QV={r['median_qv']} INV={r['median_inv']} STAB={r['median_stab']}", severity="WARN")

    # ── 8. Arrondissements Paris ──────────────────────────────────────────
    cur.execute("""
        SELECT COUNT(*) AS n
        FROM communes_agregat
        WHERE code_commune LIKE '751%' AND code_commune != '75056'
    """)
    n = cur.fetchone()["n"]
    check("Paris — pas d'arrondissements", n == 0,
          "Aucun arrondissement Paris (75101-75120) dans la table",
          f"{n} arrondissements parisiens présents — doivent être consolidés en 75056 !")

    # ── 9. Fraîcheur données ──────────────────────────────────────────────
    cur.execute("""
        SELECT
            MAX(updated_at)                                                AS last_update,
            EXTRACT(EPOCH FROM (NOW() - MAX(updated_at))) / 86400         AS jours_depuis_maj
        FROM communes_agregat
        WHERE updated_at IS NOT NULL
    """)
    r = cur.fetchone()
    if r["jours_depuis_maj"] is not None:
        jours = float(r["jours_depuis_maj"])
        check("Fraîcheur — données < 30 jours", jours < 30,
              f"Dernière MàJ il y a {jours:.0f} jour(s) ({r['last_update'].date() if r['last_update'] else 'N/A'})",
              f"Données vieilles de {jours:.0f} jours — relancer le pipeline", severity="WARN",
              value=jours, threshold="< 30 jours")


# ── Affichage rapport ────────────────────────────────────────────────────────
def print_report():
    nb_ok    = sum(1 for r in RESULTS if r.status == "OK")
    nb_warn  = sum(1 for r in RESULTS if r.status == "WARN")
    nb_error = sum(1 for r in RESULTS if r.status == "ERROR")

    print("\n" + "═" * 66)
    print("  📊  HomePedia — Rapport Qualité Données PostgreSQL")
    print("═" * 66)

    status_icons = {"OK": "✅", "WARN": "⚠️ ", "ERROR": "❌"}
    for r in RESULTS:
        icon = status_icons[r.status]
        print(f"  {icon}  {r.name}")
        if r.status != "OK":
            print(f"       → {r.message}")

    print("─" * 66)
    print(f"  Total : {len(RESULTS)} checks | ✅ {nb_ok} OK | ⚠️  {nb_warn} WARN | ❌ {nb_error} ERROR")
    print("═" * 66 + "\n")

    return nb_error


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="HomePedia data quality check")
    parser.add_argument("--local", action="store_true", help="Utiliser la DB locale (port 5433)")
    parser.add_argument("--exit-on-error", action="store_true", help="Exit code 1 si erreurs détectées")
    args = parser.parse_args()

    cfg = LOCAL_DB if args.local else PROD_DB

    target = "LOCAL (port 5433)" if args.local else f"PROD ({cfg['host']})"
    print(f"\n🔍 Connexion à PostgreSQL — {target}")

    try:
        conn = psycopg2.connect(**{k: v for k, v in cfg.items() if v}, cursor_factory=RealDictCursor)
        conn.autocommit = True
    except Exception as e:
        print(f"❌ Impossible de se connecter à PostgreSQL : {e}")
        sys.exit(1)

    with conn.cursor() as cur:
        run_checks(cur)

    conn.close()

    nb_errors = print_report()

    if args.exit_on_error and nb_errors > 0:
        print(f"🚨 {nb_errors} erreur(s) détectée(s) → exit 1")
        sys.exit(1)

    print("✅ Quality check terminé.")


if __name__ == "__main__":
    main()
