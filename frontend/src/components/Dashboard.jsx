import React, { useEffect, useState } from "react";
import axios from "axios";

// Terminal grid dots background (from Stitch)
const terminalGridStyle = {
  backgroundImage: "radial-gradient(circle at 2px 2px, rgba(60,131,246,0.05) 1px, transparent 0)",
  backgroundSize: "24px 24px",
};

// SVG Line Chart (from Stitch — custom, not Recharts)
function TendanceChart() {
  return (
    <div className="flex-1 min-h-[240px] w-full relative">
      <svg className="w-full h-full min-h-[240px]" viewBox="0 0 1000 400" preserveAspectRatio="none">
        <defs>
          <linearGradient id="grad-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(60,131,246,0.2)" />
            <stop offset="100%" stopColor="rgba(60,131,246,0)" />
          </linearGradient>
        </defs>
        {/* Grid */}
        {[350,250,150,50].map(y => (
          <line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="currentColor" strokeWidth="1" className="text-slate-800" />
        ))}
        {/* Area */}
        <path d="M0,350 L50,330 L150,340 L250,280 L350,290 L450,220 L550,200 L650,210 L750,150 L850,120 L950,80 L1000,90 L1000,400 L0,400 Z" fill="url(#grad-bg)" />
        {/* Line */}
        <path d="M0,350 L50,330 L150,340 L250,280 L350,290 L450,220 L550,200 L650,210 L750,150 L850,120 L950,80 L1000,90"
          fill="none" stroke="#3c83f6" strokeWidth="3" strokeLinejoin="round"
          style={{ filter: "drop-shadow(0 0 8px rgba(60,131,246,0.5))" }} />
        {/* Nodes */}
        <circle cx="450" cy="220" r="4" fill="#3c83f6" />
        <circle cx="950" cy="80"  r="4" fill="#3c83f6" />
      </svg>
      {/* Tooltip */}
      <div className="absolute top-4 right-4 bg-slate-900/80 backdrop-blur-md p-3 rounded-lg border border-slate-700 text-xs">
        <p className="text-slate-400">Août 2023</p>
        <p className="text-lg font-bold">6,840 €/m²</p>
        <p className="text-emerald-400">+4.2% YoY</p>
      </div>
    </div>
  );
}

// Heatmap grid (from Stitch)
function HeatmapGrid() {
  const rows = [
    { label: "75", cells: ["primary","primary/80","primary/40","primary","primary/20","primary/60","primary","primary/40","primary/90","primary/10","primary/50"] },
    { label: "92", cells: ["primary/70","primary","primary/90","primary/30","primary","primary/80","primary","primary/10","primary/40","primary/60","primary/20"] },
    { label: "94", cells: ["primary/20","primary/40","primary/10","primary/60","primary/30","primary/50","primary/20","primary/40","primary/30","primary/10","primary/20"] },
  ];

  const bg = (c) => {
    if (c === "primary") return "#3c83f6";
    const op = parseFloat(c.split("/")[1]) / 100;
    return `rgba(60,131,246,${op})`;
  };

  return (
    <div>
      <div className="flex flex-col gap-2">
        {rows.map(row => (
          <div key={row.label} className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md flex items-center justify-center text-[10px] font-bold text-white/50 flex-shrink-0"
              style={{ background: "#1e3a5f" }}>{row.label}</div>
            {row.cells.map((c, i) => (
              <div key={i} className="flex-1 aspect-square rounded-md" style={{ background: bg(c), minWidth: 20, minHeight: 20 }} />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-4 mt-4">
        <span className="text-[10px] text-slate-500 uppercase font-bold">Légende Densité Prix :</span>
        {[["primary/10","Bas"],["primary/50","Moyen"],["primary","Élevé"]].map(([c, label]) => (
          <div key={label} className="flex items-center gap-1">
            <div className="size-3 rounded-sm" style={{ background: bg(c) }} />
            <span className="text-[10px] text-slate-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [health, setHealth] = useState(null);
  useEffect(() => { axios.get("/api/v1/health").then(r => setHealth(r.data)).catch(() => {}); }, []);

  return (
    <div className="h-full overflow-y-auto bg-background-dark" style={terminalGridStyle}>
      <div className="w-full p-6 md:px-10 space-y-6">

        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-white">Analyse du Marché IDF</h1>
            <p className="text-slate-400 mt-1 uppercase tracking-widest text-xs font-semibold">Terminal Financier Immobilier v2.4</p>
          </div>
          <div className="flex gap-2">
            <button className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>download</span>Export PDF
            </button>
            <button className="bg-slate-800 hover:bg-slate-700 text-slate-100 px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
              Période : 12 mois
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Volume Total Marché",  value: "12.4B €",              trend: "+12.5%", up: true },
            { label: "Moy. Jours en Vente",  value: "42 jours",             trend: "-5.2%",  up: false },
            { label: "Commune Active",       value: "Boulogne-Billancourt", amber: true, sub: "TOP 1" },
            { label: "Croissance Prix",      value: "+5.8%",                trend: "+1.2%",  up: true },
          ].map(k => (
            <div key={k.label} className={`bg-slate-900 border p-5 rounded-xl ${k.amber ? "border-amber-500/30" : "border-slate-800"}`}>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{k.label}</p>
              <div className="flex items-end justify-between mt-2">
                <h3 className={`text-2xl font-bold ${k.amber ? "text-amber-500 text-xl" : "text-white"}`}>{k.value}</h3>
                {k.trend && (
                  <span className={`text-sm font-bold flex items-center gap-1 ${k.up ? "text-emerald-500" : "text-rose-500"}`}
                    style={{ filter: `drop-shadow(0 0 5px ${k.up ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"})` }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{k.up ? "trending_up" : "trending_down"}</span>
                    {k.trend}
                  </span>
                )}
                {k.sub && <span className="text-slate-400 text-xs">{k.sub}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Tendance chart */}
          <div className="lg:col-span-2 bg-slate-900 border border-slate-800 p-6 rounded-xl flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 20 }}>show_chart</span>
                Tendance Prix Moyen / m²
              </h3>
              <div className="flex gap-1 bg-slate-800 p-1 rounded-lg">
                {["IDF","75","92"].map((l, i) => (
                  <button key={l} className={`px-3 py-1 text-xs font-bold rounded transition-colors ${i === 0 ? "bg-slate-700 shadow-sm text-white" : "text-slate-400 hover:bg-slate-700"}`}>{l}</button>
                ))}
              </div>
            </div>
            <TendanceChart />
            <div className="flex justify-between text-xs text-slate-500 font-bold px-2">
              {["SEP 22","DEC 22","MAR 23","JUN 23","SEP 23"].map(l => <span key={l}>{l}</span>)}
            </div>
          </div>

          {/* Volume par type */}
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl flex flex-col">
            <h3 className="font-bold mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary" style={{ fontSize: 20 }}>bar_chart</span>
              Volume par Type
            </h3>
            <div className="flex flex-col justify-around gap-4 flex-1">
              {[
                { label: "Appartement T2", value: "3.2B €", w: "85%"  },
                { label: "Appartement T3", value: "2.8B €", w: "70%"  },
                { label: "Maison 4+p",     value: "4.1B €", w: "95%"  },
                { label: "Studio",          value: "1.4B €", w: "45%"  },
                { label: "Bureau/Com.",     value: "0.9B €", w: "30%"  },
              ].map(b => (
                <div key={b.label} className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-200">{b.label}</span>
                    <span className="text-slate-400 mono-nums">{b.value}</span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div className="bg-primary h-full rounded-full" style={{ width: b.w, boxShadow: "0 0 10px rgba(60,131,246,0.5)" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Heatmap */}
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold flex items-center gap-2">
              <span className="material-symbols-outlined text-primary" style={{ fontSize: 20 }}>grid_view</span>
              Distribution des prix par zone
            </h3>
            <span className="text-xs text-slate-500 font-medium">Actualisé il y a 5 min</span>
          </div>
          <HeatmapGrid />
        </div>

        {/* Alertes + Mini carte */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-500" style={{ fontSize: 20 }}>notifications_active</span>
              Alertes Récents
            </h3>
            <div className="space-y-3">
              <div className="flex gap-4 p-3 rounded-lg border bg-emerald-500/10 border-emerald-500/20">
                <span className="material-symbols-outlined text-emerald-500" style={{ fontSize: 20 }}>arrow_upward</span>
                <div>
                  <p className="text-sm font-bold">Pic de volume à Nanterre</p>
                  <p className="text-xs text-slate-500 mt-0.5">Le volume de transactions a augmenté de 18% cette semaine.</p>
                </div>
              </div>
              <div className="flex gap-4 p-3 rounded-lg border bg-rose-500/10 border-rose-500/20">
                <span className="material-symbols-outlined text-rose-500" style={{ fontSize: 20 }}>warning</span>
                <div>
                  <p className="text-sm font-bold">Correction des prix à Paris 16e</p>
                  <p className="text-xs text-slate-500 mt-0.5">Baisse de 2.1% observée sur les appartements T3/T4.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary" style={{ fontSize: 20 }}>map</span>
              Vue Carte Dynamique
            </h3>
            <div className="aspect-video w-full rounded-lg bg-slate-800 relative overflow-hidden flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #0d1b2e, #1a2744)" }}>
              <div className="absolute inset-0 opacity-10"
                style={{ backgroundImage: "radial-gradient(circle at 2px 2px, rgba(60,131,246,0.3) 1px, transparent 0)", backgroundSize: "20px 20px" }} />
              <div className="p-3 bg-background-dark/90 backdrop-blur border border-primary/30 rounded-xl text-center z-10">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 32 }}>location_on</span>
                <p className="text-xs font-bold mt-1">Explorer la carte interactive</p>
              </div>
            </div>
          </div>
        </div>

        {/* Services status */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <p className="text-white font-semibold text-sm mb-4">Statut des services</p>
          <div className="flex flex-wrap gap-3">
            {(health
              ? Object.entries(health.services ?? {}).map(([n, s]) => ({ name: n, ok: s.status === "ok", lat: s.latency_ms }))
              : ["postgres","redis","chromadb"].map(n => ({ name: n, ok: null }))
            ).map(s => (
              <div key={s.name} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${
                s.ok === null ? "border-slate-700 bg-slate-800 text-slate-400" :
                s.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" :
                        "border-red-500/30 bg-red-500/10 text-red-400"
              }`}>
                <span className={`size-1.5 rounded-full ${s.ok === null ? "bg-slate-500 animate-pulse" : s.ok ? "bg-emerald-400" : "bg-red-400"}`} />
                {s.name}
                {s.lat && <span className="text-slate-500 ml-1">{s.lat}ms</span>}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
