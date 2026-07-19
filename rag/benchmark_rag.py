#!/usr/bin/env python3
"""Benchmark du RAG HomePedia en production.

Vérifie le retrieval (le bon document est-il ramené ?) plutôt que la formulation :
Qwen connaît beaucoup de réponses juridiques de mémoire, une réponse juste ne
prouve donc pas que le RAG fonctionne.

Trois familles de cas :
  - retrieval : un document précis est attendu dans les sources
  - garde-fou : la question doit être refusée sans appel au LLM
  - qualité   : la réponse doit (ou ne doit pas) contenir certains termes
"""
import json
import re
import time
import urllib.request

RAG = "https://homepedia-rag-714876351060.europe-west1.run.app/rag/query"

# (categorie, question, type_attendu, mot_cle_attendu)
QUESTIONS = [
    # ── Communes : prix ────────────────────────────────────────────────────
    ("commune-prix", "Quel est le prix immobilier a Vincennes ?", "commune", "Vincennes"),
    ("commune-prix", "Combien coute le metre carre a Neuilly-sur-Seine ?", "commune", "Neuilly"),
    ("commune-prix", "Quel est le prix moyen a Montreuil ?", "commune", "Montreuil"),
    ("commune-prix", "Prix au m2 a Saint-Denis", "commune", "Saint-Denis"),
    ("commune-prix", "Combien vaut un appartement a Boulogne-Billancourt ?", "commune", "Boulogne"),
    ("commune-prix", "Quel est le prix a Cergy ?", "commune", "Cergy"),

    # ── Communes : DPE / énergie ───────────────────────────────────────────
    ("commune-dpe", "Quelle est la classe DPE moyenne a Saint-Denis ?", "dpe", "Saint-Denis"),
    ("commune-dpe", "Les logements de Versailles sont-ils bien isoles ?", "dpe", "Versailles"),
    ("commune-dpe", "Quelle est la consommation energetique a Meaux ?", "dpe", "Meaux"),

    # ── Communes : cadre de vie / POI ──────────────────────────────────────
    ("commune-poi", "Est-ce que Nogent-sur-Marne est bien desservie en transports ?", "poi", "Nogent"),
    ("commune-poi", "Y a-t-il des ecoles a Antony ?", "poi", "Antony"),
    ("commune-poi", "Comment est le cadre de vie a Sceaux ?", "poi", "Sceaux"),

    # ── Communes : sécurité ────────────────────────────────────────────────
    ("commune-secu", "Quel est le niveau de securite a Aubervilliers ?", "commune", "Aubervilliers"),
    ("commune-secu", "Est-ce que Sarcelles est une ville sure ?", "commune", "Sarcelles"),

    # ── Comparaisons et classements ────────────────────────────────────────
    ("comparaison", "Compare Vincennes et Montreuil", "commune", "Vincennes"),
    ("comparaison", "Quelles sont les communes les moins cheres du 93 ?", "commune", None),
    ("comparaison", "Ou investir avec un budget de 300000 euros en Seine-Saint-Denis ?", "commune", None),
    ("comparaison", "Quelle commune du Val-de-Marne a le meilleur cadre de vie ?", "commune", None),
    ("comparaison", "Quelles sont les villes les plus cheres des Hauts-de-Seine ?", "commune", None),
    ("comparaison", "Ou trouver un logement abordable en Essonne ?", "commune", None),

    # ── Juridique : bail et location ───────────────────────────────────────
    ("legal-location", "Quel est le depot de garantie maximum pour un meuble ?", "legal", "garantie"),
    ("legal-location", "Combien de temps dure un bail de location vide ?", "legal", "bail"),
    ("legal-location", "Quel preavis pour quitter mon logement en zone tendue ?", "legal", "avis"),
    ("legal-location", "Comment fonctionne la revision du loyer avec l'IRL ?", "legal", "IRL"),
    ("legal-location", "Qui paie la reparation d'un chauffe-eau, locataire ou proprietaire ?", "legal", "paration"),
    ("legal-location", "Quelles charges le proprietaire peut-il me refacturer ?", "legal", "harges"),
    ("legal-location", "Mon proprietaire peut-il m'expulser en hiver ?", "legal", "hivernale"),
    ("legal-location", "Qu'est-ce qu'un logement decent ?", "legal", "cent"),
    ("legal-location", "Puis-je sous-louer mon appartement ?", "legal", "ous-location"),
    ("legal-location", "Comment se passe un etat des lieux de sortie ?", "legal", "tat des lieux"),
    ("legal-location", "Quels sont les types de baux d'habitation ?", "legal", "bail"),
    ("legal-location", "Mon proprietaire peut-il me donner conge ?", "legal", "ong"),
    ("legal-location", "Comment fonctionne une colocation ?", "legal", "colocation"),
    ("legal-location", "Qu'est-ce que l'encadrement des loyers ?", "legal", "ncadrement"),
    ("legal-location", "C'est quoi une zone tendue ?", "legal", "tendue"),
    ("legal-location", "Quels sont les honoraires d'agence en location ?", "legal", "onoraires"),
    ("legal-location", "Que faire en cas de litige avec mon proprietaire ?", "legal", "onciliation"),

    # ── Juridique : diagnostics ────────────────────────────────────────────
    ("legal-diag", "Quels diagnostics sont obligatoires pour louer ?", "legal", "iagnostic"),
    ("legal-diag", "A quoi sert le diagnostic plomb ?", "legal", "plomb"),
    ("legal-diag", "Combien de temps est valable un DPE ?", "legal", "DPE"),

    # ── Juridique : achat et financement ───────────────────────────────────
    ("legal-achat", "Combien coutent les frais de notaire ?", "legal", "notaire"),
    ("legal-achat", "Qu'est-ce que le PTZ et qui peut en beneficier ?", "legal", "PTZ"),
    ("legal-achat", "Comment est calculee la plus-value immobiliere ?", "legal", "plus-value"),
    ("legal-achat", "Quelle difference entre loi Carrez et loi Boutin ?", "legal", "Carrez"),
    ("legal-achat", "Faut-il un permis de construire pour une veranda ?", "legal", "ermis de construire"),
    ("legal-achat", "Comment se deroule un achat immobilier ?", "legal", "achat"),
    ("legal-achat", "Comment fonctionne un credit immobilier ?", "legal", "dit"),
    ("legal-achat", "Puis-je vendre un bien avec un locataire dedans ?", "legal", "locataire"),
    ("legal-achat", "Comment se passe une succession immobiliere ?", "legal", "uccession"),

    # ── Juridique : aides ──────────────────────────────────────────────────
    ("legal-aides", "Comment demander l'APL ?", "legal", "APL"),
    ("legal-aides", "C'est quoi la garantie Visale ?", "legal", "Visale"),
    ("legal-aides", "Suis-je eligible a MaPrimeRenov ?", "legal", "MaPrimeR"),
    ("legal-aides", "Comment acceder a un logement social ?", "legal", "HLM"),
    ("legal-aides", "Qu'est-ce que le DALO ?", "legal", "DALO"),
    ("legal-aides", "Comment financer des travaux de renovation ?", "legal", "PTZ"),
    ("legal-aides", "Quelles aides pour les salaries du prive ?", "legal", "Action Logement"),

    # ── Juridique : investissement et fiscalité ────────────────────────────
    ("legal-invest", "Comment fonctionne le dispositif Pinel ?", "legal", "Pinel"),
    ("legal-invest", "Quels sont les avantages d'une SCI ?", "legal", "SCI"),
    ("legal-invest", "Comment sont imposes les revenus locatifs ?", "legal", None),
    ("legal-invest", "Qu'est-ce que le deficit foncier ?", "legal", "ficit foncier"),
    ("legal-invest", "Comment fonctionne la taxe fonciere ?", "legal", "onci"),

    # ── Juridique : copropriété ────────────────────────────────────────────
    ("legal-copro", "Comment fonctionne une copropriete ?", "legal", "opropri"),
    ("legal-copro", "A quoi sert le syndic ?", "legal", "syndic"),
    ("legal-copro", "Puis-je faire des travaux dans ma copropriete ?", "legal", "ravaux"),
]

# Questions qui DOIVENT être refusées par le garde-fou (sans appel LLM).
GARDE_FOU = [
    ("gf-salutation", "Salut !"),
    ("gf-salutation", "Bonjour"),
    ("gf-salutation", "merci beaucoup"),
    ("gf-salutation", "ok merci"),
    ("gf-salutation", "Bonne journee"),
    ("gf-salutation", "au revoir"),
    ("gf-hors-idf", "Quel est le prix immobilier a Marseille ?"),
    ("gf-hors-idf", "Combien coute un appartement a Lyon ?"),
    ("gf-hors-idf", "Le marche immobilier a Bordeaux est-il tendu ?"),
    ("gf-hors-idf", "Prix au m2 a Nantes"),
    ("gf-hors-scope", "Quel temps fait-il a Paris ?"),
    ("gf-hors-scope", "Donne-moi une recette de cuisine"),
    ("gf-hors-scope", "Le bitcoin va-t-il monter ?"),
    ("gf-hors-scope", "Qui va gagner le match ce soir ?"),
]

# Questions qui doivent PASSER le garde-fou (contrôle des faux positifs).
NON_REGRESSION_GF = [
    ("gf-faux-positif", "Quel est le prix a Limoges-Fourches ?"),
    ("gf-faux-positif", "Combien coute le m2 a Tournan-en-Brie ?"),
    ("gf-faux-positif", "Quel est le prix moyen a Paris ?"),
    ("gf-faux-positif", "Quel est le depot de garantie pour un meuble ?"),
    # Régressions constatées au run précédent : "sport" bloquait "transports",
    # "cuisine" bloquait une question sur la loi Carrez.
    ("gf-faux-positif", "Est-ce que Nogent-sur-Marne est bien desservie en transports ?"),
    ("gf-faux-positif", "Quels sont les transports a Pantin ?"),
    ("gf-faux-positif", "La cuisine est-elle comptee dans la loi Carrez ?"),
    ("gf-faux-positif", "Y a-t-il des equipements sportifs a Antony ?"),
]

CONVERSATIONS = [
    ("multitours-commune", [
        ("Parle-moi de Vincennes", "commune", "Vincennes"),
        ("Et le DPE ?", "dpe", "Vincennes"),
        ("Compare avec Montreuil", "commune", "Montreuil"),
    ]),
    ("multitours-legal", [
        ("Quel est le depot de garantie pour un meuble ?", "legal", "garantie"),
        ("Et pour un logement vide ?", "legal", "garantie"),
    ]),
    ("multitours-mixte", [
        ("Quel est le prix a Vincennes ?", "commune", "Vincennes"),
        ("Quel preavis pour partir de mon logement ?", "legal", "avis"),
    ]),
]

MARQUEURS_REFUS = ("spécialisé dans l'immobilier", "Je suis l'assistant HomePedia")


def demander(question, history):
    payload = json.dumps({"question": question, "history": history}).encode()
    req = urllib.request.Request(RAG, data=payload,
                                 headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.loads(r.read())
    return data, round((time.time() - t0) * 1000)


def evaluer(data, type_attendu, mot_cle):
    sources = data.get("sources", [])
    types = [s.get("type") for s in sources]
    if type_attendu is None:
        return "N/A", f"{len(sources)} sources"
    pertinentes = [s for s in sources if s.get("type") == type_attendu]
    if not pertinentes:
        return "ECHEC", f"aucune source '{type_attendu}' (types: {sorted(set(t for t in types if t))})"
    if mot_cle is None:
        return "OK", f"{len(pertinentes)} sources '{type_attendu}'"
    for i, s in enumerate(pertinentes, start=1):
        hay = (s.get("text", "") + " " + (s.get("city") or "")).lower()
        if mot_cle.lower() in hay:
            return ("OK", f"1er chunk contient '{mot_cle}'") if i == 1 else \
                   ("PARTIEL", f"'{mot_cle}' en position {i}")
    return "ECHEC", f"'{mot_cle}' absent des sources '{type_attendu}'"


resultats = []


def enregistrer(cat, q, statut, detail, rep, ms):
    resultats.append({"categorie": cat, "question": q, "statut": statut,
                      "detail": detail, "reponse": rep[:300], "latence_ms": ms})
    print(f"[{statut:7}] {cat:18} | {ms:6} ms | {q[:52]}")
    print(f"          -> {detail}")


print("=" * 100)
print("A. RETRIEVAL")
print("=" * 100)
for cat, q, type_attendu, mot_cle in QUESTIONS:
    try:
        data, ms = demander(q, [])
        statut, detail = evaluer(data, type_attendu, mot_cle)
        rep = (data.get("answer") or "").replace("\n", " ").strip()
    except Exception as e:
        statut, detail, rep, ms = "ERREUR", str(e)[:80], "", 0
    enregistrer(cat, q, statut, detail, rep, ms)

print()
print("=" * 100)
print("B. GARDE-FOUS (doivent etre refusees, sans appel LLM)")
print("=" * 100)
for cat, q in GARDE_FOU:
    try:
        data, ms = demander(q, [])
        rep = (data.get("answer") or "").replace("\n", " ").strip()
        refuse = any(m in rep for m in MARQUEURS_REFUS)
        nb_src = len(data.get("sources", []))
        if refuse and nb_src == 0:
            statut, detail = "OK", f"refus correct ({ms} ms, 0 source)"
        elif refuse:
            statut, detail = "PARTIEL", f"refus mais {nb_src} sources renvoyees"
        else:
            statut, detail = "ECHEC", f"a repondu au lieu de refuser : {rep[:90]}"
    except Exception as e:
        statut, detail, rep, ms = "ERREUR", str(e)[:80], "", 0
    enregistrer(cat, q, statut, detail, rep, ms)

print()
print("=" * 100)
print("C. NON-REGRESSION GARDE-FOU (doivent passer)")
print("=" * 100)
for cat, q in NON_REGRESSION_GF:
    try:
        data, ms = demander(q, [])
        rep = (data.get("answer") or "").replace("\n", " ").strip()
        refuse = any(m in rep for m in MARQUEURS_REFUS)
        if refuse:
            statut, detail = "ECHEC", "FAUX POSITIF : question legitime refusee"
        else:
            statut, detail = "OK", f"passe ({len(data.get('sources', []))} sources)"
    except Exception as e:
        statut, detail, rep, ms = "ERREUR", str(e)[:80], "", 0
    enregistrer(cat, q, statut, detail, rep, ms)

print()
print("=" * 100)
print("D. CONVERSATIONS MULTI-TOURS")
print("=" * 100)
for cat, tours in CONVERSATIONS:
    history = []
    print(f"\n### {cat}")
    for q, type_attendu, mot_cle in tours:
        try:
            data, ms = demander(q, history)
            statut, detail = evaluer(data, type_attendu, mot_cle)
            rep = (data.get("answer") or "").replace("\n", " ").strip()
            history = history + [{"role": "user", "content": q},
                                 {"role": "assistant", "content": rep}]
        except Exception as e:
            statut, detail, rep, ms = "ERREUR", str(e)[:80], "", 0
        enregistrer(cat, q, statut, detail, rep, ms)

# ── Synthèse ───────────────────────────────────────────────────────────────
print()
print("=" * 100)
print("SYNTHESE")
print("=" * 100)
evalues = [r for r in resultats if r["statut"] != "N/A"]
ok = [r for r in evalues if r["statut"] == "OK"]
partiel = [r for r in evalues if r["statut"] == "PARTIEL"]
echec = [r for r in evalues if r["statut"] in ("ECHEC", "ERREUR")]

print(f"Questions posees : {len(resultats)}")
print(f"  OK      : {len(ok)}/{len(evalues)}")
print(f"  PARTIEL : {len(partiel)}")
print(f"  ECHEC   : {len(echec)}")

lat = sorted(r["latence_ms"] for r in resultats if r["latence_ms"] > 0)
if lat:
    print(f"\nLatence globale : min {lat[0]} | median {lat[len(lat)//2]} | max {lat[-1]} ms")
lat_gf = sorted(r["latence_ms"] for r in resultats
                if r["categorie"].startswith("gf-") and not r["categorie"].endswith("faux-positif")
                and r["latence_ms"] > 0)
if lat_gf:
    print(f"Latence garde-fou : median {lat_gf[len(lat_gf)//2]} ms (doit etre tres faible)")

print("\nPar categorie :")
cats = {}
for r in evalues:
    c = cats.setdefault(r["categorie"], {"ok": 0, "total": 0})
    c["total"] += 1
    if r["statut"] == "OK":
        c["ok"] += 1
for c, v in sorted(cats.items()):
    marque = "" if v["ok"] == v["total"] else "  <--"
    print(f"  {c:20} {v['ok']}/{v['total']}{marque}")

if echec or partiel:
    print("\nA examiner :")
    for r in partiel + echec:
        print(f"  [{r['statut']}] {r['categorie']} | {r['question']}")
        print(f"      {r['detail']}")

with open("/tmp/bench_rag_report.json", "w", encoding="utf-8") as f:
    json.dump(resultats, f, ensure_ascii=False, indent=2)
print("\nRapport : /tmp/bench_rag_report.json")
