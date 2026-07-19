import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { isFavorite, addFavorite, removeFavorite } from "../utils/favorites.js";
import { useCommunes } from "../contexts/CommunesContext.jsx";

// ── Utilitaires ───────────────────────────────────────────────────────────────

function fmt(v, decimals = 0) {
  if (v == null) return "—";
  return Number(v).toLocaleString("fr-FR", { maximumFractionDigits: decimals });
}

function fmtEur(v) {
  if (v == null) return "—";
  return Number(v).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

// ── Comparaison d'une métrique ────────────────────────────────────────────────

function MetricRow({ label, valA, valB, higherIsBetter = true, format = fmt, suffix = "" }) {
  const a = valA != null ? Number(valA) : null;
  const b = valB != null ? Number(valB) : null;
  if (a == null && b == null) return null;
  const max = Math.max(a ?? 0, b ?? 0) || 1;

  const winA = a != null && b != null && (higherIsBetter ? a > b : a < b);
  const winB = a != null && b != null && (higherIsBetter ? b > a : b < a);

  return (
    <div className="grid grid-cols-[1fr_200px_1fr] gap-4 items-center py-2.5 border-b border-slate-800/60 last:border-0">
      {/* Colonne A */}
      <div className="flex flex-col items-end gap-1">
        <span className={`text-sm font-bold ${winA ? "text-emerald-400" : "text-slate-200"}`}>
          {a != null ? format(a) + suffix : "—"}
          {winA && <span className="ml-1 text-emerald-400">▲</span>}
        </span>
        <div className="w-full flex justify-end">
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden" style={{ width: 120 }}>
            {a != null && (
              <div
                className={`h-full rounded-full transition-all duration-500 ${winA ? "bg-emerald-500" : "bg-blue-500/60"}`}
                style={{ width: `${Math.min(100, Math.max(0, Math.round((a / max) * 100)))}%` }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Label central */}
      <div className="text-center text-xs text-slate-400 font-medium leading-tight">{label}</div>

      {/* Colonne B */}
      <div className="flex flex-col items-start gap-1">
        <span className={`text-sm font-bold ${winB ? "text-emerald-400" : "text-slate-200"}`}>
          {winB && <span className="mr-1 text-emerald-400">▲</span>}
          {b != null ? format(b) + suffix : "—"}
        </span>
        <div className="w-full">
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden" style={{ width: 120 }}>
            {b != null && (
              <div
                className={`h-full rounded-full transition-all duration-500 ${winB ? "bg-emerald-500" : "bg-violet-500/60"}`}
                style={{ width: `${Math.min(100, Math.max(0, Math.round((b / max) * 100)))}%` }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Score radar simple ────────────────────────────────────────────────────────

function ScoreBar({ label, val, color }) {
  const pct = val != null ? Math.min(Math.max(Number(val), 0), 100) : 0;
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-xs text-slate-400 w-28 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-bold text-slate-200 w-12 text-right">{val != null ? `${Number(val).toFixed(0)}/100` : "—"}</span>
    </div>
  );
}

// ── Recherche commune (autocomplete) ─────────────────────────────────────────

function CommuneSearch({ label, color, value, onSelect }) {
  const [query, setQuery] = useState(value?.city || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounce = useRef(null);
  const ref = useRef(null);

  useEffect(() => {
    if (value) setQuery(value.city || "");
  }, [value]);

  const search = useCallback((q) => {
    if (q.length < 2) { setResults([]); return; }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await axios.get(`/api/v1/communes/agregat?limit=8`, {
          params: { departement: "" }
        });
        // Filtre côté client car l'endpoint agregat n'a pas de param q
        const filtered = (data.data || []).filter(c =>
          (c.nom || c.city)?.toLowerCase().includes(q.toLowerCase())
        ).slice(0, 8);
        setResults(filtered);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, []);

  const handleSelect = (commune) => {
    setQuery(commune.nom || commune.city);
    setOpen(false);
    setResults([]);
    onSelect(commune);
  };

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <p className={`text-xs font-bold uppercase tracking-wider mb-2 ${color}`}>{label}</p>
      <div className="relative">
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" style={{ fontSize: 16 }}>
          {loading ? "sync" : "search"}
        </span>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); search(e.target.value); }}
          onFocus={() => query.length >= 2 && results.length > 0 && setOpen(true)}
          className="w-full bg-slate-800/60 border border-slate-700/60 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
          placeholder="Nom de commune..."
        />
        {query && (
          <button onClick={() => { setQuery(""); onSelect(null); setResults([]); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl overflow-hidden shadow-2xl z-50"
          style={{ background: "#0f1724", border: "1px solid rgba(60,131,246,0.3)" }}>
          {results.map((c) => (
            <button key={c.code_commune} onMouseDown={() => handleSelect(c)}
              className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-blue-500/10 border-b border-slate-800/40 last:border-0 transition-colors">
              <span className="material-symbols-outlined text-slate-500" style={{ fontSize: 14 }}>location_city</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-100 truncate">{c.nom || c.city}</p>
                <p className="text-[11px] text-slate-500">{c.code_commune} · Dép. {c.code_departement}</p>
              </div>
              {(c.prix_m2_median ?? c.prix_median_m2) != null && (
                <span className="text-xs text-blue-400 shrink-0">{fmt(c.prix_m2_median ?? c.prix_median_m2)} €/m²</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Bloc d'en-tête commune ────────────────────────────────────────────────────

function CommuneHeader({ data, color, side }) {
  const navigate = useNavigate();
  const [fav, setFav] = useState(() => data ? isFavorite(data.code_commune) : false);

  const toggleFav = () => {
    if (!data) return;
    if (fav) { removeFavorite(data.code_commune); setFav(false); }
    else      { addFavorite(data); setFav(true); }
  };

  if (!data) {
    return (
      <div className={`flex-1 rounded-2xl border border-dashed border-slate-700 p-6 flex flex-col items-center justify-center gap-3 min-h-[140px] ${side === "left" ? "mr-2" : "ml-2"}`}>
        <span className="material-symbols-outlined text-slate-600" style={{ fontSize: 36 }}>location_city</span>
        <p className="text-slate-500 text-sm">Sélectionnez une commune</p>
      </div>
    );
  }
  return (
    <div className={`flex-1 rounded-2xl p-5 ${side === "left" ? "mr-2" : "ml-2"}`}
      style={{ background: "rgba(30,41,59,0.7)", border: `1px solid ${color === "text-blue-400" ? "rgba(59,130,246,0.4)" : "rgba(139,92,246,0.4)"}` }}>
      <div className="flex items-start justify-between mb-1">
        <p className={`text-xs font-bold uppercase tracking-wider ${color}`}>{side === "left" ? "Commune A" : "Commune B"}</p>
        <button onClick={toggleFav}
          title={fav ? "Retirer des favoris" : "Ajouter aux favoris"}
          className={`size-7 rounded-lg flex items-center justify-center transition-all -mt-0.5 -mr-0.5 ${
            fav ? "text-red-400 bg-red-500/15" : "text-slate-600 hover:text-red-400 hover:bg-red-500/10"
          }`}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, fontVariationSettings: fav ? "'FILL' 1" : "'FILL' 0" }}>favorite</span>
        </button>
      </div>
      <h2 className="text-xl font-bold text-slate-100">{data.nom || data.city}</h2>
      <p className="text-xs text-slate-400 mt-0.5">Code INSEE {data.code_commune || data.code_insee} · Dép. {data.code_departement || data.departement}</p>
      <div className="flex gap-4 mt-3 flex-wrap">
        {data.population_totale && (
          <div><p className="text-[10px] text-slate-500 uppercase">Population</p><p className="text-sm font-bold text-slate-200">{fmt(data.population_totale)}</p></div>
        )}
        {data.surface_km2 && (
          <div><p className="text-[10px] text-slate-500 uppercase">Surface</p><p className="text-sm font-bold text-slate-200">{fmt(data.surface_km2, 1)} km²</p></div>
        )}
        {data.prix_median_m2 && (
          <div><p className="text-[10px] text-slate-500 uppercase">Prix médian/m²</p><p className="text-sm font-bold text-blue-400">{fmt(data.prix_median_m2)} €</p></div>
        )}
      </div>
      {data.prix_median_m2 && (
        <button
          onClick={() => {
            const prixTotal = Math.round(data.prix_median_m2 * 50);
            const params = new URLSearchParams({ prix: prixTotal, commune: data.nom || data.city || '' });
            if (data.loyer_median_m2) params.set('loyer', Math.round(data.loyer_median_m2 * 50));
            navigate(`/portfolio?${params.toString()}`);
          }}
          className="mt-3 w-full py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all hover:brightness-110"
          style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#10b981" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>savings</span>
          Simuler l'investissement
        </button>
      )}
    </div>
  );
}

// ── Top communes suggérées ─────────────────────────────────────────────────────

const TOP_CRITERIA = [
  {
    key: "investissement",
    label: "Meilleur investissement",
    icon: "trending_up",
    color: "#3c83f6",
    sort: c => -(c.score_investissement ?? -999),
    badge: c => c.score_investissement != null ? `Score ${Math.round(c.score_investissement)}/100` : null,
    sub: c => { const p = c.prix_m2_median ?? c.prix_median_m2; return p != null ? `${fmt(p)} €/m²` : null; },
  },
  {
    key: "qualite_vie",
    label: "Qualité de vie",
    icon: "favorite",
    color: "#10b981",
    sort: c => -(c.score_qualite_vie ?? -999),
    badge: c => c.score_qualite_vie != null ? `Score ${Math.round(c.score_qualite_vie)}/100` : null,
    sub: c => c.ips_moyen != null ? `IPS ${c.ips_moyen.toFixed(0)}` : null,
  },
  {
    key: "prix_accessible",
    label: "Prix accessibles",
    icon: "savings",
    color: "#f59e0b",
    sort: c => (c.prix_m2_median ?? c.prix_median_m2 ?? 999999),
    badge: c => { const p = c.prix_m2_median ?? c.prix_median_m2; return p != null ? `${fmt(p)} €/m²` : null; },
    sub: c => c.nb_transactions != null ? `${fmt(c.nb_transactions)} transactions` : null,
  },
  {
    key: "liquidite",
    label: "Marché liquide",
    icon: "swap_horiz",
    color: "#a78bfa",
    sort: c => -(c.nb_transactions ?? -999),
    badge: c => c.nb_transactions != null ? `${fmt(c.nb_transactions)} ventes` : null,
    sub: c => { const p = c.prix_m2_median ?? c.prix_median_m2; return p != null ? `${fmt(p)} €/m²` : null; },
  },
  {
    key: "securite",
    label: "Plus sûres",
    icon: "shield",
    color: "#34d399",
    sort: c => -(c.score_securite ?? -999),
    badge: c => c.score_securite != null ? `Score ${Math.round(c.score_securite)}/100` : null,
    sub: c => c.taux_cambriolages != null ? `${c.taux_cambriolages.toFixed(1)} ‰ camb.` : null,
  },
  {
    key: "rendement",
    label: "Meilleur rendement",
    icon: "account_balance",
    color: "#10b981",
    sort: c => -(c.rendement_locatif_brut ?? -999),
    badge: c => c.rendement_locatif_brut != null ? `${c.rendement_locatif_brut.toFixed(2)}% brut` : null,
    sub: c => c.loyer_median_m2 != null ? `${c.loyer_median_m2.toFixed(1)} €/m²/mois` : null,
  },
];

function TopCommunesPanel({ communes, onSelectA, onSelectB, communeA, communeB }) {
  const [activeTab, setActiveTab] = useState("investissement");

  if (!communes || communes.length === 0) return null;

  const criterion = TOP_CRITERIA.find(c => c.key === activeTab);
  const top5 = [...communes]
    .filter(c => {
      const v = criterion.sort(c);
      return v !== 999999 && v !== 999 && (c.nom || c.city);
    })
    .sort((a, b) => criterion.sort(a) - criterion.sort(b))
    .slice(0, 5);

  return (
    <div className="rounded-2xl shrink-0" style={{ background: "rgba(15,23,36,0.9)", border: "1px solid rgba(60,131,246,0.15)", overflow: "hidden" }}>
      {/* Titre */}
      <div className="px-5 py-4 border-b border-slate-800/60">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-blue-400" style={{ fontSize: 18 }}>workspace_premium</span>
          <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Top communes IDF</h2>
          <span className="ml-2 text-[10px] text-slate-500">Cliquez pour sélectionner directement</span>
        </div>
      </div>

      {/* Onglets */}
      <div className="flex gap-1 p-3 border-b border-slate-800/60 overflow-x-auto">
        {TOP_CRITERIA.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${activeTab === tab.key ? "text-white" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"}`}
            style={activeTab === tab.key ? { background: tab.color + "25", border: `1px solid ${tab.color}50`, color: tab.color } : { border: "1px solid transparent" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Résultats */}
      <div className="overflow-x-auto">
      <div className="p-3 grid grid-cols-5 gap-2 min-w-[380px]">
        {top5.length === 0 ? (
          <div className="col-span-5 text-center py-4 text-slate-500 text-xs">Aucune donnée pour ce critère</div>
        ) : top5.map((c, i) => {
          const badge = criterion.badge(c);
          const sub = criterion.sub(c);
          const isA = communeA?.code_commune === c.code_commune;
          const isB = communeB?.code_commune === c.code_commune;
          return (
            <div key={c.code_commune} className="rounded-xl flex flex-col"
              style={{
                padding: "10px 10px 8px",
                background: isA ? "rgba(59,130,246,0.12)" : isB ? "rgba(139,92,246,0.12)" : "rgba(22,32,48,0.7)",
                border: `1px solid ${isA ? "rgba(59,130,246,0.4)" : isB ? "rgba(139,92,246,0.4)" : "rgba(60,131,246,0.1)"}`,
              }}>
              {/* Rang + badge sélection */}
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[11px] font-black rounded-full w-5 h-5 flex items-center justify-center shrink-0"
                  style={{ background: criterion.color + "22", color: criterion.color }}>
                  {i + 1}
                </span>
                {isA && <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ background: "rgba(59,130,246,0.2)", color: "#3c83f6" }}>A</span>}
                {isB && <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ background: "rgba(139,92,246,0.2)", color: "#a78bfa" }}>B</span>}
              </div>

              {/* Nom commune — priorité maximale */}
              <p className="text-[13px] font-bold text-white leading-tight mb-0.5">{c.nom || c.city}</p>
              <p className="text-[10px] text-slate-500 mb-2">Dép. {c.code_departement}</p>

              {/* Métrique principale */}
              {badge && (
                <p className="text-[11px] font-bold mb-0.5" style={{ color: criterion.color }}>{badge}</p>
              )}
              {sub && <p className="text-[10px] text-slate-500 mb-2">{sub}</p>}

              {/* Boutons */}
              <div className="flex gap-1 mt-auto pt-1">
                <button onClick={() => onSelectA(c)} disabled={isA}
                  className="flex-1 text-[10px] font-bold py-1 rounded-lg transition-all disabled:opacity-30 hover:opacity-80"
                  style={{ background: "rgba(59,130,246,0.18)", color: "#3c83f6", border: "1px solid rgba(59,130,246,0.3)" }}>
                  A
                </button>
                <button onClick={() => onSelectB(c)} disabled={isB}
                  className="flex-1 text-[10px] font-bold py-1 rounded-lg transition-all disabled:opacity-30 hover:opacity-80"
                  style={{ background: "rgba(139,92,246,0.18)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.3)" }}>
                  B
                </button>
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

// ── Section groupée ───────────────────────────────────────────────────────────

function Section({ title, icon, children }) {
  const visibleChildren = React.Children.toArray(children).filter(Boolean);
  if (visibleChildren.length === 0) return null;
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "rgba(15,23,36,0.8)", border: "1px solid rgba(60,131,246,0.1)" }}>
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-800/60">
        <span className="material-symbols-outlined text-blue-400" style={{ fontSize: 18 }}>{icon}</span>
        <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">{title}</h3>
      </div>
      <div className="px-5 py-3">{children}</div>
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function Comparer() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [communeA, setCommuneA] = useState(null);
  const [communeB, setCommuneB] = useState(null);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const { communes: allCommunes } = useCommunes();

  const loadFromCode = useCallback(async (code, setter, setLoading) => {
    if (!code) return;
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/v1/communes/${code}/agregat`);
      setter(data);
    } catch {
      setter(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Restaurer depuis URL params
  useEffect(() => {
    const a = searchParams.get("a");
    const b = searchParams.get("b");
    if (a) loadFromCode(a, setCommuneA, setLoadingA);
    if (b) loadFromCode(b, setCommuneB, setLoadingB);
  }, []);

  const handleSelectA = (c) => {
    if (c) {
      const code = c.code_insee || c.code_commune;
      setSearchParams(p => { p.set("a", code); return p; });
      loadFromCode(code, setCommuneA, setLoadingA);
    } else {
      setCommuneA(null);
      setSearchParams(p => { p.delete("a"); return p; });
    }
  };

  const handleSelectB = (c) => {
    if (c) {
      const code = c.code_insee || c.code_commune;
      setSearchParams(p => { p.set("b", code); return p; });
      loadFromCode(code, setCommuneB, setLoadingB);
    } else {
      setCommuneB(null);
      setSearchParams(p => { p.delete("b"); return p; });
    }
  };

  const A = communeA;
  const B = communeB;

  // Filtrage local pour l'autocomplete (on utilise allCommunes pré-chargées)
  const searchInAll = useCallback((query) => {
    if (!query || query.length < 2) return [];
    return allCommunes.filter(c => c.city?.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
  }, [allCommunes]);

  return (
    <div className="flex flex-col h-full overflow-auto bg-background-dark p-4 md:p-6 gap-4 md:gap-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-slate-100">Analyse comparative — Communes IDF</h1>
        <p className="text-xs md:text-sm text-slate-400 mt-1">Outil professionnel de comparaison : immobilier, qualité de vie, énergie, sécurité et scores d'investissement.</p>
      </div>

      {/* Sélecteurs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
        <CommuneSearchLocal
          label="Commune A"
          color="text-blue-400"
          value={communeA}
          communes={allCommunes}
          onSelect={handleSelectA}
        />
        <CommuneSearchLocal
          label="Commune B"
          color="text-violet-400"
          value={communeB}
          communes={allCommunes}
          onSelect={handleSelectB}
        />
      </div>

      {/* Top communes suggérées */}
      <TopCommunesPanel
        communes={allCommunes}
        onSelectA={handleSelectA}
        onSelectB={handleSelectB}
        communeA={communeA}
        communeB={communeB}
      />

      {/* En-têtes communes */}
      <div className="flex gap-0">
        {loadingA ? (
          <div className="flex-1 mr-2 rounded-2xl border border-slate-800 p-6 flex items-center justify-center">
            <span className="material-symbols-outlined animate-spin text-blue-400" style={{ fontSize: 28 }}>progress_activity</span>
          </div>
        ) : (
          <CommuneHeader data={A} color="text-blue-400" side="left" />
        )}
        <div className="flex items-center justify-center w-12 shrink-0">
          <div className="w-px h-full bg-slate-700/50" />
          <span className="absolute bg-slate-800 text-slate-400 text-xs font-bold px-2 py-1 rounded-full border border-slate-700">VS</span>
        </div>
        {loadingB ? (
          <div className="flex-1 ml-2 rounded-2xl border border-slate-800 p-6 flex items-center justify-center">
            <span className="material-symbols-outlined animate-spin text-violet-400" style={{ fontSize: 28 }}>progress_activity</span>
          </div>
        ) : (
          <CommuneHeader data={B} color="text-violet-400" side="right" />
        )}
      </div>

      {/* Comparaisons */}
      {(A || B) && (
        <div className="flex flex-col gap-4 overflow-x-auto">
          {/* Header colonnes */}
          <div className="grid grid-cols-[1fr_200px_1fr] gap-4 px-0">
            <div className="text-right">
              <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">
                {A?.city || "Commune A"}
              </span>
            </div>
            <div />
            <div>
              <span className="text-xs font-bold text-violet-400 uppercase tracking-wider">
                {B?.city || "Commune B"}
              </span>
            </div>
          </div>

          {/* Immobilier */}
          <Section title="Immobilier" icon="home">
            <MetricRow label="Prix médian/m²" valA={A?.prix_median_m2} valB={B?.prix_median_m2} higherIsBetter={false} format={fmt} suffix=" €" />
            <MetricRow label="Prix moyen/m²" valA={A?.prix_moyen_m2} valB={B?.prix_moyen_m2} higherIsBetter={false} format={fmt} suffix=" €" />
            <MetricRow label="Surface moyenne" valA={A?.surface_moyenne} valB={B?.surface_moyenne} higherIsBetter={true} format={(v) => fmt(v, 1)} suffix=" m²" />
            <MetricRow label="Prix médian transaction" valA={A?.prix_median_transaction} valB={B?.prix_median_transaction} higherIsBetter={false} format={fmtEur} />
            <MetricRow label="Nb transactions" valA={A?.nb_transactions} valB={B?.nb_transactions} higherIsBetter={true} format={fmt} />
          </Section>

          {/* Population */}
          <Section title="Population & Territoire" icon="groups">
            <MetricRow label="Population totale" valA={A?.population_totale} valB={B?.population_totale} higherIsBetter={true} format={fmt} />
            <MetricRow label="Densité pop. (hab/km²)" valA={A?.densite_pop_km2} valB={B?.densite_pop_km2} higherIsBetter={false} format={(v) => fmt(v, 0)} />
            <MetricRow label="Surface (km²)" valA={A?.surface_km2} valB={B?.surface_km2} higherIsBetter={true} format={(v) => fmt(v, 1)} />
          </Section>

          {/* Qualité de vie & POI */}
          <Section title="Qualité de vie & Équipements" icon="local_cafe">
            <MetricRow label="Total POI" valA={A?.nb_poi_total} valB={B?.nb_poi_total} higherIsBetter={true} format={fmt} />
            <MetricRow label="Transports" valA={A?.nb_transport} valB={B?.nb_transport} higherIsBetter={true} format={fmt} />
            <MetricRow label="Éducation" valA={A?.nb_education} valB={B?.nb_education} higherIsBetter={true} format={fmt} />
            <MetricRow label="Santé" valA={A?.nb_sante} valB={B?.nb_sante} higherIsBetter={true} format={fmt} />
            <MetricRow label="Commerce" valA={A?.nb_commerce} valB={B?.nb_commerce} higherIsBetter={true} format={fmt} />
            <MetricRow label="Restauration" valA={A?.nb_restauration} valB={B?.nb_restauration} higherIsBetter={true} format={fmt} />
            <MetricRow label="Parcs & espaces verts" valA={A?.nb_parcs} valB={B?.nb_parcs} higherIsBetter={true} format={fmt} />
            <MetricRow label="Bio / Bobo" valA={A?.nb_bio_bobo} valB={B?.nb_bio_bobo} higherIsBetter={true} format={fmt} />
          </Section>

          {/* Énergie & DPE */}
          <Section title="Énergie & DPE" icon="bolt">
            <MetricRow label="Score DPE moyen" valA={A?.score_dpe_moyen} valB={B?.score_dpe_moyen} higherIsBetter={false} format={(v) => fmt(v, 1)} />
            <MetricRow label="Conso. énergie moy." valA={A?.conso_energie_moyenne} valB={B?.conso_energie_moyenne} higherIsBetter={false} format={(v) => fmt(v, 0)} suffix=" kWh/m²" />
            <MetricRow label="Émissions GES moy." valA={A?.emission_ges_moyenne} valB={B?.emission_ges_moyenne} higherIsBetter={false} format={(v) => fmt(v, 1)} suffix=" kg CO₂/m²" />
            <MetricRow label="% DPE bons (A/B)" valA={A?.pct_dpe_bon} valB={B?.pct_dpe_bon} higherIsBetter={true} format={(v) => fmt(v, 1)} suffix=" %" />
            <MetricRow label="Conso. élec/logement" valA={A?.conso_elec_par_logement} valB={B?.conso_elec_par_logement} higherIsBetter={false} format={(v) => fmt(v, 1)} suffix=" MWh" />
            <MetricRow label="Conso. gaz/logement" valA={A?.conso_gaz_par_logement} valB={B?.conso_gaz_par_logement} higherIsBetter={false} format={(v) => fmt(v, 1)} suffix=" MWh" />
          </Section>

          {/* Sécurité */}
          <Section title="Sécurité" icon="local_police">
            <MetricRow label="Taux cambriolages (/1000)" valA={A?.taux_cambriolages} valB={B?.taux_cambriolages} higherIsBetter={false} format={(v) => fmt(v, 2)} />
            <MetricRow label="Taux vols & violence (/1000)" valA={A?.taux_vols_violence} valB={B?.taux_vols_violence} higherIsBetter={false} format={(v) => fmt(v, 2)} />
          </Section>

          {/* Rendement locatif */}
          {(A?.loyer_median_m2 != null || B?.loyer_median_m2 != null) && (
            <Section title="Rendement locatif" icon="account_balance">
              <MetricRow label="Loyer médian/m²/mois" valA={A?.loyer_median_m2} valB={B?.loyer_median_m2} higherIsBetter={true} format={(v) => fmt(v, 1)} suffix=" €" />
              <MetricRow label="Rendement brut annuel" valA={A?.rendement_locatif_brut} valB={B?.rendement_locatif_brut} higherIsBetter={true} format={(v) => fmt(v, 2)} suffix=" %" />
            </Section>
          )}

          {/* Éducation */}
          <Section title="Éducation & IPS" icon="school">
            <MetricRow label="IPS moyen" valA={A?.ips_moyen} valB={B?.ips_moyen} higherIsBetter={true} format={(v) => fmt(v, 1)} />
            <MetricRow label="% écoles favorisées" valA={A?.pct_ecoles_favorisees} valB={B?.pct_ecoles_favorisees} higherIsBetter={true} format={(v) => fmt(v, 1)} suffix=" %" />
            <MetricRow label="Nb écoles" valA={A?.nb_ecoles} valB={B?.nb_ecoles} higherIsBetter={true} format={fmt} />
          </Section>

          {/* Scores synthèse */}
          <div className="grid grid-cols-2 gap-4">
            {/* Scores A */}
            <div className="rounded-xl p-5" style={{ background: "rgba(15,23,36,0.8)", border: "1px solid rgba(59,130,246,0.2)" }}>
              <p className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-3">{A?.city || "Commune A"} — Scores synthèse</p>
              <ScoreBar label="Qualité de vie (30%)" val={A?.score_qualite_vie}    color="bg-emerald-500" />
              <ScoreBar label="Investissement (20%)" val={A?.score_investissement}  color="bg-blue-500" />
              <ScoreBar label="Accessibilité (20%)"  val={A?.score_accessibilite}  color="bg-cyan-500" />
              <ScoreBar label="Stabilité DPE (15%)"  val={A?.score_stabilite}      color="bg-amber-500" />
              <ScoreBar label="Sécurité (15%)"       val={A?.score_securite}       color="bg-violet-500" />
              {A?.score_global != null && (
                <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-semibold">Score global pondéré</span>
                  <span className="text-sm font-black text-white">{Math.round(A.score_global)}<span className="text-[10px] text-slate-500">/100</span></span>
                </div>
              )}
            </div>

            {/* Scores B */}
            <div className="rounded-xl p-5" style={{ background: "rgba(15,23,36,0.8)", border: "1px solid rgba(139,92,246,0.2)" }}>
              <p className="text-xs font-bold text-violet-400 uppercase tracking-wider mb-3">{B?.city || "Commune B"} — Scores synthèse</p>
              <ScoreBar label="Qualité de vie (30%)" val={B?.score_qualite_vie}    color="bg-emerald-500" />
              <ScoreBar label="Investissement (20%)" val={B?.score_investissement}  color="bg-blue-500" />
              <ScoreBar label="Accessibilité (20%)"  val={B?.score_accessibilite}  color="bg-cyan-500" />
              <ScoreBar label="Stabilité DPE (15%)"  val={B?.score_stabilite}      color="bg-amber-500" />
              <ScoreBar label="Sécurité (15%)"       val={B?.score_securite}       color="bg-violet-500" />
              {B?.score_global != null && (
                <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-semibold">Score global pondéré</span>
                  <span className="text-sm font-black text-white">{Math.round(B.score_global)}<span className="text-[10px] text-slate-500">/100</span></span>
                </div>
              )}
            </div>
          </div>
          <p className="text-[10px] text-slate-600 text-center">Les pourcentages indiquent la pondération de chaque critère dans le score global · chaque score est un percentile IDF 0-100</p>

          {/* Lien partage */}
          <div className="flex items-center gap-3 rounded-xl p-4" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.15)" }}>
            <span className="material-symbols-outlined text-blue-400" style={{ fontSize: 18 }}>share</span>
            <p className="text-xs text-slate-400">Partagez cette comparaison via l'URL — les communes sont sauvegardées dans les paramètres de la page.</p>
            <button
              onClick={() => navigator.clipboard.writeText(window.location.href)}
              className="ml-auto text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 px-3 py-1.5 rounded-lg transition-colors shrink-0"
            >
              Copier le lien
            </button>
          </div>
        </div>
      )}

      {!A && !B && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center py-16">
          <span className="material-symbols-outlined text-slate-600" style={{ fontSize: 56 }}>compare_arrows</span>
          <h2 className="text-lg font-bold text-slate-400">Sélectionnez deux communes ci-dessus</h2>
          <p className="text-sm text-slate-500 max-w-sm">Comparez les prix au m², la qualité de vie, l'énergie et la sécurité de n'importe quelle commune d'Île-de-France.</p>
        </div>
      )}
    </div>
  );
}

// ── Autocomplete local (filtre sur la liste pré-chargée) ──────────────────────

function CommuneSearchLocal({ label, color, value, communes, onSelect }) {
  const [query, setQuery] = useState(value?.city || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const debounce = useRef(null);

  useEffect(() => {
    if (value) setQuery(value.nom || value.city || "");
  }, [value?.nom, value?.city]);

  const search = (q) => {
    setQuery(q);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if (q.length < 2) { setResults([]); setOpen(false); return; }
      const filtered = communes.filter(c => (c.nom || c.city)?.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
      setResults(filtered);
      setOpen(filtered.length > 0);
    }, 150);
  };

  const handleSelect = (c) => {
    setQuery(c.city);
    setOpen(false);
    setResults([]);
    onSelect(c);
  };

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => { document.removeEventListener("mousedown", handler); clearTimeout(debounce.current); };
  }, []);

  return (
    <div className="relative" ref={ref}>
      <p className={`text-xs font-bold uppercase tracking-wider mb-2 ${color}`}>{label}</p>
      <div className="relative">
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" style={{ fontSize: 16 }}>search</span>
        <input
          value={query}
          onChange={e => search(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="w-full bg-slate-800/60 border border-slate-700/60 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
          placeholder="Rechercher une commune IDF..."
        />
        {query && (
          <button onClick={() => { setQuery(""); onSelect(null); setResults([]); setOpen(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl overflow-hidden shadow-2xl z-50"
          style={{ background: "#0f1724", border: "1px solid rgba(60,131,246,0.3)" }}>
          {results.map((c) => (
            <button key={c.code_commune} onMouseDown={() => handleSelect(c)}
              className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-blue-500/10 border-b border-slate-800/40 last:border-0 transition-colors">
              <span className="material-symbols-outlined text-slate-500" style={{ fontSize: 14 }}>location_city</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-100 truncate">{c.nom || c.city}</p>
                <p className="text-[11px] text-slate-500">{c.code_commune} · Dép. {c.code_departement}</p>
              </div>
              {(c.prix_m2_median ?? c.prix_median_m2) != null && (
                <span className="text-xs text-blue-400 shrink-0">{fmt(c.prix_m2_median ?? c.prix_median_m2)} €/m²</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
