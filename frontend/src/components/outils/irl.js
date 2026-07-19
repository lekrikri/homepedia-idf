/**
 * Indice de référence des loyers — valeurs officielles INSEE.
 *
 * Série BDM 001515333, relevée le 19 juillet 2026 et couvrant 2018-T1 à 2026-T2.
 *
 * Ces valeurs étaient auparavant saisies à la main dans le composant de gestion
 * locative, et fausses à partir du 3e trimestre 2023 : décalées d'un trimestre,
 * avec des valeurs 2025 qui n'existent pas (149,03 au lieu de 146,68). Un
 * bailleur appliquant cette table aurait révisé de 2,65 % au lieu de 1,04 %,
 * soit une augmentation illégale — la révision annuelle ne peut jamais dépasser
 * la variation de l'IRL.
 *
 * À actualiser à chaque publication trimestrielle de l'INSEE, en vérifiant
 * l'ensemble de la série : l'institut révise parfois les valeurs passées.
 */

export const IRL = {
  "T1-2018": 127.22, "T2-2018": 127.77, "T3-2018": 128.45, "T4-2018": 129.03,
  "T1-2019": 129.38, "T2-2019": 129.72, "T3-2019": 129.99, "T4-2019": 130.26,
  "T1-2020": 130.57, "T2-2020": 130.57, "T3-2020": 130.59, "T4-2020": 130.52,
  "T1-2021": 130.69, "T2-2021": 131.12, "T3-2021": 131.67, "T4-2021": 132.62,
  "T1-2022": 133.93, "T2-2022": 135.84, "T3-2022": 136.27, "T4-2022": 137.26,
  "T1-2023": 138.61, "T2-2023": 140.59, "T3-2023": 141.03, "T4-2023": 142.06,
  "T1-2024": 143.46, "T2-2024": 145.17, "T3-2024": 144.51, "T4-2024": 144.64,
  "T1-2025": 145.47, "T2-2025": 146.68, "T3-2025": 145.77, "T4-2025": 145.78,
  "T1-2026": 146.60, "T2-2026": 148.37,
};

export const IRL_SOURCE = "INSEE, série 001515333";
export const IRL_RELEVE_LE = "19 juillet 2026";

/** Trimestres disponibles, du plus récent au plus ancien. */
export const TRIMESTRES = Object.keys(IRL).sort().reverse();

/**
 * Loyer révisé selon la formule légale (art. 17-1 de la loi du 6 juillet 1989) :
 *   loyer initial × (IRL du trimestre de révision / IRL du trimestre de référence)
 *
 * Retourne null si l'un des trimestres est inconnu, plutôt qu'un montant faux.
 */
export function loyerRevise(loyerInitial, trimestreReference, trimestreRevision) {
  const ancien = IRL[trimestreReference];
  const nouveau = IRL[trimestreRevision];
  if (!ancien || !nouveau || !(loyerInitial > 0)) return null;

  const montant = loyerInitial * (nouveau / ancien);
  return {
    montant: Math.round(montant * 100) / 100,
    variation: Math.round(((nouveau / ancien) - 1) * 10000) / 100,
    irlReference: ancien,
    irlRevision: nouveau,
    // Une variation négative est possible : l'IRL a reculé en 2024-T3 et
    // 2025-T3. Le bailleur n'est alors pas tenu de baisser le loyer, mais il ne
    // peut pas non plus l'augmenter.
    baisse: nouveau < ancien,
  };
}
