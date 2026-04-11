import React, { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import axios from "axios";
import "maplibre-gl/dist/maplibre-gl.css";
import CesiumView3D from "./CesiumView3D";

// Coordonnées par code INSEE pour le flyTo
const COMMUNE_COORDS = {
  "75056": [2.3488, 48.8566],
  "92012": [2.2408, 48.8359],
  "92051": [2.2698, 48.8847],
  "93066": [2.4415, 48.8638],
  "94028": [2.4399, 48.8477],
  "78646": [2.1297, 48.8014],
  "91228": [2.4452, 48.6278],
  "77288": [2.6556, 48.5400],
  "95500": [2.0637, 49.0402],
  "92026": [2.2874, 48.8936],
};

const DPE_COLORS = {
  A: { bg: "bg-green-500",   text: "text-green-400",   ring: "ring-green-500/40"   },
  B: { bg: "bg-green-400",   text: "text-green-400",   ring: "ring-green-400/40"   },
  C: { bg: "bg-yellow-400",  text: "text-yellow-400",  ring: "ring-yellow-400/40"  },
  D: { bg: "bg-orange-400",  text: "text-orange-400",  ring: "ring-orange-400/40"  },
  E: { bg: "bg-orange-500",  text: "text-orange-500",  ring: "ring-orange-500/40"  },
  F: { bg: "bg-red-400",     text: "text-red-400",     ring: "ring-red-400/40"     },
  G: { bg: "bg-red-600",     text: "text-red-500",     ring: "ring-red-600/40"     },
};

// ─── Right Panel ───────────────────────────────────────────────────────────────
function RightPanel({ commune, transactions, agregat }) {
  // Prix médian — Gold agregat en priorité, fallback gold calculé, fallback client-side
  const prixMedian = agregat?.prix_median_m2
    ? Math.round(agregat.prix_median_m2)
    : commune?.prix_m2_median
      ? Math.round(commune.prix_m2_median)
      : (() => {
          const prices = transactions
            .filter(t => t.valeur_fonciere && t.surface_reelle_bati)
            .map(t => t.valeur_fonciere / t.surface_reelle_bati)
            .sort((a, b) => a - b);
          return prices.length ? Math.round(prices[Math.floor(prices.length / 2)]) : null;
        })();

  const dpePrincipal = commune?.dpe_dominant
    ?? Object.entries(
        transactions.reduce((acc, t) => {
          if (t.classe_energie) acc[t.classe_energie] = (acc[t.classe_energie] || 0) + 1;
          return acc;
        }, {})
       ).sort((a, b) => b[1] - a[1])[0]?.[0];

  const dpeStyle = dpePrincipal ? DPE_COLORS[dpePrincipal] : null;
  const nbTransactions = agregat?.nb_transactions ?? commune?.nb_transactions ?? transactions.length;
  const score = prixMedian ? Math.min(95, Math.max(25, Math.round(100 - prixMedian / 280))) : 82;
  const lastSales = transactions.slice(0, 4);

  if (!commune) return (
    <aside className="w-80 h-full flex-shrink-0 flex items-center justify-center"
      style={{ background: "rgba(16,23,34,0.7)", borderLeft: "1px solid rgba(60,131,246,0.1)" }}>
      <div className="text-center p-6">
        <span className="material-symbols-outlined text-primary/40 mb-3 block" style={{ fontSize: 40 }}>map</span>
        <p className="text-slate-400 text-sm">Sélectionnez une commune<br/>pour voir ses statistiques</p>
      </div>
    </aside>
  );

  return (
    <aside className="w-80 h-full flex-shrink-0 overflow-y-auto"
      style={{ background: "rgba(16,23,34,0.7)", backdropFilter: "blur(12px)", borderLeft: "1px solid rgba(60,131,246,0.1)" }}>
      <div className="p-6">

        {/* Header */}
        <header className="mb-6">
          <h2 className="text-sm font-bold text-primary mb-1">Détail Zone</h2>
          <h3 className="text-lg font-bold text-slate-100">{commune.nom}</h3>
          <p className="text-xs text-slate-400">Dept. {commune.departement?.trim()}
            {agregat?.population_totale ? ` · ${Math.round(agregat.population_totale / 1000)}k hab.` : ""}
            {agregat?.densite_pop_km2 ? ` · ${Math.round(agregat.densite_pop_km2).toLocaleString()} hab/km²` : ""}
          </p>
        </header>

        {/* Prix médian */}
        <div className="bg-slate-900/50 p-4 rounded-xl border border-primary/10 mb-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Prix Médian / m²</p>
          <div className="text-3xl font-bold mono-nums text-amber-400 mb-1">
            {prixMedian ? `${prixMedian.toLocaleString()} €` : "— €"}
          </div>
          {agregat?.prix_moyen_m2 && (
            <p className="text-[10px] text-slate-500">
              Moyen : {Math.round(agregat.prix_moyen_m2).toLocaleString()} €/m²
              {agregat?.surface_moyenne ? ` · Surface moy. ${Math.round(agregat.surface_moyenne)} m²` : ""}
            </p>
          )}
        </div>

        {/* 2-col grid — Transactions + DPE */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-slate-900/50 p-3 rounded-xl border border-primary/10 flex flex-col items-center">
            <span className="material-symbols-outlined text-primary mb-1" style={{ fontSize: 20 }}>handshake</span>
            <div className="text-xl font-bold mono-nums text-slate-100">{Number(nbTransactions).toLocaleString()}</div>
            <p className="text-[10px] text-slate-500 uppercase">Transactions</p>
          </div>
          <div className="bg-slate-900/50 p-3 rounded-xl border border-primary/10 flex flex-col items-center">
            <span className="material-symbols-outlined text-primary mb-1" style={{ fontSize: 20 }}>bolt</span>
            <div className={`text-xl font-bold mono-nums ${dpeStyle?.text || "text-slate-100"}`}>
              {dpePrincipal || "—"}
            </div>
            <p className="text-[10px] text-slate-500 uppercase">DPE Dominant</p>
          </div>
        </div>

        {/* DPE énergie détail */}
        {agregat?.score_dpe_moyen && (
          <div className="bg-slate-900/50 p-3 rounded-xl border border-primary/10 mb-4">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Performance Énergétique</p>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">Score DPE moyen</span>
              <span className="text-slate-200 font-bold mono-nums">{agregat.score_dpe_moyen.toFixed(1)} / 7</span>
            </div>
            {agregat.conso_energie_moyenne && (
              <div className="flex justify-between text-[11px] mt-1">
                <span className="text-slate-400">Conso énergie</span>
                <span className="text-slate-200 mono-nums">{Math.round(agregat.conso_energie_moyenne)} kWh/m²/an</span>
              </div>
            )}
            {agregat.emission_ges_moyenne && (
              <div className="flex justify-between text-[11px] mt-1">
                <span className="text-slate-400">Émissions GES</span>
                <span className="text-slate-200 mono-nums">{agregat.emission_ges_moyenne.toFixed(1)} kgCO₂/m²/an</span>
              </div>
            )}
            {agregat.pct_dpe_bon != null && (
              <div className="flex justify-between text-[11px] mt-1">
                <span className="text-slate-400">Biens classés A/B</span>
                <span className="text-green-400 font-bold mono-nums">{(agregat.pct_dpe_bon * 100).toFixed(1)} %</span>
              </div>
            )}
          </div>
        )}

        {/* POI — Équipements */}
        {agregat?.nb_poi_total > 0 && (
          <div className="bg-slate-900/50 p-3 rounded-xl border border-primary/10 mb-4">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Équipements ({Number(agregat.nb_poi_total).toLocaleString()} POI)</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {[
                { icon: "train", label: "Transports", val: agregat.nb_transport },
                { icon: "school", label: "Éducation",  val: agregat.nb_education },
                { icon: "local_hospital", label: "Santé",    val: agregat.nb_sante },
                { icon: "storefront", label: "Commerces", val: agregat.nb_commerce },
                { icon: "restaurant", label: "Restos",    val: agregat.nb_restauration },
                { icon: "park", label: "Parcs",     val: agregat.nb_parcs },
              ].map(({ icon, label, val }) => val > 0 && (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-primary/70" style={{ fontSize: 13 }}>{icon}</span>
                  <span className="text-[10px] text-slate-400">{label}</span>
                  <span className="text-[10px] font-bold text-slate-200 mono-nums ml-auto">{Number(val).toLocaleString()}</span>
                </div>
              ))}
            </div>
            {agregat.nb_bio_bobo > 0 && (
              <div className="mt-2 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-emerald-400/70" style={{ fontSize: 13 }}>eco</span>
                <span className="text-[10px] text-emerald-400">Gentrification</span>
                <span className="text-[10px] font-bold text-emerald-300 mono-nums ml-auto">{Number(agregat.nb_bio_bobo)} commerces bio/bobo</span>
              </div>
            )}
          </div>
        )}

        {/* Score investissement */}
        <div className="bg-slate-900/50 p-4 rounded-xl border border-primary/20 mb-4 flex items-center gap-4">
          <div className="relative shrink-0" style={{ width: 56, height: 56 }}>
            <svg className="-rotate-90" width="56" height="56" viewBox="0 0 56 56">
              <circle cx="28" cy="28" r="24" fill="transparent" stroke="#1e293b" strokeWidth="4" />
              <circle cx="28" cy="28" r="24" fill="transparent" stroke="#3c83f6" strokeWidth="4"
                strokeDasharray="150" strokeDashoffset={Math.round(150 - (score / 100) * 150)}
                strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-base font-black mono-nums text-slate-100">{score}</span>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-100">Score Investissement</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Indicateur composite</p>
          </div>
        </div>

        {/* Dernières ventes */}
        <div>
          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Dernières ventes</h4>
          {lastSales.length === 0
            ? <p className="text-xs text-slate-600 text-center py-2">Aucune transaction</p>
            : <div className="space-y-2">
              {lastSales.map((t, i) => {
                const prix = t.valeur_fonciere
                  ? t.valeur_fonciere >= 1e6
                    ? `${(t.valeur_fonciere / 1e6).toFixed(2)}M€`
                    : `${(t.valeur_fonciere / 1000).toFixed(0)}k€`
                  : "—";
                return (
                  <div key={t.id} className="flex items-center gap-3 p-2 rounded-lg"
                    style={{ border: "1px solid rgba(60,131,246,0.08)" }}>
                    <div className={`size-1.5 rounded-full shrink-0 ${i === 0 ? "bg-primary" : "bg-slate-600"}`} />
                    <div className="flex-1 min-w-0 flex items-center justify-between gap-1">
                      <span className="text-[11px] text-slate-300 truncate">
                        {t.type_local || "Bien"} · {t.surface_reelle_bati?.toFixed(0) ?? "?"}m²
                      </span>
                      <span className="text-[11px] font-bold text-primary mono-nums shrink-0">{prix}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          }
        </div>

      </div>
    </aside>
  );
}

// ─── Left Sidebar ──────────────────────────────────────────────────────────────
function LeftSidebar({ communes, transactions, selectedCommune, onSelectCommune, onSelectTransaction, search, onSearch,
  activeTypes, onToggleType, anneeMax, onAnneeChange, onReset, sortDesc, onToggleSort }) {
  const [showSuggestions, setShowSuggestions] = useState(false);

  const suggestions = search.length >= 1
    ? communes.filter(c => c.nom.toLowerCase().includes(search.toLowerCase()) || (c.code_postal || "").includes(search)).slice(0, 6)
    : [];

  return (
    <aside className="w-72 h-full flex-shrink-0 overflow-y-auto z-20"
      style={{ background: "rgba(16,23,34,0.85)", backdropFilter: "blur(12px)", borderRight: "1px solid rgba(60,131,246,0.1)" }}>
      <div className="p-5 flex flex-col gap-5">

        {/* Commune selector */}
        <div>
          <h3 className="text-[10px] font-bold text-primary uppercase tracking-widest mb-2">Commune</h3>

          {/* Selected pill */}
          {selectedCommune && (
            <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg"
              style={{ background: "rgba(60,131,246,0.12)", border: "1px solid rgba(60,131,246,0.3)" }}>
              <span className="material-symbols-outlined text-primary" style={{ fontSize: 16 }}>location_on</span>
              <span className="text-sm font-semibold text-slate-100 flex-1">{selectedCommune.nom}</span>
              <span className="text-[10px] mono-nums text-slate-400">{selectedCommune.code_postal}</span>
            </div>
          )}

          {/* Search + autocomplete */}
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" style={{ fontSize: 16 }}>search</span>
            <input
              value={search}
              onChange={e => { onSearch(e.target.value); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-lg py-2 pl-9 pr-3 text-sm focus:border-primary outline-none text-slate-100 placeholder:text-slate-600"
              placeholder="Chercher une commune..."
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-lg overflow-hidden z-50 shadow-xl"
                style={{ background: "#0f1724", border: "1px solid rgba(60,131,246,0.25)" }}>
                {suggestions.map(c => (
                  <button key={c.code_insee}
                    onMouseDown={() => { onSelectCommune(c); onSearch(""); setShowSuggestions(false); }}
                    className={`w-full text-left px-3 py-2.5 flex items-center justify-between hover:bg-primary/10 transition-colors text-xs ${
                      selectedCommune?.code_insee === c.code_insee ? "bg-primary/15 text-primary" : "text-slate-300"
                    }`}>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-slate-600" style={{ fontSize: 14 }}>location_city</span>
                      <span className="font-medium">{c.nom}</span>
                    </div>
                    <span className="text-slate-500 mono-nums">{c.code_postal}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Quick commune chips */}
          {!search && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {communes.slice(0, 5).map(c => (
                <button key={c.code_insee}
                  onClick={() => onSelectCommune(c)}
                  className={`px-2 py-1 rounded-full text-[10px] font-medium transition-colors ${
                    selectedCommune?.code_insee === c.code_insee
                      ? "bg-primary text-white"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 border border-slate-700"
                  }`}>
                  {c.nom.length > 12 ? c.nom.slice(0, 12) + "…" : c.nom}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Filtres */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-bold text-primary uppercase tracking-widest">Filtres</h3>
            <button onClick={onReset} className="text-[10px] text-slate-500 hover:text-primary underline">Réinitialiser</button>
          </div>
          <div className="space-y-2">
            {["Appartement", "Maison"].map(t => (
              <label key={t} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input type="checkbox" checked={activeTypes.has(t)} onChange={() => onToggleType(t)}
                  className="rounded border-slate-700 bg-slate-800 accent-primary size-4" />
                {t}
              </label>
            ))}
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-400">Année de vente</span>
              <span className="text-primary mono-nums">2019 – {anneeMax}</span>
            </div>
            <input type="range" min="2019" max="2024" value={anneeMax}
              onChange={e => onAnneeChange(Number(e.target.value))}
              className="w-full h-1 bg-slate-700 rounded-lg accent-primary cursor-pointer" />
          </div>
        </div>

        {/* Résultats */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-bold text-primary uppercase tracking-widest">
              Résultats <span className="text-slate-500">({transactions.length})</span>
            </h3>
            <button onClick={onToggleSort} title={sortDesc ? "Trier par prix croissant" : "Trier par prix décroissant"}
              className="material-symbols-outlined text-slate-500 hover:text-primary transition-colors" style={{ fontSize: 16 }}>
              {sortDesc ? "arrow_downward" : "arrow_upward"}
            </button>
          </div>

          {transactions.length === 0 ? (
            <div className="text-center py-6">
              <span className="material-symbols-outlined text-slate-700 block mb-1" style={{ fontSize: 28 }}>search_off</span>
              <p className="text-[11px] text-slate-600">{selectedCommune ? "Aucune transaction" : "Choisissez une commune"}</p>
            </div>
          ) : (
            transactions.slice(0, 8).map((t, i) => {
              const addr = [t.adresse_numero, t.adresse].filter(Boolean).join(" ").toUpperCase();
              const ppm = t.valeur_fonciere && t.surface_reelle_bati
                ? Math.round(t.valeur_fonciere / t.surface_reelle_bati).toLocaleString() : "—";
              const prix = t.valeur_fonciere
                ? t.valeur_fonciere >= 1e6 ? `${(t.valeur_fonciere / 1e6).toFixed(2)}M €` : `${(t.valeur_fonciere / 1000).toFixed(0)}k €`
                : "—";
              const info = `${t.surface_reelle_bati?.toFixed(0) ?? "?"}m² · T${t.nombre_pieces ?? "?"}`;
              const dpeS = t.classe_energie ? DPE_COLORS[t.classe_energie] : null;
              return (
                <div key={t.id}
                  onClick={() => onSelectTransaction(t)}
                  className={`p-3 rounded-lg cursor-pointer transition-all group ${
                    i === 0 ? "border border-primary/25" : "bg-slate-900/40 border border-slate-800 hover:border-primary/20"
                  }`}
                  style={i === 0 ? { background: "rgba(60,131,246,0.06)" } : {}}>
                  <div className="flex justify-between items-start mb-1.5">
                    <span className="text-[10px] mono-nums text-slate-400 truncate mr-2 flex-1">{addr || "—"}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {dpeS && <span className={`text-[8px] font-black px-1 rounded ${dpeS.text}`}>{t.classe_energie}</span>}
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${i === 0 ? "bg-green-500/20 text-green-400" : "bg-slate-800 text-slate-500"}`}>{t.source_annee}</span>
                    </div>
                  </div>
                  <div className="text-sm font-bold text-slate-100 mono-nums">{prix}</div>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-[10px] text-slate-500">{info}</span>
                    <span className={`text-[10px] mono-nums ${i === 0 ? "text-primary" : "text-slate-500 group-hover:text-primary"} transition-colors`}>€{ppm}/m²</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
const ANNEE_MIN = 2019;
const ANNEE_MAX = 2024;
const TYPES_ALL = ["Appartement", "Maison"];

export default function MapView() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markersRef = useRef([]);
  const highlightMarkerRef = useRef(null);
  const mapClickHandlerRef = useRef(null);
  const allCommunesRef = useRef([]);       // ref stable → accessible dans les handlers map
  const handleSelectRef = useRef(null);   // idem pour handleSelectCommune
  const navigate = useNavigate();
  const initialSelectDone = useRef(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const [allCommunes, setAllCommunes] = useState([]);
  const [communes, setCommunes] = useState([]);
  const [selectedCommune, setSelectedCommune] = useState(null);
  const [agregat, setAgregat] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [search, setSearch] = useState("");
  const [is3D, setIs3D] = useState(false);
  const [sortDesc, setSortDesc] = useState(true);
  const [adressePin, setAdressePin] = useState(null); // marqueur adresse recherchée
  const [cesiumInitCenter, setCesiumInitCenter] = useState(null);
  const [cesiumFlyTarget, setCesiumFlyTarget] = useState(null);

  // ── Filtres actifs ────────────────────────────────────────────────────────
  const [activeTypes, setActiveTypes] = useState(new Set(TYPES_ALL));
  const [anneeMax, setAnneeMax] = useState(ANNEE_MAX);
  const [mapClickLoading, setMapClickLoading] = useState(false); // spinner pendant géocodage

  useEffect(() => {
    axios.get("/api/v1/communes/gold?limit=1300").then(r => {
      if (r.data.data) { setAllCommunes(r.data.data); setCommunes(r.data.data); }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!search) { setCommunes(allCommunes); return; }
    const q = search.toLowerCase();
    setCommunes(allCommunes.filter(c => c.nom.toLowerCase().includes(q)));
  }, [search, allCommunes]);

  // Recharge les transactions quand commune ou filtres changent
  const loadAgregat = useCallback((commune) => {
    if (!commune?.code_insee) return;
    setAgregat(null); // reset immédiat pour éviter données stale
    // Paris arrondissements (75101-75120) → fallback sur Paris entier (75056)
    const code = commune.code_insee.startsWith("751") && commune.code_insee !== "75056"
      ? "75056"
      : commune.code_insee;
    axios.get(`/api/v1/communes/${code}/agregat`)
      .then(r => setAgregat(r.data))
      .catch(() => setAgregat(null));
  }, []);

  const loadTransactions = useCallback((commune, types, maxAnnee) => {
    if (!commune) return;
    const typeParam = types.size === 1 ? `&type_local=${[...types][0]}` : "";
    const anneeParam = maxAnnee < ANNEE_MAX ? `&annee=${maxAnnee}` : "";
    axios.get(`/api/v1/transactions?commune=${commune.code_insee}&limit=100${typeParam}${anneeParam}`).then(r => {
      const data = r.data.data || [];
      setTransactions(data);
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];

      // FlyTo : centroïde calculé depuis les coordonnées des transactions
      const withCoords = data.filter(t => t.longitude && t.latitude);
      if (withCoords.length && map.current) {
        const avgLon = withCoords.reduce((s, t) => s + t.longitude, 0) / withCoords.length;
        const avgLat = withCoords.reduce((s, t) => s + t.latitude, 0) / withCoords.length;
        map.current.flyTo({ center: [avgLon, avgLat], zoom: 13, duration: 900 });
      }

      data.forEach(t => {
        if (!t.longitude || !t.latitude) return;
        const el = document.createElement("div");
        el.style.cssText = "width:10px;height:10px;background:#3c83f6;border-radius:50%;border:2px solid rgba(255,255,255,0.6);cursor:pointer;box-shadow:0 0 8px rgba(60,131,246,0.7);transition:transform .15s";
        el.addEventListener("mouseenter", () => { el.style.transform = "scale(1.5)"; });
        el.addEventListener("mouseleave", () => { el.style.transform = "scale(1)"; });
        const dpeColors = { A:"#22c55e",B:"#4ade80",C:"#facc15",D:"#fb923c",E:"#f97316",F:"#ef4444",G:"#dc2626" };
        const prixM2Popup = t.valeur_fonciere && t.surface_reelle_bati ? Math.round(t.valeur_fonciere / t.surface_reelle_bati) : null;
        const popup = new maplibregl.Popup({ offset: 16, closeButton: false, maxWidth: "220px" })
          .setHTML(`<div style="font-family:Inter,sans-serif;min-width:180px">
            <div style="font-size:10px;color:#64748b;margin-bottom:6px;display:flex;align-items:center;gap:4px">
              <svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#3c83f6" opacity="0.4"/><circle cx="5" cy="5" r="2" fill="#3c83f6"/></svg>
              ${[t.adresse_numero, t.adresse].filter(Boolean).join(" ") || "—"}
            </div>
            <div style="font-size:22px;font-weight:900;color:#3c83f6;letter-spacing:-0.5px;line-height:1">
              ${t.valeur_fonciere ? (t.valeur_fonciere >= 1e6 ? (t.valeur_fonciere/1e6).toFixed(2)+"M €" : (t.valeur_fonciere/1000).toFixed(0)+"k €") : "—"}
            </div>
            <div style="height:1px;background:rgba(60,131,246,0.15);margin:8px 0"></div>
            <div style="display:flex;align-items:center;justify-content:space-between;font-size:10px">
              <span style="color:#94a3b8">${t.surface_reelle_bati || "?"}m² · ${t.type_local || "—"}</span>
              ${t.classe_energie ? `<span style="font-weight:900;font-size:11px;padding:1px 6px;border-radius:4px;background:${dpeColors[t.classe_energie]||"#64748b"}20;color:${dpeColors[t.classe_energie]||"#64748b"};border:1px solid ${dpeColors[t.classe_energie]||"#64748b"}50">DPE ${t.classe_energie}</span>` : ""}
            </div>
            ${prixM2Popup ? `<div style="font-size:10px;color:#475569;margin-top:4px">€${prixM2Popup.toLocaleString()}/m²</div>` : ""}
          </div>`);
        markersRef.current.push(new maplibregl.Marker(el).setLngLat([t.longitude, t.latitude]).setPopup(popup).addTo(map.current));
      });
    }).catch(() => {});
  }, []);

  const handleSelectCommune = useCallback((commune) => {
    setSelectedCommune(commune);
    loadTransactions(commune, activeTypes, anneeMax);
    loadAgregat(commune);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTransactions, loadAgregat, activeTypes, anneeMax]);

  // Garder les refs à jour pour les handlers enregistrés sur la carte
  useEffect(() => { allCommunesRef.current = allCommunes; }, [allCommunes]);
  useEffect(() => { handleSelectRef.current = handleSelectCommune; }, [handleSelectCommune]);

  const handleToggleType = (type) => {
    setActiveTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) { if (next.size > 1) next.delete(type); }
      else next.add(type);
      loadTransactions(selectedCommune, next, anneeMax);
      return next;
    });
  };

  const handleAnneeChange = (val) => {
    setAnneeMax(val);
    loadTransactions(selectedCommune, activeTypes, val);
  };

  const handleReset = () => {
    setActiveTypes(new Set(TYPES_ALL));
    setAnneeMax(ANNEE_MAX);
    loadTransactions(selectedCommune, new Set(TYPES_ALL), ANNEE_MAX);
  };

  const handleResetToIDF = useCallback(() => {
    setSelectedCommune(null);
    setTransactions([]);
    setAgregat(null);
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (map.current) {
      map.current.flyTo({ center: [2.3488, 48.85], zoom: 9, duration: 900 });
    }
  }, []);

  const handleSelectTransaction = useCallback((t) => {
    if (!t.longitude || !t.latitude || !map.current) return;
    map.current.flyTo({ center: [t.longitude, t.latitude], zoom: 17, duration: 700 });
    // open the matching marker popup
    const marker = markersRef.current.find(m => {
      const ll = m.getLngLat();
      return Math.abs(ll.lng - t.longitude) < 0.00001 && Math.abs(ll.lat - t.latitude) < 0.00001;
    });
    if (marker) {
      markersRef.current.forEach(m => { if (m.getPopup()?.isOpen()) m.togglePopup(); });
      marker.togglePopup();
    }
  }, []);

  // Auto-select Paris 15e à l'ouverture UNIQUEMENT (pas après un reset IDF)
  useEffect(() => {
    if (allCommunes.length && !initialSelectDone.current) {
      initialSelectDone.current = true;
      const paris15 = allCommunes.find(c => c.code_insee === "75115") || allCommunes[0];
      handleSelectCommune(paris15);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCommunes]);

  // FlyTo / sélection commune depuis les URL params
  useEffect(() => {
    const lat  = parseFloat(searchParams.get("lat"));
    const lng  = parseFloat(searchParams.get("lng"));
    const zoom = parseFloat(searchParams.get("zoom") || "16");
    const q    = searchParams.get("q");

    // Cas ?q=CommuneName sans coordonnées → sélectionner la commune depuis la liste
    if (q && !lat && !lng && allCommunes.length) {
      const found = allCommunes.find(c => c.nom.toLowerCase() === q.toLowerCase())
        || allCommunes.find(c => c.nom.toLowerCase().includes(q.toLowerCase()));
      if (found) {
        handleSelectCommune(found);
        const coords = COMMUNE_COORDS[found.code_insee];
        if (coords && map.current) map.current.flyTo({ center: coords, zoom: 13, duration: 900 });
      }
      setSearchParams({});
      return;
    }

    if (!lat || !lng || !map.current) return;

    map.current.flyTo({ center: [lng, lat], zoom, duration: 800 });

    // Propager vers Cesium si vue 3D active (ou au prochain basculement)
    setCesiumFlyTarget({ lng, lat, zoom });

    // Supprimer l'ancien pin adresse
    if (adressePin) adressePin.remove();

    // Créer un marqueur rouge pour l'adresse
    const el = document.createElement("div");
    el.style.cssText = "width:14px;height:14px;background:#ef4444;border-radius:50%;border:3px solid white;box-shadow:0 0 12px rgba(239,68,68,0.8);cursor:default";
    const popup = new maplibregl.Popup({ offset: 18, closeButton: false, maxWidth: "240px" })
      .setHTML(`<div style="font-family:Inter,sans-serif;font-size:12px;color:#e2e8f0;padding:2px 0">
        <div style="font-weight:700;margin-bottom:2px">${q || "Adresse recherchée"}</div>
        <div style="color:#64748b;font-size:10px">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
      </div>`);
    const pin = new maplibregl.Marker(el)
      .setLngLat([lng, lat])
      .setPopup(popup)
      .addTo(map.current);
    setAdressePin(pin);
    pin.togglePopup();

    // Nettoyer les params après usage
    setSearchParams({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, allCommunes]);

  useEffect(() => {
    if (map.current) return;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      center: [2.3488, 48.8534],
      zoom: 12,
    });
    map.current.addControl(new maplibregl.NavigationControl(), "bottom-right");

    // ── Chargement polygones IDF + hover ────────────────────────────────────
    map.current.on("load", async () => {
      try {
        const res = await fetch(
          "https://geo.api.gouv.fr/communes?codeRegion=11&geometry=contour&format=geojson&fields=nom,code"
        );
        const geojson = await res.json();
        if (!map.current) return;

        map.current.addSource("communes-geo", {
          type: "geojson",
          data: geojson,
          generateId: true,
        });

        // Fill hover
        map.current.addLayer({
          id: "communes-fill",
          type: "fill",
          source: "communes-geo",
          paint: {
            "fill-color": "#3778E2",
            "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.18, 0],
          },
        });

        // Bordure commune
        map.current.addLayer({
          id: "communes-border",
          type: "line",
          source: "communes-geo",
          paint: {
            "line-color": "#3778E2",
            "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 1.8, 0.25],
            "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.2],
          },
        });

        // Tooltip nom commune au hover
        const hoverPopup = new maplibregl.Popup({
          closeButton: false, closeOnClick: false, offset: 14,
          className: "commune-hover-tip",
        });

        let hoveredId = null;

        map.current.on("mousemove", "communes-fill", (e) => {
          if (!e.features?.length) return;
          map.current.getCanvas().style.cursor = "pointer";
          if (hoveredId !== null) {
            map.current.setFeatureState({ source: "communes-geo", id: hoveredId }, { hover: false });
          }
          hoveredId = e.features[0].id;
          map.current.setFeatureState({ source: "communes-geo", id: hoveredId }, { hover: true });
          hoverPopup
            .setLngLat(e.lngLat)
            .setHTML(`<span style="font-size:12px;font-weight:700;color:#e2e8f0">${e.features[0].properties.nom}</span>`)
            .addTo(map.current);
        });

        map.current.on("mouseleave", "communes-fill", () => {
          map.current.getCanvas().style.cursor = "";
          if (hoveredId !== null) {
            map.current.setFeatureState({ source: "communes-geo", id: hoveredId }, { hover: false });
          }
          hoveredId = null;
          hoverPopup.remove();
        });

        // Click sur le layer GeoJSON → sélection directe (plus rapide, sans géocodage)
        map.current.on("click", "communes-fill", (e) => {
          if (!e.features?.length) return;
          e.originalEvent._communeHandled = true; // évite double-traitement dans le handler générique
          const { code, nom } = e.features[0].properties;
          const found = allCommunesRef.current.find(c => c.code_insee === code)
            || allCommunesRef.current.find(c => c.nom.toLowerCase() === nom.toLowerCase());
          if (found && handleSelectRef.current) handleSelectRef.current(found);
        });

      } catch (err) {
        console.warn("GeoJSON IDF non chargé:", err);
      }
    });

    return () => { map.current?.remove(); map.current = null; };
  }, []);

  // ── Clic sur la carte → géocoder la commune ───────────────────────────────
  useEffect(() => {
    if (!map.current) return;

    // Dé-enregistrer l'ancien handler
    if (mapClickHandlerRef.current) {
      map.current.off("click", mapClickHandlerRef.current);
    }

    mapClickHandlerRef.current = async (e) => {
      // Ignorer si déjà traité par le layer GeoJSON ou un marqueur
      if (e.originalEvent?._communeHandled) return;
      if (e.originalEvent?.target?.closest?.(".maplibregl-marker, .maplibregl-popup")) return;

      const { lng, lat } = e.lngLat;

      // Marqueur surbrillance pulsant au point cliqué
      if (highlightMarkerRef.current) highlightMarkerRef.current.remove();
      const hlEl = document.createElement("div");
      hlEl.style.cssText = [
        "width:36px;height:36px;border-radius:50%;",
        "border:2px solid rgba(60,131,246,0.9);",
        "background:rgba(60,131,246,0.15);",
        "box-shadow:0 0 0 6px rgba(60,131,246,0.12),0 0 20px rgba(60,131,246,0.5);",
        "animation:pulse-ring 1.2s infinite;pointer-events:none;"
      ].join("");
      highlightMarkerRef.current = new maplibregl.Marker({ element: hlEl, anchor: "center" })
        .setLngLat([lng, lat])
        .addTo(map.current);

      setMapClickLoading(true);
      try {
        const res = await fetch(
          `https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lng}&fields=nom,code,codesPostaux&limit=1`
        );
        const json = await res.json();
        if (json[0]) {
          const { code, nom } = json[0];
          const found = allCommunes.find(c => c.code_insee === code)
            || allCommunes.find(c => c.nom.toLowerCase() === nom.toLowerCase());
          if (found) {
            handleSelectCommune(found);
            // Déplacer le highlight sur le centroïde connu de la commune
            const coords = COMMUNE_COORDS[found.code_insee];
            if (coords) highlightMarkerRef.current?.setLngLat(coords);
          }
        }
      } catch {}
      setMapClickLoading(false);
    };

    // Attendre que la carte soit prête avant d'écouter
    if (map.current.loaded()) {
      map.current.on("click", mapClickHandlerRef.current);
    } else {
      map.current.once("load", () => {
        map.current?.on("click", mapClickHandlerRef.current);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCommunes, handleSelectCommune]);

  const breadcrumb = selectedCommune
    ? ["Île-de-France", selectedCommune.nom, selectedCommune.code_postal]
    : ["Île-de-France"];

  return (
    <div className="flex h-full overflow-hidden">
      <LeftSidebar
        communes={communes}
        transactions={sortDesc ? [...transactions].sort((a,b) => (b.valeur_fonciere||0)-(a.valeur_fonciere||0)) : transactions}
        selectedCommune={selectedCommune}
        onSelectCommune={handleSelectCommune}
        onSelectTransaction={handleSelectTransaction}
        search={search}
        onSearch={setSearch}
        activeTypes={activeTypes}
        onToggleType={handleToggleType}
        anneeMax={anneeMax}
        onAnneeChange={handleAnneeChange}
        onReset={handleReset}
        sortDesc={sortDesc}
        onToggleSort={() => setSortDesc(v => !v)}
      />

      <div className="relative flex-1">
        {/* MapLibre 2D — toujours monté pour garder l'état, juste caché en mode 3D */}
        <div ref={mapContainer} className="w-full h-full" style={{ display: is3D ? "none" : "block", cursor: mapClickLoading ? "wait" : "crosshair" }} />

        {/* Cesium 3D — monté uniquement quand activé */}
        {is3D && (
          <CesiumView3D
            selectedCommune={selectedCommune}
            transactions={transactions}
            initCenter={cesiumInitCenter}
            flyTarget={cesiumFlyTarget}
          />
        )}

        {/* Breadcrumb + loading indicator */}
        <div className="absolute top-4 left-4 flex items-center gap-2 z-10 rounded-full px-4 py-1.5 text-xs font-medium"
          style={{ background: "rgba(16,23,34,0.8)", backdropFilter: "blur(12px)", border: "1px solid rgba(60,131,246,0.2)" }}>
          {breadcrumb.map((s, i, a) => (
            <React.Fragment key={s}>
              <span
                className={i === a.length-1 ? "text-slate-100 font-semibold" : "text-slate-400 hover:text-primary cursor-pointer transition-colors"}
                onClick={i === 0 && a.length > 1 ? handleResetToIDF : undefined}
              >{s}</span>
              {i < a.length-1 && <span className="material-symbols-outlined text-slate-600" style={{ fontSize: 14 }}>chevron_right</span>}
            </React.Fragment>
          ))}
          {mapClickLoading && (
            <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin ml-1" />
          )}
        </div>

        {/* Hint clic carte — visible seulement quand pas de commune sélectionnée */}
        {!selectedCommune && !mapClickLoading && (
          <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-10 pointer-events-none"
            style={{ background: "rgba(16,23,34,0.85)", border: "1px solid rgba(60,131,246,0.25)", borderRadius: 24, padding: "6px 14px" }}>
            <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-primary" style={{ fontSize: 14 }}>touch_app</span>
              Cliquez sur la carte pour sélectionner une commune
            </span>
          </div>
        )}

        {/* Mode badge 3D */}
        {is3D && (
          <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold"
            style={{ background: "rgba(60,131,246,0.2)", border: "1px solid rgba(60,131,246,0.5)", color: "#3c83f6" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>view_in_ar</span>
            Vue 3D · OSM Buildings
          </div>
        )}

        {/* Contrôles droite */}
        <div className="absolute bottom-20 right-4 z-10 flex flex-col gap-2">
          {/* Toggle 3D */}
          <button
            onClick={() => {
            if (!is3D && map.current) {
              const { lng, lat } = map.current.getCenter();
              const zoom = map.current.getZoom();
              setCesiumInitCenter({ lng, lat, zoom });
            }
            setIs3D(v => !v);
          }}
            title={is3D ? "Passer en vue 2D" : "Passer en vue 3D"}
            className={`size-11 rounded-xl flex items-center justify-center transition-all ${
              is3D
                ? "bg-primary text-white shadow-lg shadow-primary/40"
                : "glass-panel hover:bg-primary/20 text-slate-300"
            }`}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
              {is3D ? "map" : "3d_rotation"}
            </span>
          </button>

          <button
            onClick={() => map.current && map.current.setStyle(
              map.current.getStyle().name?.includes("dark")
                ? "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
                : "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
            )}
            title="Changer le fond de carte"
            className="size-11 rounded-xl glass-panel flex items-center justify-center hover:bg-primary/20 transition-all">
            <span className="material-symbols-outlined text-slate-300" style={{ fontSize: 20 }}>layers</span>
          </button>

          {!is3D && (
            <div className="flex flex-col glass-panel rounded-xl overflow-hidden divide-y divide-primary/10">
              {[["add", () => map.current?.zoomIn()], ["remove", () => map.current?.zoomOut()]].map(([icon, fn]) => (
                <button key={icon} onClick={fn} className="size-11 flex items-center justify-center hover:bg-primary/20 transition-all">
                  <span className="material-symbols-outlined text-slate-300" style={{ fontSize: 20 }}>{icon}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* FAB → dashboard macro */}
        <button
          onClick={() => navigate("/dashboard")}
          title="Voir l'analyse macro IDF"
          className="absolute bottom-10 right-4 z-10 bg-primary rounded-full flex items-center justify-center shadow-2xl shadow-primary/40 hover:scale-105 transition-transform"
          style={{ width: 52, height: 52 }}>
          <span className="material-symbols-outlined text-white" style={{ fontSize: 26 }}>analytics</span>
          <span className="absolute -top-1 -right-1 size-4 bg-green-500 border-2 border-background-dark rounded-full animate-pulse" />
        </button>

        {/* Status bar */}
        <div className="absolute bottom-0 left-0 right-0 h-8 border-t border-primary/20 flex items-center justify-between px-4 z-10"
          style={{ background: "rgba(16,23,34,0.95)", backdropFilter: "blur(8px)" }}>
          <div className="flex items-center gap-4">
            <span className="text-[10px] text-slate-500 mono-nums">Données DVF 2019–2024</span>
            <span className="h-3 w-px bg-slate-700" />
            <span className="text-[10px] text-slate-500 mono-nums">{transactions.length} transactions chargées</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold" style={{ color: is3D ? "#3c83f6" : "#64748b" }}>
              {is3D ? "CesiumJS · OSM Buildings" : "MapLibre GL · Dark Matter"}
            </span>
            <span className="h-3 w-px bg-slate-700" />
            <span className="text-[10px] text-slate-500 mono-nums">
              {is3D ? "3D" : "2D"}
            </span>
          </div>
        </div>
      </div>

      <RightPanel commune={selectedCommune} transactions={transactions} agregat={agregat} />
    </div>
  );
}
