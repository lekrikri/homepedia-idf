"""Lecture des étiquettes énergie et GES d'un DPE (format 2011) avec Tesseract.

La valeur est écrite en blanc dans une flèche noire, dans la colonne de droite :
on localise la flèche, on prépare l'image (recadrage, agrandissement, inversion,
marge), puis Tesseract la lit en mode « une seule ligne ».
"""
import subprocess
import tempfile

from PIL import Image, ImageOps

X_COLONNE = 440            # la flèche est à droite de cette abscisse
X_FLECHE = (445, 515)      # zone horizontale du nombre dans la flèche


def trouver_fleche(image, x_debut, seuil):
    """Renvoie (haut, bas) du plus long bloc de lignes sombres : la flèche."""
    blocs = []        # liste de (debut, fin)
    debut = None      # None = on n'est pas dans un bloc

    for y in range(image.height):
        compte = 0
        for x in range(x_debut, image.width):
            if image.getpixel((x, y)) < 100:
                compte += 1
        sombre = compte > seuil

        # La ligne est sombre et on n'est pas dans un bloc : un bloc commence.
        if sombre and debut is None:
            debut = y
        # La ligne est claire et on était dans un bloc : le bloc se termine.
        elif not sombre and debut is not None:
            blocs.append((debut, y - 1))
            debut = None

    # Un bloc qui touche le bas de l'image n'a jamais été refermé.
    if debut is not None:
        blocs.append((debut, image.height - 1))

    if not blocs:
        return 0, 0
    # La flèche est le bloc le plus haut : un texte ou un trait est bien plus fin.
    return max(blocs, key=lambda b: b[1] - b[0])


def bord_droit_fleche(gris, haut, bas):
    """Dernière colonne encore noire sur la majorité des lignes de la flèche.

    Sur les vrais DPE, la flèche s'arrête parfois avant le bord de la colonne : sans ce
    réglage, la bande blanche qui suit devient un trait noir après inversion, que les
    modèles d'OCR lisent comme un « 1 ».
    """
    hauteur = bas - haut + 1
    for x in range(X_FLECHE[1], X_FLECHE[0], -1):
        sombres = sum(1 for y in range(haut, bas + 1) if gris.getpixel((x, y)) < 100)
        if sombres > hauteur / 2:
            return x
    return X_FLECHE[1]


def preparer_fleche(image):
    """Isole le nombre de la flèche et le prépare pour l'OCR. Renvoie None si pas de flèche."""
    gris = image.convert("L")
    haut, bas = trouver_fleche(gris, X_COLONNE, 5)
    if bas <= haut:
        return None
    droite = bord_droit_fleche(gris, haut, bas)
    fleche = gris.crop((X_FLECHE[0], haut, droite - 2, bas))
    fleche = fleche.resize((fleche.width * 4, fleche.height * 4), Image.LANCZOS)
    fleche = ImageOps.invert(fleche)
    return ImageOps.expand(fleche, border=30, fill=255)


def lire_nombre_tesseract(image):
    """Lit un nombre seul sur une image (mode une ligne, chiffres uniquement)."""
    with tempfile.NamedTemporaryFile(suffix=".png") as fichier:
        image.save(fichier.name)
        resultat = subprocess.run(
            ["tesseract", fichier.name, "-", "--psm", "7",
             "-c", "tessedit_char_whitelist=0123456789"],
            capture_output=True, text=True,
        )
    try:
        return int(resultat.stdout.strip())
    except ValueError:
        return None


def lire_fleche(chemin):
    """Lit le nombre écrit dans la flèche noire d'une étiquette DPE."""
    fleche = preparer_fleche(Image.open(chemin))
    if fleche is None:
        return None
    return lire_nombre_tesseract(fleche)


# Bornes hautes de chaque classe (DPE 2011). G = au-delà de la dernière borne.
TRANCHES_ENERGIE = {
    "A": 50,
    "B": 90,
    "C": 150,
    "D": 230,
    "E": 330,
    "F": 450,
}

TRANCHES_GES = {
    "A": 5,
    "B": 10,
    "C": 20,
    "D": 35,
    "E": 55,
    "F": 80,
}


def classe_depuis_valeur(valeur, tranches):
    """Renvoie la lettre de la classe (A à G) correspondant à la valeur."""
    for lettre, borne in tranches.items():
        if valeur <= borne:
            return lettre
    return "G"


if __name__ == "__main__":
    # Étiquettes extraites du vrai DPE avec : pdfimages -f 1 -l 1 -png dpe_reel.pdf /tmp/etq
    energie = lire_fleche("/tmp/etq-002.png")
    if energie is None:
        print("Énergie : lecture impossible")
    else:
        print("Énergie :", energie, "kWh/m²/an → classe", classe_depuis_valeur(energie, TRANCHES_ENERGIE))

    ges = lire_fleche("/tmp/etq-003.png")
    if ges is None:
        print("GES : lecture impossible")
    else:
        print("GES :", ges, "kg CO2/m²/an → classe", classe_depuis_valeur(ges, TRANCHES_GES))
