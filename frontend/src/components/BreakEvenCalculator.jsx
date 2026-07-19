import { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtEur(v) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
}
function fmtK(v) {
  return v >= 1000 ? `${Math.round(v / 1000)} k€` : `${Math.round(v)} €`;
}

// ── Calcul break-even ─────────────────────────────────────────────────────────
function computeBreakEven({
  prix, apportPct, tauxCredit, dureeCredit,
  loyerMensuel, inflationLoyer,
  fraisNotairePct, taxeFonciere, chargesCopro,
  entretienPct, appreciationAnnuelle,
}) {
  const apport = prix * (apportPct / 100);
  const capital = prix - apport;
  const fraisNotaire = prix * (fraisNotairePct / 100);
  const tauxMensuel = tauxCredit / 100 / 12;
  const nbMois = dureeCredit * 12;

  // Mensualité crédit (amortissement constant)
  const mensualite = tauxMensuel > 0
    ? capital * (tauxMensuel * Math.pow(1 + tauxMensuel, nbMois)) / (Math.pow(1 + tauxMensuel, nbMois) - 1)
    : capital / nbMois;

  const rows = [];
  let capitalRestant = capital;
  let cumulCoutAchat = fraisNotaire + apport; // coût initial propriétaire
  let cumulCoutLocation = apport; // locataire place son apport (coût d'opportunité)
  let loyer = loyerMensuel * 12;
  let valeurBien = prix;
  let breakEvenYear = null;

  for (let year = 1; year <= Math.min(dureeCredit + 5, 30); year++) {
    // Intérêts + capital remboursé cette année
    let interetsAnnee = 0;
    let capitalAnnee = 0;
    for (let m = 0; m < 12; m++) {
      const intMois = capitalRestant * tauxMensuel;
      const capMois = Math.min(mensualite - intMois, capitalRestant);
      interetsAnnee += intMois;
      capitalAnnee += capMois;
      capitalRestant = Math.max(0, capitalRestant - capMois);
    }

    // Coût annuel propriétaire (hors remboursement capital = investissement)
    const coutProprio = interetsAnnee + taxeFonciere + chargesCopro + prix * (entretienPct / 100);
    // Mensualité totale (intérêts + capital, jusqu'à fin crédit)
    const mensualiteAnnuelle = year <= dureeCredit ? mensualite * 12 : 0;

    // Appréciation du bien
    valeurBien *= (1 + appreciationAnnuelle / 100);
    const plusValue = valeurBien - prix;

    // Coût total cumulé propriétaire : frais notaire + intérêts cumulés + charges - plus-value latente
    cumulCoutAchat += coutProprio;
    const coutNetProprietaire = cumulCoutAchat - plusValue;

    // Coût locataire : loyers cumulés
    cumulCoutLocation += loyer;
    loyer *= (1 + inflationLoyer / 100);

    const avantageAchat = cumulCoutLocation - coutNetProprietaire;

    if (breakEvenYear === null && avantageAchat > 0) {
      breakEvenYear = year;
    }

    rows.push({
      year,
      coutProprietaire: Math.round(coutNetProprietaire),
      coutLocataire: Math.round(cumulCoutLocation),
      avantageAchat: Math.round(avantageAchat),
      valeurBien: Math.round(valeurBien),
      mensualiteAnnuelle: Math.round(mensualiteAnnuelle / 12),
    });
  }

  return { rows, breakEvenYear, mensualite };
}

// ── Tooltip custom ────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  return (
    <div className="glass-panel rounded-xl px-3 py-2.5 text-[11px] shadow-xl border border-slate-700/50">
      <p className="font-bold text-slate-200 mb-1.5">Année {label}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-blue-400">Coût net propriétaire</span>
          <span className="font-bold mono-nums text-slate-200">{fmtK(p.coutProprietaire)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-rose-400">Coût locataire cumulé</span>
          <span className="font-bold mono-nums text-slate-200">{fmtK(p.coutLocataire)}</span>
        </div>
        <div className="flex justify-between gap-4 pt-1 border-t border-slate-700">
          <span className={p.avantageAchat > 0 ? "text-emerald-400" : "text-amber-400"}>
            {p.avantageAchat > 0 ? "Gain propriétaire" : "Avantage locataire"}
          </span>
          <span className={`font-bold mono-nums ${p.avantageAchat > 0 ? "text-emerald-400" : "text-amber-400"}`}>
            {fmtK(Math.abs(p.avantageAchat))}
          </span>
        </div>
        <div className="flex justify-between gap-4 text-slate-500">
          <span>Valeur bien estimée</span>
          <span className="mono-nums">{fmtK(p.valeurBien)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Slider helper ─────────────────────────────────────────────────────────────
function Slider({ label, value, min, max, step, unit, onChange, color = "#3c83f6", format }) {
  const display = format ? format(value) : `${value} ${unit}`;
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
        <span className="text-sm font-bold mono-nums" style={{ color }}>{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 rounded-lg cursor-pointer"
        style={{ accentColor: color }} />
    </div>
  );
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function BreakEvenCalculator({ prixInitial = 350000, loyerInitial = 1200 }) {
  const [prix, setPrix] = useState(prixInitial);
  const [apportPct, setApportPct] = useState(20);
  const [tauxCredit, setTauxCredit] = useState(3.5);
  const [dureeCredit, setDureeCredit] = useState(20);
  const [loyerMensuel, setLoyerMensuel] = useState(loyerInitial);
  const [inflationLoyer, setInflationLoyer] = useState(2);
  const [fraisNotairePct, setFraisNotairePct] = useState(7.5);
  const [taxeFonciere, setTaxeFonciere] = useState(1200);
  const [chargesCopro, setChargesCopro] = useState(1800);
  const [entretienPct, setEntretienPct] = useState(1);
  const [appreciationAnnuelle, setAppreciationAnnuelle] = useState(2);

  const { rows, breakEvenYear, mensualite } = useMemo(() => computeBreakEven({
    prix, apportPct, tauxCredit, dureeCredit,
    loyerMensuel, inflationLoyer,
    fraisNotairePct, taxeFonciere, chargesCopro,
    entretienPct, appreciationAnnuelle,
  }), [prix, apportPct, tauxCredit, dureeCredit, loyerMensuel, inflationLoyer,
      fraisNotairePct, taxeFonciere, chargesCopro, entretienPct, appreciationAnnuelle]);

  const breakEvenRow = rows.find(r => r.year === breakEvenYear);
  const lastRow = rows[rows.length - 1];

  return (
    <div className="flex flex-col h-full bg-[#0f1117] text-slate-200 overflow-auto">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(60,131,246,0.12)", border: "1px solid rgba(60,131,246,0.3)" }}>
            <span className="material-symbols-outlined text-blue-400" style={{ fontSize: 20 }}>balance</span>
          </div>
          <div>
            <h2 className="font-bold text-white text-base">Achat vs Location — Break-even</h2>
            <p className="text-[11px] text-slate-400">À partir de quelle année l'achat devient rentable ?</p>
          </div>
        </div>

        {/* Métriques clés */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          {[
            {
              label: "Break-even",
              value: breakEvenYear ? `Année ${breakEvenYear}` : "≥ 30 ans",
              sub: breakEvenYear ? `${new Date().getFullYear() + breakEvenYear}` : "Non atteint",
              color: breakEvenYear && breakEvenYear <= 10 ? "#10b981" : breakEvenYear && breakEvenYear <= 20 ? "#f59e0b" : "#ef4444",
              icon: "flag",
            },
            {
              label: "Mensualité crédit",
              value: fmtEur(mensualite),
              sub: `vs loyer ${fmtEur(loyerMensuel)}`,
              color: mensualite <= loyerMensuel * 1.2 ? "#10b981" : "#f59e0b",
              icon: "payments",
            },
            {
              label: `Gain à ${rows.length} ans`,
              value: lastRow ? fmtK(Math.abs(lastRow.avantageAchat)) : "—",
              sub: lastRow?.avantageAchat > 0 ? "en faveur achat" : "en faveur location",
              color: lastRow?.avantageAchat > 0 ? "#10b981" : "#ef4444",
              icon: "savings",
            },
          ].map(({ label, value, sub, color, icon }) => (
            <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="material-symbols-outlined" style={{ fontSize: 14, color }}>{icon}</span>
                <p className="text-[9px] text-slate-500 uppercase tracking-wide">{label}</p>
              </div>
              <p className="text-base font-bold mono-nums" style={{ color }}>{value}</p>
              <p className="text-[9px] text-slate-600 mt-0.5">{sub}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 gap-0">
        {/* Colonne sliders */}
        <div className="w-64 shrink-0 p-4 border-r border-slate-800 overflow-y-auto space-y-5">
          <div className="space-y-4">
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Bien & Financement</p>
            <Slider label="Prix d'achat" value={prix} min={100000} max={1000000} step={5000}
              format={v => fmtEur(v)} onChange={setPrix} color="#3c83f6" />
            <Slider label="Apport" value={apportPct} min={5} max={50} step={1} unit="%"
              onChange={setApportPct} color="#60a5fa" />
            <Slider label="Taux crédit" value={tauxCredit} min={1} max={6} step={0.1} unit="%"
              onChange={setTauxCredit} color="#a78bfa" />
            <Slider label="Durée crédit" value={dureeCredit} min={5} max={25} step={1} unit="ans"
              onChange={setDureeCredit} color="#818cf8" />
            <Slider label="Frais notaire" value={fraisNotairePct} min={2.5} max={8.5} step={0.5} unit="%"
              onChange={setFraisNotairePct} color="#94a3b8" />
          </div>

          <div className="space-y-4 pt-4 border-t border-slate-800">
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Location & Marché</p>
            <Slider label="Loyer équivalent" value={loyerMensuel} min={300} max={5000} step={50}
              format={v => fmtEur(v) + "/mois"} onChange={setLoyerMensuel} color="#f97316" />
            <Slider label="Inflation loyer" value={inflationLoyer} min={0} max={5} step={0.5} unit="%/an"
              onChange={setInflationLoyer} color="#fb923c" />
            <Slider label="Appréciation bien" value={appreciationAnnuelle} min={-2} max={6} step={0.5} unit="%/an"
              onChange={setAppreciationAnnuelle} color="#10b981" />
          </div>

          <div className="space-y-4 pt-4 border-t border-slate-800">
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Charges propriétaire</p>
            <Slider label="Taxe foncière" value={taxeFonciere} min={0} max={5000} step={100}
              format={v => fmtEur(v) + "/an"} onChange={setTaxeFonciere} color="#f59e0b" />
            <Slider label="Charges copro" value={chargesCopro} min={0} max={6000} step={100}
              format={v => fmtEur(v) + "/an"} onChange={setChargesCopro} color="#eab308" />
            <Slider label="Entretien" value={entretienPct} min={0.5} max={3} step={0.25} unit="%/an du prix"
              onChange={setEntretienPct} color="#ca8a04" />
          </div>
        </div>

        {/* Graphique */}
        <div className="flex-1 flex flex-col p-4 min-w-0">
          {/* Annotation break-even */}
          {breakEvenYear && (
            <div className="mb-3 px-3 py-2 rounded-xl text-[11px]"
              style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
              <span className="text-emerald-400 font-bold">✓ Break-even en année {breakEvenYear}</span>
              <span className="text-slate-400 ml-2">
                — l'achat devient rentable en {new Date().getFullYear() + breakEvenYear}
                {breakEvenRow && ` (gain cumulé propriétaire : ${fmtK(breakEvenRow.avantageAchat)})`}
              </span>
            </div>
          )}

          <div className="flex-1 min-h-0" style={{ minHeight: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="year"
                  label={{ value: "Années", position: "insideBottom", offset: -10, fill: "#64748b", fontSize: 10 }}
                  tick={{ fill: "#64748b", fontSize: 10 }} />
                <YAxis tickFormatter={v => `${Math.round(v / 1000)}k€`} tick={{ fill: "#64748b", fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
                {breakEvenYear && (
                  <ReferenceLine x={breakEvenYear} stroke="#10b981" strokeDasharray="4 3"
                    label={{ value: `Break-even an ${breakEvenYear}`, fill: "#10b981", fontSize: 9, position: "top" }} />
                )}
                <Line type="monotone" dataKey="coutProprietaire" name="Coût net propriétaire"
                  stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="coutLocataire" name="Coût locataire cumulé"
                  stroke="#ef4444" strokeWidth={2} dot={false} strokeDasharray="5 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Tableau décennal */}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-slate-800">
                  {["Année", "Coût net propriétaire", "Coût locataire cumulé", "Avantage", "Valeur bien"].map(h => (
                    <th key={h} className="text-left py-1.5 px-2 text-slate-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.filter(r => r.year % 5 === 0 || r.year === breakEvenYear || r.year === 1).map(r => (
                  <tr key={r.year}
                    className={`border-b border-slate-800/50 ${r.year === breakEvenYear ? "bg-emerald-500/5" : ""}`}>
                    <td className="py-1.5 px-2 font-bold mono-nums text-slate-300">
                      {r.year === breakEvenYear ? `★ An ${r.year}` : `An ${r.year}`}
                    </td>
                    <td className="py-1.5 px-2 mono-nums text-blue-400">{fmtK(r.coutProprietaire)}</td>
                    <td className="py-1.5 px-2 mono-nums text-rose-400">{fmtK(r.coutLocataire)}</td>
                    <td className={`py-1.5 px-2 mono-nums font-bold ${r.avantageAchat > 0 ? "text-emerald-400" : "text-amber-400"}`}>
                      {r.avantageAchat > 0 ? "+" : ""}{fmtK(r.avantageAchat)}
                    </td>
                    <td className="py-1.5 px-2 mono-nums text-slate-400">{fmtK(r.valeurBien)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
