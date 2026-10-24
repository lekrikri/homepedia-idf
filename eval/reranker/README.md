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
| **Retenue pour la production (CPU, 2 cœurs)** | 76,7 % | **82,2 %** | **62,5 %** | **0,9 s** |

Configuration retenue : mots-clés en OU, 30 candidats, re-ranker mMiniLM (118 M de
paramètres) sur les 10 premières fiches, textes coupés à 256 jetons.

**Ce qu'on en retient**

- **Un bug de production** : la partie mots-clés ne trouvait jamais rien. `plainto_tsquery`
  relie les mots par ET : « Combien coûtent les frais de notaire ? » exigeait « combien » ET
  « coutent » dans la fiche. Le score plein texte valait toujours 0, et l'« hybride » était
  en réalité 100 % sémantique. Les mots sont désormais reliés par OU.
- **Le re-ranker apporte l'essentiel du gain**, surtout sur les questions en langage
  courant (de 41 % à 63 % en production, jusqu'à 81 % avec plus de candidats).
- **Le choix dépend de l'infrastructure.** Sur GPU, 30 candidats et mMiniLM donnent 92 % en
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
