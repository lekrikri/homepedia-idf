import { useState, useEffect } from "react";
import axios from "axios";

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

  function genererDossier() {
    if (!data?.communes?.length) return;
    const d = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const libelleCritere = CRITERES.find(c => c.value === data.critere)?.label || data.critere;
    const alerteDpe = data.communes.filter(c => c.pct_dpe_bon != null && c.pct_dpe_bon <= 0.02);

    const lignes = data.communes.slice(0, 20).map(c => `
      <tr>
        <td>${c.ville}<span class="dept"> · ${c.departement}</span></td>
        <td class="n">${pct(c.pct_dpe_bon)}</td>
        <td class="n">${fmtEur(c.budget_au_p25)}</td>
        <td class="n">${fmtEur(c.budget_median)}</td>
        <td class="n">${c.score_accessibilite ?? "—"}</td>
        <td class="n">${c.score_securite ?? "—"}</td>
        <td class="n">${c.taxe_fonciere_estimee ? fmtEur(c.taxe_fonciere_estimee)
          : (c.taux_tf_global ? c.taux_tf_global + " %" : "—")}</td>
        <td class="n">${c.nb_ventes}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Dossier de recherche — ${typeLocal} ${pieces} pièces</title>
<style>
@page{size:A4;margin:1.6cm}
body{font-family:Arial,sans-serif;font-size:10.5pt;color:#111;line-height:1.5;margin:0}
.header{border-bottom:3px solid #111;padding-bottom:12px;margin-bottom:20px}
h1{font-size:19pt;margin:0 0 4px}
h2{font-size:10pt;text-transform:uppercase;letter-spacing:.07em;color:#555;margin:22px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
.sub{color:#555;font-size:9.5pt;margin:0}
table{width:100%;border-collapse:collapse;margin:10px 0;font-size:9.5pt}
th{background:#f4f4f4;padding:7px 9px;text-align:left;border:1px solid #ddd;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em}
td{padding:6px 9px;border:1px solid #ddd}
td.n,th.n{text-align:right}
.dept{color:#888;font-size:8.5pt}
.encart{background:#f7f9fc;border-left:4px solid #1d4ed8;padding:12px 15px;margin:14px 0;page-break-inside:avoid}
.encart.alerte{border-left-color:#b91c1c;background:#fdf5f5}
.encart p{margin:0 0 6px}.encart p:last-child{margin:0}
.encart b{display:block;margin-bottom:4px}
ul{margin:6px 0;padding-left:18px}li{margin-bottom:3px}
.footer{margin-top:26px;font-size:8pt;color:#888;border-top:1px solid #ddd;padding-top:9px}
</style></head><body>
<div class="header">
  <h1>Dossier de recherche</h1>
  <p class="sub">${typeLocal} · ${pieces} pièces · ${surface} m²${budget ? ` · budget ${fmtEur(budget)}` : ""} — établi le ${d}</p>
</div>

<div class="encart">
  <b>Votre recherche</b>
  <p>${data.synthese}</p>
</div>

${alerteDpe.length ? `
<div class="encart alerte">
  <b>Vigilance sur la performance énergétique</b>
  <p>${alerteDpe.length} commune${alerteDpe.length > 1 ? "s" : ""} de cette sélection
  compte${alerteDpe.length > 1 ? "nt" : ""} moins de 2 % de logements classés A, B ou C :
  ${alerteDpe.slice(0, 6).map(c => c.ville).join(", ")}. Le risque d'y acheter un logement
  énergivore est élevé. Les classes G sont déjà interdites à la location, les F le seront en 2028.</p>
</div>` : ""}

<h2>Communes classées selon ${libelleCritere.toLowerCase()}</h2>
<table>
  <thead><tr>
    <th>Commune</th><th class="n">Logements A·B·C</th>
    <th class="n">Au 1<sup>er</sup> quartile</th><th class="n">Au prix médian</th>
    <th class="n">Transports</th><th class="n">Sécurité</th>
    <th class="n">Taxe foncière</th><th class="n">Ventes</th>
  </tr></thead>
  <tbody>${lignes}</tbody>
</table>
<p style="font-size:8.5pt;color:#666">
  Le budget indiqué correspond à ${surface} m² au prix au m² observé. Acheter au premier
  quartile plutôt qu'à la médiane est le principal levier d'économie : l'écart tient à
  l'étage, à l'état, au DPE et aux charges, autant d'éléments négociables.
</p>

<h2>À demander à chaque visite</h2>
<ul>
  <li>Le montant réel des charges annuelles et leur contenu</li>
  <li>Les procès-verbaux des trois dernières assemblées générales : travaux votés, impayés</li>
  <li>La classe DPE, la date du diagnostic et la consommation estimée</li>
  <li>La taxe foncière de l'année précédente</li>
  <li>Depuis combien de temps le bien est en vente, et si le prix a déjà baissé</li>
  <li>La raison de la vente : succession, mutation et divorce impliquent un vendeur pressé</li>
</ul>

<h2>Négocier</h2>
<p>Situez le prix demandé dans la distribution des ventes de la commune, puis chiffrez les
défauts constatés : devis de travaux, DPE défavorable, charges élevées. Une offre écrite,
motivée par ces éléments et assortie d'une durée de validité, pèse davantage qu'une
proposition orale. Ne révélez jamais votre budget maximum.</p>

<div class="footer">
  Sources : transactions DVF (DGFiP), diagnostics ADEME, base HomePedia IDF. Seules les communes
  totalisant au moins 40 ventes comparables figurent dans cette sélection, en dessous les
  percentiles ne sont pas significatifs. Les données DVF publiées accusent environ six mois de
  décalage. Document d'aide à la décision fondé sur des ventes passées : ni expertise, ni offre.
</div>
</body></html>`;

    const w = window.open("", "_blank");
    if (!w) { setErreur("Autorisez les fenêtres surgissantes pour générer le dossier."); return; }
    w.document.write(html);
    w.document.close();
    w.onload = () => w.print();
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
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
              <p className="text-slate-300 text-sm">{data.synthese}</p>
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
                    {data.communes.map(c => (
                      <tr key={c.code_commune} className="border-t border-slate-800">
                        <td className="py-2 pr-3">
                          <span className="text-slate-200">{c.ville}</span>
                          <span className="text-slate-600 text-xs"> · {c.departement}</span>
                          {c.remarque && (
                            <span className="block text-[10px] text-amber-500/80">{c.remarque}</span>
                          )}
                        </td>
                        <td className="text-right px-2 text-slate-400">{pct(c.pct_dpe_bon)}</td>
                        <td className="text-right px-2 text-white font-medium">{fmtEur(c.budget_au_p25)}</td>
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
              <p className="text-[11px] text-slate-600 mt-3">
                Seules les communes totalisant au moins 40 ventes comparables sont retenues :
                en dessous, les percentiles ne veulent plus rien dire. Le budget affiché
                correspond à {surface} m² au prix au m² observé.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
