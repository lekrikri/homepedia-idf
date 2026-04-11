import React, { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

const terminalGridStyle = {
  backgroundImage: "radial-gradient(circle at 2px 2px, rgba(60,131,246,0.05) 1px, transparent 0)",
  backgroundSize: "24px 24px",
};

const DPE_COLORS = { A:"#22c55e", B:"#4ade80", C:"#facc15", D:"#fb923c", E:"#f97316", F:"#ef4444", G:"#dc2626" };

const DEPT_LABELS = {
  "75": "Paris (75)", "77": "Seine-et-Marne (77)", "78": "Yvelines (78)",
  "91": "Essonne (91)", "92": "Hauts-de-Seine (92)", "93": "Seine-Saint-Denis (93)",
  "94": "Val-de-Marne (94)", "95": "Val-d'Oise (95)",
};

// ── Composants réutilisables ────────────────────────────────────────────────

function KpiCard({ label, value, trend, up, sub, amber, loading }) {
  return (
    <div className={`bg-slate-900 border p-5 rounded-xl ${amber ? "border-amber-500/30" : "border-slate-800"}`}>
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</p>
      <div className="flex items-end justify-between mt-2">
        <h3 className={`text-2xl font-bold ${amber ? "text-amber-500 text-xl" : "text-white"} ${loading ? "opacity-30" : ""}`}>
          {loading ? "..." : value}
        </h3>
        {trend && !loading && (
          <span className={`text-sm font-bold flex items-center gap-1 ${up ? "text-emerald-500" : "text-rose-500"}`}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{up ? "trending_up" : "trending_down"}</span>
            {trend}
          </span>
        )}
        {sub && <span className="text-slate-400 text-xs">{k?.sub}</span>}
      </div>
    </div>
  );
}

function SectionTitle({ icon, title, badge }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 border border-primary/20">
        <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>{icon}</span>
      </div>
      <h2 className="font-bold text-white text-lg">{title}</h2>
      {badge && (
        <span className="ml-auto text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded-full border border-slate-700">
          {badge}
        </span>
      )}
    </div>
  );
}

// SVG line chart évolution prix
function TendanceChart({ evolution }) {
  if (!evolution || evolution.length < 2) return (
    <div className="flex-1 min-h-[200px] flex items-center justify-center">
      <p className="text-slate-600 text-sm">Données insuffisantes</p>
    </div>
  );
  const maxP = Math.max(...evolution.map(e => e.prix_m2));
  const minP = Math.min(...evolution.map(e => e.prix_m2));
  const range = maxP - minP || 1;
  const W = 1000, H = 340, PAD = 40;
  const pts = evolution.map((e, i) => [
    PAD + (i / (evolution.length - 1)) * (W - PAD * 2),
    PAD + (1 - (e.prix_m2 - minP) / range) * (H - PAD * 2),
  ]);
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
  const areaPath = linePath + ` L${pts[pts.length-1][0]},${H} L${pts[0][0]},${H} Z`;
  const last = evolution[evolution.length - 1];
  const prev = evolution[evolution.length - 2];
  const yoy = prev ? (((last.prix_m2 - prev.prix_m2) / prev.prix_m2) * 100).toFixed(1) : null;
  return (
    <div className="flex-1 min-h-[200px] w-full relative">
      <svg className="w-full h-full min-h-[200px]" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="grad-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(60,131,246,0.2)" />
            <stop offset="100%" stopColor="rgba(60,131,246,0)" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map(r => (
          <line key={r} x1={PAD} x2={W-PAD}
            y1={PAD+(1-r)*(H-PAD*2)} y2={PAD+(1-r)*(H-PAD*2)}
            stroke="currentColor" strokeWidth="1" className="text-slate-800" />
        ))}
        <path d={areaPath} fill="url(#grad-bg)" />
        <path d={linePath} fill="none" stroke="#3c83f6" strokeWidth="3" strokeLinejoin="round"
          style={{ filter: "drop-shadow(0 0 8px rgba(60,131,246,0.5))" }} />
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="5" fill="#3c83f6" />)}
      </svg>
      {yoy && (
        <div className="absolute top-2 right-2 bg-slate-900/90 backdrop-blur-md p-2 rounded-lg border border-slate-700 text-xs">
          <p className="text-slate-400">{last.year}</p>
          <p className="text-base font-bold">{Math.round(last.prix_m2).toLocaleString()} €/m²</p>
          <p className={parseFloat(yoy) >= 0 ? "text-emerald-400" : "text-red-400"}>
            {parseFloat(yoy) >= 0 ? "+" : ""}{yoy}% vs {prev.year}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Dashboard principal ────────────────────────────────────────────────────

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      axios.get("/api/v1/stats").then(r => r.data),
      axios.get("/api/v1/health").then(r => r.data).catch(() => null),
    ]).then(([s]) => setStats(s)).finally(() => setLoading(false));
  }, []);

  const fmt = n => {
    if (!n) return "—";
    if (n >= 1e9) return `${(n/1e9).toFixed(1)}Md €`;
    if (n >= 1e6) return `${(n/1e6).toFixed(0)}M €`;
    return `${Math.round(n).toLocaleString()} €`;
  };

  const evo = stats?.evolution || [];
  const last = evo[evo.length-1], prev = evo[evo.length-2];
  const yoy = last && prev ? (((last.prix_m2 - prev.prix_m2) / prev.prix_m2)*100).toFixed(1) : null;
  const maxVol = Math.max(...(stats?.by_type || []).map(t => t.volume), 1);
  const maxDeptPrix = Math.max(...(stats?.by_dept || []).map(d => d.prix_median_m2), 1);

  return (
    <div className="h-full overflow-y-auto bg-background-dark" style={terminalGridStyle}>
      <div className="w-full p-6 md:px-10 space-y-8">

        {/* ── En-tête avec fil d'Ariane ───────────────────────────────────── */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
              <span className="material-symbols-outlined" style={{fontSize:14}}>home</span>
              <span>Île-de-France</span>
              <span className="material-symbols-outlined" style={{fontSize:12}}>chevron_right</span>
              <span className="text-slate-400">Vue globale</span>
            </div>
            <h1 className="text-3xl font-bold text-white">Analyse du Marché IDF</h1>
            <p className="text-slate-400 mt-1 text-xs font-semibold uppercase tracking-widest">
              Données DVF réelles · 3 niveaux d'analyse
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {["Macro IDF", "Méso Département", "Micro Commune"].map((lvl, i) => (
              <span key={lvl} className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                i === 0
                  ? "bg-primary/20 border-primary/40 text-primary"
                  : "bg-slate-800 border-slate-700 text-slate-400"
              }`}>
                {lvl}
              </span>
            ))}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            NIVEAU 1 — MACRO : Vue IDF globale
        ══════════════════════════════════════════════════════════════════ */}
        <section>
          <SectionTitle icon="public" title="Niveau 1 — IDF Global" badge="Macro" />

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { label: "Volume total marché", value: fmt(stats?.total_volume), trend: yoy ? `${parseFloat(yoy)>=0?"+":""}${yoy}%` : null, up: yoy ? parseFloat(yoy)>=0 : true },
              { label: "Transactions DVF", value: stats?.nb_transactions?.toLocaleString() || "—", sub: "2019 – 2024" },
              { label: "Prix moyen / m²", value: stats?.avg_prix_m2 ? `${Math.round(stats.avg_prix_m2).toLocaleString()} €` : "—" },
              { label: "Type dominant", value: stats?.by_type?.[0]?.type_local || "—", amber: true, sub: `${stats?.by_type?.[0]?.count?.toLocaleString() || "—"} ventes` },
            ].map(k => (
              <div key={k.label} className={`bg-slate-900 border p-4 rounded-xl ${k.amber ? "border-amber-500/30" : "border-slate-800"}`}>
                <p className="text-xs text-slate-400 uppercase tracking-wider">{k.label}</p>
                <div className="flex items-end justify-between mt-2">
                  <span className={`text-xl font-bold ${k.amber ? "text-amber-400" : "text-white"} ${loading ? "opacity-30" : ""}`}>
                    {loading ? "..." : k.value}
                  </span>
                  {k.trend && !loading && (
                    <span className={`text-xs font-bold flex items-center gap-0.5 ${k.up ? "text-emerald-400" : "text-rose-400"}`}>
                      <span className="material-symbols-outlined" style={{fontSize:14}}>{k.up ? "trending_up" : "trending_down"}</span>
                      {k.trend}
                    </span>
                  )}
                </div>
                {k.sub && <p className="text-xs text-slate-500 mt-1">{k.sub}</p>}
              </div>
            ))}
          </div>

          {/* Évolution prix + Volume par type */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary" style={{fontSize:18}}>show_chart</span>
                  Évolution prix moyen / m²
                </h3>
                <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">DVF réel</span>
              </div>
              <TendanceChart evolution={stats?.evolution} />
              <div className="flex justify-between text-xs text-slate-500 font-bold px-2">
                {(stats?.evolution || []).map(e => <span key={e.year}>{e.year}</span>)}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col">
              <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-primary" style={{fontSize:18}}>bar_chart</span>
                Volume par type de bien
              </h3>
              <div className="flex flex-col gap-3 flex-1 justify-around">
                {(stats?.by_type || Array(5).fill(null)).map((t, i) => (
                  <div key={t?.type_local || i} className="space-y-1.5">
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-slate-200">{t?.type_local || "..."}</span>
                      <span className="text-slate-400">{t ? fmt(t.volume) : "..."}</span>
                    </div>
                    <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                      <div className="bg-primary h-full rounded-full"
                        style={{ width: t ? `${(t.volume/maxVol)*100}%` : "0%", boxShadow: "0 0 8px rgba(60,131,246,0.4)" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            NIVEAU 2 — MÉSO : Comparaison par département
        ══════════════════════════════════════════════════════════════════ */}
        <section>
          <SectionTitle icon="map" title="Niveau 2 — Par Département" badge="Méso" />

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            {/* Barres horizontales */}
            <div className="p-5 space-y-3">
              {(stats?.by_dept || Array(8).fill(null)).map((d, i) => {
                const pct = d ? (d.prix_median_m2 / maxDeptPrix) * 100 : 0;
                const label = d ? (DEPT_LABELS[d.dept] || `Dept ${d.dept}`) : "...";
                const isParis = d?.dept === "75";
                return (
                  <div key={d?.dept || i} className="group flex items-center gap-3">
                    <span className={`text-xs font-bold w-28 shrink-0 ${isParis ? "text-amber-400" : "text-slate-300"}`}>
                      {label}
                    </span>
                    <div className="flex-1 bg-slate-800 h-6 rounded-lg overflow-hidden relative">
                      <div
                        className="h-full rounded-lg transition-all duration-700 flex items-center justify-end pr-2"
                        style={{
                          width: loading ? "0%" : `${pct}%`,
                          background: isParis
                            ? "linear-gradient(90deg, rgba(251,191,36,0.3), rgba(251,191,36,0.6))"
                            : "linear-gradient(90deg, rgba(60,131,246,0.3), rgba(60,131,246,0.6))",
                          boxShadow: isParis ? "0 0 12px rgba(251,191,36,0.3)" : "0 0 12px rgba(60,131,246,0.2)",
                        }}
                      >
                        {d && pct > 20 && (
                          <span className="text-xs font-bold text-white">
                            {Math.round(d.prix_median_m2).toLocaleString()} €/m²
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right w-24 shrink-0">
                      {d && pct <= 20 && (
                        <span className="text-xs font-bold text-white">{Math.round(d.prix_median_m2).toLocaleString()} €/m²</span>
                      )}
                      <p className="text-xs text-slate-500">{d ? `${d.nb_transactions.toLocaleString()} tx` : ""}</p>
                    </div>
                    {/* Clic → ouvrir la carte filtrée sur ce dept */}
                    <button
                      onClick={() => navigate(`/carte?dept=${d?.dept}`)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-primary border border-primary/30 px-2 py-1 rounded-lg hover:bg-primary/10 shrink-0"
                    >
                      Voir carte →
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Légende */}
            <div className="border-t border-slate-800 px-5 py-3 flex gap-6 text-xs text-slate-500">
              <span>Prix médian au m² par département (transactions DVF 2019-2024)</span>
              <span className="ml-auto flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-amber-400/50"></span>Paris
                <span className="w-3 h-3 rounded bg-primary/50 ml-2"></span>Autres dépts
              </span>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            NIVEAU 3 — MICRO : Top communes + DPE
        ══════════════════════════════════════════════════════════════════ */}
        <section>
          <SectionTitle icon="location_city" title="Niveau 3 — Communes" badge="Micro" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Top communes — cliquables → ouvrent la carte */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-4">
                Top communes · activité transactionnelle
              </p>
              <div className="space-y-2">
                {(stats?.top_communes || Array(5).fill(null)).map((c, i) => (
                  <button
                    key={c?.commune || i}
                    onClick={() => c && navigate(`/carte?q=${encodeURIComponent(c.commune)}`)}
                    className="w-full flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 hover:bg-slate-700/60 transition-colors group text-left"
                  >
                    <span className="text-xs font-black text-slate-500 w-5 text-center">#{i+1}</span>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-200">{c?.commune || "..."}</p>
                      <p className="text-xs text-slate-500">{c ? `${c.nb_transactions.toLocaleString()} transactions` : ""}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-amber-400">
                        {c?.prix_m2_median ? `${Math.round(c.prix_m2_median).toLocaleString()} €` : "—"}
                      </p>
                      <p className="text-[10px] text-slate-500">/m²</p>
                    </div>
                    <span className="material-symbols-outlined text-slate-600 group-hover:text-primary transition-colors text-sm ml-1"
                      style={{fontSize:16}}>arrow_forward</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-600 mt-3 text-center">
                Cliquer sur une commune pour l'ouvrir sur la carte
              </p>
            </div>

            {/* Distribution DPE */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-4">
                Distribution DPE · performance énergétique IDF
              </p>
              {stats?.dpe?.length > 0 ? (
                <div className="flex flex-col gap-3 flex-1">
                  {(() => {
                    const total = stats.dpe.reduce((s, d) => s + d.count, 0) || 1;
                    return stats.dpe.map(d => (
                      <div key={d.classe} className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded flex items-center justify-center text-xs font-black text-white shrink-0"
                          style={{ background: DPE_COLORS[d.classe] || "#64748b" }}>
                          {d.classe}
                        </div>
                        <div className="flex-1 bg-slate-800 h-2.5 rounded-full overflow-hidden">
                          <div className="h-full rounded-full"
                            style={{ width: `${(d.count/total)*100}%`, background: DPE_COLORS[d.classe] || "#64748b" }} />
                        </div>
                        <span className="text-xs text-slate-300 font-bold w-10 text-right">
                          {Math.round((d.count/total)*100)}%
                        </span>
                        <span className="text-xs text-slate-500 w-16 text-right">
                          {d.count.toLocaleString()}
                        </span>
                      </div>
                    ));
                  })()}
                </div>
              ) : (
                <p className="text-slate-600 text-sm text-center py-8">Pas de données DPE disponibles</p>
              )}
            </div>
          </div>
        </section>

        {/* ── Pied de page récap ──────────────────────────────────────────── */}
        <div className="border-t border-slate-800 pt-4 flex flex-wrap gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            Sources : DVF (DGFiP), DPE (ADEME), INSEE
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
            Pipeline : Azure ADLS → DBT + BigQuery → Supabase → API Go
          </span>
          <span className="ml-auto">
            Données 2019–2024 · IDF uniquement
          </span>
        </div>

      </div>
    </div>
  );
}
