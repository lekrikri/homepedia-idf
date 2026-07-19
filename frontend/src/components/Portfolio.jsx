import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import BreakEvenCalculator from "./BreakEvenCalculator.jsx";

const terminalGridStyle = {
  backgroundImage: "radial-gradient(circle at 2px 2px, rgba(60,131,246,0.05) 1px, transparent 0)",
  backgroundSize: "24px 24px",
};

function SliderRow({ label, value, min, max, step, unit, format, onChange }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-baseline">
        <span className="text-xs text-slate-400 uppercase tracking-wider">{label}</span>
        <span className="text-sm font-bold text-slate-100 mono-nums">
          {format ? format(value) : `${value.toLocaleString()} ${unit}`}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, #3c83f6 0%, #3c83f6 ${((value - min) / (max - min)) * 100}%, #1e293b ${((value - min) / (max - min)) * 100}%, #1e293b 100%)`,
        }}
      />
      <div className="flex justify-between text-[10px] text-slate-600">
        <span className="mono-nums">{min.toLocaleString()}{unit && ` ${unit}`}</span>
        <span className="mono-nums">{max.toLocaleString()}{unit && ` ${unit}`}</span>
      </div>
    </div>
  );
}

function ResultCard({ label, value, unit, color, icon, sub }) {
  return (
    <div className={`bg-slate-900 border rounded-xl p-4 flex flex-col gap-1 ${color === "green" ? "border-emerald-500/30" : color === "red" ? "border-red-500/30" : "border-slate-800"}`}>
      <div className="flex items-center gap-1.5 text-slate-500">
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{icon}</span>
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className={`text-2xl font-bold mono-nums ${color === "green" ? "text-emerald-400" : color === "red" ? "text-red-400" : "text-white"}`}>
          {value}
        </span>
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </div>
      {sub && <p className="text-[10px] text-slate-600 mt-0.5">{sub}</p>}
    </div>
  );
}

function CashflowChart({ data, breakEvenYear }) {
  if (!data || data.length === 0) return null;

  const W = 800;
  const H = 150;
  const PAD_L = 60;
  const PAD_R = 16;
  const PAD_T = 12;
  const PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const cashflows = data.map(d => d.cumulCashflow);
  const patrimoines = data.map(d => d.patrimoineNet);
  const allVals = [...cashflows, ...patrimoines];
  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const range = maxVal - minVal || 1;

  const xOf = i => PAD_L + (i / (data.length - 1)) * innerW;
  const yOf = v => PAD_T + (1 - (v - minVal) / range) * innerH;

  const cashPath = data.map((d, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(d.cumulCashflow).toFixed(1)}`).join(" ");
  const patriPath = data.map((d, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(d.patrimoineNet).toFixed(1)}`).join(" ");

  const zeroY = yOf(0);
  const zeroInRange = zeroY >= PAD_T && zeroY <= PAD_T + innerH;

  const fmt = v => {
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M€`;
    if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}k€`;
    return `${Math.round(v)}€`;
  };

  const yLabels = [0, 0.33, 0.67, 1].map(r => ({
    val: minVal + r * range,
    y: PAD_T + (1 - r) * innerH,
  }));

  return (
    <svg className="w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ height: 150 }}>
      <defs>
        <linearGradient id="cf-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(60,131,246,0.15)" />
          <stop offset="100%" stopColor="rgba(60,131,246,0)" />
        </linearGradient>
      </defs>

      {yLabels.map((l, i) => (
        <g key={i}>
          <line x1={PAD_L} x2={W - PAD_R} y1={l.y} y2={l.y} stroke="#1e293b" strokeWidth="1" />
          <text x={PAD_L - 4} y={l.y + 4} textAnchor="end" fontSize="9" fill="#475569" className="font-mono">{fmt(l.val)}</text>
        </g>
      ))}

      {zeroInRange && (
        <line x1={PAD_L} x2={W - PAD_R} y1={zeroY} y2={zeroY} stroke="rgba(100,116,139,0.5)" strokeWidth="1" strokeDasharray="4,3" />
      )}

      <path d={cashPath + ` L${xOf(data.length - 1)},${PAD_T + innerH} L${PAD_L},${PAD_T + innerH} Z`} fill="url(#cf-grad)" />
      <path d={cashPath} fill="none" stroke="#3c83f6" strokeWidth="2" strokeLinejoin="round"
        style={{ filter: "drop-shadow(0 0 4px rgba(60,131,246,0.4))" }} />
      <path d={patriPath} fill="none" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" strokeDasharray="5,3"
        style={{ filter: "drop-shadow(0 0 4px rgba(16,185,129,0.3))" }} />

      {breakEvenYear !== null && breakEvenYear >= 0 && breakEvenYear <= 20 && (
        <g>
          <line
            x1={xOf(breakEvenYear)} x2={xOf(breakEvenYear)}
            y1={PAD_T} y2={PAD_T + innerH}
            stroke="#f59e0b" strokeWidth="1" strokeDasharray="3,3"
          />
          <circle cx={xOf(breakEvenYear)} cy={zeroInRange ? zeroY : PAD_T + innerH / 2} r="4" fill="#f59e0b" />
          <text x={xOf(breakEvenYear) + 5} y={PAD_T + 12} fontSize="9" fill="#f59e0b">Equilibre</text>
        </g>
      )}

      {[0, 5, 10, 15, 20].map(yr => (
        <text key={yr} x={xOf(yr)} y={H - 6} textAnchor="middle" fontSize="9" fill="#475569">{yr}a</text>
      ))}

      <g transform={`translate(${PAD_L + 8}, ${PAD_T + 8})`}>
        <rect width="80" height="34" rx="4" fill="rgba(15,23,36,0.8)" stroke="#1e293b" strokeWidth="1" />
        <line x1="6" y1="12" x2="18" y2="12" stroke="#3c83f6" strokeWidth="2" />
        <text x="22" y="15" fontSize="8" fill="#94a3b8">Cash-flow</text>
        <line x1="6" y1="24" x2="18" y2="24" stroke="#10b981" strokeWidth="2" strokeDasharray="4,2" />
        <text x="22" y="27" fontSize="8" fill="#94a3b8">Patrimoine</text>
      </g>
    </svg>
  );
}

export default function Portfolio() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Helper pour lire un param URL avec fallback
  const getParam = (key, fallback, isInt = false) => {
    const v = searchParams.get(key);
    if (!v) return fallback;
    return isInt ? (parseInt(v) || fallback) : (parseFloat(v) || fallback);
  };

  // Initialisation depuis query params (?prix=X&loyer=Y&commune=NOM&surface=S)
  const communeLabel = searchParams.get('commune') || null;
  const surfaceParam = Number(searchParams.get('surface')) || 0;
  const prixParam = searchParams.get('prix') ? Number(searchParams.get('prix')) : null;
  // Si prix/m² passé + surface, on calcule le total ; sinon on prend prix direct
  const prixInit = prixParam
    ? (surfaceParam && prixParam < 50000 ? Math.round(prixParam * surfaceParam) : prixParam)
    : getParam("prix", 350000, true);

  const [prix, setPrix] = useState(Math.min(Math.max(prixInit, 50000), 2000000));
  const [apportPct, setApportPct] = useState(() => getParam("apport", 20));
  const [taux, setTaux] = useState(() => getParam("taux", 3.5));
  const [duree, setDuree] = useState(() => getParam("duree", 20, true));
  const [loyer, setLoyer] = useState(() => {
    const fromUrl = getParam("loyer", 0, true);
    if (fromUrl > 0) return Math.min(Math.max(fromUrl, 200), 8000);
    const l = Number(searchParams.get('loyer'));
    return l > 0 ? Math.min(Math.max(l, 200), 8000) : 1200;
  });
  const [charges, setCharges] = useState(() => getParam("charges", 2400, true));
  const [taxeFonciere, setTaxeFonciere] = useState(() => getParam("taxe", 1800, true));
  const [vacance, setVacance] = useState(() => getParam("vacance", 5));
  const [regime, setRegime] = useState(() => searchParams.get("regime") || "micro"); // "micro" | "reel"
  const [tmi, setTmi] = useState(() => getParam("tmi", 30, true)); // 0 | 11 | 30 | 41 | 45
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("simulation"); // "simulation" | "breakeven"

  // Synchroniser l'URL quand les valeurs changent
  useEffect(() => {
    const params = {
      prix: String(prix),
      loyer: String(loyer),
      apport: String(apportPct),
      taux: String(taux),
      duree: String(duree),
      charges: String(charges),
      vacance: String(vacance),
      taxe: String(taxeFonciere),
      regime,
      tmi: String(tmi),
    };
    if (communeLabel) params.commune = communeLabel;
    setSearchParams(params, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prix, loyer, apportPct, taux, duree, charges, vacance, taxeFonciere, regime, tmi]);

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const calc = useMemo(() => {
    const apport = prix * (apportPct / 100);
    const montantEmprunte = prix - apport;
    const fraisNotaire = prix * 0.08;
    const coutTotal = prix + fraisNotaire;

    const tauxMensuel = taux / 100 / 12;
    const n = duree * 12;
    let mensualite = 0;
    if (tauxMensuel > 0) {
      mensualite = montantEmprunte * (tauxMensuel * Math.pow(1 + tauxMensuel, n)) / (Math.pow(1 + tauxMensuel, n) - 1);
    } else {
      mensualite = montantEmprunte / n;
    }

    const loyerNetAnnuel = loyer * (1 - vacance / 100) * 12 - charges - taxeFonciere;
    const cashflowMensuel = loyerNetAnnuel / 12 - mensualite;
    const rendementBrut = (loyer * 12 / prix) * 100;
    const rendementNet = (loyerNetAnnuel / coutTotal) * 100;
    const effortMensuel = (mensualite - loyerNetAnnuel / 12) > 0 ? mensualite - loyerNetAnnuel / 12 : 0;

    // Fiscalité immobilière
    const loyerBrutAnnuel = loyer * 12;
    const interetsAnnuels = (() => {
      // Intérêts de la 1ère année (approximation)
      const capital = prix * (1 - apportPct / 100);
      return capital * (taux / 100);
    })();

    let revenus_imposables = 0;
    if (regime === "micro") {
      revenus_imposables = loyerBrutAnnuel * 0.70; // abattement 30%
    } else {
      // Régime réel : on déduit intérêts, charges, taxe foncière
      revenus_imposables = loyerBrutAnnuel - interetsAnnuels - charges - taxeFonciere;
    }

    const impot = Math.max(0, revenus_imposables) * (tmi / 100 + 0.172);
    // Déficit foncier au régime réel : imputable sur revenu global max 10 700€/an
    const deficit = revenus_imposables < 0 ? Math.min(Math.abs(revenus_imposables), 10700) : 0;
    const economie_deficit = deficit * (tmi / 100); // économie d'impôt sur revenu global

    const loyerNetNetAnnuel = loyerNetAnnuel - impot + economie_deficit;
    const rendementNetNet = (loyerNetNetAnnuel / coutTotal) * 100;
    const cashflowNetNet = loyerNetNetAnnuel / 12 - mensualite;

    const plusValue2pct10ans = prix * (Math.pow(1.02, 10) - 1);
    const cashflowsCumul10ans = cashflowMensuel * 12 * 10;
    const roi10ans = ((plusValue2pct10ans + cashflowsCumul10ans) / coutTotal) * 100;

    const chartData = Array.from({ length: 21 }, (_, i) => {
      const annee = i;
      const cumulCashflow = cashflowMensuel * 12 * annee;

      let capitalRestantDu = montantEmprunte;
      if (annee > 0 && tauxMensuel > 0) {
        const moisPasses = annee * 12;
        capitalRestantDu = montantEmprunte * (Math.pow(1 + tauxMensuel, n) - Math.pow(1 + tauxMensuel, moisPasses)) / (Math.pow(1 + tauxMensuel, n) - 1);
      } else if (annee > 0) {
        capitalRestantDu = Math.max(0, montantEmprunte - mensualite * 12 * annee);
      }
      const valeurBien = prix * Math.pow(1.02, annee);
      const patrimoineNet = valeurBien - capitalRestantDu;

      return { annee, cumulCashflow, patrimoineNet };
    });

    let breakEvenYear = null;
    for (let i = 1; i < chartData.length; i++) {
      if (chartData[i - 1].cumulCashflow < 0 && chartData[i].cumulCashflow >= 0) {
        breakEvenYear = i;
        break;
      }
    }

    return {
      apport,
      montantEmprunte,
      fraisNotaire,
      coutTotal,
      mensualite,
      loyerNetAnnuel,
      cashflowMensuel,
      rendementBrut,
      rendementNet,
      effortMensuel,
      roi10ans,
      chartData,
      breakEvenYear,
      revenus_imposables,
      impot,
      loyerNetNetAnnuel,
      rendementNetNet,
      cashflowNetNet,
      regime_hint: regime === "micro" ? "Abattement forfaitaire 30%" : "Déduction réelle (intérêts + charges)",
    };
  }, [prix, apportPct, taux, duree, loyer, charges, taxeFonciere, vacance, regime, tmi]);

  const fmtEur = v => `${Math.round(v).toLocaleString("fr-FR")} €`;
  const fmtPct = v => `${v.toFixed(2)} %`;
  const cashflowColor = calc.cashflowMensuel >= 0 ? "green" : "red";

  return (
    <div className="h-full flex flex-col bg-background-dark" style={terminalGridStyle}>
      {/* Onglets */}
      <div className="flex gap-1 px-6 pt-4 border-b border-slate-800 shrink-0">
        {[
          { key: "simulation", label: "Simulateur rendement", icon: "calculate" },
          { key: "breakeven", label: "Achat vs Location", icon: "balance" },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-t-lg text-sm font-medium transition-all"
            style={{
              background: activeTab === tab.key ? "rgba(60,131,246,0.12)" : "transparent",
              borderBottom: activeTab === tab.key ? "2px solid #3c83f6" : "2px solid transparent",
              color: activeTab === tab.key ? "#3c83f6" : "#64748b",
            }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "breakeven" && (
        <div className="flex-1 min-h-0">
          <BreakEvenCalculator />
        </div>
      )}

      {activeTab === "simulation" && (
      <div className="flex-1 overflow-y-auto">
      <div className="w-full p-6 md:px-10 space-y-8">

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>home</span>
              <span>Île-de-France</span>
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>chevron_right</span>
              <span className="text-slate-400">Portfolio</span>
            </div>
            <h1 className="text-3xl font-bold text-white">Portfolio Investisseur</h1>
            {communeLabel ? (
              <div className="flex items-center gap-2 mt-1.5">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 14 }}>location_on</span>
                <span className="text-sm font-semibold text-primary">{communeLabel}</span>
                <button onClick={() => navigate('/carte')} className="text-[10px] text-slate-500 hover:text-slate-300 underline ml-1">Voir sur la carte</button>
              </div>
            ) : (
              <p className="text-slate-400 mt-1 text-xs font-semibold uppercase tracking-widest">
                Simulez votre investissement locatif en IDF
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2">
              <span className="material-symbols-outlined text-primary" style={{ fontSize: 16 }}>info</span>
              <span className="text-xs text-slate-400">Simulation 100% locale · aucune donnée envoyée</span>
            </div>
            <button onClick={copyLink}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs transition-all"
              style={{
                background: copied ? "rgba(16,185,129,0.12)" : "rgba(30,41,59,0.6)",
                border: `1px solid ${copied ? "rgba(16,185,129,0.3)" : "rgba(30,41,59,0.8)"}`,
                color: copied ? "#10b981" : "#64748b",
              }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                {copied ? "check" : "link"}
              </span>
              {copied ? "Copié !" : "Partager"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">

          {/* Colonne gauche — Formulaire */}
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 border border-primary/20">
                  <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>home_work</span>
                </div>
                <h2 className="font-bold text-white text-lg">Bien immobilier</h2>
              </div>

              <SliderRow
                label="Prix d'achat"
                value={prix}
                min={50000}
                max={2000000}
                step={5000}
                unit="€"
                format={v => `${v.toLocaleString("fr-FR")} €`}
                onChange={setPrix}
              />
              <SliderRow
                label="Apport personnel"
                value={apportPct}
                min={0}
                max={50}
                step={1}
                unit="%"
                onChange={setApportPct}
              />

              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Montant emprunté</span>
                  <span className="text-slate-300 mono-nums">{fmtEur(calc.montantEmprunte)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Frais de notaire (~8%)</span>
                  <span className="text-slate-300 mono-nums">{fmtEur(calc.fraisNotaire)}</span>
                </div>
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-slate-400">Coût total acquisition</span>
                  <span className="text-amber-400 mono-nums">{fmtEur(calc.coutTotal)}</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 border border-primary/20">
                  <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>account_balance</span>
                </div>
                <h2 className="font-bold text-white text-lg">Crédit immobilier</h2>
              </div>

              <SliderRow
                label="Taux d'intérêt"
                value={taux}
                min={1}
                max={7}
                step={0.1}
                unit="%"
                format={v => `${v.toFixed(1)} %`}
                onChange={setTaux}
              />
              <SliderRow
                label="Durée du crédit"
                value={duree}
                min={5}
                max={30}
                step={1}
                unit="ans"
                onChange={setDuree}
              />
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 border border-primary/20">
                  <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>real_estate_agent</span>
                </div>
                <h2 className="font-bold text-white text-lg">Location</h2>
              </div>

              <SliderRow
                label="Loyer mensuel estimé"
                value={loyer}
                min={200}
                max={5000}
                step={50}
                unit="€/mois"
                format={v => `${v.toLocaleString("fr-FR")} €/mois`}
                onChange={setLoyer}
              />
              <SliderRow
                label="Vacance locative"
                value={vacance}
                min={0}
                max={20}
                step={1}
                unit="%"
                format={v => `${v} % (~${Math.round(v * 365 / 100)} j/an)`}
                onChange={setVacance}
              />
              <SliderRow
                label="Charges annuelles"
                value={charges}
                min={0}
                max={10000}
                step={100}
                unit="€/an"
                format={v => `${v.toLocaleString("fr-FR")} €/an`}
                onChange={setCharges}
              />
              <SliderRow
                label="Taxe foncière"
                value={taxeFonciere}
                min={0}
                max={5000}
                step={50}
                unit="€/an"
                format={v => `${v.toLocaleString("fr-FR")} €/an`}
                onChange={setTaxeFonciere}
              />

              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Loyer net annuel</span>
                  <span className={`font-bold mono-nums ${calc.loyerNetAnnuel >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {fmtEur(calc.loyerNetAnnuel)}
                  </span>
                </div>
              </div>
            </div>

            {/* Section Fiscalité */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <span className="material-symbols-outlined text-amber-400" style={{ fontSize: 18 }}>receipt</span>
                </div>
                <h2 className="font-bold text-white text-lg">Fiscalité</h2>
              </div>

              {/* Régime */}
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Régime d'imposition</p>
                <div className="grid grid-cols-2 gap-2">
                  {[["micro", "Micro-foncier", "Abattement 30%"], ["reel", "Régime réel", "Déductions réelles"]].map(([val, label, sub]) => (
                    <button key={val} onClick={() => setRegime(val)}
                      className="p-2.5 rounded-lg text-left transition-all"
                      style={{
                        background: regime === val ? "rgba(245,158,11,0.12)" : "rgba(15,23,36,0.6)",
                        border: `1px solid ${regime === val ? "rgba(245,158,11,0.4)" : "rgba(30,41,59,0.8)"}`,
                      }}>
                      <p className={`text-xs font-bold ${regime === val ? "text-amber-400" : "text-slate-400"}`}>{label}</p>
                      <p className="text-[10px] text-slate-600 mt-0.5">{sub}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* TMI */}
              <div>
                <div className="flex justify-between items-baseline mb-2">
                  <p className="text-xs text-slate-400 uppercase tracking-wider">Tranche marginale d'imposition</p>
                  <span className="text-sm font-bold text-amber-400">{tmi} %</span>
                </div>
                <div className="flex gap-1.5">
                  {[0, 11, 30, 41, 45].map(t => (
                    <button key={t} onClick={() => setTmi(t)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-bold transition-all"
                      style={{
                        background: tmi === t ? "rgba(245,158,11,0.2)" : "rgba(15,23,36,0.6)",
                        border: `1px solid ${tmi === t ? "rgba(245,158,11,0.5)" : "rgba(30,41,59,0.8)"}`,
                        color: tmi === t ? "#f59e0b" : "#475569",
                      }}>
                      {t}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Résumé fiscal */}
              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Revenus imposables</span>
                  <span className={`font-bold mono-nums ${calc.revenus_imposables >= 0 ? "text-slate-300" : "text-emerald-400"}`}>
                    {calc.revenus_imposables >= 0 ? fmtEur(calc.revenus_imposables) : `Déficit ${fmtEur(-calc.revenus_imposables)}`}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Impôt + prélèvements sociaux</span>
                  <span className="font-bold mono-nums text-red-400">−{fmtEur(calc.impot)}</span>
                </div>
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-slate-400">Loyer net net annuel</span>
                  <span className={`mono-nums ${calc.loyerNetNetAnnuel >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {fmtEur(calc.loyerNetNetAnnuel)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Colonne droite — Résultats */}
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3">
              <ResultCard
                label="Mensualité crédit"
                value={fmtEur(calc.mensualite).replace(" €", "")}
                unit="€/mois"
                color="neutral"
                icon="payments"
                sub={`sur ${duree} ans`}
              />
              <ResultCard
                label="Cash-flow mensuel"
                value={`${calc.cashflowMensuel >= 0 ? "+" : ""}${Math.round(calc.cashflowMensuel).toLocaleString("fr-FR")}`}
                unit="€/mois"
                color={cashflowColor}
                icon={calc.cashflowMensuel >= 0 ? "trending_up" : "trending_down"}
                sub={calc.cashflowMensuel >= 0 ? "Autofinancement" : "Effort mensuel requis"}
              />
              <ResultCard
                label="Rendement brut"
                value={fmtPct(calc.rendementBrut)}
                color={calc.rendementBrut >= 5 ? "green" : calc.rendementBrut >= 3 ? "neutral" : "red"}
                icon="percent"
                sub="Loyers bruts / prix"
              />
              <ResultCard
                label="Rendement net"
                value={fmtPct(calc.rendementNet)}
                color={calc.rendementNet >= 3.5 ? "green" : calc.rendementNet >= 2 ? "neutral" : "red"}
                icon="show_chart"
                sub="Loyer net / coût total"
              />
              <ResultCard
                label="Rendement net-net"
                value={fmtPct(calc.rendementNetNet)}
                color={calc.rendementNetNet >= 2.5 ? "green" : calc.rendementNetNet >= 1 ? "neutral" : "red"}
                icon="account_balance"
                sub={`TMI ${tmi}% + 17.2% prélèv. soc. · ${regime === "micro" ? "Micro-foncier" : "Réel"}`}
              />
              <ResultCard
                label="Effort mensuel"
                value={calc.effortMensuel > 0 ? fmtEur(calc.effortMensuel).replace(" €", "") : "0"}
                unit="€/mois"
                color={calc.effortMensuel > 0 ? "red" : "green"}
                icon="wallet"
                sub="À financer de sa poche"
              />
              <ResultCard
                label="ROI estimé 10 ans"
                value={`${calc.roi10ans >= 0 ? "+" : ""}${calc.roi10ans.toFixed(1)} %`}
                color={calc.roi10ans >= 20 ? "green" : calc.roi10ans >= 0 ? "neutral" : "red"}
                icon="savings"
                sub="Cash-flows + plus-value 2%/an"
              />
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>area_chart</span>
                  Cash-flow cumulé sur 20 ans
                </h3>
                {calc.breakEvenYear !== null ? (
                  <span className="text-[10px] bg-amber-500/10 border border-amber-500/30 text-amber-400 px-2 py-1 rounded-full">
                    Équilibre an {calc.breakEvenYear}
                  </span>
                ) : calc.cashflowMensuel >= 0 ? (
                  <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-2 py-1 rounded-full">
                    Cash-flow positif dès le départ
                  </span>
                ) : (
                  <span className="text-[10px] bg-red-500/10 border border-red-500/30 text-red-400 px-2 py-1 rounded-full">
                    Pas d'équilibre sur 20 ans
                  </span>
                )}
              </div>
              <CashflowChart data={calc.chartData} breakEvenYear={calc.breakEvenYear} />
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>summarize</span>
                Récapitulatif complet
              </h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {[
                  { label: "Prix d'achat",        val: fmtEur(prix) },
                  { label: "Apport",               val: fmtEur(calc.apport) },
                  { label: "Emprunt",              val: fmtEur(calc.montantEmprunte) },
                  { label: "Frais notaire",        val: fmtEur(calc.fraisNotaire) },
                  { label: "Coût total",           val: fmtEur(calc.coutTotal) },
                  { label: "Mensualité",           val: fmtEur(calc.mensualite) },
                  { label: "Loyer brut/an",        val: fmtEur(loyer * 12) },
                  { label: "Charges + TF",         val: fmtEur(charges + taxeFonciere) },
                  { label: "Loyer net/an",         val: fmtEur(calc.loyerNetAnnuel) },
                  { label: "Cash-flow/mois",       val: `${calc.cashflowMensuel >= 0 ? "+" : ""}${Math.round(calc.cashflowMensuel).toLocaleString("fr-FR")} €` },
                ].map(({ label, val }) => (
                  <div key={label} className="flex justify-between text-xs py-1 border-b border-slate-800/50">
                    <span className="text-slate-500">{label}</span>
                    <span className="text-slate-200 font-semibold mono-nums">{val}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-slate-800 rounded-xl px-5 py-3 flex flex-wrap gap-4 text-xs text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                Frais notaire estimés à 8% (ancien)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                Plus-value simulée à 2%/an
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                Hors fiscalité (IR, PFU 30%)
              </span>
            </div>
          </div>
        </div>
      </div>
      </div>
      )}
    </div>
  );
}
