# OCR des diagnostics DPE

Lecture automatique de la consommation d'énergie et des émissions de GES sur les
étiquettes d'un DPE (format 2011). Sur ces PDF, le texte courant est lisible
directement, mais les valeurs clés sont des **images** : il faut de l'OCR.

## Méthode

1. `pdfimages` extrait les images du PDF, dont les deux étiquettes.
2. La valeur est écrite en blanc dans une flèche noire, placée en face de la classe.
   On la localise par un **profil de projection** : nombre de pixels sombres par ligne,
   découpé en blocs, dont on garde le plus haut. Le bord droit est détecté de la même façon.
3. Préparation : recadrage, agrandissement ×4, inversion, marge blanche.
4. Lecture du nombre, puis classe déduite des tranches officielles (A à G).
   Une lecture impossible renvoie `None` au lieu de planter.

## Benchmark

Jeu synthétique de 70 étiquettes (énergie et GES, toutes classes), chacune en 6 conditions
qui imitent de vrais scans : 420 images, valeurs connues par construction, aucune donnée
personnelle. Chaque moteur est un run MLflow (expérience `homepedia-ocr-dpe`).

| Moteur | Valeur exacte | Classe exacte | Lecture impossible | CER | Latence médiane |
|---|---|---|---|---|---|
| Tesseract, étiquette entière | 2,9 % | 4,0 % | 91,0 % | 0,96 | 156 ms |
| Tesseract, flèche préparée | 94,3 % | 94,3 % | 4,5 % | 0,05 | 107 ms |
| docTR, étiquette entière | 81,7 % | 83,1 % | 13,3 % | 0,17 | 103 ms |
| **docTR, flèche préparée** | **99,3 %** | **99,8 %** | **0 %** | **0,01** | **33 ms** |

Exactitude de la valeur par condition :

| Moteur | Propre | Rotation | Flou | Bruit | Basse résolution | Scan |
|---|---|---|---|---|---|---|
| Tesseract, étiquette entière | 1,4 | 0,0 | 7,1 | 1,4 | 2,9 | 4,3 |
| Tesseract, flèche préparée | 98,6 | 98,6 | 87,1 | 95,7 | 95,7 | 90,0 |
| docTR, étiquette entière | 84,3 | 84,3 | 72,9 | 91,4 | 71,4 | 85,7 |
| **docTR, flèche préparée** | **100** | **95,7** | **100** | **100** | **100** | **100** |

Mesures du 24/10/2026, Tesseract 5.3.4 et docTR 1.1.0 (GPU RTX 3060).

**Ce qu'on en retient**

- Sans préparation, Tesseract ne lit presque jamais un chiffre blanc sur fond noir au milieu d'un graphique.
- Le modèle docTR fait mieux seul, mais la préparation reste décisive : elle fait gagner 17 points et divise la latence par trois, car on ne lui donne qu'une petite zone.
- Le jeu synthétique ne suffit pas. Sur un vrai DPE, la flèche s'arrêtait avant le bord de la colonne : docTR lisait « 3521 » au lieu de 352. La détection du bord droit et des flèches de longueur variable dans le générateur ont corrigé l'écart. Les deux étiquettes du vrai DPE sont désormais lues correctement.

## Utilisation

```bash
sudo apt install tesseract-ocr tesseract-ocr-fra
python3 -m venv --system-site-packages ocr/.venv
ocr/.venv/bin/pip install -r ocr/requirements.txt

cd ocr
.venv/bin/python generer_etiquettes.py      # jeu synthétique dans data/synth/
.venv/bin/python benchmark_ocr.py           # 4 runs MLflow
.venv/bin/mlflow ui --backend-store-uri sqlite:///mlflow.db --port 5001
```

Les vrais DPE contiennent des données personnelles : ils restent dans `data/private/`, exclu de Git.
