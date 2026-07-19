"""
01_build_corpus.py
Transforme les données Gold (communes agrégées) en documents texte
sémantiquement riches pour indexation RAG dans ChromaDB.

Chaque chiffre est contextualisé : comparé à la moyenne du département,
qualifié (abordable, cher, bien desservi, passoire thermique, etc.).

Génère 3 types de documents par commune :
  1. Fiche commune (prix, population, transactions) — contextualisée
  2. Fiche DPE (performance énergétique) — qualifiée
  3. Fiche cadre de vie (POI, transports, commerces) — comparée

Sources :
  - mock_gold.json (dev)
  - PostgreSQL table communes_agregat (prod)
"""

import os
import json
import argparse
import logging
from collections import defaultdict

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# Mapping département → nom lisible
DEPT_NAMES = {
    "75": "Paris",
    "77": "Seine-et-Marne",
    "78": "Yvelines",
    "91": "Essonne",
    "92": "Hauts-de-Seine",
    "93": "Seine-Saint-Denis",
    "94": "Val-de-Marne",
    "95": "Val-d'Oise",
}


# ── Chargement données ───────────────────────────────────────────────────────

def load_gold_data(source: str) -> list[dict]:
    """Charge les données Gold depuis le mock JSON ou PostgreSQL."""
    if source == "mock":
        path = os.path.join(os.path.dirname(__file__), "mock_gold.json")
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        log.info(f"Chargé {len(data)} communes depuis mock_gold.json")
        return data

    elif source == "postgres":
        from dotenv import load_dotenv
        import psycopg2

        load_dotenv()
        conn = psycopg2.connect(
            host=os.getenv("POSTGRES_HOST", "localhost"),
            port=int(os.getenv("POSTGRES_PORT", 5433)),
            dbname=os.getenv("POSTGRES_DB", "homepedia"),
            user=os.getenv("POSTGRES_USER", "homepedia"),
            password=os.getenv("POSTGRES_PASSWORD", "homepedia"),
        )
        cur = conn.cursor()
        cur.execute("""
            SELECT
                code_commune, city, code_departement,
                centroid_lon, centroid_lat, surface_km2,
                population_totale, population_municipale, densite_pop_km2,
                prix_median_m2, prix_moyen_m2, nb_transactions,
                surface_moyenne, prix_median_transaction,
                score_dpe_moyen, conso_energie_moyenne, emission_ges_moyenne,
                nb_dpe, pct_dpe_bon,
                nb_poi_total, nb_transport, nb_education, nb_sante,
                nb_commerce, nb_restauration, nb_parcs, nb_services, nb_bio_bobo
            FROM communes_agregat
            ORDER BY city
        """)
        cols = [d[0] for d in cur.description]
        data = []
        for row in cur.fetchall():
            r = dict(zip(cols, row))
            for k, v in r.items():
                if hasattr(v, "as_integer_ratio"):
                    r[k] = float(v)
            data.append(r)
        conn.close()
        log.info(f"Chargé {len(data)} communes depuis PostgreSQL (communes_agregat)")
        return data

    else:
        raise ValueError(f"Source inconnue : {source}")


# ── Statistiques de référence par département ────────────────────────────────

def compute_dept_stats(data: list[dict]) -> dict:
    """
    Calcule les stats de référence par département pour contextualiser
    chaque commune : moyenne, médiane, percentiles.
    """
    dept_values = defaultdict(lambda: defaultdict(list))

    # Normaliser les départements (trim espaces)
    for c in data:
        if "code_departement" in c and isinstance(c["code_departement"], str):
            c["code_departement"] = c["code_departement"].strip()

    for c in data:
        dept = c.get("code_departement", "")
        if not dept:
            continue
        for key in [
            "prix_median_m2", "score_dpe_moyen", "conso_energie_moyenne",
            "nb_transport", "nb_education", "nb_sante", "nb_commerce",
            "nb_restauration", "nb_parcs", "nb_poi_total", "nb_transactions",
            "densite_pop_km2", "population_totale", "pct_dpe_bon",
        ]:
            val = c.get(key)
            if val is not None:
                dept_values[dept][key].append(float(val))

    stats = {}
    for dept, fields in dept_values.items():
        stats[dept] = {}
        for key, values in fields.items():
            values_sorted = sorted(values)
            n = len(values_sorted)
            stats[dept][key] = {
                "mean": sum(values) / n,
                "min": values_sorted[0],
                "max": values_sorted[-1],
                "p25": values_sorted[int(n * 0.25)],
                "median": values_sorted[int(n * 0.5)],
                "p75": values_sorted[int(n * 0.75)],
                "count": n,
            }
    return stats


def rank_in_dept(value, dept_stats, key) -> str:
    """Positionne une valeur par rapport au département. Retourne un qualificatif."""
    if value is None or key not in dept_stats:
        return ""
    s = dept_stats[key]
    if value <= s["p25"]:
        return "parmi les plus bas du département"
    elif value >= s["p75"]:
        return "parmi les plus élevés du département"
    else:
        return "dans la moyenne du département"


def compare_to_dept(value, dept_stats, key) -> str:
    """Retourne l'écart en % par rapport à la moyenne du département."""
    if value is None or key not in dept_stats:
        return ""
    mean = dept_stats[key]["mean"]
    if mean == 0:
        return ""
    ecart = ((value - mean) / mean) * 100
    if ecart > 5:
        return f"{abs(ecart):.0f}% au-dessus de la moyenne du département"
    elif ecart < -5:
        return f"{abs(ecart):.0f}% en dessous de la moyenne du département"
    else:
        return "proche de la moyenne du département"


# ── Helpers texte ─────────────────────────────────────────────────────────────

def fmt(value, suffix="", decimals=0):
    """Formatte un nombre pour le texte."""
    if value is None:
        return None
    if isinstance(value, float):
        if decimals == 0:
            return f"{int(value):,}{suffix}".replace(",", " ")
        return f"{value:.{decimals}f}{suffix}"
    return f"{int(value):,}{suffix}".replace(",", " ")


def qualify_prix(prix, dept_stats) -> str:
    """Qualifie un prix au m² en langage naturel."""
    if prix is None:
        return ""
    cmp = compare_to_dept(prix, dept_stats, "prix_median_m2")
    rank = rank_in_dept(prix, dept_stats, "prix_median_m2")

    if prix < 2500:
        label = "très abordable"
    elif prix < 4000:
        label = "abordable"
    elif prix < 6000:
        label = "dans la moyenne francilienne"
    elif prix < 8500:
        label = "élevé"
    elif prix < 10000:
        label = "très élevé"
    else:
        label = "parmi les plus chers d'Île-de-France"

    return with_rank(f"Ce prix est considéré comme {label}", cmp) + "."


def qualify_dpe(score, conso, pct_bon, dept_stats) -> str:
    """Qualifie la performance énergétique."""
    parts = []
    if score is not None:
        if score <= 2:
            parts.append("La commune a une excellente performance énergétique")
        elif score <= 3:
            parts.append("La commune a une bonne performance énergétique")
        elif score <= 4.5:
            parts.append("La commune a une performance énergétique moyenne")
        elif score <= 5.5:
            parts.append("La commune a une performance énergétique médiocre")
        else:
            parts.append("La commune a une mauvaise performance énergétique, avec beaucoup de passoires thermiques")

        cmp = compare_to_dept(score, dept_stats, "score_dpe_moyen")
        if cmp:
            parts[-1] = with_rank(parts[-1], cmp) + "."
        else:
            parts[-1] += "."

    if pct_bon is not None:
        pct_val = pct_bon * 100 if pct_bon < 1 else pct_bon
        if pct_val >= 30:
            parts.append(f"{fmt(pct_val, '%', 1)} des biens sont en classe A ou B, un taux remarquable.")
        elif pct_val >= 15:
            parts.append(f"{fmt(pct_val, '%', 1)} des biens sont en classe A ou B, un taux correct.")
        elif pct_val >= 5:
            parts.append(f"Seulement {fmt(pct_val, '%', 1)} des biens sont en classe A ou B, un taux faible.")
        else:
            parts.append(f"Très peu de biens bien classés : {fmt(pct_val, '%', 1)} en A ou B, signe d'un parc immobilier énergivore.")

    return " ".join(parts)


def with_rank(text, rank) -> str:
    """Ajoute le positionnement départemental si disponible."""
    if rank:
        return f"{text} ({rank})"
    return text


def qualify_transport(nb, dept_stats) -> str:
    """Qualifie la desserte en transports."""
    if nb is None or nb == 0:
        return "La commune est très mal desservie en transports en commun."

    rank = rank_in_dept(nb, dept_stats, "nb_transport")
    if nb >= 200:
        return with_rank(f"Avec {fmt(nb)} arrêts de transport, la commune est excellemment desservie", rank) + "."
    elif nb >= 80:
        return with_rank(f"Avec {fmt(nb)} arrêts de transport, la commune est bien desservie", rank) + "."
    elif nb >= 30:
        return with_rank(f"Avec {fmt(nb)} arrêts de transport, la desserte est correcte", rank) + "."
    elif nb >= 10:
        return with_rank(f"Avec {fmt(nb)} arrêts de transport, la desserte est limitée", rank) + "."
    else:
        return with_rank(f"Avec seulement {fmt(nb)} arrêts de transport, la commune est mal desservie", rank) + "."


# ── Générateurs de documents ──────────────────────────────────────────────────

def build_commune_doc(c: dict, dept_stats: dict) -> dict:
    """Fiche commune contextualisée : prix, population, positionnement."""
    dept = c.get("code_departement", "").strip()
    dept_name = DEPT_NAMES.get(dept, "Île-de-France")
    city = c.get("city") or c.get("nom", "Commune inconnue")
    ds = dept_stats.get(dept, {})

    parts = [
        f"{city} ({c['code_commune']}) est une commune du département "
        f"{dept} ({dept_name}).",
    ]

    pop = c.get("population_totale")
    if pop:
        if pop > 100000:
            taille = "C'est une grande ville"
        elif pop > 30000:
            taille = "C'est une ville de taille moyenne"
        elif pop > 10000:
            taille = "C'est une petite ville"
        elif pop > 2000:
            taille = "C'est un bourg"
        else:
            taille = "C'est un village"
        parts.append(f"{taille} de {fmt(pop)} habitants.")

        densite = c.get("densite_pop_km2")
        surface = c.get("surface_km2")
        if densite and surface:
            if densite > 15000:
                densite_label = "très densément peuplée"
            elif densite > 5000:
                densite_label = "densément peuplée"
            elif densite > 1000:
                densite_label = "moyennement dense"
            else:
                densite_label = "peu dense, à caractère rural"
            parts.append(f"Sa superficie est de {fmt(surface, ' km²', 1)}, "
                         f"elle est {densite_label} ({fmt(densite, ' hab/km²')}).")

    prix_med = c.get("prix_median_m2")
    if prix_med:
        parts.append(f"Le prix immobilier médian est de {fmt(prix_med, '€/m²')}. "
                      + qualify_prix(prix_med, ds))

    nb_tx = c.get("nb_transactions")
    if nb_tx:
        cmp = compare_to_dept(nb_tx, ds, "nb_transactions")
        if nb_tx > 2000:
            parts.append(with_rank(f"Le marché est très actif avec {fmt(nb_tx)} transactions enregistrées", cmp) + ".")
        elif nb_tx > 500:
            parts.append(with_rank(f"Le marché est actif avec {fmt(nb_tx)} transactions", cmp) + ".")
        elif nb_tx > 100:
            parts.append(with_rank(f"Le marché est modéré avec {fmt(nb_tx)} transactions", cmp) + ".")
        else:
            parts.append(with_rank(f"Le marché est peu actif avec seulement {fmt(nb_tx)} transactions", cmp) + ".")

    surface_moy = c.get("surface_moyenne")
    if surface_moy:
        if surface_moy > 80:
            parts.append(f"Les biens vendus sont grands en moyenne ({fmt(surface_moy, ' m²')}).")
        elif surface_moy > 50:
            parts.append(f"Les biens vendus font en moyenne {fmt(surface_moy, ' m²')}.")
        else:
            parts.append(f"Les biens vendus sont plutôt petits ({fmt(surface_moy, ' m²')} en moyenne).")

    prix_med_tx = c.get("prix_median_transaction")
    if prix_med_tx:
        parts.append(f"Le prix médian d'une transaction complète est de {fmt(prix_med_tx, '€')}.")

    return {
        "id": f"commune_{c['code_commune']}",
        "text": " ".join(parts),
        "metadata": {
            "type": "commune",
            "code_commune": c["code_commune"],
            "city": city,
            "departement": dept,
        },
    }


def build_dpe_doc(c: dict, dept_stats: dict) -> dict | None:
    """Fiche DPE qualifiée : performance, consommation, comparaison."""
    city = c.get("city") or c.get("nom", "Commune inconnue")
    dept = c.get("code_departement", "").strip()
    ds = dept_stats.get(dept, {})
    score = c.get("score_dpe_moyen")
    if score is None:
        return None

    dpe_labels = {1: "A", 2: "B", 3: "C", 4: "D", 5: "E", 6: "F", 7: "G"}
    classe_approx = dpe_labels.get(round(score), "?")

    parts = [
        f"Performance énergétique à {city} ({c['code_commune']}) : "
        f"la classe DPE moyenne est {classe_approx} (score {fmt(score, '/7', 1)}).",
    ]

    parts.append(qualify_dpe(score, c.get("conso_energie_moyenne"),
                             c.get("pct_dpe_bon"), ds))

    conso = c.get("conso_energie_moyenne")
    if conso:
        cmp = compare_to_dept(conso, ds, "conso_energie_moyenne")
        if conso < 150:
            parts.append(with_rank(f"La consommation moyenne de {fmt(conso, ' kWh/m²/an')} est basse", cmp) + ".")
        elif conso < 250:
            parts.append(with_rank(f"La consommation moyenne est de {fmt(conso, ' kWh/m²/an')}", cmp) + ".")
        else:
            parts.append(with_rank(f"La consommation est élevée : {fmt(conso, ' kWh/m²/an')}", cmp) + ".")

    ges = c.get("emission_ges_moyenne")
    if ges:
        if ges < 20:
            parts.append(f"Les émissions GES sont faibles ({fmt(ges, ' kgCO2/m²/an', 1)}).")
        elif ges < 40:
            parts.append(f"Les émissions GES sont modérées ({fmt(ges, ' kgCO2/m²/an', 1)}).")
        else:
            parts.append(f"Les émissions GES sont élevées ({fmt(ges, ' kgCO2/m²/an', 1)}).")

    nb_dpe = c.get("nb_dpe")
    if nb_dpe:
        parts.append(f"Ces statistiques se basent sur {fmt(nb_dpe)} diagnostics DPE.")

    return {
        "id": f"dpe_{c['code_commune']}",
        "text": " ".join(parts),
        "metadata": {
            "type": "dpe",
            "code_commune": c["code_commune"],
            "city": city,
            "departement": dept,
        },
    }


def build_poi_doc(c: dict, dept_stats: dict) -> dict | None:
    """Fiche cadre de vie qualifiée : desserte, équipements, comparaison."""
    city = c.get("city") or c.get("nom", "Commune inconnue")
    dept = c.get("code_departement", "").strip()
    ds = dept_stats.get(dept, {})
    nb_total = c.get("nb_poi_total")
    if nb_total is None:
        return None

    parts = [f"Cadre de vie à {city} ({c['code_commune']}) :"]

    # Transport
    parts.append(qualify_transport(c.get("nb_transport"), ds))

    # Éducation
    nb_edu = c.get("nb_education")
    if nb_edu:
        rank = rank_in_dept(nb_edu, ds, "nb_education")
        if nb_edu >= 50:
            parts.append(with_rank(f"L'offre scolaire est riche avec {fmt(nb_edu)} établissements", rank) + ".")
        elif nb_edu >= 15:
            parts.append(with_rank(f"L'offre scolaire est correcte avec {fmt(nb_edu)} établissements", rank) + ".")
        elif nb_edu >= 5:
            parts.append(with_rank(f"L'offre scolaire est limitée avec {fmt(nb_edu)} établissements", rank) + ".")
        else:
            parts.append(with_rank(f"Très peu d'établissements scolaires ({fmt(nb_edu)})", rank) + ".")

    # Santé
    nb_sante = c.get("nb_sante")
    if nb_sante:
        rank = rank_in_dept(nb_sante, ds, "nb_sante")
        if nb_sante >= 30:
            parts.append(with_rank(f"L'offre de santé est bonne avec {fmt(nb_sante)} établissements", rank) + ".")
        elif nb_sante >= 10:
            parts.append(with_rank(f"L'offre de santé est correcte avec {fmt(nb_sante)} établissements", rank) + ".")
        else:
            parts.append(with_rank(f"L'offre de santé est faible avec {fmt(nb_sante)} établissements", rank) + ".")

    # Commerces
    nb_com = c.get("nb_commerce")
    if nb_com:
        rank = rank_in_dept(nb_com, ds, "nb_commerce")
        if nb_com >= 100:
            parts.append(with_rank(f"La commune est très commerçante avec {fmt(nb_com)} commerces", rank) + ".")
        elif nb_com >= 30:
            parts.append(with_rank(f"L'offre commerciale est correcte avec {fmt(nb_com)} commerces", rank) + ".")
        elif nb_com >= 10:
            parts.append(with_rank(f"L'offre commerciale est limitée avec {fmt(nb_com)} commerces", rank) + ".")
        else:
            parts.append(with_rank(f"Très peu de commerces ({fmt(nb_com)})", rank) + ".")

    # Restauration
    nb_resto = c.get("nb_restauration")
    if nb_resto:
        if nb_resto >= 50:
            parts.append(f"La vie nocturne et la restauration sont animées ({fmt(nb_resto)} restaurants et cafés).")
        elif nb_resto >= 15:
            parts.append(f"On trouve {fmt(nb_resto)} restaurants et cafés.")

    # Parcs
    nb_parcs = c.get("nb_parcs")
    if nb_parcs:
        if nb_parcs >= 20:
            parts.append(f"La commune est très verte avec {fmt(nb_parcs)} parcs et espaces verts.")
        elif nb_parcs >= 5:
            parts.append(f"La commune dispose de {fmt(nb_parcs)} parcs et espaces verts.")
        elif nb_parcs >= 1:
            parts.append(f"Les espaces verts sont limités ({fmt(nb_parcs)} parcs).")

    # Gentrification
    bio = c.get("nb_bio_bobo")
    if bio and bio > 10:
        parts.append(f"Présence notable de commerces bio et épiceries fines ({fmt(bio)}), signal de gentrification.")

    # Résumé global
    cmp_total = rank_in_dept(nb_total, ds, "nb_poi_total")
    parts.append(with_rank(f"Au total {fmt(nb_total)} points d'intérêt", cmp_total) + ".")

    return {
        "id": f"poi_{c['code_commune']}",
        "text": " ".join(parts),
        "metadata": {
            "type": "poi",
            "code_commune": c["code_commune"],
            "city": city,
            "departement": dept,
        },
    }


def build_summary_doc(c: dict, dept_stats: dict) -> dict:
    """
    Résumé court (~200 tokens) couvrant TOUS les aspects de la commune.
    C'est le document principal pour le retrieval sémantique.
    Les docs détaillés (commune, dpe, poi) sont récupérés ensuite via code_commune.
    """
    dept = c.get("code_departement", "").strip()
    dept_name = DEPT_NAMES.get(dept, "Île-de-France")
    city = c.get("city") or c.get("nom", "Commune inconnue")
    ds = dept_stats.get(dept, {})

    parts = [f"{city} ({c['code_commune']}, {dept_name})"]

    # Population
    pop = c.get("population_totale")
    if pop:
        if pop > 100000:
            parts.append(f"grande ville de {fmt(pop)} habitants")
        elif pop > 30000:
            parts.append(f"ville moyenne de {fmt(pop)} habitants")
        elif pop > 10000:
            parts.append(f"petite ville de {fmt(pop)} habitants")
        elif pop > 2000:
            parts.append(f"bourg de {fmt(pop)} habitants")
        else:
            parts.append(f"village de {fmt(pop)} habitants")

    # Prix
    prix = c.get("prix_median_m2")
    if prix:
        if prix < 2500:
            label = "très abordable"
        elif prix < 4000:
            label = "abordable"
        elif prix < 6000:
            label = "prix moyen"
        elif prix < 8500:
            label = "prix élevé"
        elif prix < 10000:
            label = "prix très élevé"
        else:
            label = "parmi les plus chers d'IDF"
        parts.append(f"immobilier {label} à {fmt(prix, '€/m²')}")

    nb_tx = c.get("nb_transactions")
    if nb_tx:
        if nb_tx > 2000:
            parts.append(f"marché très actif ({fmt(nb_tx)} transactions)")
        elif nb_tx > 500:
            parts.append(f"marché actif ({fmt(nb_tx)} transactions)")
        else:
            parts.append(f"marché calme ({fmt(nb_tx)} transactions)")

    # DPE
    score = c.get("score_dpe_moyen")
    if score:
        dpe_labels = {1: "A", 2: "B", 3: "C", 4: "D", 5: "E", 6: "F", 7: "G"}
        classe = dpe_labels.get(round(score), "?")
        if score <= 3:
            parts.append(f"bonne performance énergétique (classe {classe})")
        elif score <= 4.5:
            parts.append(f"performance énergétique moyenne (classe {classe})")
        else:
            parts.append(f"mauvaise performance énergétique (classe {classe}, passoires thermiques)")

    # Transport
    nb_tr = c.get("nb_transport")
    if nb_tr:
        if nb_tr >= 200:
            parts.append("excellemment desservie en transports")
        elif nb_tr >= 80:
            parts.append("bien desservie en transports")
        elif nb_tr >= 30:
            parts.append("desserte transport correcte")
        elif nb_tr >= 10:
            parts.append("desserte transport limitée")
        else:
            parts.append("mal desservie en transports")

    # Équipements clés
    equipements = []
    nb_edu = c.get("nb_education")
    if nb_edu and nb_edu >= 15:
        equipements.append(f"{fmt(nb_edu)} écoles")
    nb_com = c.get("nb_commerce")
    if nb_com and nb_com >= 30:
        equipements.append(f"{fmt(nb_com)} commerces")
    nb_sante = c.get("nb_sante")
    if nb_sante and nb_sante >= 10:
        equipements.append(f"{fmt(nb_sante)} établissements de santé")
    nb_parcs = c.get("nb_parcs")
    if nb_parcs and nb_parcs >= 10:
        equipements.append(f"{fmt(nb_parcs)} parcs")
    if equipements:
        parts.append(", ".join(equipements))

    return {
        "id": f"summary_{c['code_commune']}",
        "text": ". ".join(parts) + ".",
        "metadata": {
            "type": "summary",
            "code_commune": c["code_commune"],
            "city": city,
            "departement": dept,
        },
    }


# ── Pipeline principal ────────────────────────────────────────────────────────

def build_corpus(data: list[dict]) -> list[dict]:
    """
    Génère le corpus avec architecture Parent Document Retriever :
    - summary : résumé court multi-aspects (pour le retrieval)
    - commune, dpe, poi : docs détaillés (pour le contexte LLM)
    """
    log.info("Calcul des statistiques par département...")
    dept_stats = compute_dept_stats(data)

    for dept, fields in sorted(dept_stats.items()):
        prix = fields.get("prix_median_m2", {})
        log.info(f"  {dept} ({DEPT_NAMES.get(dept, '?')}) : "
                 f"prix médian moyen {prix.get('mean', 0):.0f}€/m², "
                 f"{fields.get('prix_median_m2', {}).get('count', 0)} communes")

    docs = []
    for c in data:
        dept = c.get("code_departement", "").strip()
        ds = dept_stats.get(dept, {})

        # Document résumé (pour le retrieval sémantique)
        docs.append(build_summary_doc(c, ds))

        # Documents détaillés (pour le contexte LLM)
        docs.append(build_commune_doc(c, ds))

        dpe_doc = build_dpe_doc(c, ds)
        if dpe_doc:
            docs.append(dpe_doc)

        poi_doc = build_poi_doc(c, ds)
        if poi_doc:
            docs.append(poi_doc)

    return docs


def main():
    parser = argparse.ArgumentParser(description="Génération du corpus RAG HomePedia")
    parser.add_argument(
        "--source", choices=["mock", "postgres"], default="mock",
        help="Source des données Gold (default: mock)"
    )
    args = parser.parse_args()

    log.info("Construction du corpus RAG HomePedia...")
    data = load_gold_data(args.source)
    docs = build_corpus(data)

    output_path = os.path.join(os.path.dirname(__file__), "corpus.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(docs, f, ensure_ascii=False, indent=2)

    # Stats
    types = {}
    for d in docs:
        t = d["metadata"]["type"]
        types[t] = types.get(t, 0) + 1

    log.info(f"Corpus généré : {len(docs)} documents")
    for t, n in sorted(types.items()):
        log.info(f"  - {t}: {n}")
    log.info(f"Sauvegardé dans {output_path}")

    # Aperçu
    log.info("")
    log.info("Aperçu (3 premiers documents) :")
    for d in docs[:3]:
        log.info(f"  [{d['metadata']['type']}] {d['metadata'].get('city', '?')}")
        log.info(f"    {d['text'][:200]}...")


if __name__ == "__main__":
    main()
