"""Génère de fausses étiquettes DPE (énergie et GES), avec leur vraie valeur connue.

Mise en page calquée sur les étiquettes de 2011 : 7 barres de couleur (A à G) et une
flèche noire à droite, en face de la classe, avec la valeur écrite en blanc. Chaque
étiquette est déclinée en plusieurs conditions qui imitent de vrais scans.

Les étiquettes ne contiennent aucune donnée personnelle : elles peuvent être publiées.

Lancement (depuis la racine du projet) :
    python3 ocr/generer_etiquettes.py
"""
import csv
import io
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from explore_etiquette import TRANCHES_ENERGIE, TRANCHES_GES

POLICE = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
POLICE_FINE = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
LETTRES = "ABCDEFG"
SORTIE = Path(__file__).resolve().parent / "data" / "synth"
GRAINE = 42
VALEURS_PAR_CLASSE = 5

TYPES = {
    "energie": {
        "tranches": TRANCHES_ENERGIE,
        "maximum": 600,
        "couleurs": ["#009a3b", "#52b153", "#c0d730", "#fff200", "#fcb814", "#f26c21", "#ed1c24"],
        "haut": "Logement économe",
        "bas": "Logement énergivore",
        "unite": "kWhEP/m².an",
    },
    "ges": {
        "tranches": TRANCHES_GES,
        "maximum": 120,
        "couleurs": ["#f6edfd", "#e4c7f5", "#d4a9ef", "#c78de9", "#b46ae0", "#a255d6", "#8a35c9"],
        "haut": "Faible émission de GES",
        "bas": "Forte émission de GES",
        "unite": "kgéqCO2/m².an",
    },
}


def libelles_tranches(tranches):
    """Construit les libellés des barres : « ≤ 50 », « 51 à 90 », …, « > 450 »."""
    bornes = list(tranches.values())
    libelles = [f"≤ {bornes[0]}"]
    for bas, haut in zip(bornes, bornes[1:]):
        libelles.append(f"{bas + 1} à {haut}")
    libelles.append(f"> {bornes[-1]}")
    return libelles


def dessiner_etiquette(valeur, classe, type_etiquette, fin_fleche=515):
    """Dessine une étiquette avec la flèche en face de la classe et la valeur écrite dedans.

    `fin_fleche` varie d'une étiquette à l'autre : sur les vrais DPE, la flèche ne va pas
    toujours jusqu'au bord de la colonne.
    """
    modele = TYPES[type_etiquette]
    image = Image.new("RGB", (521, 423), "white")
    draw = ImageDraw.Draw(image)
    police_lettre = ImageFont.truetype(POLICE, 22)
    police_valeur = ImageFont.truetype(POLICE, 26)
    police_texte = ImageFont.truetype(POLICE_FINE, 12)

    draw.rectangle((0, 0, 520, 422), outline="black", width=2)
    draw.line((430, 0, 430, 422), fill="black", width=1)
    draw.text((8, 6), modele["haut"], fill="black", font=police_texte)
    draw.text((448, 6), "Logement", fill="black", font=police_texte)
    draw.text((8, 402), modele["bas"], fill="black", font=police_texte)

    for i, (lettre, libelle) in enumerate(zip(LETTRES, libelles_tranches(modele["tranches"]))):
        haut = 30 + i * 52
        largeur_barre = 120 + i * 40
        draw.rectangle((10, haut, 10 + largeur_barre, haut + 40), fill=modele["couleurs"][i])
        draw.text((16, haut + 13), libelle, fill="black", font=police_texte)
        draw.text((10 + largeur_barre - 22, haut + 8), lettre, fill="black", font=police_lettre)

    # Flèche noire en face de la classe : pointe vers la gauche, corps de x = 440 à fin_fleche.
    haut = 30 + LETTRES.index(classe) * 52
    bas = haut + 40
    milieu = (haut + bas) // 2
    draw.polygon([(415, milieu), (440, haut), (fin_fleche, haut), (fin_fleche, bas), (440, bas)],
                 fill="black")
    texte = str(valeur)
    largeur_texte = draw.textlength(texte, font=police_valeur)
    centre = (440 + fin_fleche) / 2 + 3
    draw.text((centre - largeur_texte / 2, haut + 6), texte, fill="white", font=police_valeur)
    draw.text((436, bas + 4), modele["unite"], fill="black", font=police_texte)
    return image


# --- Dégradations : imitent ce qu'un scanner ou une photo fait subir au document ---

def ajouter_bruit(image, ecart_type, rng):
    pixels = np.asarray(image, dtype=np.float32)
    pixels += rng.normal(0, ecart_type, pixels.shape)
    return Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8))


def compresser_jpeg(image, qualite):
    tampon = io.BytesIO()
    image.save(tampon, format="JPEG", quality=qualite)
    tampon.seek(0)
    return Image.open(tampon).convert("RGB")


def basse_resolution(image, facteur):
    petite = image.resize((int(image.width * facteur), int(image.height * facteur)), Image.BILINEAR)
    return petite.resize(image.size, Image.BILINEAR)


def degrader(image, condition, rng):
    if condition == "propre":
        return image
    if condition == "rotation":
        return image.rotate(rng.uniform(-2, 2), resample=Image.BICUBIC, fillcolor="white")
    if condition == "flou":
        return image.filter(ImageFilter.GaussianBlur(1.5))
    if condition == "bruit":
        return ajouter_bruit(image, 25, rng)
    if condition == "basse_resolution":
        return compresser_jpeg(basse_resolution(image, 0.5), 20)
    if condition == "scan":
        image = image.rotate(rng.uniform(-1, 1), resample=Image.BICUBIC, fillcolor="white")
        image = image.filter(ImageFilter.GaussianBlur(1))
        return compresser_jpeg(ajouter_bruit(image, 15, rng), 30)
    raise ValueError(f"Condition inconnue : {condition!r}")


CONDITIONS = ["propre", "rotation", "flou", "bruit", "basse_resolution", "scan"]


def tirer_valeur(classe, tranches, maximum, rng):
    """Tire une valeur au hasard dans la tranche de la classe."""
    bornes = [0] + list(tranches.values()) + [maximum]
    i = LETTRES.index(classe)
    return int(rng.integers(bornes[i] + 1, bornes[i + 1] + 1))


def generer(sortie=SORTIE, graine=GRAINE, valeurs_par_classe=VALEURS_PAR_CLASSE):
    """Génère le jeu complet et le fichier labels.csv (vérité terrain)."""
    random.seed(graine)
    rng = np.random.default_rng(graine)
    lignes = []
    numero = 0
    for type_etiquette, modele in TYPES.items():
        for classe in LETTRES:
            for _ in range(valeurs_par_classe):
                valeur = tirer_valeur(classe, modele["tranches"], modele["maximum"], rng)
                fin_fleche = int(rng.integers(500, 516))
                etiquette = dessiner_etiquette(valeur, classe, type_etiquette, fin_fleche)
                for condition in CONDITIONS:
                    dossier = sortie / condition
                    dossier.mkdir(parents=True, exist_ok=True)
                    chemin = dossier / f"{numero:04d}_{type_etiquette}.png"
                    degrader(etiquette, condition, rng).save(chemin)
                    lignes.append({
                        "id": numero, "type": type_etiquette, "valeur": valeur, "classe": classe,
                        "condition": condition, "chemin": str(chemin.relative_to(sortie)),
                    })
                numero += 1

    with open(sortie / "labels.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(lignes[0]))
        writer.writeheader()
        writer.writerows(lignes)
    return lignes


if __name__ == "__main__":
    lignes = generer()
    print(f"{len(lignes)} images générées dans {SORTIE} ({len(CONDITIONS)} conditions)")
