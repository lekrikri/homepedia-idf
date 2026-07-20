import { useState, useEffect } from "react";
import axios from "axios";
import { entete as enteteDoc, pied as piedDoc, titre as titreDoc, imprimer as imprimerDoc } from "./outils/document.js";
import { capaciteAchat } from "./outils/finance.js";

/**
 * Dossier de recherche — l'étape avant l'estimation.
 *
 * L'estimation répond "ce bien est-il au bon prix ?", une fois l'annonce trouvée.
 * Le dossier répond "où chercher ?", quand rien n'est encore décidé. Le rapport
 * imprimable est pensé pour être annoté au fil des visites.
 */

const CRITERES = [
  { value: "prix", label: "Le prix", aide: "Les communes les plus abordables d'abord" },
  { value: "dpe", label: "La qualité énergétique", aide: "Éviter de racheter une passoire thermique" },
  { value: "transports", label: "Les transports", aide: "Desserte en métro, RER, bus" },
  { value: "cadre_vie", label: "Le cadre de vie", aide: "Commerces, écoles, espaces verts" },
  { value: "securite", label: "La sécurité", aide: "Données départementales SSMSI" },
];

const DEPARTEMENTS = [
  { code: "75", nom: "Paris" }, { code: "77", nom: "Seine-et-Marne" },
  { code: "78", nom: "Yvelines" }, { code: "91", nom: "Essonne" },
  { code: "92", nom: "Hauts-de-Seine" }, { code: "93", nom: "Seine-Saint-Denis" },
  { code: "94", nom: "Val-de-Marne" }, { code: "95", nom: "Val-d'Oise" },
];

const fmtEur = n => (n == null ? "—" : Math.round(n).toLocaleString("fr-FR") + " €");
const pct = v => (v == null ? "—" : Math.round(v * 100) + " %");

function Chiffre({ valeur, libelle, icone, accent }) {
  return (
    <div className="rounded-xl p-4 border"
      style={{
        background: accent ? "rgba(52,211,153,0.08)" : "rgba(15,23,42,0.6)",
        borderColor: accent ? "rgba(52,211,153,0.25)" : "rgb(30,41,59)",
      }}>
      <span className="material-symbols-outlined"
        style={{ fontSize: 18, color: accent ? "#34d399" : "#64748b" }}>{icone}</span>
      <div className="text-2xl font-bold mt-1" style={{ color: accent ? "#34d399" : "white" }}>
        {valeur}
      </div>
      <div className="text-[11px] uppercase tracking-wider text-slate-500 mt-0.5">{libelle}</div>
    </div>
  );
}

const MEDAILLES = ["#fbbf24", "#cbd5e1", "#d97706"];

function Podium({ commune: c, rang, surface }) {
  const badges = [
    c.score_accessibilite != null && { icone: "directions_subway", texte: `Transports ${c.score_accessibilite}` },
    c.score_securite != null && { icone: "shield", texte: `Sécurité ${c.score_securite}` },
    c.pct_dpe_bon != null && { icone: "energy_savings_leaf", texte: `${pct(c.pct_dpe_bon)} en A·B·C` },
  ].filter(Boolean);

  return (
    <div className="rounded-xl p-4 border bg-slate-900/60"
      style={{ borderColor: rang === 0 ? "rgba(251,191,36,0.35)" : "rgb(30,41,59)" }}>
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined" style={{ fontSize: 19, color: MEDAILLES[rang] }}>
          {rang === 0 ? "workspace_premium" : "counter_" + (rang + 1)}
        </span>
        <div className="min-w-0">
          <div className="text-white font-semibold text-sm truncate">{c.ville}</div>
          <div className="text-[11px] text-slate-500">Département {c.departement}</div>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-slate-800">
        <div className="text-xl font-bold text-white" style={{ fontVariantNumeric: "tabular-nums" }}>
          {fmtEur(c.budget_au_p25)}
        </div>
        <div className="text-[11px] text-slate-500">
          pour {surface} m² au 1ᵉʳ quartile · {fmtEur(c.budget_median)} au médian
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3">
        {badges.map(b => (
          <span key={b.texte}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-slate-300"
            style={{ background: "rgba(148,163,184,0.12)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{b.icone}</span>
            {b.texte}
          </span>
        ))}
      </div>

      {c.remarque && <p className="text-[10px] text-amber-500/80 mt-2">{c.remarque}</p>}
    </div>
  );
}

export default function Dossier() {
  const [budget, setBudget] = useState(180000);
  const [surface, setSurface] = useState(40);
  const [pieces, setPieces] = useState(2);
  const [typeLocal, setTypeLocal] = useState("Appartement");
  const [critere, setCritere] = useState("dpe");
  const [deps, setDeps] = useState(["93"]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState(null);

  function basculerDept(code) {
    setDeps(d => (d.includes(code) ? d.filter(x => x !== code) : [...d, code]));
  }

  async function chercher(e) {
    e?.preventDefault();
    setLoading(true); setErreur(null);
    try {
      const { data } = await axios.get("/api/v1/dossier", {
        params: {
          budget: budget || undefined, surface, pieces, type_local: typeLocal,
          critere, departements: deps.join(",") || undefined,
        },
      });
      setData(data);
    } catch (err) {
      setErreur(err.response?.data?.error || "Recherche indisponible.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { chercher(); /* premier rendu */ }, []); // eslint-disable-line

  const maxP25 = Math.max(1, ...(data?.communes || []).map(c => c.budget_au_p25 || 0));

  // Une recherche départementale ramène couramment quarante communes. Les
  // afficher d'un bloc noie le classement, qui est pourtant tout l'intérêt :
  // les premières lignes sont celles qui comptent.
  const PAR_PAGE = 15;
  const [page, setPage] = useState(0);
  const communes = data?.communes || [];
  const nbPages = Math.ceil(communes.length / PAR_PAGE);
  const communesPage = communes.slice(page * PAR_PAGE, (page + 1) * PAR_PAGE);
  useEffect(() => { setPage(0); }, [data]);

  // Ce que permet chaque niveau de revenus. La question se pose avant même de
  // choisir une commune, et le tableau n'existait jusqu'ici que dans le PDF —
  // donc invisible à celui qui ne l'imprime pas.
  const capacites = (data?.communes?.length ? [2500, 3000, 3500, 4000] : []).map(revenus => {
    const c = capaciteAchat({ revenusNets: revenus, apport: 20000, taux: 3.5, duree: 20 });
    return {
      revenus, ...c,
      accessibles: data.communes.filter(x => x.budget_au_p25 <= c.budgetMax).length,
    };
  });

  function genererDossier() {
    if (!data?.communes?.length) return;
    const libelleCritere = CRITERES.find(c => c.value === data.critere)?.label || data.critere;
    const alerteDpe = data.communes.filter(c => c.pct_dpe_bon != null && c.pct_dpe_bon <= 0.02);
    const premiere = data.communes[0];
    const nomsDepts = deps.map(d => DEPARTEMENTS.find(x => x.code === d)?.nom || d).join(", ");

    const plafond = Math.max(1, ...data.communes.slice(0, 20).map(c => c.budget_au_p25 || 0));

    const lignes = data.communes.slice(0, 20).map((c, i) => `
      <tr${i === 0 ? ' class="hp-fort"' : ""}>
        <td>${i === 0 ? "⭐ " : ""}${c.ville}<span class="hp-petit"> · ${c.departement}</span></td>
        <td class="n">${pct(c.pct_dpe_bon)}</td>
        <td class="n">${fmtEur(c.budget_au_p25)}
          <span class="hp-barre${budget && c.budget_au_p25 <= budget ? " vert" : ""}"><i style="width:${
            Math.max(4, Math.round((c.budget_au_p25 / plafond) * 100))}%"></i></span>
        </td>
        <td class="n">${fmtEur(c.budget_median)}</td>
        <td class="n">${c.score_accessibilite ?? "—"}</td>
        <td class="n">${c.score_securite ?? "—"}</td>
        <td class="n">${c.taxe_fonciere_estimee ? fmtEur(c.taxe_fonciere_estimee)
          : (c.taux_tf_global ? c.taux_tf_global + " %" : "—")}</td>
      </tr>`).join("");

    // Ce que permet chaque niveau de revenus : la question que tout acheteur se
    // pose avant même de chercher, et à laquelle une liste de communes ne répond pas.
    const budgets = [2500, 3000, 3500, 4000].map(revenus => {
      const c = capaciteAchat({ revenusNets: revenus, apport: 20000, taux: 3.5, duree: 20 });
      const accessibles = data.communes.filter(x => x.budget_au_p25 <= c.budgetMax).length;
      return `<tr>
        <td>${revenus.toLocaleString("fr-FR")} €/mois</td>
        <td class="n">${fmtEur(c.mensualiteMax)}</td>
        <td class="n">${fmtEur(c.budgetMax)}</td>
        <td class="n">${accessibles} / ${data.communes.length}</td>
      </tr>`;
    }).join("");

    const corps = enteteDoc(
      "Dossier de recherche",
      `${typeLocal} · ${pieces} pièces · ${surface} m²${budget ? ` · budget ${fmtEur(budget)}` : ""}` +
      `${nomsDepts ? ` · ${nomsDepts}` : ""}`
    ) + `

<div class="hp-encart">
  <b>🔎 Votre recherche</b>
  <p>${data.synthese}</p>
</div>

<div class="hp-chiffres">
  <div class="hp-chiffre"><div class="v">${data.nb_communes}</div><div class="l">communes retenues</div></div>
  <div class="hp-chiffre vert"><div class="v">${fmtEur(premiere.budget_au_p25)}</div><div class="l">au 1ᵉʳ quartile · ${premiere.ville}</div></div>
  <div class="hp-chiffre"><div class="v">${fmtEur(premiere.budget_median)}</div><div class="l">au prix médian</div></div>
</div>

<div class="hp-podium">
  ${data.communes.slice(0, 3).map((c, i) => {
    const puces = [
      c.score_accessibilite != null && `🚇 Transports ${c.score_accessibilite}`,
      c.score_securite != null && `🛡️ Sécurité ${c.score_securite}`,
      c.pct_dpe_bon != null && `🍃 ${pct(c.pct_dpe_bon)} en A·B·C`,
    ].filter(Boolean).map(t => `<span class="hp-puce">${t}</span>`).join("");
    return `
  <div class="hp-podium-carte${i === 0 ? " premier" : ""}">
    <div class="hp-podium-rang">${["🥇 1ᵉʳ choix", "🥈 2ᵉ", "🥉 3ᵉ"][i]}</div>
    <div class="hp-podium-nom">${c.ville}</div>
    <div class="hp-petit">Département ${c.departement}</div>
    <div class="hp-podium-prix">${fmtEur(c.budget_au_p25)}</div>
    <div class="hp-podium-detail">pour ${surface} m² au 1ᵉʳ quartile<br>${fmtEur(c.budget_median)} au prix médian</div>
    <div class="hp-puces">${puces}</div>
  </div>`;
  }).join("")}
</div>

${alerteDpe.length ? `
<div class="hp-encart rouge">
  <b>⚡ Vigilance sur la performance énergétique</b>
  <p>${alerteDpe.length} commune${alerteDpe.length > 1 ? "s" : ""} de cette sélection
  compte${alerteDpe.length > 1 ? "nt" : ""} <strong>moins de 2 % de logements classés A, B ou C</strong> :
  ${alerteDpe.slice(0, 6).map(c => c.ville).join(", ")}. Le risque d'y acheter un logement
  énergivore est élevé. Les classes G sont déjà interdites à la location, les F le seront
  en 2028 — un bien mal classé sera difficile à revendre comme à louer.</p>
</div>` : ""}

${titreDoc("🏘️", `Communes classées selon ${libelleCritere.toLowerCase()}`)}
<table>
  <thead><tr>
    <th>Commune</th><th class="n">A·B·C</th>
    <th class="n">1ᵉʳ quartile</th><th class="n">Prix médian</th>
    <th class="n">Transp.</th><th class="n">Sécurité</th><th class="n">Taxe fonc.</th>
  </tr></thead>
  <tbody>${lignes}</tbody>
</table>
<p class="hp-petit">Budget calculé pour ${surface} m² au prix au m² observé. Seules les communes
totalisant au moins 40 ventes comparables figurent ici : en dessous, les percentiles ne veulent
plus rien dire. Sécurité et transports sont des scores sur 100.</p>

<div class="hp-encart vert">
  <b>💡 Le premier quartile plutôt que la médiane</b>
  <p>Acheter au premier quartile plutôt qu'au prix médian représente
  <strong>${fmtEur(premiere.budget_median - premiere.budget_au_p25)} d'économie</strong> à ${premiere.ville},
  sans changer de commune. L'écart s'explique par l'étage, l'état, le DPE ou les charges —
  autant d'éléments négociables. C'est le principal levier d'économie d'un achat.</p>
</div>

${titreDoc("💰", "Ce que permet votre budget")}
<table>
  <thead><tr>
    <th>Revenus nets du foyer</th><th class="n">Mensualité max</th>
    <th class="n">Budget d'achat</th><th class="n">Communes accessibles</th>
  </tr></thead>
  <tbody>${budgets}</tbody>
</table>
<p class="hp-petit">Sur 20 ans à 3,5 % avec 20 000 € d'apport, à 35 % d'endettement maximum.
Le taux réel dépend de votre dossier : demandez plusieurs simulations.</p>

<div class="hp-encart ambre">
  <b>⚠️ Le piège de l'apport</b>
  <p>Votre apport finance d'abord les frais de notaire, qui ne s'empruntent pas : environ
  <strong>7,5 % du prix</strong> dans l'ancien. Sur 20 000 € d'apport et un bien à 180 000 €,
  13 500 € y passent — il n'en reste que 6 500 € pour le bien lui-même.</p>
</div>

${titreDoc("🔍", "À demander à chaque visite")}
<ul>
  <li>🧾 Le montant réel des charges annuelles et leur contenu</li>
  <li>📋 Les procès-verbaux des trois dernières assemblées générales : travaux votés, impayés</li>
  <li>⚡ La classe DPE, la date du diagnostic et la consommation estimée</li>
  <li>🏛️ La taxe foncière de l'année précédente</li>
  <li>🏦 L'existence d'un fonds de travaux et son montant</li>
  <li>⏳ Depuis combien de temps le bien est en vente, et si le prix a déjà baissé</li>
  <li>🔑 La raison de la vente : succession, mutation ou divorce impliquent un vendeur pressé</li>
</ul>

${titreDoc("💬", "Négocier")}
<p>Situez le prix demandé dans la distribution des ventes de la commune, puis chiffrez les
défauts constatés : devis de travaux, DPE défavorable, charges élevées. Une offre écrite,
motivée par ces éléments et assortie d'une durée de validité, pèse bien davantage qu'une
proposition orale. <strong>Ne révélez jamais votre budget maximum</strong>, et ne montrez pas
que vous êtes pressé.</p>

<div class="hp-encart">
  <b>📜 Vos protections après l'offre</b>
  <p><strong>10 jours de rétractation</strong> après le compromis, sans avoir à vous justifier.
  <strong>La condition suspensive de prêt</strong> annule la vente et vous rend votre dépôt si
  le financement est refusé : ne l'abandonnez jamais, même si le vendeur le demande.</p>
</div>` + piedDoc(
      "Seules les communes réunissant au moins 40 ventes comparables sont retenues."
    );

    if (!imprimerDoc(corps, `Dossier de recherche — ${typeLocal} ${pieces} pièces`)) {
      setErreur("Autorisez les fenêtres surgissantes pour générer le dossier.");
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dossier de recherche</h1>
        <p className="text-slate-400 text-sm mt-1">
          Où chercher, avant même d'avoir trouvé une annonce.
        </p>
      </div>

      <form onSubmit={chercher} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Budget maximum</label>
            <input type="number" value={budget} onChange={e => setBudget(Number(e.target.value))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Surface (m²)</label>
            <input type="number" value={surface} onChange={e => setSurface(Number(e.target.value))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Pièces</label>
            <select value={pieces} onChange={e => setPieces(Number(e.target.value))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
              {[1, 2, 3, 4, 5].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Type</label>
            <select value={typeLocal} onChange={e => setTypeLocal(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
              <option>Appartement</option><option>Maison</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-2">Ce qui compte le plus pour vous</label>
          <div className="flex flex-wrap gap-2">
            {CRITERES.map(c => (
              <button key={c.value} type="button" onClick={() => setCritere(c.value)}
                title={c.aide}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={critere === c.value
                  ? { background: "rgba(60,131,246,0.25)", border: "1px solid rgba(60,131,246,0.6)", color: "#93c5fd" }
                  : { background: "rgba(30,41,59,0.6)", border: "1px solid rgba(255,255,255,0.07)", color: "#94a3b8" }}>
                {c.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            {CRITERES.find(c => c.value === critere)?.aide}
          </p>
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-2">Départements</label>
          <div className="flex flex-wrap gap-2">
            {DEPARTEMENTS.map(d => (
              <button key={d.code} type="button" onClick={() => basculerDept(d.code)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={deps.includes(d.code)
                  ? { background: "rgba(60,131,246,0.25)", border: "1px solid rgba(60,131,246,0.6)", color: "#93c5fd" }
                  : { background: "rgba(30,41,59,0.6)", border: "1px solid rgba(255,255,255,0.07)", color: "#94a3b8" }}>
                {d.code} · {d.nom}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={loading}
            className="px-5 py-2.5 rounded-lg text-sm font-medium transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", color: "white" }}>
            {loading ? "Recherche…" : "Chercher"}
          </button>
          {data?.communes?.length > 0 && (
            <button type="button" onClick={genererDossier}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-all hover:brightness-110"
              style={{ background: "rgba(60,131,246,0.2)", border: "1px solid rgba(60,131,246,0.4)", color: "#60a5fa" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 17 }}>picture_as_pdf</span>
              Dossier PDF
            </button>
          )}
        </div>

        {erreur && <p className="text-red-400 text-xs">{erreur}</p>}
      </form>

      {data && (
        <>
          {data.synthese && (
            <div className="rounded-xl p-4 border"
              style={{ background: "rgba(60,131,246,0.07)", borderColor: "rgba(60,131,246,0.25)" }}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>search</span>
                <span className="text-primary font-semibold text-sm">Votre recherche</span>
              </div>
              <p className="text-slate-300 text-sm leading-relaxed">{data.synthese}</p>
            </div>
          )}

          {data.communes?.length > 0 && (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}>
              <Chiffre valeur={data.nb_communes} libelle="communes retenues" icone="location_city" />
              <Chiffre valeur={fmtEur(data.communes[0].budget_au_p25)}
                libelle={`au 1ᵉʳ quartile · ${data.communes[0].ville}`} icone="trending_down" accent />
              <Chiffre valeur={fmtEur(data.communes[0].budget_median)}
                libelle="au prix médian" icone="show_chart" />
            </div>
          )}

          {/* Les trois premières communes méritent mieux qu'une ligne de tableau :
              c'est sur elles que se prend la décision d'aller visiter. */}
          {data.communes?.length > 0 && (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
              {data.communes.slice(0, 3).map((c, i) => (
                <Podium key={c.code_commune} commune={c} rang={i} surface={surface} />
              ))}
            </div>
          )}

          {data.communes?.length > 0 && (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                      <th className="text-left font-medium pb-2 pr-3">Commune</th>
                      <th className="text-right font-medium pb-2 px-2">A·B·C</th>
                      <th className="text-right font-medium pb-2 px-2">1<sup>er</sup> quartile</th>
                      <th className="text-right font-medium pb-2 px-2">Médian</th>
                      <th className="text-right font-medium pb-2 px-2">Transp.</th>
                      <th className="text-right font-medium pb-2 px-2">Sécurité</th>
                      <th className="text-right font-medium pb-2 px-2">Taxe fonc.</th>
                      <th className="text-right font-medium pb-2 pl-2">Ventes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {communesPage.map(c => (
                      <tr key={c.code_commune} className="border-t border-slate-800">
                        <td className="py-2 pr-3">
                          <span className="text-slate-200">{c.ville}</span>
                          <span className="text-slate-600 text-xs"> · {c.departement}</span>
                          {c.remarque && (
                            <span className="block text-[10px] text-amber-500/80">{c.remarque}</span>
                          )}
                        </td>
                        <td className="text-right px-2 text-slate-400">{pct(c.pct_dpe_bon)}</td>
                        {/* La barre situe la commune dans l'étendue des prix de la
                            sélection : un écart se voit avant de se lire. */}
                        <td className="text-right px-2 text-white font-medium">
                          {fmtEur(c.budget_au_p25)}
                          <span className="block h-1 rounded-full mt-1" style={{
                            background: "rgba(148,163,184,0.15)",
                          }}>
                            <span className="block h-1 rounded-full" style={{
                              width: `${Math.max(4, Math.round((c.budget_au_p25 / maxP25) * 100))}%`,
                              marginLeft: "auto",
                              background: budget && c.budget_au_p25 <= budget ? "#34d399" : "#64748b",
                            }} />
                          </span>
                        </td>
                        <td className="text-right px-2 text-slate-400">{fmtEur(c.budget_median)}</td>
                        <td className="text-right px-2 text-slate-400">{c.score_accessibilite ?? "—"}</td>
                        <td className="text-right px-2">
                          {c.score_securite != null ? (
                            <span style={{ color: c.score_securite >= 75 ? "#34d399"
                              : c.score_securite >= 60 ? "#94a3b8" : "#f59e0b" }}>
                              {c.score_securite}
                            </span>
                          ) : <span className="text-slate-600">—</span>}
                        </td>
                        <td className="text-right px-2 text-slate-400">
                          {c.taxe_fonciere_estimee
                            ? fmtEur(c.taxe_fonciere_estimee)
                            : c.taux_tf_global ? `${c.taux_tf_global} %` : "—"}
                        </td>
                        <td className="text-right pl-2 text-slate-500 text-xs">{c.nb_ventes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {nbPages > 1 && (
                <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-slate-800">
                  <span className="text-[11px] text-slate-500">
                    {page * PAR_PAGE + 1}–{Math.min((page + 1) * PAR_PAGE, communes.length)} sur {communes.length},
                    classées de la meilleure à la moins bonne
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                      className="px-2.5 py-1 rounded-lg text-xs text-slate-300 bg-slate-800 disabled:opacity-35 hover:brightness-125">
                      Précédent
                    </button>
                    <span className="text-[11px] text-slate-500 tabular-nums px-1">{page + 1} / {nbPages}</span>
                    <button type="button" onClick={() => setPage(p => Math.min(nbPages - 1, p + 1))}
                      disabled={page >= nbPages - 1}
                      className="px-2.5 py-1 rounded-lg text-xs text-slate-300 bg-slate-800 disabled:opacity-35 hover:brightness-125">
                      Suivant
                    </button>
                  </div>
                </div>
              )}

              <p className="text-[11px] text-slate-600 mt-3">
                Seules les communes totalisant au moins 40 ventes comparables sont retenues :
                en dessous, les percentiles ne veulent plus rien dire. Le budget affiché
                correspond à {surface} m² au prix au m² observé.
              </p>
            </div>
          )}

          {capacites.length > 0 && (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>savings</span>
                <h2 className="text-white font-semibold text-sm">Ce que permet votre situation</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                      <th className="text-left font-medium pb-2 pr-3">Revenus nets</th>
                      <th className="text-right font-medium pb-2 px-2">Mensualité max</th>
                      <th className="text-right font-medium pb-2 px-2">Budget max</th>
                      <th className="text-right font-medium pb-2 pl-2">Communes accessibles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capacites.map(c => (
                      <tr key={c.revenus} className="border-t border-slate-800">
                        <td className="py-2 pr-3 text-slate-300">{c.revenus.toLocaleString("fr-FR")} €/mois</td>
                        <td className="text-right px-2 text-slate-400">{fmtEur(c.mensualiteMax)}</td>
                        <td className="text-right px-2 text-white font-medium">{fmtEur(c.budgetMax)}</td>
                        <td className="text-right pl-2">
                          <span style={{ color: c.accessibles > 0 ? "#34d399" : "#f59e0b" }}>
                            {c.accessibles}
                          </span>
                          <span className="text-slate-600"> / {data.communes.length}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-600 mt-3">
                Hypothèses : apport de 20 000 €, taux de 3,5 % sur 20 ans, taux d'endettement
                plafonné à 35 % comme le recommande le HCSF. Votre banque appliquera ses
                propres critères.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
