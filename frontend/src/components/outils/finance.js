/**
 * Calculs financiers de l'achat immobilier.
 *
 * Tout est calculé côté client : ce sont des formules et des barèmes publics,
 * aucun aller-retour serveur n'est nécessaire, et l'utilisateur voit les
 * résultats bouger en direct quand il ajuste ses paramètres.
 */

// Taux d'endettement maximal recommandé par le Haut Conseil de stabilité
// financière (assurance emprunteur comprise).
export const TAUX_ENDETTEMENT_MAX = 0.35;

// Frais d'acquisition dans l'ancien : droits de mutation, émoluments, débours.
export const TAUX_FRAIS_NOTAIRE = 0.075;

/** Mensualité d'un prêt amortissable, hors assurance. */
export function mensualite(capital, tauxAnnuelPct, dureeAns) {
  if (capital <= 0 || dureeAns <= 0) return 0;
  const n = dureeAns * 12;
  const i = tauxAnnuelPct / 100 / 12;
  if (i === 0) return capital / n;
  return (capital * i) / (1 - Math.pow(1 + i, -n));
}

/** Capital empruntable pour une mensualité donnée — l'inverse du calcul précédent. */
export function capitalEmpruntable(mensualiteCible, tauxAnnuelPct, dureeAns) {
  if (mensualiteCible <= 0 || dureeAns <= 0) return 0;
  const n = dureeAns * 12;
  const i = tauxAnnuelPct / 100 / 12;
  if (i === 0) return mensualiteCible * n;
  return (mensualiteCible * (1 - Math.pow(1 + i, -n))) / i;
}

/**
 * Capacité d'achat complète.
 *
 * L'apport ne s'ajoute pas entièrement au budget : il finance d'abord les frais
 * de notaire, qui ne sont jamais empruntables en pratique. Un apport de 20 000 €
 * sur un bien à 185 000 € ne laisse presque rien une fois les ~13 900 € de frais
 * réglés — c'est la principale mauvaise surprise des primo-accédants.
 */
export function capaciteAchat({ revenusNets, chargesCredits = 0, apport = 0, taux = 3.5, duree = 20, assurancePct = 0.34 }) {
  const mensualiteMax = Math.max(0, revenusNets * TAUX_ENDETTEMENT_MAX - chargesCredits);

  // L'assurance emprunteur entre dans le taux d'endettement : elle réduit
  // d'autant la part disponible pour le remboursement du capital.
  const capitalBrut = capitalEmpruntable(mensualiteMax, taux, duree);
  const assuranceMensuelle = (capitalBrut * (assurancePct / 100)) / 12;
  const mensualiteHorsAssurance = Math.max(0, mensualiteMax - assuranceMensuelle);
  const capital = capitalEmpruntable(mensualiteHorsAssurance, taux, duree);

  // budget = capital + apport - frais, avec frais = budget * taux
  const budgetMax = (capital + apport) / (1 + TAUX_FRAIS_NOTAIRE);
  const fraisNotaire = budgetMax * TAUX_FRAIS_NOTAIRE;

  const coutTotalCredit = mensualiteHorsAssurance * duree * 12 - capital;
  const resteAVivre = revenusNets - mensualiteMax;

  return {
    mensualiteMax: Math.round(mensualiteMax),
    mensualiteHorsAssurance: Math.round(mensualiteHorsAssurance),
    assuranceMensuelle: Math.round(assuranceMensuelle),
    capital: Math.round(capital),
    apport,
    fraisNotaire: Math.round(fraisNotaire),
    budgetMax: Math.round(budgetMax),
    coutTotalCredit: Math.round(coutTotalCredit),
    resteAVivre: Math.round(resteAVivre),
  };
}

// ── Rénovation énergétique ───────────────────────────────────────────────────

// Coûts indicatifs au m² pour un appartement, poste par poste. Ordres de grandeur
// issus des observations ADEME ; un devis reste indispensable, notamment en
// copropriété où l'isolation par l'extérieur relève d'une décision collective.
const POSTES_RENOVATION = [
  { cle: "menuiseries", label: "Remplacement des menuiseries", euroM2: 180, gainClasses: 1 },
  { cle: "chauffage", label: "Système de chauffage performant", euroM2: 150, gainClasses: 1 },
  { cle: "isolation_interieure", label: "Isolation des murs par l'intérieur", euroM2: 120, gainClasses: 1 },
  { cle: "ventilation", label: "Ventilation (VMC)", euroM2: 60, gainClasses: 0.5 },
];

const CLASSES = ["A", "B", "C", "D", "E", "F", "G"];

/**
 * Chiffre le passage d'une classe DPE à une autre.
 *
 * Un DPE F ou G n'est pas une fatalité mais un levier : les travaux se chiffrent,
 * les aides se déduisent, et le reste à charge devient un argument de négociation
 * opposable au vendeur.
 */
export function coutRenovation({ classeActuelle, classeCible = "D", surface, revenusModestes = false }) {
  const iActuel = CLASSES.indexOf((classeActuelle || "").toUpperCase());
  const iCible = CLASSES.indexOf((classeCible || "").toUpperCase());
  if (iActuel < 0 || iCible < 0 || iActuel <= iCible || surface <= 0) return null;

  const classesAGagner = iActuel - iCible;

  // On empile les postes jusqu'à couvrir le gain visé, du plus rentable au moins.
  const postes = [];
  let gainCumule = 0;
  for (const p of POSTES_RENOVATION) {
    if (gainCumule >= classesAGagner) break;
    postes.push({ ...p, cout: Math.round(p.euroM2 * surface) });
    gainCumule += p.gainClasses;
  }

  const coutTravaux = postes.reduce((s, p) => s + p.cout, 0);

  // MaPrimeRénov' parcours accompagné : le taux de prise en charge dépend des
  // revenus du foyer et de l'ampleur du gain de classes.
  const tauxAide = revenusModestes ? 0.55 : 0.35;
  const plafondAide = classesAGagner >= 4 ? 70000 : classesAGagner >= 3 ? 55000 : 40000;
  const maPrimeRenov = Math.round(Math.min(coutTravaux * tauxAide, plafondAide));

  // Certificats d'économies d'énergie, ordre de grandeur.
  const cee = Math.round(Math.min(coutTravaux * 0.08, 5000));

  const resteACharge = Math.max(0, coutTravaux - maPrimeRenov - cee);
  const ecoPtzMax = Math.min(50000, resteACharge);

  return {
    classeActuelle: CLASSES[iActuel],
    classeCible: CLASSES[iCible],
    classesAGagner,
    surface,
    postes,
    coutTravaux,
    maPrimeRenov,
    cee,
    resteACharge,
    ecoPtzMax,
    mensualiteEcoPtz: ecoPtzMax > 0 ? Math.round(ecoPtzMax / (15 * 12)) : 0,
  };
}

export const CLASSES_DPE = CLASSES;
