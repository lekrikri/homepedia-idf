import React, { useEffect, useState } from "react";
import axios from "axios";

const DPE_COLOR = { A: "bg-green-500/20 text-green-400 border-green-500/30", B: "bg-green-500/20 text-green-400 border-green-500/30", C: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", D: "bg-orange-500/20 text-orange-400 border-orange-500/30", E: "bg-orange-500/20 text-orange-400 border-orange-500/30", F: "bg-red-500/20 text-red-400 border-red-500/30", G: "bg-red-500/20 text-red-400 border-red-500/30" };

const MOCK = [
  { date: "2023-11-24", adresse: "12 Rue de Rivoli, 75004 Paris",          type: "Apartment",  surface: 54.2,  prix: 745000,   prix_m2: 13745, dpe: "A" },
  { date: "2023-11-23", adresse: "45 Av. Victor Hugo, 92100 Boulogne",      type: "House",      surface: 112.5, prix: 1250000,  prix_m2: 11111, dpe: "C" },
  { date: "2023-11-22", adresse: "8 Bis Rue de la Paix, 75002 Paris",       type: "Studio",     surface: 19.0,  prix: 310000,   prix_m2: 16315, dpe: "F" },
  { date: "2023-11-21", adresse: "102 Boulevard Raspail, 75006 Paris",      type: "Apartment",  surface: 88.4,  prix: 1410000,  prix_m2: 15950, dpe: "D" },
  { date: "2023-11-20", adresse: "32 Rue de Vanves, 92100 Boulogne",        type: "Apartment",  surface: 42.0,  prix: 455000,   prix_m2: 10833, dpe: "B" },
  { date: "2023-11-20", adresse: "7 Quai Branly, 75007 Paris",              type: "Penthouse",  surface: 145.0, prix: 3250000,  prix_m2: 22413, dpe: "A" },
  { date: "2023-11-19", adresse: "18 Rue Lepic, 75018 Paris",               type: "Apartment",  surface: 33.5,  prix: 385000,   prix_m2: 11492, dpe: "E" },
];

const STATS = [
  { label: "Avg Price/m²",      value: "€11,450", trend: "+2.4%", up: true },
  { label: "Total Volume",      value: "€82.4M",  trend: "Last 30d", up: null },
  { label: "Market Velocity",   value: "4.2/day", trend: "-0.5%", up: false },
  { label: "Most Popular Type", value: "2BR Apt", trend: "42% of total", up: null },
];

export default function Transactions() {
  const [data, setData] = useState(MOCK);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const PER_PAGE = 25;

  useEffect(() => {
    axios.get("/api/v1/transactions?limit=500")
      .then(r => { if (r.data.data?.length) setData(r.data.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Computed stats from real data
  const withM2 = data.filter(t => t.valeur_fonciere && t.surface_reelle_bati);
  const avgM2 = withM2.length
    ? Math.round(withM2.reduce((s, t) => s + t.valeur_fonciere / t.surface_reelle_bati, 0) / withM2.length)
    : 0;
  const totalVolume = data.reduce((s, t) => s + (t.valeur_fonciere || 0), 0);
  const typeCounts = data.reduce((acc, t) => { const k = t.type_local || "Autre"; acc[k] = (acc[k]||0)+1; return acc; }, {});
  const topType = Object.entries(typeCounts).sort((a,b) => b[1]-a[1])[0];

  const computedStats = [
    { label: "Prix moyen/m²",     value: `€${avgM2.toLocaleString()}`,                     trend: "+2.4%", up: true },
    { label: "Volume total",      value: `€${(totalVolume/1e6).toFixed(1)}M`,               trend: "Total", up: null },
    { label: "Market Velocity",   value: `${(data.length/30).toFixed(1)}/jour`,             trend: "-0.5%", up: false },
    { label: "Type le + fréquent",value: topType ? topType[0] : "—", trend: topType ? `${Math.round(topType[1]/data.length*100)}% du total` : "", up: null },
  ];

  const paged = data.slice((page-1)*PER_PAGE, page*PER_PAGE);
  const totalPages = Math.ceil(data.length / PER_PAGE);

  return (
    <div className="h-full overflow-y-auto bg-background-dark px-6 py-8 lg:px-20 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Transaction Registry</h1>
          <p className="text-slate-400 mt-1">
            {loading ? "Chargement…" : <>Found <span className="text-slate-300 font-semibold">{data.length}</span> transactions en Île-de-France.</>}
          </p>
        </div>
        <button className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 w-fit">
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>file_download</span>
          Export Data
        </button>
      </div>

      {/* Filters bar */}
      <div className="glass-panel-light rounded-xl p-3 flex flex-wrap items-center gap-3">
        {["Last 30 Days", "Property Type: All", "Price Range", "Surface"].map(f => (
          <button key={f} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-slate-100 rounded-lg text-xs font-medium border border-slate-700 hover:bg-slate-700 transition-colors">
            {f === "Last 30 Days" && <span className="material-symbols-outlined" style={{ fontSize: 16 }}>calendar_today</span>}
            {f}
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>expand_more</span>
          </button>
        ))}
        <div className="h-6 w-px bg-slate-700 mx-2" />
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-primary/20 hover:bg-primary/20 transition-colors"
          style={{ background: "rgba(60,131,246,0.1)", color: "#3c83f6" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>filter_alt</span>
          Advanced Filters
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-500">Sorted by: Newest</span>
          <button className="p-1.5 hover:bg-slate-800 rounded">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>sort</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="glass-panel-light rounded-xl overflow-hidden border border-slate-800">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="border-b border-slate-700/50" style={{ background: "rgba(30,41,59,0.5)" }}>
                {["Date","Address","Type","Surface (m²)","Total Price","Price/m²","DPE",""].map(h => (
                  <th key={h} className={`px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-400 ${["Surface (m²)","Total Price","Price/m²"].includes(h) ? "text-right" : h === "DPE" ? "text-center" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {paged.map((t, i) => {
                const prixM2 = t.valeur_fonciere && t.surface_reelle_bati
                  ? Math.round(t.valeur_fonciere / t.surface_reelle_bati) : null;
                const adresse = [t.adresse_numero, t.adresse, t.code_postal, t.commune].filter(Boolean).join(" ") || t.adresse || "—";
                return (
                  <tr key={t.id || i} className="group hover:bg-primary/10 transition-colors border-l-4 border-l-transparent hover:border-l-primary">
                    <td className="px-6 py-4 whitespace-nowrap text-sm mono-nums text-slate-300">{t.date_mutation}</td>
                    <td className="px-6 py-4 text-sm font-medium">{adresse}</td>
                    <td className="px-6 py-4 text-xs font-medium">
                      <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-300">{t.type_local || "—"}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-right mono-nums">{t.surface_reelle_bati?.toFixed(1) ?? "—"}</td>
                    <td className="px-6 py-4 text-sm text-right mono-nums font-semibold text-primary">
                      {t.valeur_fonciere ? `€${(t.valeur_fonciere / 1000).toFixed(0)}k` : "—"}
                    </td>
                    <td className="px-6 py-4 text-sm text-right mono-nums text-slate-400">
                      {prixM2 ? `€${prixM2.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {t.classe_energie
                        ? <span className={`px-2 py-0.5 rounded-sm text-[10px] font-bold border ${DPE_COLOR[t.classe_energie] || "bg-slate-700 text-slate-400 border-slate-600"}`}>{t.classe_energie}</span>
                        : <span className="text-slate-600">—</span>
                      }
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="p-1 hover:text-primary">
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>open_in_new</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-slate-800 flex items-center justify-between"
          style={{ background: "rgba(15,23,42,0.3)" }}>
          <div className="text-xs text-slate-500">
            Showing <span className="text-slate-300 font-semibold">{(page-1)*PER_PAGE+1}–{Math.min(page*PER_PAGE, data.length)}</span> of {data.length} transactions
          </div>
          <div className="flex gap-2 items-center">
            <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
              className="p-1.5 rounded bg-slate-800 border border-slate-700 disabled:opacity-40">
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>chevron_left</span>
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(n => (
              <button key={n} onClick={() => setPage(n)}
                className={`px-3 py-1 rounded text-xs font-bold ${page === n ? "bg-primary text-white" : "text-slate-400 hover:bg-slate-800"}`}>
                {n}
              </button>
            ))}
            {totalPages > 5 && <span className="text-slate-600 px-1">…{totalPages}</span>}
            <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}
              className="p-1.5 rounded bg-slate-800 border border-slate-700 disabled:opacity-40">
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>chevron_right</span>
            </button>
          </div>
        </div>
      </div>

      {/* Mini stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {computedStats.map(s => (
          <div key={s.label} className="glass-panel-light p-4 rounded-xl">
            <p className="text-xs font-medium text-slate-500 uppercase">{s.label}</p>
            <div className="flex items-end justify-between mt-1">
              <h3 className="text-xl font-bold mono-nums">{s.value}</h3>
              {s.up !== null && (
                <span className={`text-xs font-medium flex items-center ${s.up ? "text-green-400" : "text-red-400"}`}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{s.up ? "trending_up" : "trending_down"}</span>
                  {s.trend}
                </span>
              )}
              {s.up === null && <span className="text-xs text-slate-400">{s.trend}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
