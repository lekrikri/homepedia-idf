import React, { useEffect, useState, useMemo, useRef } from "react";
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

  // ── Explorateur commune (Niveau 3) ────────────────────────────────────────
  const [allCommunes, setAllCommunes] = useState([]);
  const [communeSearchInput, setCommuneSearchInput] = useState("");
  const [communeSearch, setCommuneSearch] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [microCommune, setMicroCommune] = useState(null);
  const [microStats, setMicroStats] = useState(null);
  const [microLoading, setMicroLoading] = useState(false);
  const microAbortRef = useRef(null);
  const searchDebounceRef = useRef(null);

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      axios.get("/api/v1/stats", { signal: ctrl.signal }).then(r => r.data),
      axios.get("/api/v1/health", { signal: ctrl.signal }).then(r => r.data).catch(() => null),
    ]).then(([s]) => setStats(s)).catch(() => {}).finally(() => setLoading(false));

    axios.get("/api/v1/communes/gold?limit=1300", { signal: ctrl.signal })
      .then(r => { if (r.data?.data) setAllCommunes(r.data.data); })
      .catch(() => {});

    return () => ctrl.abort();
  }, []);

  const communeSuggestions = useMemo(() => {
    if (!communeSearch) return [];
    const q = communeSearch.toLowerCase();
    return allCommunes
      .filter(c => c.nom.toLowerCase().includes(q) || (c.code_postal || "").includes(communeSearch))
      .slice(0, 6);
  }, [communeSearch, allCommunes]);

  const handleSelectMicroCommune = (c) => {
    setMicroCommune(c);
    setCommuneSearch("");
    setCommuneSearchInput("");
    setShowSuggestions(false);
    setMicroStats(null);
    setMicroLoading(true);
    microAbortRef.current?.abort();
    microAbortRef.current = new AbortController();
    const code = c.code_insee.startsWith("751") && c.code_insee !== "75056" ? "75056" : c.code_insee;
    axios.get(`/api/v1/communes/${code}/agregat`, { signal: microAbortRef.current.signal })
      .then(r => setMicroStats(r.data))
      .catch(err => { if (!axios.isCancel(err)) setMicroStats(null); })
      .finally(() => setMicroLoading(false));
  };

  const handleCommuneSearchChange = (e) => {
    const v = e.target.value;
    setCommuneSearchInput(v);
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setCommuneSearch(v), 150);
    setShowSuggestions(true);
  };

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
            {[
              { label: "Macro IDF",        id: "section-macro" },
              { label: "Méso Département", id: "section-meso"  },
              { label: "Micro Commune",    id: "section-micro" },
            ].map(({ label, id }, i) => (
              <button key={label}
                onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className={`px-3 py-1 rounded-full text-xs font-semibold border cursor-pointer transition-all ${
                  i === 0
                    ? "bg-primary/20 border-primary/40 text-primary hover:bg-primary/30"
                    : "bg-slate-800 border-slate-700 text-slate-400 hover:border-primary/40 hover:text-primary hover:bg-primary/10"
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            NIVEAU 1 — MACRO : Vue IDF globale
        ══════════════════════════════════════════════════════════════════ */}
        <section id="section-macro">
          <SectionTitle icon="public" title="Niveau 1 — IDF Global" badge="Macro" />

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { label: "Volume total marché", value: fmt(stats?.total_volume), trend: yoy ? `${parseFloat(yoy)>=0?"+":""}${yoy}%` : null, up: yoy ? parseFloat(yoy)>=0 : true },
              { label: "Transactions DVF", value: stats?.nb_transactions?.toLocaleString() || "—", sub: "2020 – 2025" },
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
        <section id="section-meso">
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
              <span>Prix médian au m² par département (transactions DVF 2020-2025)</span>
              <span className="ml-auto flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-amber-400/50"></span>Paris
                <span className="w-3 h-3 rounded bg-primary/50 ml-2"></span>Autres dépts
              </span>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            NIVEAU 3 — MICRO : Explorateur de commune
        ══════════════════════════════════════════════════════════════════ */}
        <section id="section-micro">
          <SectionTitle icon="travel_explore" title="Niveau 3 — Explorer une Commune" badge="Micro" />

          {/* Search bar + autocomplete */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-4">
            <p className="text-xs text-slate-400 mb-3">Sélectionnez une commune pour voir ses indicateurs clés</p>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" style={{fontSize:18}}>search</span>
              <input
                value={communeSearchInput}
                onChange={handleCommuneSearchChange}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="Rechercher une commune IDF… ex: Boulogne, Vincennes"
                className="w-full bg-slate-800 border border-slate-700 focus:border-primary rounded-xl py-3 pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-600 outline-none transition-colors"
              />
              {showSuggestions && communeSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 rounded-xl overflow-hidden z-50 shadow-2xl"
                  style={{ background: "#0d1422", border: "1px solid rgba(60,131,246,0.25)" }}>
                  {communeSuggestions.map(c => (
                    <button key={c.code_insee} onMouseDown={() => handleSelectMicroCommune(c)}
                      className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-primary/10 transition-colors border-b border-slate-800/60 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-slate-600" style={{fontSize:15}}>location_city</span>
                        <span className="text-sm font-medium text-slate-200">{c.nom}</span>
                      </div>
                      <span className="text-xs text-slate-500 mono-nums">{c.code_postal} · Dept. {c.departement?.trim()}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Chips communes suggérées */}
            {!communeSearch && !microCommune && allCommunes.length > 0 && (
              <div className="mt-3">
                <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-2">Suggestions</p>
                <div className="flex flex-wrap gap-2">
                  {["Paris", "Boulogne-Billancourt", "Vincennes", "Versailles", "Montreuil", "Créteil", "Nanterre"].map(name => {
                    const c = allCommunes.find(x => x.nom.toLowerCase() === name.toLowerCase());
                    return c ? (
                      <button key={name} onClick={() => handleSelectMicroCommune(c)}
                        className="px-3 py-1.5 rounded-full text-xs font-medium bg-slate-800 border border-slate-700 text-slate-300 hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all">
                        {c.nom}
                      </button>
                    ) : null;
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Résultat commune sélectionnée */}
          {microLoading && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 flex items-center justify-center gap-3">
              <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <span className="text-slate-400 text-sm">Chargement des données…</span>
            </div>
          )}

          {microCommune && !microLoading && (
            <div className="bg-slate-900 border border-primary/20 rounded-xl overflow-hidden"
              style={{ boxShadow: "0 0 0 1px rgba(60,131,246,0.1), 0 8px 32px rgba(60,131,246,0.08)" }}>

              {/* Header commune */}
              <div className="px-5 py-4 flex items-center justify-between border-b border-slate-800"
                style={{ background: "rgba(60,131,246,0.05)" }}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <span className="material-symbols-outlined text-primary" style={{fontSize:18}}>location_on</span>
                  </div>
                  <div>
                    <h3 className="font-bold text-white">{microCommune.nom}</h3>
                    <p className="text-xs text-slate-400">{microCommune.code_postal} · Département {microCommune.departement?.trim()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => navigate(`/transactions?commune=${encodeURIComponent(microCommune.nom)}`)}
                    className="text-xs text-slate-400 border border-slate-700 px-3 py-1.5 rounded-lg hover:border-slate-500 hover:text-slate-200 transition-colors">
                    Transactions
                  </button>
                  <button onClick={() => navigate(`/comparer?a=${microCommune.code_insee}`)}
                    className="text-xs text-slate-400 border border-slate-700 px-3 py-1.5 rounded-lg hover:border-slate-500 hover:text-slate-200 transition-colors flex items-center gap-1">
                    <span className="material-symbols-outlined" style={{fontSize:14}}>compare_arrows</span>
                    Comparer
                  </button>
                  <button onClick={() => navigate(`/carte?q=${encodeURIComponent(microCommune.nom)}`)}
                    className="text-xs font-semibold bg-primary/10 border border-primary/40 text-primary px-3 py-1.5 rounded-lg hover:bg-primary/20 transition-colors flex items-center gap-1">
                    <span className="material-symbols-outlined" style={{fontSize:14}}>map</span>
                    Voir sur la carte
                  </button>
                  <button onClick={() => { setMicroCommune(null); setMicroStats(null); }}
                    className="text-slate-600 hover:text-slate-400 transition-colors ml-1">
                    <span className="material-symbols-outlined" style={{fontSize:18}}>close</span>
                  </button>
                </div>
              </div>

              {/* KPIs grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y divide-slate-800">
                {[
                  {
                    icon: "payments", label: "Prix médian / m²",
                    value: microStats?.prix_median_m2 ? `${Math.round(microStats.prix_median_m2).toLocaleString()} €` : microCommune?.prix_m2_median ? `${Math.round(microCommune.prix_m2_median).toLocaleString()} €` : "—",
                    color: "text-amber-400",
                  },
                  {
                    icon: "handshake", label: "Transactions",
                    value: (microStats?.nb_transactions ?? microCommune?.nb_transactions ?? "—").toLocaleString?.() ?? "—",
                    color: "text-primary",
                  },
                  {
                    icon: "bolt", label: "DPE dominant",
                    value: microStats?.dpe_dominant ?? microCommune?.dpe_dominant ?? "—",
                    color: microStats?.dpe_dominant ? `text-${{"A":"green","B":"green","C":"yellow","D":"orange","E":"orange","F":"red","G":"red"}[microStats.dpe_dominant] || "slate"}-400` : "text-slate-300",
                  },
                  {
                    icon: "square_foot", label: "Surface moy.",
                    value: microStats?.surface_moyenne ? `${Math.round(microStats.surface_moyenne)} m²` : "—",
                    color: "text-slate-200",
                  },
                ].map(({ icon, label, value, color }) => (
                  <div key={label} className="px-5 py-4 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 text-slate-500">
                      <span className="material-symbols-outlined" style={{fontSize:14}}>{icon}</span>
                      <span className="text-[10px] uppercase tracking-wider">{label}</span>
                    </div>
                    <span className={`text-2xl font-bold mono-nums ${color}`}>{value}</span>
                  </div>
                ))}
              </div>

              {/* Barre DPE si dispo */}
              {microStats?.pct_dpe_bon != null && (
                <div className="px-5 py-3 border-t border-slate-800 flex items-center gap-3">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Biens classés A/B</span>
                  <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, microStats.pct_dpe_bon * 100).toFixed(1)}%` }} />
                  </div>
                  <span className="text-xs font-bold text-emerald-400 mono-nums">{(microStats.pct_dpe_bon * 100).toFixed(1)}%</span>
                </div>
              )}

              {/* ── Scores composites ── */}
              {(microStats?.score_qualite_vie != null || microStats?.score_investissement != null ||
                microStats?.score_stabilite != null || microStats?.score_securite != null) && (
                <div className="px-5 py-4 border-t border-slate-800">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Scores synthèse</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    {[
                      { label: "Qualité de vie",  val: microStats?.score_qualite_vie,    color: "#10b981", icon: "favorite" },
                      { label: "Investissement",   val: microStats?.score_investissement, color: "#3c83f6", icon: "trending_up" },
                      { label: "Stabilité DPE",   val: microStats?.score_stabilite,      color: "#f59e0b", icon: "verified" },
                      { label: "Sécurité",        val: microStats?.score_securite,       color: "#8b5cf6", icon: "shield" },
                    ].map(({ label, val, color, icon }) => val != null ? (
                      <div key={label}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="material-symbols-outlined" style={{ fontSize: 11, color }}>{icon}</span>
                          <span className="text-[10px] text-slate-500">{label}</span>
                          <span className="ml-auto text-[10px] font-bold" style={{ color }}>{Math.round(val)}/100</span>
                        </div>
                        <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, val)}%`, background: color }} />
                        </div>
                      </div>
                    ) : null)}
                  </div>
                </div>
              )}

              {/* ── IPS + Éducation ── */}
              {microStats?.ips_moyen != null && (
                <div className="px-5 py-3 border-t border-slate-800 flex items-center gap-4">
                  <span className="material-symbols-outlined text-amber-400" style={{ fontSize: 16 }}>school</span>
                  <div className="flex-1">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">IPS scolaire</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-base font-bold text-slate-100">{microStats.ips_moyen.toFixed(1)}</span>
                      <span className={`text-[10px] font-semibold ${microStats.ips_moyen >= 110 ? "text-emerald-400" : microStats.ips_moyen >= 80 ? "text-amber-400" : "text-red-400"}`}>
                        {microStats.ips_moyen >= 110 ? "Très favorisé" : microStats.ips_moyen >= 80 ? "Intermédiaire" : "Défavorisé"}
                      </span>
                    </div>
                  </div>
                  {microStats.nb_ecoles > 0 && (
                    <div className="text-right">
                      <p className="text-[10px] text-slate-500">Établissements</p>
                      <p className="text-sm font-bold text-slate-200">{microStats.nb_ecoles}</p>
                    </div>
                  )}
                  {microStats.pct_ecoles_favorisees != null && (
                    <div className="text-right">
                      <p className="text-[10px] text-slate-500">% favorisées</p>
                      <p className="text-sm font-bold text-emerald-400">{microStats.pct_ecoles_favorisees.toFixed(0)}%</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Énergie réelle ENEDIS/GRDF ── */}
              {(microStats?.conso_elec_par_logement != null || microStats?.conso_gaz_par_logement != null) && (
                <div className="px-5 py-3 border-t border-slate-800 flex items-center gap-4">
                  <span className="material-symbols-outlined text-yellow-400" style={{ fontSize: 16 }}>bolt</span>
                  <div className="flex-1">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Consommation réelle / logement</p>
                    <div className="flex gap-4">
                      {microStats.conso_elec_par_logement != null && (
                        <div>
                          <p className="text-[10px] text-slate-500">Électricité</p>
                          <p className="text-sm font-bold text-yellow-400">{microStats.conso_elec_par_logement.toFixed(1)} <span className="text-[9px] text-slate-500">MWh/an</span></p>
                        </div>
                      )}
                      {microStats.conso_gaz_par_logement != null && (
                        <div>
                          <p className="text-[10px] text-slate-500">Gaz</p>
                          <p className="text-sm font-bold text-orange-400">{microStats.conso_gaz_par_logement.toFixed(1)} <span className="text-[9px] text-slate-500">MWh/an</span></p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Loyer + Rendement ── */}
              {microStats?.loyer_median_m2 != null && (
                <div className="px-5 py-3 border-t border-slate-800 flex items-center gap-4">
                  <span className="material-symbols-outlined text-emerald-400" style={{ fontSize: 16 }}>account_balance</span>
                  <div className="flex-1">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Rendement locatif</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-base font-bold text-slate-100">{microStats.loyer_median_m2.toFixed(1)} €/m²/mois</span>
                      {microStats.zone_tendue && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 border border-orange-500/30">Zone tendue</span>
                      )}
                    </div>
                  </div>
                  {microStats.rendement_locatif_brut != null && (
                    <div className="text-right">
                      <p className="text-[10px] text-slate-500">Rendement brut</p>
                      <p className="text-base font-bold" style={{
                        color: microStats.rendement_locatif_brut >= 5 ? "#10b981"
                             : microStats.rendement_locatif_brut >= 3.5 ? "#f59e0b" : "#ef4444"
                      }}>{microStats.rendement_locatif_brut.toFixed(2)}%</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Sécurité ── */}
              {microStats?.score_securite != null && (
                <div className="px-5 py-3 border-t border-slate-800 flex items-center gap-4">
                  <span className="material-symbols-outlined text-violet-400" style={{ fontSize: 16 }}>shield</span>
                  <div className="flex-1">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Sécurité (source SSMSI)</p>
                    <div className="flex gap-4">
                      {microStats.taux_cambriolages != null && (
                        <div>
                          <p className="text-[10px] text-slate-500">Cambriolages</p>
                          <p className="text-sm font-bold text-slate-200">{microStats.taux_cambriolages.toFixed(1)} <span className="text-[9px] text-slate-500">‰ logements</span></p>
                        </div>
                      )}
                      {microStats.taux_vols_violence != null && (
                        <div>
                          <p className="text-[10px] text-slate-500">CBV</p>
                          <p className="text-sm font-bold text-slate-200">{microStats.taux_vols_violence.toFixed(1)} <span className="text-[9px] text-slate-500">‰ hab.</span></p>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-500">Score sécurité</p>
                    <p className="text-base font-bold text-violet-400">{Math.round(microStats.score_securite)}/100</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Top communes + DPE (données agrégées) */}
        <section>
          <SectionTitle icon="location_city" title="Top Communes & DPE" badge="Micro" />

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
            Sources : DVF (DGFiP), DPE (ADEME), INSEE, IPS (DEPP), SSMSI, ENEDIS/GRDF (agenceORE)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
            Pipeline : Azure ADLS → DBT + BigQuery → Supabase → API Go
          </span>
          <span className="ml-auto">
            Données 2020–2025 · IDF uniquement
          </span>
        </div>

      </div>
    </div>
  );
}
