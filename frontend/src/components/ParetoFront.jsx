import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

// Calcule le front de Pareto (maximiser rendement, minimiser risque)
function calcParetoFront(points) {
  const sorted = [...points].sort((a, b) => b.rendement - a.rendement);
  const front = [];
  let minRisk = Infinity;
  for (const p of sorted) {
    if (p.risque < minRisk) {
      front.push(p.code);
      minRisk = p.risque;
    }
  }
  return new Set(front);
}

const DEPT_COLORS = {
  "75": "#ef4444",
  "92": "#f59e0b",
  "93": "#10b981",
  "94": "#3b82f6",
  "77": "#8b5cf6",
  "78": "#ec4899",
  "91": "#06b6d4",
  "95": "#84cc16",
};

function deptColor(dept) {
  return DEPT_COLORS[dept] ?? "#64748b";
}

const CustomDot = ({ cx, cy, payload, isPareto, isHovered, onClick }) => {
  const r = isPareto ? 7 : isHovered ? 5 : 3.5;
  const color = deptColor(payload.dept);
  return (
    <circle
      cx={cx} cy={cy} r={r}
      fill={isPareto ? color : color + "99"}
      stroke={isPareto ? "#fff" : "none"}
      strokeWidth={isPareto ? 1.5 : 0}
      style={{ cursor: "pointer", transition: "r 0.15s" }}
      onClick={() => onClick(payload)}
    />
  );
};

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="glass-panel rounded-xl px-3 py-2 text-[11px] shadow-xl border border-slate-700/50">
      <div className="font-bold text-slate-100 mb-1">{p.city}</div>
      <div className="text-slate-400">Dép. {p.dept}</div>
      <div className="flex gap-3 mt-1">
        <span className="text-emerald-400">Rendement : <b>{p.rendement.toFixed(2)}%</b></span>
        <span className={p.risque < 70 ? "text-green-400" : p.risque < 80 ? "text-yellow-400" : "text-red-400"}>
          Risque : <b>{p.risque.toFixed(0)}/100</b>
        </span>
      </div>
      <div className="text-slate-400 mt-0.5">{p.prix_m2.toLocaleString("fr-FR")} €/m²</div>
    </div>
  );
};

export default function ParetoFront({ onSelectCommune }) {
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paretoSet, setParetoSet] = useState(new Set());
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(null);
  const [filterDept, setFilterDept] = useState("all");
  const [showOnlyPareto, setShowOnlyPareto] = useState(false);
  const [showInfo, setShowInfo] = useState(() => !localStorage.getItem("hp_pareto_info_closed"));

  useEffect(() => {
    axios.get("/api/v1/pareto").then(r => {
      const pts = r.data?.points ?? [];
      setPoints(pts);
      setParetoSet(calcParetoFront(pts));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const depts = ["all", ...Array.from(new Set(points.map(p => p.dept))).sort()];

  const displayed = points.filter(p => {
    if (filterDept !== "all" && p.dept !== filterDept) return false;
    if (showOnlyPareto && !paretoSet.has(p.code)) return false;
    return true;
  });

  const paretoLine = [...points]
    .filter(p => paretoSet.has(p.code))
    .sort((a, b) => a.risque - b.risque);

  const handleClick = useCallback((payload) => {
    setSelected(payload.code);
    onSelectCommune?.(payload.code, payload.city);
  }, [onSelectCommune]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Chargement des données Pareto…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0f1117] text-slate-200">
      {/* En-tête */}
      <div className="px-5 pt-5 pb-3 border-b border-slate-800">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-100">Pareto Front — Rendement vs Risque</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {points.length} communes IDF · <span className="text-emerald-400">{paretoSet.size} sur le front optimal</span>
            </p>
          </div>
          <button
            onClick={() => {
              const next = !showInfo;
              setShowInfo(next);
              if (!next) localStorage.setItem("hp_pareto_info_closed", "1");
              else localStorage.removeItem("hp_pareto_info_closed");
            }}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg transition-all"
            style={{
              background: showInfo ? "rgba(167,139,250,0.12)" : "rgba(30,41,59,0.6)",
              border: showInfo ? "1px solid rgba(167,139,250,0.3)" : "1px solid rgba(30,41,59,0.8)",
              color: showInfo ? "#a78bfa" : "#64748b",
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>help_outline</span>
            {showInfo ? "Masquer l'aide" : "Comment ça marche ?"}
          </button>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={filterDept}
              onChange={e => setFilterDept(e.target.value)}
              className="text-xs bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200">
              {depts.map(d => (
                <option key={d} value={d}>{d === "all" ? "Tous les dép." : `Dép. ${d}`}</option>
              ))}
            </select>
            <button
              onClick={() => setShowOnlyPareto(v => !v)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-all font-medium ${
                showOnlyPareto ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}>
              Front Pareto uniquement
            </button>
          </div>
        </div>
        {/* Légende départements */}
        <div className="flex flex-wrap gap-2 mt-3">
          {Object.entries(DEPT_COLORS).map(([d, c]) => (
            <button
              key={d}
              onClick={() => setFilterDept(prev => prev === d ? "all" : d)}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full transition-all"
              style={{ background: filterDept === d ? c + "33" : "rgba(255,255,255,0.04)", border: `1px solid ${c}55` }}>
              <span style={{ background: c, width: 6, height: 6, borderRadius: "50%", display: "inline-block" }} />
              <span style={{ color: c }}>
                {d === "75" ? "Paris" : d === "92" ? "Hauts-de-Seine" : d === "93" ? "Seine-St-Denis" :
                 d === "94" ? "Val-de-Marne" : d === "77" ? "Seine-et-Marne" : d === "78" ? "Yvelines" :
                 d === "91" ? "Essonne" : "Val-d'Oise"}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Bloc explicatif rétractable */}
      {showInfo && (
        <div className="px-5 py-4 border-b border-slate-800" style={{ background: "rgba(167,139,250,0.04)" }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex gap-3">
              <div className="size-8 rounded-lg shrink-0 flex items-center justify-center mt-0.5"
                style={{ background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.3)" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#a78bfa" }}>psychology</span>
              </div>
              <div>
                <p className="text-[11px] font-bold text-slate-200 mb-1">C'est quoi le front de Pareto ?</p>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Une commune est sur le front de Pareto si aucune autre commune n'offre simultanément un meilleur rendement <em>et</em> un risque plus faible. Ce sont les choix objectivement optimaux — tout autre choix implique un compromis.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="size-8 rounded-lg shrink-0 flex items-center justify-center mt-0.5"
                style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#10b981" }}>show_chart</span>
              </div>
              <div>
                <p className="text-[11px] font-bold text-slate-200 mb-1">Comment lire le graphique ?</p>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  <span className="text-slate-300 font-semibold">Axe X (horizontal)</span> = Score de risque (0 = sans risque, 100 = très risqué).<br />
                  <span className="text-slate-300 font-semibold">Axe Y (vertical)</span> = Rendement locatif brut (%).<br />
                  Le coin <span className="text-emerald-400 font-semibold">haut-gauche</span> = idéal.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="size-8 rounded-lg shrink-0 flex items-center justify-center mt-0.5"
                style={{ background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.3)" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#f87171" }}>scatter_plot</span>
              </div>
              <div>
                <p className="text-[11px] font-bold text-slate-200 mb-1">Comment utiliser ?</p>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Les <span className="text-white font-semibold">points avec contour blanc</span> sont sur le front optimal (ligne pointillée verte).
                  Filtrez par département pour comparer entre eux. Cliquez sur un point pour voir la fiche commune.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Scatter Plot */}
      <div className="flex-1 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              type="number" dataKey="risque" name="Score risque"
              domain={[30, 100]}
              label={{ value: "Score risque (100 = très risqué)", position: "insideBottom", offset: -10, fill: "#64748b", fontSize: 11 }}
              tick={{ fill: "#64748b", fontSize: 10 }}
              tickFormatter={v => `${v}`}
            />
            <YAxis
              type="number" dataKey="rendement" name="Rendement"
              domain={[0, 9]}
              label={{ value: "Rendement locatif brut (%)", angle: -90, position: "insideLeft", offset: 15, fill: "#64748b", fontSize: 11 }}
              tick={{ fill: "#64748b", fontSize: 10 }}
              tickFormatter={v => `${v}%`}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Front de Pareto (ligne de référence) */}
            {paretoLine.length > 1 && (
              <ReferenceLine
                segment={paretoLine.map(p => ({ x: p.risque, y: p.rendement }))}
                stroke="#10b981"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}

            <Scatter
              data={displayed}
              shape={(props) => {
                const p = props.payload;
                return (
                  <CustomDot
                    {...props}
                    isPareto={paretoSet.has(p.code)}
                    isHovered={hovered === p.code}
                    onClick={handleClick}
                  />
                );
              }}
              onMouseEnter={(d) => setHovered(d?.code)}
              onMouseLeave={() => setHovered(null)}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Liste du front de Pareto */}
      <div className="px-5 pb-4 border-t border-slate-800 pt-3">
        <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">
          Top communes front optimal (meilleur rendement pour le risque le plus faible)
        </div>
        <div className="flex flex-wrap gap-2">
          {paretoLine.slice(0, 12).map(p => (
            <button
              key={p.code}
              onClick={() => handleClick(p)}
              className={`text-[11px] px-2.5 py-1 rounded-lg transition-all ${
                selected === p.code
                  ? "bg-emerald-600/30 text-emerald-300 ring-1 ring-emerald-500/50"
                  : "bg-slate-800/60 text-slate-300 hover:bg-slate-700"
              }`}>
              {p.city}
              <span className="ml-1 text-emerald-400 font-bold">{p.rendement.toFixed(1)}%</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
