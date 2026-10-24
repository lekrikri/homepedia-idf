"""Benchmark de moteurs OCR sur les fausses étiquettes DPE, suivi dans MLflow.

Quatre moteurs, comparés sur la précision, la latence et la robustesse :
  - tesseract_brut       : Tesseract sur l'étiquette entière, sans préparation
  - tesseract_pretraite  : flèche localisée et préparée, puis Tesseract (une ligne, chiffres)
  - doctr_page           : docTR complet (détection + reconnaissance) sur l'étiquette entière
  - doctr_pretraite      : même préparation, puis la reconnaissance docTR seule

Chaque moteur est un run MLflow : exactitude de la valeur et de la classe, taux d'erreur
par caractère (CER), latence médiane, et ces mesures pour chaque condition de dégradation.

Prérequis : python3 ocr/generer_etiquettes.py
Lancement (depuis ocr/) :
    .venv/bin/python benchmark_ocr.py
Interface : mlflow ui --backend-store-uri sqlite:///mlflow.db --port 5001
"""
import csv
import os
import statistics
import subprocess
import time
from pathlib import Path

import mlflow
import numpy as np
from PIL import Image

from explore_etiquette import (TRANCHES_ENERGIE, TRANCHES_GES, X_COLONNE,
                               classe_depuis_valeur, lire_nombre_tesseract, preparer_fleche)
from generer_etiquettes import CONDITIONS, GRAINE, SORTIE

DOSSIER = Path(__file__).resolve().parent
TRACKING_URI = os.environ.get("MLFLOW_TRACKING_URI", f"sqlite:///{DOSSIER / 'mlflow.db'}")
EXPERIMENT = "homepedia-ocr-dpe"
TRANCHES = {"energie": TRANCHES_ENERGIE, "ges": TRANCHES_GES}


def chiffres(texte):
    """Garde les chiffres d'un texte et les convertit en nombre (None s'il n'y en a pas)."""
    seuls = "".join(c for c in texte if c.isdecimal())  # isdigit() accepterait « ² »
    return int(seuls) if seuls else None


# --- Moteurs : chacun reçoit une image PIL et renvoie un nombre ou None ---

def tesseract_brut(image):
    """Tesseract sur toute l'étiquette (texte épars), puis les chiffres de la colonne de droite."""
    chemin = "/tmp/ocr_bench.png"
    image.save(chemin)
    sortie = subprocess.run(["tesseract", chemin, "-", "--psm", "11", "tsv"],
                            capture_output=True, text=True).stdout
    mots = []
    for ligne in sortie.splitlines()[1:]:
        champs = ligne.split("\t")
        if len(champs) == 12 and champs[11].strip() and int(champs[6]) >= X_COLONNE:
            mots.append(champs[11])
    return chiffres(" ".join(m for m in mots if any(c.isdecimal() for c in m)))


def tesseract_pretraite(image):
    fleche = preparer_fleche(image)
    return None if fleche is None else lire_nombre_tesseract(fleche)


class Doctr:
    """Charge les modèles docTR une seule fois (sur le GPU s'il est disponible)."""

    def __init__(self):
        import torch
        from doctr.models import ocr_predictor, recognition_predictor
        self.appareil = "cuda" if torch.cuda.is_available() else "cpu"
        self.page = ocr_predictor(pretrained=True).to(self.appareil)
        self.reco = recognition_predictor(pretrained=True).to(self.appareil)

    def page_entiere(self, image):
        resultat = self.page([np.asarray(image.convert("RGB"))])
        largeur = image.width
        mots = [mot.value
                for bloc in resultat.pages[0].blocks
                for ligne in bloc.lines
                for mot in ligne.words
                if mot.geometry[0][0] * largeur >= X_COLONNE and any(c.isdecimal() for c in mot.value)]
        return chiffres(" ".join(mots))

    def pretraite(self, image):
        fleche = preparer_fleche(image)
        if fleche is None:
            return None
        texte, _confiance = self.reco([np.asarray(fleche.convert("RGB"))])[0]
        return chiffres(texte)


# --- Mesures ---

def distance_edition(a, b):
    """Nombre minimal d'insertions, suppressions ou substitutions pour passer de a à b."""
    precedente = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        courante = [i]
        for j, cb in enumerate(b, 1):
            courante.append(min(precedente[j] + 1, courante[j - 1] + 1, precedente[j - 1] + (ca != cb)))
        precedente = courante
    return precedente[-1]


def cer(prediction, verite):
    """Taux d'erreur par caractère : 0 = parfait, 1 = rien de lu."""
    attendu = str(verite)
    lu = "" if prediction is None else str(prediction)
    return distance_edition(lu, attendu) / len(attendu)


def resumer(lignes):
    n = len(lignes)
    return {
        "exactitude_valeur": 100 * sum(l["valeur_ok"] for l in lignes) / n,
        "exactitude_classe": 100 * sum(l["classe_ok"] for l in lignes) / n,
        "taux_lecture_impossible": 100 * sum(l["prediction"] is None for l in lignes) / n,
        "cer_moyen": sum(l["cer"] for l in lignes) / n,
        "latence_mediane_ms": statistics.median(l["latence_ms"] for l in lignes),
    }


def evaluer(nom, moteur, exemples):
    moteur(Image.open(SORTIE / exemples[0]["chemin"]))  # échauffement (chargement, cache GPU)
    lignes = []
    for ex in exemples:
        image = Image.open(SORTIE / ex["chemin"])
        debut = time.perf_counter()
        prediction = moteur(image)
        latence = (time.perf_counter() - debut) * 1000
        verite = int(ex["valeur"])
        classe = None if prediction is None else classe_depuis_valeur(prediction, TRANCHES[ex["type"]])
        lignes.append({**ex, "moteur": nom, "prediction": prediction, "latence_ms": latence,
                       "valeur_ok": prediction == verite, "classe_ok": classe == ex["classe"],
                       "cer": cer(prediction, verite)})
    return lignes


def main():
    exemples = list(csv.DictReader(open(SORTIE / "labels.csv", encoding="utf-8")))
    print(f"{len(exemples)} images, conditions : {', '.join(CONDITIONS)}")

    mlflow.set_tracking_uri(TRACKING_URI)
    if mlflow.get_experiment_by_name(EXPERIMENT) is None:
        mlflow.create_experiment(EXPERIMENT, artifact_location=(DOSSIER / "mlartifacts").as_uri())
    mlflow.set_experiment(EXPERIMENT)

    version_tesseract = subprocess.run(["tesseract", "--version"], capture_output=True,
                                       text=True).stdout.splitlines()[0]
    doctr = Doctr()
    moteurs = {
        "tesseract_brut": (tesseract_brut, "tesseract"),
        "tesseract_pretraite": (tesseract_pretraite, "tesseract"),
        "doctr_page": (doctr.page_entiere, "doctr"),
        "doctr_pretraite": (doctr.pretraite, "doctr"),
    }

    tableau = []
    for nom, (moteur, famille) in moteurs.items():
        print(f"- {nom} …", flush=True)
        with mlflow.start_run(run_name=nom):
            mlflow.log_params({
                "moteur": nom, "famille": famille, "nb_images": len(exemples),
                "graine_jeu": GRAINE, "conditions": ",".join(CONDITIONS),
                "version": version_tesseract if famille == "tesseract" else f"doctr {doctr.appareil}",
            })
            lignes = evaluer(nom, moteur, exemples)
            global_ = resumer(lignes)
            mlflow.log_metrics(global_)
            for condition in CONDITIONS:
                par_condition = resumer([l for l in lignes if l["condition"] == condition])
                mlflow.log_metrics({f"{cle}_{condition}": v for cle, v in par_condition.items()})

            fichier = DOSSIER / "data" / f"predictions_{nom}.csv"
            with open(fichier, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=list(lignes[0]))
                writer.writeheader()
                writer.writerows(lignes)
            mlflow.log_artifact(str(fichier))

            tableau.append((nom, global_, {c: resumer([l for l in lignes if l["condition"] == c])
                                           for c in CONDITIONS}))
            print(f"     exactitude {global_['exactitude_valeur']:.1f} %, "
                  f"latence {global_['latence_mediane_ms']:.0f} ms")

    print("\nExactitude de la valeur (%) par condition")
    print(f"{'moteur':<22}" + "".join(f"{c[:10]:>11}" for c in CONDITIONS) + f"{'global':>9}{'ms':>7}")
    for nom, global_, par in tableau:
        print(f"{nom:<22}" + "".join(f"{par[c]['exactitude_valeur']:>11.1f}" for c in CONDITIONS)
              + f"{global_['exactitude_valeur']:>9.1f}{global_['latence_mediane_ms']:>7.0f}")


if __name__ == "__main__":
    main()
