"""Mesure du TTFT (temps avant le premier mot) de l'assistant HomePedia en production.

Passe par la passerelle Go publique /api/v1/chat (le chemin réel de l'utilisateur),
en streaming SSE. Pour chaque question : temps avant le premier événement « token »
(TTFT), temps total, longueur de la réponse. Pause entre requêtes (quota Gemini gratuit).
"""
import json, statistics, sys, time
import requests

URL = "https://homepedia-backend-oejl7swlxa-ew.a.run.app/api/v1/chat"
RAG = [
    "Quel est le préavis pour quitter un logement vide en zone tendue ?",
    "Mon propriétaire peut-il garder mon dépôt de garantie ?",
    "Comment contester une augmentation de loyer ?",
    "Ai-je le droit de sous-louer mon appartement ?",
    "Quels sont les frais de notaire pour un achat dans l'ancien ?",
    "Le bailleur doit-il faire les travaux de mise en décence ?",
    "Qu'est-ce que l'encadrement des loyers à Paris ?",
    "Comment fonctionne la trêve hivernale pour les expulsions ?",
    "Puis-je résilier mon bail meublé avant la fin ?",
    "Quelles aides pour rénover une passoire thermique ?",
]
SQL = [
    "Quelles sont les communes les moins chères du 93 ?",
    "Prix au m2 à Versailles",
    "Compare Montreuil et Vincennes",
    "Meilleure qualité de vie dans le 77",
    "Rendement locatif à Saint-Denis",
]

def une(question):
    t0 = time.perf_counter()
    ttft = None; texte = []; route = None; ev = None
    with requests.post(URL, json={"question": question, "history": []}, stream=True, timeout=120) as r:
        if r.status_code != 200:
            return {"q": question, "erreur": r.status_code}
        for line in r.iter_lines(decode_unicode=True):
            if line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:"):
                data = line[5:].strip()
                if ev == "meta":
                    try: route = json.loads(data).get("route")
                    except Exception: pass
                elif ev == "token":
                    if ttft is None: ttft = time.perf_counter() - t0
                    try: texte.append(json.loads(data).get("text", ""))
                    except Exception: pass
                elif ev == "done":
                    break
                elif ev == "error":
                    return {"q": question, "erreur": data}
    total = time.perf_counter() - t0
    return {"q": question, "route": route, "ttft": ttft, "total": total, "car": len("".join(texte))}

def main():
    pause = float(sys.argv[1]) if len(sys.argv) > 1 else 5
    res = []
    for i, q in enumerate(RAG + SQL):
        r = une(q)
        if "erreur" in r:
            time.sleep(10); r = une(q)  # une relance (503 du quota)
        res.append(r)
        print(json.dumps(r, ensure_ascii=False), flush=True)
        time.sleep(pause)
    json.dump(res, open("eval/ttft/resultats_ttft.json", "w"), ensure_ascii=False, indent=1)
    for route in ("rag", "sql"):
        ok = [r for r in res[1:] if r.get("route") == route and r.get("ttft")]  # 1re requête exclue (réveil)
        if ok:
            t = sorted(r["ttft"] for r in ok); tt = sorted(r["total"] for r in ok)
            print(f"{route}: n={len(ok)} TTFT médiane={statistics.median(t):.2f}s min={t[0]:.2f}s max={t[-1]:.2f}s | total médiane={statistics.median(tt):.2f}s")

if __name__ == "__main__":
    main()
