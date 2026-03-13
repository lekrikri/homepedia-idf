import React, { useEffect, useState } from "react";
import axios from "axios";

const terminalGridStyle = {
  backgroundImage: "radial-gradient(circle at 2px 2px, rgba(60,131,246,0.05) 1px, transparent 0)",
  backgroundSize: "24px 24px",
};

const DPE_COLORS_HEX = { A:"#22c55e", B:"#4ade80", C:"#facc15", D:"#fb923c", E:"#f97316", F:"#ef4444", G:"#dc2626" };

// SVG line chart construit à partir de vraies données
function TendanceChart({ evolution }) {
  if (!evolution || evolution.length < 2) return (
    <div className="flex-1 min-h-[240px] flex items-center justify-center">
      <p className="text-slate-600 text-sm">Données insuffisantes</p>
    </div>
  );

  const maxP = Math.max(...evolution.map(e => e.prix_m2));
  const minP = Math.min(...evolution.map(e => e.prix_m2));
  const range = maxP - minP || 1;

  const W = 1000, H = 400, PAD = 40;
  const pts = evolution.map((e, i) => {
    const x = PAD + (i / (evolution.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - (e.prix_m2 - minP) / range) * (H - PAD * 2);
    return [x, y];
  });

  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
  const areaPath = linePath + ` L${pts[pts.length-1][0]},${H} L${pts[0][0]},${H} Z`;

  const lastPt = pts[pts.length - 1];
  const lastE  = evolution[evolution.length - 1];
  const prevE  = evolution[evolution.length - 2];
  const yoy    = prevE ? (((lastE.prix_m2 - prevE.prix_m2) / prevE.prix_m2) * 100).toFixed(1) : null;

  return (
    <div className="flex-1 min-h-[240px] w-full relative">
      <svg className="w-full h-full min-h-[240px]" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="grad-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(60,131,246,0.2)" />
            <stop offset="100%" stopColor="rgba(60,131,246,0)" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map(r => (
          <line key={r} x1={PAD} x2={W - PAD}
            y1={PAD + (1 - r) * (H - PAD * 2)} y2={PAD + (1 - r) * (H - PAD * 2)}
            stroke="currentColor" strokeWidth="1" className="text-slate-800" />
        ))}
        <path d={areaPath} fill="url(#grad-bg)" />
        <path d={linePath} fill="none" stroke="#3c83f6" strokeWidth="3" strokeLinejoin="round"
          style={{ filter: "drop-shadow(0 0 8px rgba(60,131,246,0.5))" }} />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="4" fill="#3c83f6" />
        ))}
      </svg>
      <div className="absolute top-4 right-4 bg-slate-900/80 backdrop-blur-md p-3 rounded-lg border border-slate-700 text-xs">
        <p className="text-slate-400">{lastE.year}</p>
        <p className="text-lg font-bold">{Math.round(lastE.prix_m2).toLocaleString()} €/m²</p>
        {yoy && <p className={parseFloat(yoy) >= 0 ? "text-emerald-400" : "text-red-400"}>{parseFloat(yoy) >= 0 ? "+" : ""}{yoy}% YoY</p>}
      </div>
    </div>
  );
}

// DPE bar chart
function DPEChart({ dpe }) {
  const total = dpe.reduce((s, d) => s + d.count, 0) || 1;
  return (
    <div className="flex flex-col gap-2.5 flex-1">
      {dpe.map(d => (
        <div key={d.classe} className="flex items-center gap-3">
          <div className="w-6 h-6 rounded flex items-center justify-center text-xs font-black text-white shrink-0"
            style={{ background: DPE_COLORS_HEX[d.classe] || "#64748b" }}>
            {d.classe}
          </div>
          <div className="flex-1 bg-slate-800 h-2 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${(d.count / total) * 100}%`, background: DPE_COLORS_HEX[d.classe] || "#64748b" }} />
          </div>
          <span className="text-xs text-slate-400 mono-nums w-8 text-right">{Math.round((d.count / total) * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [stats,  setStats]  = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get("/api/v1/stats").then(r => r.data),
      axios.get("/api/v1/health").then(r => r.data).catch(() => null),
    ]).then(([s, h]) => {
      setStats(s);
      setHealth(h);
    }).finally(() => setLoading(false));
  }, []);

  const fmt = (n) => {
    if (!n) return "—";
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B €`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M €`;
    return `${Math.round(n).toLocaleString()} €`;
  };

  // Compute YoY from evolution
  const evo = stats?.evolution || [];
  const lastEvo  = evo[evo.length - 1];
  const prevEvo  = evo[evo.length - 2];
  const yoyPrix  = lastEvo && prevEvo
    ? (((lastEvo.prix_m2 - prevEvo.prix_m2) / prevEvo.prix_m2) * 100).toFixed(1)
    : null;

  const topType = stats?.by_type?.[0]?.type_local || "—";

  const kpis = [
    {
      label: "Volume Total Marché",
      value: fmt(stats?.total_volume),
      trend: yoyPrix ? `${parseFloat(yoyPrix) >= 0 ? "+" : ""}${yoyPrix}%` : null,
      up: yoyPrix ? parseFloat(yoyPrix) >= 0 : true,
    },
    {
      label: "Transactions",
      value: stats?.nb_transactions?.toLocaleString() || "—",
      trend: null,
      sub: "DVF 2019–2024",
    },
    {
      label: "Type dominant",
      value: topType,
      amber: true,
      sub: `${stats?.by_type?.[0]?.count || "—"} ventes`,
    },
    {
      label: "Prix Moyen / m²",
      value: stats?.avg_prix_m2 ? `${Math.round(stats.avg_prix_m2).toLocaleString()} €` : "—",
      trend: yoyPrix ? `${parseFloat(yoyPrix) >= 0 ? "+" : ""}${yoyPrix}%` : null,
      up: yoyPrix ? parseFloat(yoyPrix) >= 0 : true,
    },
  ];

  // Max volume for bar chart scaling
  const maxVol = Math.max(...(stats?.by_type || []).map(t => t.volume), 1);

  return (
    <div className="h-full overflow-y-auto bg-background-dark" style={terminalGridStyle}>
      <div className="w-full p-6 md:px-10 space-y-6">

        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-white">Analyse du Marché IDF</h1>
            <p className="text-slate-400 mt-1 uppercase tracking-widest text-xs font-semibold">Terminal Financier Immobilier · Données DVF réelles</p>
          </div>
          <div className="flex gap-2">
            <button className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>download</span>Export PDF
            </button>
            <button className="bg-slate-800 hover:bg-slate-700 text-slate-100 px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
              Période : 2019–2024
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map(k => (
            <div key={k.label} className={`bg-slate-900 border p-5 rounded-xl ${k.amber ? "border-amber-500/30" : "border-slate-800"}`}>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{k.label}</p>
              <div className="flex items-end justify-between mt-2">
                <h3 className={`text-2xl font-bold ${k.amber ? "text-amber-500 text-xl" : "text-white"} ${loading ? "opacity-30" : ""}`}>
                  {loading ? "..." : k.value}
                </h3>
                {k.trend && !loading && (
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

          {/* Tendance */}
          <div className="lg:col-span-2 bg-slate-900 border border-slate-800 p-6 rounded-xl flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 20 }}>show_chart</span>
                Évolution Prix Moyen / m²
              </h3>
              <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">DVF données réelles</span>
            </div>
            <TendanceChart evolution={stats?.evolution} />
            <div className="flex justify-between text-xs text-slate-500 font-bold px-2">
              {(stats?.evolution || []).map(e => <span key={e.year}>{e.year}</span>)}
            </div>
          </div>

          {/* Volume par type */}
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl flex flex-col">
            <h3 className="font-bold mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary" style={{ fontSize: 20 }}>bar_chart</span>
              Volume par Type de Bien
            </h3>
            <div className="flex flex-col justify-around gap-4 flex-1">
              {(stats?.by_type || Array(5).fill(null)).map((t, i) => (
                <div key={t?.type_local || i} className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-200">{t?.type_local || "..."}</span>
                    <span className="text-slate-400 mono-nums">{t ? fmt(t.volume) : "..."}</span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div className="bg-primary h-full rounded-full transition-all"
                      style={{ width: t ? `${(t.volume / maxVol) * 100}%` : "0%", boxShadow: "0 0 10px rgba(60,131,246,0.5)" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* DPE distribution */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl flex flex-col">
            <h3 className="font-bold mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary" style={{ fontSize: 20 }}>bolt</span>
              Distribution DPE
            </h3>
            {stats?.dpe?.length > 0
              ? <DPEChart dpe={stats.dpe} />
              : <p className="text-slate-600 text-sm text-center py-4">Chargement...</p>
            }
          </div>

          {/* Top communes */}
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary" style={{ fontSize: 20 }}>location_city</span>
              Top Communes
            </h3>
            <div className="space-y-3">
              {(stats?.top_communes || Array(3).fill(null)).map((c, i) => (
                <div key={c?.commune || i} className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50">
                  <span className="text-xs font-black text-slate-500 w-5 text-center">#{i + 1}</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-200">{c?.commune || "..."}</p>
                    <p className="text-xs text-slate-500 mono-nums">{c ? `${c.nb_transactions} transactions` : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-amber-400 mono-nums">
                      {c?.prix_m2_median ? `${Math.round(c.prix_m2_median).toLocaleString()} €` : "—"}
                    </p>
                    <p className="text-[10px] text-slate-500">/m²</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Statut des services */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <p className="text-white font-semibold text-sm mb-4">Statut des services</p>
          <div className="flex flex-wrap gap-3">
            {(health
              ? Object.entries(health.services ?? {}).map(([n, s]) => ({ name: n, ok: s.status === "ok", lat: s.latency_ms }))
              : ["postgres", "redis", "chromadb"].map(n => ({ name: n, ok: null }))
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
