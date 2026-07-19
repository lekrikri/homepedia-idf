/**
 * Extraction des caractéristiques d'une annonce immobilière collée.
 *
 * Les portails n'exposent pas d'API et interdisent l'extraction automatisée.
 * L'utilisateur reste donc l'intermédiaire : il copie le texte, l'application
 * en tire le prix, la surface, le nombre de pièces, la commune et le DPE.
 *
 * Le parseur vise les formats courants et assume ses limites : chaque valeur
 * trouvée est présentée à l'utilisateur, qui corrige avant de lancer le calcul.
 * Mieux vaut un champ vide qu'une valeur inventée.
 */

const nombreDepuis = t => {
  // "185 000", "185.000", "185,000" désignent tous cent quatre-vingt-cinq mille.
  const nettoye = (t || "").replace(/[\s.  ]/g, "").replace(",", ".");
  const v = parseFloat(nettoye);
  return Number.isFinite(v) ? v : null;
};

const sansAccent = t =>
  (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Prix de vente : le plus gros montant en euros du texte. */
function extrairePrix(texte) {
  const montants = [];
  const re = /(\d[\d\s.,  ]{2,12})\s*(?:€|eur\b|euros?\b)/gi;
  let m;
  while ((m = re.exec(texte)) !== null) {
    const v = nombreDepuis(m[1]);
    // On écarte les prix au m² et les charges : sous 20 000 €, ce n'est pas un
    // prix de vente ; au-delà de 5 M€, c'est probablement une coquille.
    if (v && v >= 20000 && v <= 5000000) {
      const contexte = sansAccent(texte.slice(Math.max(0, m.index - 40), m.index));
      // "3 500 €/m²" ou "charges : 180 €" ne sont pas le prix du bien.
      const suite = texte.slice(m.index, m.index + m[0].length + 6);
      if (/\/\s*m|par\s*m|au\s*m/i.test(suite)) continue;
      if (/charge|honoraire|taxe|loyer|mensualit/.test(contexte)) continue;
      montants.push(v);
    }
  }
  return montants.length ? Math.max(...montants) : null;
}

/** Surface habitable, en m². */
function extraireSurface(texte) {
  const candidats = [];
  const re = /(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:m²|m2|m\s?carr|metres?\s?carr|mètres?\s?carr)/gi;
  let m;
  while ((m = re.exec(texte)) !== null) {
    const v = nombreDepuis(m[1]);
    if (!v || v < 7 || v > 500) continue; // hors bornes d'un logement
    const contexte = sansAccent(texte.slice(Math.max(0, m.index - 45), m.index));
    // Terrain, balcon, cave et séjour ne sont pas la surface habitable.
    if (/terrain|jardin|balcon|terrasse|cave|parking|box|sejour|salon|chambre|cuisine|loggia/.test(contexte)) {
      continue;
    }
    candidats.push(v);
  }
  // À défaut de mention explicite d'habitable, la plus grande surface plausible
  // est presque toujours la bonne.
  return candidats.length ? Math.max(...candidats) : null;
}

/** Nombre de pièces : "3 pièces", "T3", "F3". */
function extrairePieces(texte) {
  const t = sansAccent(texte);
  const parType = t.match(/\b[tf]\s?(\d)\b/);
  if (parType) {
    const v = parseInt(parType[1], 10);
    if (v >= 1 && v <= 9) return v;
  }
  const parMot = t.match(/(\d{1,2})\s*(?:pieces?|p\b)/);
  if (parMot) {
    const v = parseInt(parMot[1], 10);
    if (v >= 1 && v <= 9) return v;
  }
  if (/\bstudio\b/.test(t)) return 1;
  return null;
}

/** Code postal francilien. */
function extraireCodePostal(texte) {
  const codes = texte.match(/\b(7[578]\d{3}|9[1-5]\d{3})\b/g);
  return codes ? codes[0] : null;
}

/** Étiquette DPE, en évitant de confondre avec le GES. */
function extraireDpe(texte) {
  const t = sansAccent(texte);
  const re = /(dpe|classe\s+energ\w*|performance\s+energ\w*|energie)\s*[:\-–]?\s*([a-g])\b/;
  const m = t.match(re);
  if (m) return m[2].toUpperCase();
  const vierge = t.match(/\bdpe\s*(?:vierge|non\s+r[eé]alis)/);
  return vierge ? "VIERGE" : null;
}

/** Type de bien. */
function extraireType(texte) {
  const t = sansAccent(texte);
  if (/\bmaison|pavillon|villa\b/.test(t)) return "Maison";
  if (/\bappartement|appart\b|\bstudio\b|\bduplex\b|\bloft\b/.test(t)) return "Appartement";
  return null;
}

/** Charges de copropriété mensuelles, souvent mentionnées séparément. */
function extraireCharges(texte) {
  const t = sansAccent(texte);
  const m = t.match(/charges?[^\d]{0,25}(\d[\d\s.,]{1,7})\s*(?:€|eur)/);
  if (!m) return null;
  const v = nombreDepuis(m[1]);
  return v && v >= 10 && v <= 2000 ? v : null;
}

/**
 * Analyse une annonce collée.
 * Retourne les champs trouvés et la liste de ceux qui manquent, afin que
 * l'interface demande explicitement ce qu'elle n'a pas su lire.
 */
export function analyserAnnonce(texte) {
  if (!texte || texte.trim().length < 15) {
    return { vide: true, champs: {}, manquants: [] };
  }

  const champs = {
    prix: extrairePrix(texte),
    surface: extraireSurface(texte),
    pieces: extrairePieces(texte),
    codePostal: extraireCodePostal(texte),
    dpe: extraireDpe(texte),
    typeLocal: extraireType(texte),
    charges: extraireCharges(texte),
  };

  const essentiels = { prix: "le prix", surface: "la surface", codePostal: "le code postal" };
  const manquants = Object.entries(essentiels)
    .filter(([cle]) => !champs[cle])
    .map(([, libelle]) => libelle);

  // Le prix au m² se déduit et sert de contrôle : un résultat aberrant trahit
  // une mauvaise lecture du prix ou de la surface.
  if (champs.prix && champs.surface) {
    champs.prixM2 = Math.round(champs.prix / champs.surface);
    champs.suspect = champs.prixM2 < 800 || champs.prixM2 > 25000;
  }

  return { vide: false, champs, manquants };
}
