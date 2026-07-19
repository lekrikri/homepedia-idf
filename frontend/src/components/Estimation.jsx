import { useState, useEffect, useRef, useMemo } from "react";
import axios from "axios";
import { CapaciteEmprunt, RenovationDPE } from "./outils/OutilsAchat.jsx";

/**
 * Estimation — situe un bien dans la distribution réelle des ventes comparables.
 *
 * La médiane seule ne permet pas de négocier : c'est l'écart p25-p75 qui donne
 * la marge de manœuvre. L'écran met donc la distribution au premier plan, et le
 * prix demandé y est positionné.
 */

const TYPES = ["Appartement", "Maison"];
const PIECES = [1, 2, 3, 4, 5];

const fmtEur = n => (n == null ? "—" : n.toLocaleString("fr-FR") + " €");
const fmtM2 = n => (n == null ? "—" : n.toLocaleString("fr-FR") + " €/m²");

function couleurPercentile(p) {
  if (p <= 25) return "#10b981";
  if (p <= 45) return "#34d399";
  if (p <= 60) return "#3b82f6";
  if (p <= 80) return "#f59e0b";
  return "#ef4444";
}

// ── Autocomplete commune ─────────────────────────────────────────────────────

function ChoixCommune({ communes, value, onSelect }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const resultats = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return communes
      .filter(c => c.nom?.toLowerCase().includes(q) || c.code_insee?.startsWith(q))
      .slice(0, 8);
  }, [query, communes]);

  return (
    <div className="relative" ref={ref}>
      <label className="text-xs text-slate-400 block mb-1">Commune</label>
      <input
        value={open || !value ? query : value.nom}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(""); setOpen(true); }}
        placeholder="Aubervilliers, 93001…"
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white
                   focus:border-blue-500 focus:outline-none"
      />
      {open && resultats.length > 0 && (
        <div className="absolute z-30 mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg
                        shadow-2xl max-h-64 overflow-y-auto">
          {resultats.map(c => (
            <button
              key={c.code_insee}
              onMouseDown={() => { onSelect(c); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-slate-800 transition-colors"
            >
              <p className="text-sm text-slate-100">{c.nom}</p>
              <p className="text-[11px] text-slate-500">
                {c.code_insee} · Dép. {c.departement}
                {c.prix_m2_median ? ` · ${Math.round(c.prix_m2_median).toLocaleString("fr-FR")} €/m²` : ""}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Distribution p10 → p90 ───────────────────────────────────────────────────

function BarreDistribution({ p, prixM2Demande }) {
  const min = p.p10, max = p.p90;
  const span = Math.max(max - min, 1);
  const pos = v => Math.min(100, Math.max(0, ((v - min) / span) * 100));

  return (
    <div className="pt-8 pb-6">
      <div className="relative h-3 rounded-full"
        style={{ background: "linear-gradient(90deg,#10b981 0%,#34d399 22%,#3b82f6 45%,#f59e0b 72%,#ef4444 100%)" }}>
        {[["p10", p.p10], ["p25", p.p25], ["médiane", p.median], ["p75", p.p75], ["p90", p.p90]].map(([label, v]) => (
          <div key={label} className="absolute -top-7 -translate-x-1/2 text-center" style={{ left: `${pos(v)}%` }}>
            <p className="text-[9px] text-slate-500 uppercase tracking-wide">{label}</p>
            <p className={`text-[11px] font-medium ${label === "médiane" ? "text-white" : "text-slate-400"}`}>
              {Math.round(v).toLocaleString("fr-FR")}
            </p>
          </div>
        ))}
        {[p.p10, p.p25, p.median, p.p75, p.p90].map((v, i) => (
          <div key={i} className="absolute top-0 h-3 w-px bg-slate-900/60" style={{ left: `${pos(v)}%` }} />
        ))}

        {prixM2Demande != null && (
          <div className="absolute -bottom-6 -translate-x-1/2 flex flex-col items-center"
            style={{ left: `${pos(prixM2Demande)}%` }}>
            <div className="w-px h-4 bg-white" />
            <p className="text-[11px] font-semibold text-white whitespace-nowrap">
              votre bien · {Math.round(prixM2Demande).toLocaleString("fr-FR")} €/m²
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tendance annuelle ────────────────────────────────────────────────────────

function Tendance({ points, evolution }) {
  if (!points?.length) return null;
  const vals = points.map(p => p.median_m2);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = Math.max(max - min, 1);
  const baisse = (evolution ?? 0) < 0;

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <h3 className="font-semibold text-white text-sm">Tendance sur {points.length} ans</h3>
        {evolution != null && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-md"
            style={{
              background: baisse ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
              color: baisse ? "#34d399" : "#f87171",
            }}>
            {evolution > 0 ? "+" : ""}{evolution} % depuis {points[0].annee}
          </span>
        )}
      </div>

      <div className="flex items-end gap-2 h-28">
        {points.map(pt => {
          const h = 25 + ((pt.median_m2 - min) / span) * 70;
          return (
            <div key={pt.annee} className="flex-1 flex flex-col items-center gap-1">
              <p className="text-[10px] text-slate-400">{Math.round(pt.median_m2 / 100) / 10}k</p>
              <div className="w-full rounded-t transition-all"
                style={{ height: `${h}%`, background: "linear-gradient(180deg,#3b82f6,#1e40af)" }}
                title={`${pt.nb_ventes} ventes`} />
              <p className="text-[10px] text-slate-500">{pt.annee}</p>
            </div>
          );
        })}
      </div>

      {baisse && (
        <p className="text-[11px] text-emerald-400/80 mt-3">
          Un marché orienté à la baisse renforce votre position : le vendeur pressé fait la concession.
        </p>
      )}
    </div>
  );
}

// ── Lecture du résultat ──────────────────────────────────────────────────────

/**
 * Traduit le percentile en conseils d'achat.
 *
 * Un chiffre seul ne dit pas quoi en faire : la médiane donne une valeur, le
 * percentile donne une position, mais c'est la lecture qui indique où viser.
 * Le contenu est volontairement rattaché aux chiffres de l'estimation en cours,
 * un conseil générique n'apprenant rien à personne.
 */
function lectureResultat(data, pos) {
  const p = data.prix_m2;
  const est = data.prix_estime;
  const ecartQuartiles = est ? est.p75 - est.p25 : (p.p75 - p.p25);
  const unite = est ? "" : " par m²";

  const blocs = [];

  blocs.push({
    titre: "Ce que dit la fourchette",
    texte: `Entre le premier quartile (${est ? fmtEur(est.p25) : fmtM2(p.p25)}) et le troisième ` +
      `(${est ? fmtEur(est.p75) : fmtM2(p.p75)}) pour un bien équivalent dans la même commune, ` +
      `il y a ${fmtEur(ecartQuartiles)}${unite} d'écart. C'est votre marge de manœuvre réelle : ` +
      `elle pèse bien plus lourd que le choix de la commune.`,
  });

  blocs.push({
    titre: "D'où vient cet écart",
    texte: "Il ne doit rien au hasard : étage et ascenseur, état général, classe DPE, exposition, " +
      "rue calme ou axe passant, montant des charges de copropriété, travaux votés à venir. " +
      "Votre travail d'acheteur consiste à trouver un bien dont les défauts sont réparables ou " +
      "négociables, mais qui est vendu au prix des biens irréprochables.",
  });

  if (pos) {
    const pc = pos.percentile_estime;
    if (pc <= 25) {
      blocs.push({
        titre: "Ce prix est bas : cherchez pourquoi",
        ton: "prudence",
        texte: `Au ${pc}ᵉ percentile, ce bien est moins cher que ${100 - pc} % des ventes comparables. ` +
          "Parfois c'est une vraie occasion — vendeur pressé, succession, mutation. Parfois c'est " +
          "un rez-de-chaussée sur rue, 400 € de charges mensuelles, une toiture à refaire ou un " +
          "DPE F. Demandez les trois derniers procès-verbaux d'assemblée générale et le montant " +
          "des charges avant de vous enthousiasmer.",
      });
    } else if (pc <= 60) {
      blocs.push({
        titre: "Vous êtes dans la moyenne du marché",
        texte: `Au ${pc}ᵉ percentile, ce prix est cohérent : ${pc} % des ventes comparables se sont ` +
          "conclues moins cher. La négociation ne se jouera pas sur le prix affiché, mais sur les " +
          "défauts constatés en visite — travaux, DPE, charges. Chiffrez-les, ce sont eux qui " +
          "justifieront une baisse.",
      });
    } else {
      blocs.push({
        titre: "Demandez ce qui justifie ce prix",
        ton: "attention",
        texte: `Au ${pc}ᵉ percentile, seuls ${100 - pc} % des biens comparables se sont vendus plus cher. ` +
          "Un tel positionnement doit s'expliquer : dernier étage, terrasse, rénovation récente, " +
          "DPE A ou B. Posez la question directement. Si la réponse ne vient pas, vous tenez votre " +
          "argument de négociation.",
      });
    }
  }

  blocs.push({
    titre: "À demander systématiquement en visite",
    liste: [
      "Le montant réel des charges annuelles, et ce qu'elles couvrent",
      "Les procès-verbaux des trois dernières assemblées générales (travaux votés ou à voter)",
      "La classe DPE et la date du diagnostic — un F ou G sera interdit à la location en 2028",
      "La taxe foncière de l'année précédente",
      "Depuis combien de temps le bien est en vente, et s'il y a eu des baisses de prix",
    ],
  });

  if ((data.evolution_pct ?? 0) < 0) {
    blocs.push({
      titre: "Le marché joue pour vous",
      ton: "favorable",
      texte: `Les prix ont reculé de ${Math.abs(data.evolution_pct).toLocaleString("fr-FR")} % ` +
        `depuis ${data.tendance?.[0]?.annee}. Dans un marché qui baisse, le temps est du côté de ` +
        "l'acheteur : un vendeur dont le bien traîne depuis plusieurs mois devient nettement plus " +
        "ouvert à la discussion. Ne montrez jamais que vous êtes pressé.",
    });
  }

  return blocs;
}

function Conseils({ blocs }) {
  const couleurs = {
    prudence: "#f59e0b",
    attention: "#f87171",
    favorable: "#34d399",
  };
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
      <h3 className="font-semibold text-white text-sm mb-1">Comment lire ce résultat</h3>
      <p className="text-[11px] text-slate-500 mb-4">
        Une lecture pour décider quoi proposer, pas seulement constater un prix.
      </p>
      <div className="space-y-4">
        {blocs.map((b, i) => (
          <div key={i} className="pl-3" style={{ borderLeft: `2px solid ${couleurs[b.ton] || "#334155"}` }}>
            <p className="text-sm font-medium mb-1" style={{ color: couleurs[b.ton] || "#e2e8f0" }}>
              {b.titre}
            </p>
            {b.texte && <p className="text-[13px] text-slate-400 leading-relaxed">{b.texte}</p>}
            {b.liste && (
              <ul className="space-y-1 mt-1">
                {b.liste.map((item, j) => (
                  <li key={j} className="text-[13px] text-slate-400 flex gap-2">
                    <span className="text-slate-600 shrink-0">·</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Écran principal ──────────────────────────────────────────────────────────

export default function Estimation() {
  const [communes, setCommunes] = useState([]);
  const [commune, setCommune] = useState(null);
  const [typeLocal, setTypeLocal] = useState("Appartement");
  const [pieces, setPieces] = useState(2);
  const [surface, setSurface] = useState("");
  const [prixDemande, setPrixDemande] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    axios.get("/api/v1/communes/list")
      .then(({ data }) => setCommunes(data.data || []))
      .catch(() => setCommunes([]));
  }, []);

  async function estimer(e) {
    e?.preventDefault();
    if (!commune) { setErreur("Choisissez une commune."); return; }
    setLoading(true); setErreur(null);
    try {
      const { data } = await axios.get("/api/v1/estimation", {
        params: {
          commune: commune.code_insee,
          type_local: typeLocal,
          pieces,
          surface: surface || undefined,
          prix_demande: prixDemande || undefined,
        },
      });
      setData(data);
    } catch (err) {
      setErreur(err.response?.data?.error || "Estimation indisponible.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const pos = data?.positionnement;

  /**
   * Rapport imprimable — même approche que la quittance de loyer : HTML mis en
   * page en A4 puis window.print(), l'utilisateur choisit "Enregistrer en PDF".
   * Pensé pour être posé sur la table pendant une visite ou une négociation :
   * uniquement des chiffres sourcés, et les arguments qui en découlent.
   */
  function genererRapport() {
    if (!data) return;
    const d = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const p = data.prix_m2;
    const ligne = (label, valeur, fort) =>
      `<tr${fort ? ' class="fort"' : ""}><td>${label}</td><td class="num">${valeur}</td></tr>`;
    // Virgule décimale : le document est imprimé, l'écriture anglaise y saute aux yeux.
    const pct = n => (n > 0 ? "+" : "") + Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 1 });

    const blocPosition = pos ? `
<div class="encart">
  <h3>Positionnement du bien</h3>
  <p class="verdict">${pos.verdict}</p>
  <p>Prix demandé : <strong>${fmtEur(pos.prix_demande)}</strong>${data.surface_m2 ? ` pour ${data.surface_m2} m²` : ""}
     — soit <strong>${fmtM2(pos.prix_m2_demande)}</strong>.</p>
  <p>Ce prix place le bien au <strong>${pos.percentile_estime}ᵉ percentile</strong> des ventes comparables :
     ${pos.percentile_estime} % des transactions se sont conclues moins cher.
     Écart à la médiane locale : <strong>${pct(pos.ecart_median_pct)} %</strong>.</p>
  ${pos.marge_nego_haute > 0 ? `<p class="nego">Cible de négociation : <strong>−${fmtEur(pos.marge_nego_basse)} à −${fmtEur(pos.marge_nego_haute)}</strong>
     pour ramener le bien au prix médian, puis au premier quartile des ventes comparables.</p>` : ""}
</div>` : "";

    const blocTendance = data.tendance?.length ? `
<h3>Évolution du marché local</h3>
<table>
  <thead><tr><th>Année</th><th class="num">Prix médian /m²</th><th class="num">Ventes</th></tr></thead>
  <tbody>${data.tendance.map(t =>
      `<tr><td>${t.annee}</td><td class="num">${t.median_m2.toLocaleString("fr-FR")} €</td><td class="num">${t.nb_ventes}</td></tr>`
    ).join("")}</tbody>
</table>
${data.evolution_pct != null ? `<p class="${data.evolution_pct < 0 ? "favorable" : ""}">
  Évolution sur la période : <strong>${pct(data.evolution_pct)} %</strong>.
  ${data.evolution_pct < 0 ? "Un marché orienté à la baisse renforce la position de l'acheteur." : ""}</p>` : ""}` : "";

    const blocBudget = data.cout_acquisition ? `
<h3>Budget à prévoir</h3>
<table>
  ${ligne("Prix du bien", fmtEur(data.cout_acquisition.prix_bien))}
  ${ligne("Frais de notaire (ancien, ~7,5 %)", fmtEur(data.cout_acquisition.frais_notaire))}
  ${ligne("Total acquisition", fmtEur(data.cout_acquisition.total_acquisition), true)}
</table>
<p class="petit">Hors travaux, charges de copropriété et taxe foncière. Un logement classé F ou G
justifie une décote : ces biens seront interdits à la location en 2028.</p>` : "";

    const blocConseils = `
<h3>Comment lire ce résultat</h3>
${lectureResultat(data, pos).map(b => `
<div class="conseil">
  <p class="conseil-titre">${b.titre}</p>
  ${b.texte ? `<p>${b.texte}</p>` : ""}
  ${b.liste ? `<ul>${b.liste.map(i => `<li>${i}</li>`).join("")}</ul>` : ""}
</div>`).join("")}`;

    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Estimation ${data.ville} — ${data.type_local} ${data.pieces || ""} pièces</title>
<style>
@page{size:A4;margin:1.8cm}
body{font-family:Arial,sans-serif;font-size:11pt;color:#111;line-height:1.55;margin:0}
.header{border-bottom:3px solid #111;padding-bottom:14px;margin-bottom:24px}
h1{font-size:20pt;margin:0 0 4px;letter-spacing:-0.5px}
h3{font-size:10pt;text-transform:uppercase;letter-spacing:.07em;color:#555;margin:26px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
.sub{color:#555;font-size:10pt;margin:0}
table{width:100%;border-collapse:collapse;margin:10px 0}
th{background:#f4f4f4;padding:8px 12px;text-align:left;font-size:9.5pt;border:1px solid #ddd}
td{padding:8px 12px;border:1px solid #ddd;font-size:10.5pt}
td.num,th.num{text-align:right}
tr.fort td{font-weight:700;background:#efefef}
.encart{background:#f7f9fc;border:1px solid #d8e2f0;border-left:4px solid #1d4ed8;padding:14px 18px;margin:18px 0}
.encart h3{margin-top:0;border:none;color:#1d4ed8}
.verdict{font-size:12pt;font-weight:700;margin:0 0 8px}
.nego{background:#fff;border:1px dashed #1d4ed8;padding:10px 12px;margin-top:10px}
.favorable{color:#047857;font-weight:600}
.petit{font-size:9pt;color:#666}
.conseil{margin:12px 0;padding-left:12px;border-left:2px solid #d0d7e2;page-break-inside:avoid}
.conseil-titre{font-weight:700;margin:0 0 3px;font-size:10.5pt}
.conseil p{margin:0;font-size:10pt;color:#333}
.conseil ul{margin:4px 0 0;padding-left:18px;font-size:10pt;color:#333}
.conseil li{margin-bottom:2px}
.footer{margin-top:32px;font-size:8.5pt;color:#888;border-top:1px solid #ddd;padding-top:10px}
</style></head><body>
<div class="header">
  <h1>Estimation — ${data.ville}</h1>
  <p class="sub">${data.type_local}${data.pieces ? ` · ${data.pieces} pièces` : ""}${data.surface_m2 ? ` · ${data.surface_m2} m²` : ""} — établie le ${d}</p>
</div>

${blocPosition}

<h3>Distribution des ventes comparables</h3>
<p class="petit">Établie sur <strong>${data.nb_comparables} ventes</strong> (${data.niveau_comparables}).
${data.avertissement || ""}</p>
<table>
  <thead><tr><th>Repère</th><th class="num">Prix /m²</th>${data.prix_estime ? `<th class="num">Pour ${data.surface_m2} m²</th>` : ""}</tr></thead>
  <tbody>
    <tr><td>10 % les moins chers</td><td class="num">${fmtM2(p.p10)}</td>${data.prix_estime ? `<td class="num">${fmtEur(data.prix_estime.p10)}</td>` : ""}</tr>
    <tr><td>Premier quartile (p25)</td><td class="num">${fmtM2(p.p25)}</td>${data.prix_estime ? `<td class="num">${fmtEur(data.prix_estime.p25)}</td>` : ""}</tr>
    <tr class="fort"><td>Médiane du marché</td><td class="num">${fmtM2(p.median)}</td>${data.prix_estime ? `<td class="num">${fmtEur(data.prix_estime.median)}</td>` : ""}</tr>
    <tr><td>Troisième quartile (p75)</td><td class="num">${fmtM2(p.p75)}</td>${data.prix_estime ? `<td class="num">${fmtEur(data.prix_estime.p75)}</td>` : ""}</tr>
    <tr><td>10 % les plus chers</td><td class="num">${fmtM2(p.p90)}</td>${data.prix_estime ? `<td class="num">${fmtEur(data.prix_estime.p90)}</td>` : ""}</tr>
  </tbody>
</table>
<p class="petit">L'écart entre le premier et le troisième quartile mesure la marge de manœuvre :
il s'explique par l'étage, l'état, le DPE, l'exposition ou les charges. Un bien au-dessus de la
médiane doit le justifier.</p>

${blocTendance}
${blocBudget}
${blocConseils}

<div class="footer">
  Source : transactions DVF (DGFiP), base HomePedia IDF. Les données publiées accusent environ
  six mois de décalage : les ventes les plus récentes n'y figurent pas encore. Ce document est une
  aide à la décision fondée sur des ventes passées, il ne constitue ni une expertise ni une offre.
</div>
<script>window.onload=()=>window.print()</script>
</body></html>`;

    const w = window.open("", "_blank");
    if (!w) { setErreur("Autorisez les fenêtres surgissantes pour générer le rapport."); return; }
    w.document.write(html);
    w.document.close();
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Estimer un bien</h1>
        <p className="text-slate-400 text-sm mt-1">
          Situez un prix dans les ventes réelles comparables, pour savoir quoi proposer.
        </p>
      </div>

      <form onSubmit={estimer} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ChoixCommune communes={communes} value={commune} onSelect={setCommune} />
          <div>
            <label className="text-xs text-slate-400 block mb-1">Type de bien</label>
            <select value={typeLocal} onChange={e => setTypeLocal(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Nombre de pièces</label>
            <select value={pieces} onChange={e => setPieces(Number(e.target.value))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
              {PIECES.map(p => <option key={p} value={p}>{p} pièce{p > 1 ? "s" : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Surface (m²)</label>
            <input type="number" value={surface} onChange={e => setSurface(e.target.value)}
              placeholder="40"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Prix demandé (€) <span className="text-slate-600">facultatif</span>
            </label>
            <input type="number" value={prixDemande} onChange={e => setPrixDemande(e.target.value)}
              placeholder="185000"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
        </div>

        <button type="submit" disabled={loading}
          className="w-full sm:w-auto px-5 py-2.5 rounded-lg text-sm font-medium transition-all
                     hover:brightness-110 disabled:opacity-50"
          style={{ background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", color: "white" }}>
          {loading ? "Analyse…" : "Estimer"}
        </button>

        {erreur && <p className="text-red-400 text-xs">{erreur}</p>}
      </form>

      {data && (
        <>
          <div className="flex justify-end">
            <button onClick={genererRapport}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:brightness-110"
              style={{ background: "rgba(60,131,246,0.2)", border: "1px solid rgba(60,131,246,0.4)", color: "#60a5fa" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 17 }}>picture_as_pdf</span>
              Rapport PDF
            </button>
          </div>

          {pos && (
            <div className="bg-slate-900/60 border rounded-xl p-4"
              style={{ borderColor: couleurPercentile(pos.percentile_estime) + "55" }}>
              <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
                <h3 className="font-semibold text-white text-sm">Votre bien dans le marché</h3>
                <span className="text-xs px-2 py-0.5 rounded-md font-medium"
                  style={{
                    background: couleurPercentile(pos.percentile_estime) + "22",
                    color: couleurPercentile(pos.percentile_estime),
                  }}>
                  {pos.percentile_estime}ᵉ percentile
                </span>
              </div>
              <p className="text-slate-300 text-sm">{pos.verdict}</p>
              <p className="text-slate-500 text-xs mt-1">
                {fmtM2(pos.prix_m2_demande)} — soit {pos.ecart_median_pct > 0 ? "+" : ""}
                {pos.ecart_median_pct} % par rapport à la médiane locale.
              </p>

              {pos.marge_nego_haute > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-800">
                  <p className="text-xs text-slate-400">Cible de négociation</p>
                  <p className="text-lg font-semibold text-white">
                    −{fmtEur(pos.marge_nego_basse)} à −{fmtEur(pos.marge_nego_haute)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Pour ramener le bien à la médiane, puis au premier quartile des ventes comparables.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
            <div className="flex justify-between items-baseline flex-wrap gap-2">
              <h3 className="font-semibold text-white text-sm">
                Distribution des ventes — {data.ville}
              </h3>
              <span className="text-[11px] text-slate-500">
                {data.nb_comparables} ventes · {data.niveau_comparables}
              </span>
            </div>

            <BarreDistribution p={data.prix_m2} prixM2Demande={pos?.prix_m2_demande} />

            {data.prix_estime && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-800">
                {[["Fourchette basse", data.prix_estime.p25],
                  ["Prix de marché", data.prix_estime.median],
                  ["Fourchette haute", data.prix_estime.p75]].map(([label, v], i) => (
                  <div key={label}>
                    <p className="text-[11px] text-slate-500">{label}</p>
                    <p className={i === 1 ? "text-white font-semibold" : "text-slate-300"}>{fmtEur(v)}</p>
                  </div>
                ))}
              </div>
            )}

            {data.avertissement && (
              <p className="text-amber-400/80 text-[11px] mt-3">{data.avertissement}</p>
            )}
          </div>

          <Tendance points={data.tendance} evolution={data.evolution_pct} />

          {data.prevision?.length > 0 && (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
              <h3 className="font-semibold text-white text-sm mb-1">Projection</h3>
              <p className="text-[11px] text-slate-500 mb-3">
                Prolongation statistique de la tendance observée, pas une prédiction :
                un retournement de marché ou de taux la rendrait caduque.
              </p>
              {data.prevision.map(p => (
                <div key={p.annee} className="flex justify-between items-baseline py-1.5 border-b border-slate-800 last:border-0">
                  <span className="text-slate-400 text-sm">{p.annee}</span>
                  <span className="text-right">
                    <span className="text-white font-medium">{fmtM2(p.prix_m2_pred)}</span>
                    <span className="text-[11px] text-slate-500 ml-2">
                      fourchette {p.prix_m2_bas.toLocaleString("fr-FR")} – {p.prix_m2_haut.toLocaleString("fr-FR")}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {data.risques?.commentaire && (
            <div className="bg-slate-900/60 border rounded-xl p-4" style={{ borderColor: "rgba(245,158,11,0.35)" }}>
              <h3 className="font-semibold text-sm mb-1" style={{ color: "#f59e0b" }}>Risques naturels</h3>
              <p className="text-[13px] text-slate-300">{data.risques.commentaire}</p>
              <p className="text-[11px] text-slate-500 mt-2">
                L'état des risques est annexé au compromis. Il conditionne l'assurance
                et peut peser sur la revente.
              </p>
            </div>
          )}

          <Conseils blocs={lectureResultat(data, pos)} />

          <CapaciteEmprunt prixCible={pos?.prix_demande || data.prix_estime?.median} />

          <RenovationDPE surfaceInitiale={data.surface_m2 || 40} />

          {data.cout_acquisition && (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
              <h3 className="font-semibold text-white text-sm mb-3">Budget réel à prévoir</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Prix du bien</span>
                  <span className="text-slate-200">{fmtEur(data.cout_acquisition.prix_bien)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Frais de notaire (ancien, ~7,5 %)</span>
                  <span className="text-slate-200">{fmtEur(data.cout_acquisition.frais_notaire)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-800">
                  <span className="text-white font-medium">Total</span>
                  <span className="text-white font-semibold">
                    {fmtEur(data.cout_acquisition.total_acquisition)}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-3">
                Hors travaux, charges de copropriété et taxe foncière. Un DPE F ou G justifie
                une décote supplémentaire : ces logements seront interdits à la location en 2028.
              </p>
            </div>
          )}

          <p className="text-[11px] text-slate-600">
            Source : transactions DVF (DGFiP). Les données publiées accusent environ six mois de
            décalage : dans un marché qui bouge, les dernières ventes ne sont pas encore visibles.
          </p>
        </>
      )}
    </div>
  );
}
