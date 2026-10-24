# Re-ranker du RAG juridique

Mesure de la recherche du RAG juridique (`rag/03_rag_server.py`) : la bonne fiche
fait-elle partie des 3 que le serveur envoie au LLM ? Si elle n'y est pas, le LLM ne
peut pas répondre juste, quelle que soit sa qualité.

## Méthode

- **73 questions annotées** avec la ou les fiches qui y répondent (`questions_juridiques.json`) :
  41 reprises de `rag/benchmark_rag.py`, et 32 en langage courant, sans les mots des
  fiches (« Le ballon d'eau chaude est mort, c'est à moi de le changer ? »).
- **Recherche identique à la production** : base Neon (en lecture seule), même requête SQL
  hybride pgvector + tsvector, même modèle d'embeddings (nomic-embed-text-v1.5), mêmes
  versions de bibliothèques que `rag/Dockerfile.prod`.
- **Re-ranker** : un cross-encoder lit la question et chaque fiche ensemble pour les
  re-classer. Plus précis qu'un embedding, mais trop lent pour lire toute la base : on ne
  l'applique qu'aux candidats déjà trouvés.
- Chaque configuration est un run MLflow (expérience `homepedia-rag-reranker`).

## Résultats (24/10/2026)

| Configuration | Succès@1 | Rappel@3 | Rappel@3, langage courant | Latence médiane |
|---|---|---|---|---|
| Mots-clés seuls (production) | 0,0 % | 0,0 % | 0,0 % | 45 ms |
| Sémantique seule | 58,9 % | 71,2 % | 40,6 % | 43 ms |
| **Hybride (production avant correction)** | 58,9 % | 71,2 % | 40,6 % | 45 ms |
| Hybride + mMiniLM | 76,7 % | 80,8 % | 59,4 % | 99 ms |
| Hybride + BGE v2 M3 | 76,7 % | 80,8 % | 59,4 % | 609 ms |
| Hybride, mots-clés en OU | 60,3 % | 69,9 % | 43,8 % | 45 ms |
| Hybride OU, 30 candidats + mMiniLM | 80,8 % | **91,8 %** | **81,2 %** | 198 ms (GPU) / 3,7 s (CPU) |
| Hybride OU, 30 candidats + BGE v2 M3 | **87,7 %** | 90,4 % | 78,1 % | 1,6 s (GPU) / ~30 s (CPU) |
| Production v2 (10 fiches, 256 jetons, CPU 2 cœurs) | 76,7 % | 82,2 % | 62,5 % | 0,8 s |
| **Production v3 (8 fiches, 128 jetons, CPU 2 cœurs)** | — | **84,9 %** | **68,8 %** | **0,3 s** |

Configuration retenue (v3) : mots-clés en OU, 30 candidats, re-ranker mMiniLM (118 M de
paramètres) sur les 8 premières fiches, textes coupés à 128 jetons.

### Mesure de bout en bout sur la production

`mesure_prod.py` envoie les 73 questions à l'API déployée et vérifie les fiches renvoyées en
sources. Latence complète : recherche, re-ranking et génération par Gemini.

| Version déployée | Rappel@3 | Langage courant | Latence médiane |
|---|---|---|---|
| Avant (révision 19) | 71,2 % | 40,6 % | 2,0 s |
| v2 : 10 fiches, 256 jetons (révision 20) | 82,2 % | 62,5 % | 4,3 s |
| **v3 : 8 fiches, 128 jetons (révision 21)** | **84,9 %** | **68,8 %** | **2,4 s** |

Les précisions mesurées en production sont exactement celles du benchmark : la recherche
y est reproduite fidèlement. Par rapport à l'origine, 12 questions sont gagnées et 2 perdues.

### Réglage pour la production (25/10/2026)

La v2, déployée le 24/10, a donné en production exactement la précision prévue (82,2 %),
mais la latence médiane est passée de 2,0 s à 4,3 s : les CPU de Cloud Run sont environ
2,7 fois plus lents que le portable de mesure, même à nombre de cœurs égal. Mesures sur
le portable limité à 2 cœurs :

| Fiches re-notées | 256 jetons | 128 jetons |
|---|---|---|
| 3 | 69,9 % · 259 ms | 69,9 % · 125 ms |
| 5 | 75,3 % · 403 ms | 76,7 % · 200 ms |
| 8 | 82,2 % · 666 ms | **84,9 % · 295 ms** |
| 10 | 82,2 % · 840 ms | 84,9 % · 366 ms |

Couper à 128 jetons est à la fois plus rapide et plus précis : le titre et le début d'une
fiche suffisent à juger sa pertinence, la suite noie le modèle.

**ONNX quantifié en 8 bits** (`onnx/model_quint8_avx2.onnx`, 119 Mo au lieu de 471, testé
avec `reranker_onnx.py`) : 247 ms au lieu de 275 ms pour la même précision à 128 jetons,
et un point de rappel perdu à 256 jetons. Gain trop faible pour ajouter une dépendance :
non retenu.

**Ce qu'on en retient**

- **Un bug de production** : la partie mots-clés ne trouvait jamais rien. `plainto_tsquery`
  relie les mots par ET : « Combien coûtent les frais de notaire ? » exigeait « combien » ET
  « coutent » dans la fiche. Le score plein texte valait toujours 0, et l'« hybride » était
  en réalité 100 % sémantique. Les mots sont désormais reliés par OU.
- **Le re-ranker apporte l'essentiel du gain**, surtout sur les questions en langage
  courant (de 41 % à 63 % en production, jusqu'à 81 % avec plus de candidats).
- **Le choix dépend de l'infrastructure (mesures v2).** Sur GPU, 30 candidats et mMiniLM donnent 92 % en
  0,2 s. Cloud Run n'a pas de GPU : même mMiniLM y prendrait 3,7 s sur 30 fiches. On n'en
  re-note donc que 10, pour 82 % en 0,9 s. BGE, le plus précis à la première place, est
  inutilisable sans GPU (environ 30 s par question).
- **Limite** : le jeu de questions a été annoté à la main. Avec 73 questions, un écart de
  quelques points n'est pas significatif ; les écarts de 10 points et plus le sont.

## Utilisation

```bash
python3 -m venv --system-site-packages eval/reranker/.venv
eval/reranker/.venv/bin/pip install -r eval/reranker/requirements.txt

cd eval/reranker
.venv/bin/python benchmark_reranker.py     # mot de passe lu dans Secret Manager avec gcloud
.venv/bin/mlflow ui --backend-store-uri sqlite:///mlflow.db --port 5002
```
