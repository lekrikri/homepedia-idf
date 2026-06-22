import React, { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";

// ─── Constantes ───────────────────────────────────────────────────────────────

const DPE_HEX = { A:"#22c55e", B:"#4ade80", C:"#a3e635", D:"#facc15", E:"#fb923c", F:"#f87171", G:"#dc2626" };

const DEPTS_IDF = [
  { code: "75", label: "Paris (75)" },
  { code: "77", label: "Seine-et-Marne (77)" },
  { code: "78", label: "Yvelines (78)" },
  { code: "91", label: "Essonne (91)" },
  { code: "92", label: "Hauts-de-Seine (92)" },
  { code: "93", label: "Seine-Saint-Denis (93)" },
  { code: "94", label: "Val-de-Marne (94)" },
  { code: "95", label: "Val-d'Oise (95)" },
];

const SORT_COLS = [
  { key: "date_mutation",      label: "Date" },
  { key: "valeur_fonciere",    label: "Prix total" },
  { key: "prix_m2",            label: "Prix/m²" },
  { key: "surface_reelle_bati",label: "Surface" },
];

const PER_PAGE = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrix(v) {
  if (!v) return "—";
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M€`;
  return `${(v / 1000).toFixed(0)}k€`;
}

function fmtPrixM2(v, s) {
  if (!v || !s) return null;
  return Math.round(v / s).toLocaleString("fr-FR");
}

function fmtDate(dateStr, sourceAnnee) {
  if (!dateStr) return "—";
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    const yr = parseInt(parts[0], 10);
    if ((yr > 2030 || yr < 2000) && sourceAnnee) return `${sourceAnnee}-${parts[1]}-${parts[2]}`;
  }
  return dateStr;
}

// ─── Composant filtre slider ───────────────────────────────────────────────────

function FilterSelect({ label, value, onChange, options, icon }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label className="text-[9px] uppercase tracking-widest text-slate-500 font-semibold flex items-center gap-1">
        {icon && <span className="material-symbols-outlined" style={{ fontSize: 11 }}>{icon}</span>}
        {label}
      </label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="bg-slate-800/80 text-slate-100 border border-slate-700/60 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:border-primary outline-none cursor-pointer min-w-[130px]">
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function FilterInput({ label, value, onChange, placeholder, icon }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[9px] uppercase tracking-widest text-slate-500 font-semibold flex items-center gap-1">
        {icon && <span className="material-symbols-outlined" style={{ fontSize: 11 }}>{icon}</span>}
        {label}
      </label>
      <input type="number" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-slate-800/80 text-slate-100 border border-slate-700/60 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:border-primary outline-none w-28 [appearance:textfield]" />
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color }) {
  return (
    <div className="rounded-xl p-4 flex items-start gap-3"
      style={{ background: "rgba(22,32,48,0.8)", border: "1px solid rgba(60,131,246,0.12)" }}>
      <div className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
        style={{ background: (color || "#3c83f6") + "18" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18, color: color || "#3c83f6" }}>{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-[9px] uppercase tracking-widest text-slate-500 font-semibold">{label}</p>
        <p className="text-lg font-black mono-nums text-slate-100 leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function Transactions() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Filtres — initialisés depuis URL params si présents (ex: depuis MapView)
  const [dept,       setDept]       = useState(searchParams.get("departement") || "");
  const [commune,    setCommune]    = useState(searchParams.get("commune") || "");
  const [typeFilter, setTypeFilter] = useState(searchParams.get("type_local") || "");
  const [annee,      setAnnee]      = useState(searchParams.get("annee") || "");
  const [dpe,        setDpe]        = useState("");
  const [prixMin,    setPrixMin]    = useState("");
  const [prixMax,    setPrixMax]    = useState("");
  const [surfMin,    setSurfMin]    = useState("");
  const [surfMax,    setSurfMax]    = useState("");
  const [pieces,     setPieces]     = useState("");

  // Tri
  const [sortBy,    setSortBy]    = useState("date_mutation");
  const [sortOrder, setSortOrder] = useState("desc");

  // Pagination serveur
  const [offset, setOffset] = useState(0);

  // Données
  const [data,  setData]  = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Stats agrégées (calculées sur le résultat courant)
  const withM2    = data.filter(t => t.valeur_fonciere && t.surface_reelle_bati);
  const avgM2     = withM2.length ? Math.round(withM2.reduce((s,t) => s + t.valeur_fonciere/t.surface_reelle_bati, 0) / withM2.length) : null;
  const totalVol  = data.reduce((s,t) => s + (t.valeur_fonciere||0), 0);
  const typeCounts = data.reduce((acc,t) => { const k=t.type_local||"Autre"; acc[k]=(acc[k]||0)+1; return acc; }, {});
  const topType   = Object.entries(typeCounts).sort((a,b)=>b[1]-a[1])[0];
  const dpeCount  = data.filter(t => t.classe_energie).length;
  const dpePct    = data.length ? Math.round(dpeCount/data.length*100) : 0;

  const hasFilters = dept || commune || typeFilter || annee || dpe || prixMin || prixMax || surfMin || surfMax || pieces;

  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: PER_PAGE, offset });
    if (dept)       params.set("departement", dept);
    if (commune)    params.set("commune", commune);
    if (typeFilter) params.set("type_local", typeFilter);
    if (annee)      params.set("annee", annee);
    if (dpe)        params.set("dpe", dpe);
    if (prixMin)    params.set("prix_min", prixMin);
    if (prixMax)    params.set("prix_max", prixMax);
    if (surfMin)    params.set("surface_min", surfMin);
    if (surfMax)    params.set("surface_max", surfMax);
    if (pieces)     params.set("pieces", pieces);
    params.set("sort_by", sortBy);
    params.set("sort_order", sortOrder);

    axios.get(`/api/v1/transactions?${params}`)
      .then(r => {
        setData(r.data.data || []);
        setTotal(r.data.total ?? 0);
      })
      .catch(() => { setData([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [dept, commune, typeFilter, annee, dpe, prixMin, prixMax, surfMin, surfMax, pieces, sortBy, sortOrder, offset]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Reset offset when filters change
  useEffect(() => { setOffset(0); }, [dept, commune, typeFilter, annee, dpe, prixMin, prixMax, surfMin, surfMax, pieces, sortBy, sortOrder]);

  const resetFilters = () => {
    setDept(""); setCommune(""); setTypeFilter(""); setAnnee(""); setDpe("");
    setPrixMin(""); setPrixMax(""); setSurfMin(""); setSurfMax(""); setPieces("");
  };

  const handleSort = (col) => {
    if (sortBy === col) setSortOrder(o => o === "desc" ? "asc" : "desc");
    else { setSortBy(col); setSortOrder("desc"); }
  };

  const SortIcon = ({ col }) => {
    if (sortBy !== col) return <span className="material-symbols-outlined text-slate-700" style={{ fontSize: 12 }}>unfold_more</span>;
    return <span className="material-symbols-outlined text-primary" style={{ fontSize: 12 }}>
      {sortOrder === "desc" ? "arrow_downward" : "arrow_upward"}
    </span>;
  };

  const exportCSV = () => {
    const headers = ["date_mutation","commune","departement","type_local","surface_m2","pieces","prix_total","prix_m2","dpe","annee"];
    const rows = data.map(t => [
      t.date_mutation,
      t.commune || "",
      t.code_commune ? t.code_commune.slice(0,2) : "",
      t.type_local || "",
      t.surface_reelle_bati ?? "",
      t.nombre_pieces ?? "",
      t.valeur_fonciere ?? "",
      fmtPrixM2(t.valeur_fonciere, t.surface_reelle_bati) ?? "",
      t.classe_energie || "",
      t.source_annee || "",
    ].map(v => `"${v}"`).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `homepedia_transactions_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const currentPage = Math.floor(offset / PER_PAGE) + 1;
  const totalPages  = Math.ceil(total / PER_PAGE);

  const PaginationBar = ({ compact = false }) => (
    <div className={`flex items-center justify-between px-5 ${compact ? "py-2" : "py-3"}`}
      style={{ background: "rgba(15,22,36,0.6)", borderTop: compact ? "none" : "1px solid rgba(30,41,59,0.6)", borderBottom: compact ? "1px solid rgba(30,41,59,0.6)" : "none" }}>
      <span className="text-xs text-slate-500 mono-nums">
        {total > 0
          ? <>Page <span className="text-slate-300 font-semibold">{currentPage}</span>/<span className="text-slate-300 font-semibold">{totalPages}</span> · <span className="text-slate-300 font-semibold">{total.toLocaleString("fr-FR")}</span> résultats</>
          : "Aucun résultat"}
      </span>
      <div className="flex items-center gap-1.5">
        <button onClick={() => setOffset(0)} disabled={offset === 0}
          className="p-1.5 rounded-lg border border-slate-700/50 bg-slate-800/50 disabled:opacity-30 hover:border-primary/40 transition-colors">
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>first_page</span>
        </button>
        <button onClick={() => setOffset(o => Math.max(0, o - PER_PAGE))} disabled={offset === 0}
          className="p-1.5 rounded-lg border border-slate-700/50 bg-slate-800/50 disabled:opacity-30 hover:border-primary/40 transition-colors">
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chevron_left</span>
        </button>
        {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
          let p;
          if (totalPages <= 7) p = i + 1;
          else if (currentPage <= 4) p = i + 1;
          else if (currentPage >= totalPages - 3) p = totalPages - 6 + i;
          else p = currentPage - 3 + i;
          return (
            <button key={p} onClick={() => setOffset((p-1)*PER_PAGE)}
              className="w-8 h-8 rounded-lg text-xs font-bold transition-all"
              style={{
                background: p === currentPage ? "#3c83f6" : "rgba(30,41,59,0.5)",
                color: p === currentPage ? "white" : "#64748b",
                border: p === currentPage ? "1px solid #3c83f6" : "1px solid rgba(30,41,59,0.5)",
              }}>
              {p}
            </button>
          );
        })}
        <button onClick={() => setOffset(o => Math.min((totalPages-1)*PER_PAGE, o + PER_PAGE))} disabled={currentPage === totalPages || totalPages === 0}
          className="p-1.5 rounded-lg border border-slate-700/50 bg-slate-800/50 disabled:opacity-30 hover:border-primary/40 transition-colors">
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chevron_right</span>
        </button>
        <button onClick={() => setOffset((totalPages-1)*PER_PAGE)} disabled={currentPage === totalPages || totalPages === 0}
          className="p-1.5 rounded-lg border border-slate-700/50 bg-slate-800/50 disabled:opacity-30 hover:border-primary/40 transition-colors">
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>last_page</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 lg:px-10 flex flex-col gap-5"
      style={{ background: "rgba(8,13,24,1)" }}>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Transactions DVF</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {loading
              ? "Chargement…"
              : <><span className="text-slate-200 font-semibold">{total.toLocaleString("fr-FR")}</span> transactions en Île-de-France
                {hasFilters && <span className="text-primary ml-1">· filtres actifs</span>}</>
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setFiltersOpen(f => !f)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all"
            style={{
              background: filtersOpen ? "rgba(60,131,246,0.2)" : "rgba(22,32,48,0.8)",
              border: `1px solid ${filtersOpen ? "rgba(60,131,246,0.5)" : "rgba(60,131,246,0.15)"}`,
              color: filtersOpen ? "#3c83f6" : "#94a3b8",
            }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>tune</span>
            Filtres
            {hasFilters && <span className="bg-primary text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center">!</span>}
          </button>
          <button onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: "rgba(60,131,246,0.2)", border: "1px solid rgba(60,131,246,0.3)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
            CSV
          </button>
        </div>
      </div>

      {/* ── FILTRES ────────────────────────────────────────────────────────── */}
      {filtersOpen && (
        <div className="rounded-xl p-4" style={{ background: "rgba(22,32,48,0.8)", border: "1px solid rgba(60,131,246,0.15)" }}>
          <div className="flex flex-wrap gap-4 items-end">
            <FilterSelect label="Département" icon="location_city" value={dept} onChange={setDept}
              options={[{ value: "", label: "Tous les départements" }, ...DEPTS_IDF.map(d => ({ value: d.code, label: d.label }))]} />
            <FilterSelect label="Type de bien" icon="home" value={typeFilter} onChange={setTypeFilter}
              options={[
                { value: "", label: "Tous les types" },
                { value: "Appartement", label: "Appartement" },
                { value: "Maison", label: "Maison" },
                { value: "Local industriel. commercial ou assimilé", label: "Local commercial" },
                { value: "Dépendance", label: "Dépendance" },
              ]} />
            <FilterSelect label="Année" icon="calendar_month" value={annee} onChange={setAnnee}
              options={[{ value: "", label: "Toutes les années" }, ...[2025,2024,2023,2022,2021,2020].map(y => ({ value: y, label: y }))]} />
            <FilterSelect label="Classe DPE" icon="bolt" value={dpe} onChange={setDpe}
              options={[{ value: "", label: "Toutes classes" }, ...["A","B","C","D","E","F","G"].map(l => ({ value: l, label: `DPE ${l}` }))]} />
            <FilterInput label="Prix min (€)" icon="euro" value={prixMin} onChange={setPrixMin} placeholder="ex: 100000" />
            <FilterInput label="Prix max (€)" icon="euro" value={prixMax} onChange={setPrixMax} placeholder="ex: 1000000" />
            <FilterInput label="Surface min (m²)" icon="square_foot" value={surfMin} onChange={setSurfMin} placeholder="ex: 30" />
            <FilterInput label="Surface max (m²)" icon="square_foot" value={surfMax} onChange={setSurfMax} placeholder="ex: 150" />
            <FilterInput label="Nb pièces" icon="meeting_room" value={pieces} onChange={setPieces} placeholder="ex: 3" />
            {hasFilters && (
              <button onClick={resetFilters}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-colors self-end mb-0.5">
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
                Réinitialiser
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── STATS ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon="euro" label="Prix moyen/m²"
          value={avgM2 ? `${avgM2.toLocaleString("fr-FR")} €` : "—"}
          sub="sur les transactions avec surface"
          color="#3c83f6" />
        <StatCard icon="account_balance_wallet" label="Volume affiché"
          value={totalVol > 0 ? (totalVol >= 1e9 ? `${(totalVol/1e9).toFixed(2)}Md€` : `${(totalVol/1e6).toFixed(1)}M€`) : "—"}
          sub={`sur ${data.length} transactions affichées`}
          color="#10b981" />
        <StatCard icon="bar_chart" label="Type dominant"
          value={topType ? topType[0] : "—"}
          sub={topType ? `${Math.round(topType[1]/data.length*100)}% des ventes affichées` : ""}
          color="#f59e0b" />
        <StatCard icon="bolt" label="Couverture DPE"
          value={data.length ? `${dpePct}%` : "—"}
          sub={`${dpeCount} transactions avec classe énergie`}
          color="#a78bfa" />
      </div>

      {/* ── TABLEAU ────────────────────────────────────────────────────────── */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(60,131,246,0.12)" }}>
        {!loading && total > PER_PAGE && <PaginationBar compact />}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr style={{ background: "rgba(22,32,48,0.9)", borderBottom: "1px solid rgba(60,131,246,0.12)" }}>
                {[
                  { key: "date_mutation",       label: "Date",     align: "left"  },
                  { key: null,                   label: "Commune",  align: "left"  },
                  { key: null,                   label: "Type",     align: "left"  },
                  { key: "surface_reelle_bati",  label: "Surface",  align: "right" },
                  { key: "valeur_fonciere",      label: "Prix",     align: "right" },
                  { key: "prix_m2",              label: "€/m²",     align: "right" },
                  { key: null,                   label: "DPE",      align: "center"},
                  { key: null,                   label: "",         align: "right" },
                ].map(({ key, label, align }) => (
                  <th key={label}
                    onClick={key ? () => handleSort(key) : undefined}
                    className={`px-5 py-3.5 text-[10px] font-bold uppercase tracking-widest text-slate-400
                      ${align === "right" ? "text-right" : align === "center" ? "text-center" : ""}
                      ${key ? "cursor-pointer hover:text-slate-200 select-none" : ""}`}>
                    <span className="flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}">
                      {label}
                      {key && <SortIcon col={key} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-16 text-slate-500">
                  <span className="material-symbols-outlined animate-spin block mb-2" style={{ fontSize: 28 }}>progress_activity</span>
                  Chargement…
                </td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-16 text-slate-500">
                  <span className="material-symbols-outlined block mb-2 text-slate-700" style={{ fontSize: 36 }}>search_off</span>
                  Aucune transaction pour ces critères
                </td></tr>
              ) : data.map((t, i) => {
                const prixM2 = fmtPrixM2(t.valeur_fonciere, t.surface_reelle_bati);
                const commune = t.commune || `${t.code_commune || "—"}`;
                const dpeColor = t.classe_energie ? DPE_HEX[t.classe_energie] : null;
                const isEven = i % 2 === 0;
                return (
                  <tr key={t.id || i}
                    className="group transition-colors"
                    style={{
                      background: isEven ? "rgba(15,22,36,0.5)" : "rgba(22,32,48,0.3)",
                      borderBottom: "1px solid rgba(30,41,59,0.4)",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(60,131,246,0.06)"}
                    onMouseLeave={e => e.currentTarget.style.background = isEven ? "rgba(15,22,36,0.5)" : "rgba(22,32,48,0.3)"}>

                    {/* Date */}
                    <td className="px-5 py-3 whitespace-nowrap">
                      <span className="text-[11px] mono-nums text-slate-400">{fmtDate(t.date_mutation, t.source_annee)}</span>
                      {t.source_annee && <span className="text-[9px] text-slate-600 block">{t.source_annee}</span>}
                    </td>

                    {/* Commune */}
                    <td className="px-5 py-3 max-w-[200px]">
                      <span className="text-sm font-medium text-slate-200 truncate block">{commune}</span>
                      {t.code_commune && (
                        <span className="text-[9px] mono-nums text-slate-600">{t.code_commune} · {t.code_commune.slice(0,2)}</span>
                      )}
                    </td>

                    {/* Type + pièces */}
                    <td className="px-5 py-3">
                      <span className="text-[11px] px-2 py-0.5 rounded font-medium"
                        style={{ background: "rgba(60,131,246,0.1)", color: "#94a3b8", border: "1px solid rgba(60,131,246,0.15)" }}>
                        {t.type_local || "—"}
                      </span>
                      {t.nombre_pieces && (
                        <span className="text-[9px] text-slate-600 block mt-0.5">T{t.nombre_pieces}</span>
                      )}
                    </td>

                    {/* Surface */}
                    <td className="px-5 py-3 text-right">
                      <span className="text-sm mono-nums text-slate-300">
                        {t.surface_reelle_bati ? `${t.surface_reelle_bati.toFixed(0)} m²` : "—"}
                      </span>
                    </td>

                    {/* Prix total */}
                    <td className="px-5 py-3 text-right">
                      <span className="text-sm font-bold mono-nums text-primary">
                        {fmtPrix(t.valeur_fonciere)}
                      </span>
                    </td>

                    {/* Prix/m² */}
                    <td className="px-5 py-3 text-right">
                      {prixM2
                        ? <span className="text-sm mono-nums text-slate-400">{prixM2} €</span>
                        : <span className="text-slate-700">—</span>
                      }
                    </td>

                    {/* DPE */}
                    <td className="px-5 py-3 text-center">
                      {dpeColor
                        ? <span className="text-[10px] font-black px-2 py-0.5 rounded"
                            style={{ background: dpeColor + "20", color: dpeColor, border: `1px solid ${dpeColor}50` }}>
                            {t.classe_energie}
                          </span>
                        : <span className="text-slate-700 text-xs">—</span>
                      }
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {/* Lien commune → scores */}
                        {t.code_commune && (
                          <button
                            onClick={() => navigate(`/carte?commune=${t.code_commune}`)}
                            title="Voir les scores de la commune"
                            className="p-1 rounded-lg hover:bg-slate-700/50 text-slate-500 hover:text-emerald-400 transition-colors">
                            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>analytics</span>
                          </button>
                        )}
                        {/* Lien carte */}
                        <button
                          onClick={() => {
                            if (t.longitude && t.latitude)
                              navigate(`/carte?lat=${t.latitude}&lng=${t.longitude}&zoom=17`);
                            else if (t.code_commune)
                              navigate(`/carte?commune=${t.code_commune}`);
                          }}
                          title="Voir sur la carte"
                          className="p-1 rounded-lg hover:bg-slate-700/50 text-slate-500 hover:text-primary transition-colors">
                          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>map</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── PAGINATION BAS ─────────────────────────────────────────────── */}
        <PaginationBar />
      </div>

      <div className="h-2" />
    </div>
  );
}
