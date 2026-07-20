# Prompt de reprise — HomePedia IDF

> À coller au début d'une session avec un assistant IA travaillant sur ce dépôt.
> Ne contient aucun secret : les identifiants se lisent dans l'environnement.

---

## Ce qu'est le projet

HomePedia IDF est une application d'aide à la décision immobilière sur les
**1 268 communes d'Île-de-France**. Elle ne cherche pas à concurrencer les portails
d'annonces : elle répond aux trois questions qu'ils ne traitent pas.

1. **Où chercher ?** (`/dossier`) — classe les communes selon le critère prioritaire
   de l'utilisateur, sous contrainte de budget
2. **Ce prix est-il justifié ?** (`/estimation`) — situe un bien dans la distribution
   des ventes comparables, chiffre une cible de négociation
3. **Ce loyer est-il correct ?** (`/loyer`) — compare au marché local et contrôle
   l'encadrement des loyers

S'y ajoutent la gestion locative (bailleur et locataire), un chatbot RAG et les
écrans d'exploration (carte, transactions, dashboard, comparateur, Pareto).

## Stack

- **Backend** : Go 1.22 + Gin — `backend/`, déployé sur Cloud Run
- **Frontend** : React 18 + Vite + Tailwind — `frontend/`
- **Base** : PostgreSQL + PostGIS chez Supabase
- **RAG** : FastAPI + pgvector + sentence-transformers + llama-cpp — `rag/`
- **Chatbot SQL** : Flask + Qwen2.5-0.5B — `chatbot/` (distinct du RAG)
- **Ingestion** : Python — `ingestion/`
- **Déploiement** : `gcloud builds submit --config cloudbuild.yaml .` (~3 min)
  - RAG : `cloudbuild-rag.yaml` · chatbot : `cloudbuild-chatbot.yaml` (10-15 min)

## Accès

Toutes les connexions lisent `SUPABASE_PASSWORD` dans l'environnement. Les scripts
refusent de démarrer sans elle, avec un message explicite. **Ne jamais réintroduire
d'identifiant en dur** : ils ont été retirés du code, mais subsistent dans
l'historique git — le mot de passe doit être renouvelé côté Supabase.

---

## Contraintes à connaître avant d'agir

### Supabase free tier : 500 Mo

Le dépassement bascule le projet en **lecture seule**, et aucune commande SQL ne
lève le verrou (`SET`, `ALTER DATABASE`, connexion directe : toutes rejetées). Il
faut passer par le dashboard → Settings → Database → *Disable read-only mode*, qui
ouvre une fenêtre d'écriture d'environ 15 minutes.

**Vérifier la marge disponible avant toute création de table volumineuse.** La base
tourne autour de 380 Mo après nettoyage.

Si de l'espace doit être récupéré : `VACUUM FULL` exige le double de la taille de la
table en espace libre et échouera sur un disque plein. L'ordre qui fonctionne est
`DELETE` → `REINDEX` chaque index individuellement → `VACUUM FULL`. Les index
gonflent énormément après suppression : sur ce dépôt, leur reconstruction a libéré
plus que le vacuum lui-même.

### Git

`origin` pointe vers le dépôt Epitech — **ne jamais y pousser**. Le dépôt personnel
est `lekrikri/homepedia-idf`. Les historiques ayant divergé sans ancêtre commun, le
cherry-pick n'est pas praticable : cloner dans `/tmp/clean-personal`, y extraire
`git archive HEAD` (n'exporte que les fichiers suivis, aucun non-tracké ne fuite),
puis commit de synchronisation.

---

## Leçons de la dernière session — ce qui casse en pratique

Ces bugs ont tous la même origine : **une valeur écrite de mémoire au lieu d'être
dérivée des données**. Le vérifier est le premier réflexe utile.

- **Listes de communes en dur** : le détecteur d'intention du chatbot n'en connaissait
  que 78 sur 1 266. Demander « Bobigny ? » renvoyait Neuilly-sur-Seine, la commune
  n'étant pas reconnue et l'intention retombant sur le classement régional par défaut.
- **Table d'encadrement des loyers saisie de mémoire** : deux communes y figuraient
  à tort et quatre manquaient, avec des conséquences juridiques opposées pour les
  locataires.
- **Table IRL périmée et décalée d'un trimestre** : le calculateur d'indexation
  produisait une révision de 2,65 % au lieu de 1,04 %, soit une augmentation illégale.
  Révélé en comparant avec un avis d'indexation réel.
- **Arrondissements parisiens non rattachés** : Paris comptait 30 732 ventes au lieu
  de 188 252. Toujours normaliser `751xx → 75056`.
- **Une commune entière absente des agrégats** : Pierrefitte-sur-Seine, 32 379
  habitants, invisible dans toute l'application alors que ses transactions existaient.
- **Double encodage UTF-8** (`DÃ©pendance`) coupant en deux les filtres par type.
  Se répare par `convert_from(convert_to(col,'LATIN1'),'UTF8')`, jamais par
  comparaison de chaînes depuis un terminal.
- **Regex sans frontières de mot** : `sport` bloquait « transports » dans le
  garde-fou du RAG. Tester les faux positifs autant que les vrais refus.
- **Statistiques d'index à zéro** : `pg_stat_user_indexes` affichait 0 utilisation sur
  des index vitaux, les compteurs ayant été réinitialisés. Ne jamais supprimer un
  index sur cette base à partir de ces chiffres.

---

## Principes de conception à respecter

**Ne jamais afficher un indicateur sans sa limite.** Trois drapeaux de fiabilité
existent déjà et doivent être honorés :
- `tf_estimation_fiable` — le montant de taxe foncière n'a pas de sens dans les 68
  communes où la base moyenne est dominée par des locaux professionnels
- `copro_stats_fiables` — les proportions ne sont exposées qu'au-delà de 20 copropriétés
- L'estimation exige **40 ventes comparables** minimum par commune

**Un pourcentage sur un effectif minuscule induit en erreur** : « 100 % de copropriétés
aidées » sur une seule copropriété est un faux signal d'alarme.

**Les données approchées appellent des verdicts prudents.** `loyer_median_m2` est une
extrapolation d'une moyenne départementale 2022, pas une observation : les seuils de
verdict sont volontairement larges, et la note de méthode le dit à l'utilisateur.

**Écrire pour quelqu'un qui n'y connaît rien.** Les libellés nomment l'intention
(« Ce prix est-il juste ? ») plutôt que l'écran (« Estimation »). Chaque chiffre
s'accompagne de ce qu'il faut en faire.

**Les documents imprimables** passent par `frontend/src/components/outils/document.js` :
charte, en-tête de marque, encarts colorés selon le sens, icônes de section.

---

## Vérification

Un test qui ne fait que vérifier la présence de balises ne prouve rien. Les tests
Playwright (`e2e/tests/`) exercent le parcours réel — remplir, soumettre, observer —
et collectent les erreurs de console, qui sont le symptôme le plus fiable d'un
composant cassé.

```bash
cd e2e && npx playwright test --project=chromium --reporter=line
```

Le didacticiel s'ouvre au premier passage et intercepte les clics : les tests posent
`hp_tour_done` dans localStorage pour s'en affranchir.

Le RAG dispose d'un benchmark de 93 questions (`rag/benchmark_rag.py`) qui distingue
« bon document en première position », « présent mais mal classé » et « absent ».
Il inclut des cas de non-régression sur les faux positifs du garde-fou.

**Attention au piège du RAG** : Qwen connaît beaucoup de réponses juridiques de
mémoire. Une réponse juste ne prouve pas que le retrieval fonctionne — il faut
vérifier qu'un chunk de type `legal` figure dans les sources.

---

## Chantiers ouverts, par valeur décroissante

### 1. Granularité infra-communale — `scores_iris` est vide

C'est l'angle mort de fond. À Aubervilliers, les quartiers Villette–Quatre-Chemins
et Fort d'Aubervilliers ont des marchés distincts que la moyenne communale efface.
La table `iris` existe, `scores_iris` n'a jamais été alimentée. Suppose d'identifier
une source, l'ingérer sur environ 5 000 IRIS, puis reprendre estimation et dossier
pour exploiter cette finesse. **Gros chantier, plus grande valeur.**

### 2. Plafonds d'encadrement hors Paris

L'application signale l'encadrement pour 18 communes de Plaine Commune et Est
Ensemble mais ne peut chiffrer le dépassement que sur Paris, faute d'arrêtés
préfectoraux publiés dans un format exploitable. Un dépassement est récupérable sur
trois ans : c'est de l'argent concret pour l'utilisateur.

### 3. Millésime Filosofi

Les revenus datent de 2019. L'INSEE attribue un identifiant opaque à chaque édition,
sans URL prévisible : la mise à jour est manuelle. La colonne `revenus_millesime`
trace la version et doit être actualisée.

### 4. Multi-tours du RAG

Le *query rewriting* perd le fil entre deux questions : « Parle-moi de Vincennes »
puis « Et le DPE ? » ne conserve pas toujours la commune. 1/3 au dernier benchmark.

### 5. Qualité de rédaction du modèle

Qwen2.5-0.5B ramène le bon document mais formule parfois mal, et a inventé un
département pour Montreuil. Un modèle plus grand coûterait en latence et en RAM
Cloud Run — arbitrage à poser explicitement.

### Écarté volontairement

**Les annonces immobilières.** Aucun portail n'expose d'API publique, leurs CGU
interdisent l'extraction automatisée, et le scraping casse en quelques semaines tout
en exposant juridiquement. La fonction « coller une annonce » couvre le besoin sans
dépendance : l'utilisateur copie le texte, le parseur en extrait prix, surface,
pièces, commune et DPE, entièrement côté navigateur.

**Sitadel** (permis de construire) : la base nationale n'est pas exposée sous une URL
stable, les jeux disponibles sont départementaux ou antérieurs à 2010.

---

## Ce qu'on attend de vous

Vérifiez avant d'affirmer. Sur ce dépôt, plusieurs bugs sérieux ont été trouvés en
confrontant le code à des documents réels — une quittance, une annonce — plutôt qu'à
des cas de test inventés.

Dites ce que vous n'avez pas vérifié. Un écran qui compile n'est pas un écran qui
fonctionne ; une API qui répond 200 n'est pas une interface utilisable.

Préférez signaler un problème dans la demande plutôt que de l'exécuter tel quel. Sur
ce projet, élaguer les transactions 2021-2022 semblait raisonnable et aurait rendu
un quart des communes inanalysables — supprimer les lignes sans surface habitable a
libéré davantage d'espace sans aucune perte.
