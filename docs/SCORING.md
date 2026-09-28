# Méthodologie des scores HomePedia

> Comment HomePedia note les **1 266 communes** d'Île-de-France.
> Source de vérité : [`ingestion/scores/compute_scores.py`](../ingestion/scores/compute_scores.py)
> pour les scores composites, et les scripts d'ingestion cités ci-dessous pour les
> indicateurs sources.

Les scores HomePedia sont des **indices relatifs normalisés**, pas des notes absolues.
Un score de 70 ne dit pas « cette commune vaut 70/100 dans l'absolu » mais « elle se
situe dans le haut du panier francilien sur cet axe ». Ce parti pris est assumé : il
rend les 1 266 communes comparables entre elles, ce qui est précisément l'usage visé
(aide à la décision par comparaison).

---

## 1. La normalisation, commune à tous les scores composites

Chaque variable brute (prix, IPS, nombre de transactions…) est ramenée sur une échelle
**0–100** par **écrêtage aux percentiles 5 et 95**, puis mise à l'échelle linéaire :

```python
low  = percentile(série, 5)
high = percentile(série, 95)
valeur_normalisée = clip(valeur, low, high) → (valeur − low) / (high − low) × 100
```

Deux choix structurants :

- **Écrêtage 5ᵉ–95ᵉ** : une commune aux valeurs aberrantes (un prix délirant, un unique
  quartier ultra-doté) n'écrase pas l'échelle pour toutes les autres.
- **`invert=True` quand « moins = mieux »** : prix d'achat, consommation d'énergie,
  émissions GES sont inversés avant pondération.
- **Valeur manquante → médiane régionale IDF** : aucune commune n'est trouée, toutes
  obtiennent un score. Une donnée absente n'est ni un zéro (injuste) ni un blanc
  (inexploitable) : c'est « comme la commune médiane » jusqu'à preuve du contraire.

---

## 2. Les indicateurs sources

Trois axes affichés sur la carte ne sont pas des composites : ce sont des indicateurs
calculés directement depuis les données réelles.

### 🛡️ Sécurité — [`ingest_ssmsi_communal.py`](../ingestion/delinquance/ingest_ssmsi_communal.py)

Calculé sur les **taux de délinquance communaux réels** du SSMSI (et non des taux
départementaux plaqués sur chaque commune). Pour chaque commune :

```
score = Σ (1 − min(taux_indicateur / borne, 1)) × poids   ×  100
        ────────────────────────────────────────────────
                     Σ poids des indicateurs présents
```

| Indicateur (taux pour mille) | Poids | Borne haute (‰) |
|---|---|---|
| Cambriolages de logement | 35 % | 20 |
| Violences physiques hors cadre familial | 25 % | 15 |
| Vols violents sans arme | 20 % | 8 |
| Vols sans violence contre des personnes | 10 % | — |
| Destructions et dégradations volontaires | 10 % | — |

- **100 = aucune atteinte constatée** ; le score baisse à mesure que les taux montent.
- **Bornes absolues nationales**, pas relatives à l'IDF : une normalisation
  intra-régionale ferait passer une commune francilienne médiane pour « sûre », alors
  qu'elle ne l'est pas forcément au regard du reste du pays.
- **Stupéfiants et atteintes aux véhicules sont volontairement écartés** : très
  inégalement signalés d'une commune à l'autre, ils ajoutent du bruit plus qu'ils
  n'informent.
- Une commune à laquelle il manque un indicateur n'est **pas pénalisée** (renormalisation
  sur les poids réellement présents).

### ⚡ DPE — [`recalcul_dpe_score.py`](../ingestion/recalcul_dpe_score.py)

Moyenne des classes énergie **réelles des transactions DVF** (1,9 M biens avec classe
énergie), et non des DPE bâtiments ADEME. Barème :

| Classe | A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|---|
| Points | 100 | 85 | 65 | 45 | 25 | 10 | 0 |

### 💰 Rendement — couche Gold Databricks

`rendement_locatif_brut` = loyer annuel de marché ÷ prix d'achat, exprimé en %.
Le loyer de marché provient du croisement DVF × barèmes d'encadrement / observatoires.

---

## 3. Les scores composites

Tous produits par [`compute_scores.py`](../ingestion/scores/compute_scores.py), à partir
de la table `communes_agregat`.

### 🏡 Qualité de vie

Le cadre de vie au quotidien.

| Composante | Poids |
|---|---|
| Environnement scolaire (IPS moyen) | 30 % |
| Qualité énergétique du bâti (% DPE bon) | 20 % |
| Densité d'équipements *(transport + éducation + santé + parcs, par km²)* | 20 % |
| Sobriété énergétique (conso élec/logement, **inversé**) | 15 % |
| % d'écoles favorisées | 15 % |

### 📈 Investissement

L'attractivité pour un investisseur immobilier.

| Composante | Poids |
|---|---|
| Liquidité du marché (nombre de transactions) | 25 % |
| Qualité sociale (IPS moyen) | 25 % |
| Qualité énergétique (% DPE bon, future réglementation) | 20 % |
| Point d'entrée (prix médian au m², **inversé** — moins cher = meilleure opportunité) | 15 % |
| Signal de gentrification (commerces bio/bobo) | 15 % |

### 🛡️ Stabilité *(risque de dévaluation)*

La résistance du parc à la dévaluation réglementaire (passoires thermiques).

| Composante | Poids |
|---|---|
| Classe DPE moyenne (**inversée** — A bon, G mauvais) | 30 % |
| Consommation d'énergie (**inversée**) | 25 % |
| Émissions GES (**inversées**) | 25 % |
| % de logements en bon DPE (A/B/C) | 20 % |

### 🚉 Accessibilité

L'accès aux services et aux transports.

| Composante | Poids |
|---|---|
| Transports en commun (nombre d'arrêts) | 40 % |
| Proximité de Paris (distance **inversée**) | 40 % |
| Couverture fibre FTTH | 20 % |

> **Proximité Paris** : < 5 km → 100 pts · 30 km → 50 pts · > 70 km → 0 pt.

---

## 4. ⭐ Le Score Global

La synthèse pondérée de tout ce qui précède :

```
Score Global = Qualité de vie   × 30 %
             + Investissement    × 20 %
             + Accessibilité     × 20 %
             + Stabilité DPE     × 15 %
             + Sécurité          × 15 %
```

La qualité de vie pèse le plus (30 %) parce que c'est le critère qui concerne **tous**
les usages — habiter, investir, louer — là où l'investissement ou l'accessibilité ne
comptent que pour une partie des utilisateurs.

---

## 5. Limites assumées

Un score exact mais présenté avec plus d'assurance qu'il n'en mérite trompe autant
qu'un score faux. HomePedia essaie de tenir cette ligne :

- **Ce sont des indices relatifs**, calés sur la distribution francilienne. Ils
  classent, ils ne certifient pas une valeur intrinsèque.
- **Le décalage DVF** (publication semestrielle + délai des actes, 6 à 12 mois) touche
  surtout le prix et le rendement. Les axes structurels (IPS, sécurité, DPE, démographie)
  bougent lentement et sont bien plus stables. Comme le classement est comparatif et
  iso-millésime, le retard s'applique uniformément et le **rang relatif reste robuste**
  même si le niveau absolu est daté.
- **Un contrôle anti-biais tourne à chaque build** :
  [`scripts/controle_donnees.py`](../scripts/controle_donnees.py) vérifie notamment qu'un
  score fondé sur trop peu de diagnostics n'est pas publié comme une observation solide,
  et croise les estimations de loyer avec les barèmes préfectoraux.

---

## 6. Reproduire le calcul

```bash
# Variables POSTGRES_* pointant sur la base cible, puis :
python3 ingestion/scores/compute_scores.py
```

Le script lit `communes_agregat`, calcule les cinq scores, les réécrit dans la table, et
affiche la distribution (min / p25 / médiane / p75 / max) ainsi que les Top/Bottom 5 par
axe. Idempotent : relançable à volonté après une mise à jour des données sources.
