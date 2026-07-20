/**
 * Mise en page commune des documents imprimables de HomePedia.
 *
 * Les rapports étaient auparavant composés en noir et blanc, chacun avec ses
 * propres styles recopiés. Ils portent désormais l'identité de l'application —
 * le bleu #3c83f6 et ses accents — dans une déclinaison pensée pour le papier :
 * fond blanc, aplats légers, contrastes suffisants en impression monochrome.
 *
 * Un document que l'on pose sur la table d'un agent immobilier ou d'un banquier
 * doit inspirer confiance en un coup d'œil.
 */

export const COULEURS = {
  primaire: "#3c83f6",
  primaireSombre: "#1d4ed8",
  primaireClair: "#eef4fe",
  vert: "#10b981",
  vertClair: "#e9f8f2",
  ambre: "#f59e0b",
  ambreClair: "#fef6e7",
  rouge: "#ef4444",
  rougeClair: "#fdeeee",
  violet: "#a78bfa",
  encre: "#0f172a",
  texte: "#334155",
  doux: "#64748b",
  trait: "#e2e8f0",
};

/** Feuille de style partagée par tous les documents. */
export const STYLES = `
@page { size: A4; margin: 1.5cm 1.6cm; }
* { box-sizing: border-box; }
body {
  font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  font-size: 10.5pt; line-height: 1.55; color: ${COULEURS.texte}; margin: 0;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}

/* En-tête : bandeau de marque, seul aplat plein du document */
.hp-entete {
  background: linear-gradient(135deg, ${COULEURS.primaire}, ${COULEURS.primaireSombre});
  color: #fff; padding: 18px 22px; border-radius: 10px; margin-bottom: 22px;
}
.hp-marque { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; opacity: .95; }
.hp-logo {
  width: 24px; height: 24px; border-radius: 6px; background: rgba(255,255,255,.22);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13pt; line-height: 1;
}
.hp-marque-texte { font-size: 10pt; font-weight: 700; letter-spacing: .02em; }
.hp-marque-texte span { opacity: .75; font-weight: 400; }
.hp-entete h1 { font-size: 19pt; margin: 0 0 4px; font-weight: 700; letter-spacing: -.2px; }
.hp-entete .hp-sous { font-size: 9.5pt; margin: 0; opacity: .9; }

/* Titres de section : filet coloré plutôt qu'un aplat, plus sobre à l'impression */
h2 {
  font-size: 10pt; text-transform: uppercase; letter-spacing: .08em;
  color: ${COULEURS.primaireSombre}; margin: 24px 0 10px; padding-bottom: 5px;
  border-bottom: 2px solid ${COULEURS.primaireClair};
  display: flex; align-items: center; gap: 8px;
}
/* Pastille d'icône : ancre le regard et rythme la lecture d'un document dense */
h2 .hp-ico {
  width: 21px; height: 21px; border-radius: 6px; background: ${COULEURS.primaireClair};
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11pt; line-height: 1; flex-shrink: 0;
}
h3 { font-size: 10.5pt; color: ${COULEURS.encre}; margin: 14px 0 6px; }
h3 .hp-ico { margin-right: 5px; }
.hp-chiffre .l .hp-ico { margin-right: 3px; }
li .hp-ico { margin-right: 4px; }
p { margin: 0 0 8px; }
strong { color: ${COULEURS.encre}; }

/* Chiffres clés en vitrine */
.hp-chiffres { display: flex; gap: 10px; margin: 14px 0; flex-wrap: wrap; }
.hp-chiffre {
  flex: 1; min-width: 120px; background: ${COULEURS.primaireClair};
  border-radius: 8px; padding: 11px 13px; border: 1px solid ${COULEURS.trait};
}
.hp-chiffre .v { font-size: 15pt; font-weight: 700; color: ${COULEURS.primaireSombre}; line-height: 1.1; }
.hp-chiffre .l {
  font-size: 7.5pt; text-transform: uppercase; letter-spacing: .05em;
  color: ${COULEURS.doux}; margin-top: 3px;
}
.hp-chiffre.vert { background: ${COULEURS.vertClair}; }
.hp-chiffre.vert .v { color: #047857; }
.hp-chiffre.ambre { background: ${COULEURS.ambreClair}; }
.hp-chiffre.ambre .v { color: #b45309; }

table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 9.5pt; }
th {
  background: ${COULEURS.primaireClair}; color: ${COULEURS.primaireSombre};
  padding: 7px 10px; text-align: left; font-size: 8pt;
  text-transform: uppercase; letter-spacing: .04em; border-bottom: 2px solid ${COULEURS.primaire};
}
td { padding: 7px 10px; border-bottom: 1px solid ${COULEURS.trait}; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
tr.hp-fort td { background: ${COULEURS.primaireClair}; font-weight: 700; color: ${COULEURS.encre}; }
tbody tr:last-child td { border-bottom: none; }
/* Un tableau de vingt lignes se lit mal sans repère horizontal : la trame très
   claire guide l'œil sans concurrencer la ligne mise en avant. */
tbody tr:nth-child(even) td { background: #fafbfd; }
tbody tr.hp-fort:nth-child(even) td { background: ${COULEURS.primaireClair}; }
thead { display: table-header-group; }  /* l'en-tête se répète en page 2 */
tr { page-break-inside: avoid; }

/* Barre de proportion glissée dans une cellule : un écart de prix se voit
   avant de se lire, sans ajouter de colonne. */
.hp-barre { display: block; height: 3px; border-radius: 2px; background: ${COULEURS.trait}; margin-top: 3px; }
.hp-barre i { display: block; height: 3px; border-radius: 2px; background: ${COULEURS.primaire}; float: right; }
.hp-barre.vert i { background: ${COULEURS.vert}; }

/* Podium : les trois premiers résultats méritent mieux qu'une ligne de tableau,
   c'est sur eux que se prend la décision d'aller visiter. */
.hp-podium { display: flex; gap: 10px; margin: 14px 0; page-break-inside: avoid; }
.hp-podium-carte {
  flex: 1; border: 1px solid ${COULEURS.trait}; border-radius: 9px;
  padding: 12px 14px; background: #fff;
}
.hp-podium-carte.premier { border-color: ${COULEURS.primaire}; background: ${COULEURS.primaireClair}; }
.hp-podium-rang {
  font-size: 7.5pt; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  color: ${COULEURS.doux}; margin-bottom: 3px;
}
.hp-podium-carte.premier .hp-podium-rang { color: ${COULEURS.primaireSombre}; }
.hp-podium-nom { font-size: 11.5pt; font-weight: 700; color: ${COULEURS.encre}; line-height: 1.2; }
.hp-podium-prix {
  font-size: 13pt; font-weight: 700; color: ${COULEURS.primaireSombre};
  margin-top: 7px; font-variant-numeric: tabular-nums;
}
.hp-podium-detail { font-size: 8pt; color: ${COULEURS.doux}; margin-top: 2px; }
.hp-puces { margin-top: 8px; }
.hp-puce {
  display: inline-block; font-size: 7.5pt; padding: 2px 7px; border-radius: 20px;
  background: rgba(148,163,184,.14); color: ${COULEURS.texte}; margin: 0 3px 3px 0;
}

/* Encarts : la couleur porte le sens, pas la décoration */
.hp-encart {
  border-left: 4px solid ${COULEURS.primaire}; background: ${COULEURS.primaireClair};
  padding: 11px 15px; margin: 13px 0; border-radius: 0 7px 7px 0; page-break-inside: avoid;
}
.hp-encart.vert { border-left-color: ${COULEURS.vert}; background: ${COULEURS.vertClair}; }
.hp-encart.ambre { border-left-color: ${COULEURS.ambre}; background: ${COULEURS.ambreClair}; }
.hp-encart.rouge { border-left-color: ${COULEURS.rouge}; background: ${COULEURS.rougeClair}; }
.hp-encart b { display: block; margin-bottom: 4px; color: ${COULEURS.primaireSombre}; }
.hp-encart.vert b { color: #047857; }
.hp-encart.ambre b { color: #b45309; }
.hp-encart.rouge b { color: #b91c1c; }
.hp-encart p:last-child { margin: 0; }

/* Barre de position : le percentile en un coup d'œil */
.hp-jauge { margin: 16px 0 26px; }
.hp-jauge-barre {
  height: 9px; border-radius: 5px; position: relative;
  background: linear-gradient(90deg, ${COULEURS.vert} 0%, ${COULEURS.primaire} 45%, ${COULEURS.ambre} 75%, ${COULEURS.rouge} 100%);
}
.hp-jauge-curseur {
  position: absolute; top: -5px; width: 3px; height: 19px;
  background: ${COULEURS.encre}; border-radius: 2px;
}
.hp-jauge-reperes {
  display: flex; justify-content: space-between; margin-top: 6px;
  font-size: 7.5pt; color: ${COULEURS.doux}; font-variant-numeric: tabular-nums;
}

ul { margin: 6px 0 10px; padding-left: 17px; }
li { margin-bottom: 3px; }
.hp-petit { font-size: 8.5pt; color: ${COULEURS.doux}; }

.hp-pied {
  margin-top: 26px; padding-top: 10px; border-top: 2px solid ${COULEURS.primaireClair};
  font-size: 7.5pt; color: ${COULEURS.doux};
}
.hp-pied strong { color: ${COULEURS.primaireSombre}; }
`;

/** Titre de section avec sa pastille d'icône. */
export function titre(icone, texte) {
  return `<h2><span class="hp-ico">${icone}</span>${texte}</h2>`;
}

/** En-tête de marque, identique sur tous les documents. */
export function entete(titre, sousTitre) {
  return `
<div class="hp-entete">
  <div class="hp-marque">
    <span class="hp-logo">🏠</span>
    <span class="hp-marque-texte">HomePedia <span>Île-de-France</span></span>
  </div>
  <h1>${titre}</h1>
  <p class="hp-sous">${sousTitre}</p>
</div>`;
}

/** Pied de page : sources et portée du document. */
export function pied(mentionSupplementaire = "") {
  const date = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
  });
  return `
<div class="hp-pied">
  <p><strong>HomePedia IDF</strong> — document établi le ${date} à partir des transactions
  DVF (DGFiP), des diagnostics ADEME et des données publiques de l'État.
  ${mentionSupplementaire}</p>
  <p>Les données DVF publiées accusent environ six mois de décalage : les ventes les plus
  récentes n'y figurent pas encore. Ce document est une aide à la décision fondée sur des
  ventes passées — il ne constitue ni une expertise, ni un conseil juridique, ni une offre.</p>
</div>`;
}

/** Ouvre le document dans une fenêtre et lance l'impression. */
export function imprimer(corps, titreOnglet) {
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>${titreOnglet}</title><style>${STYLES}</style></head><body>${corps}
<script>window.onload=()=>window.print()<\/script></body></html>`;

  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}
