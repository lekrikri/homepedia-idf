import React, { useEffect, useRef, useState, useCallback } from "react";
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
function RightPanel({ commune, transactions }) {
  const withM2 = transactions.filter(t => t.valeur_fonciere && t.surface_reelle_bati);
  const prices = withM2.map(t => t.valeur_fonciere / t.surface_reelle_bati).sort((a, b) => a - b);
  const prixMedian = prices.length ? Math.round(prices[Math.floor(prices.length / 2)]) : null;

  const dpeCounts = transactions.reduce((acc, t) => {
    if (t.classe_energie) acc[t.classe_energie] = (acc[t.classe_energie] || 0) + 1;
    return acc;
  }, {});
  const dpePrincipal = Object.entries(dpeCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const dpeStyle = dpePrincipal ? DPE_COLORS[dpePrincipal] : null;

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
          <p className="text-xs text-slate-400">Dept. {commune.departement?.trim()} {commune.region ? `— ${commune.region}` : ""}</p>
        </header>

        {/* Prix médian + sparkline */}
        <div className="bg-slate-900/50 p-4 rounded-xl border border-primary/10 mb-6">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Prix Médian / m²</p>
          <div className="text-3xl font-bold mono-nums text-amber-400 mb-3">
            {prixMedian ? `${prixMedian.toLocaleString()} €` : "— €"}
          </div>
          <div className="flex items-end gap-1 h-8">
            {[50, 65, 50, 75, 100, 85].map((h, i) => (
              <div key={i} className="flex-1 rounded-sm bg-primary/40" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>

        {/* 2-col grid */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-slate-900/50 p-3 rounded-xl border border-primary/10 flex flex-col items-center">
            <span className="material-symbols-outlined text-primary mb-1" style={{ fontSize: 20 }}>handshake</span>
            <div className="text-xl font-bold mono-nums text-slate-100">{transactions.length}</div>
            <p className="text-[10px] text-slate-500 uppercase">Transactions</p>
          </div>
          <div className="bg-slate-900/50 p-3 rounded-xl border border-primary/10 flex flex-col items-center">
            <span className="material-symbols-outlined text-primary mb-1" style={{ fontSize: 20 }}>bolt</span>
            <div className={`text-xl font-bold mono-nums ${dpeStyle?.text || "text-slate-100"}`}>
              {dpePrincipal || "—"}
            </div>
            <p className="text-[10px] text-slate-500 uppercase">DPE Moyen</p>
          </div>
        </div>

        {/* Score investissement */}
        <div className="bg-slate-900/50 p-4 rounded-xl border border-primary/20 mb-6 flex items-center gap-4">
          <div className="relative shrink-0" style={{ width: 64, height: 64 }}>
            <svg className="-rotate-90" width="64" height="64" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="28" fill="transparent" stroke="#1e293b" strokeWidth="4" />
              <circle cx="32" cy="32" r="28" fill="transparent" stroke="#3c83f6" strokeWidth="4"
                strokeDasharray="175" strokeDashoffset={Math.round(175 - (score / 100) * 175)}
                strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-lg font-black mono-nums text-slate-100">{score}</span>
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
                const prixM2 = t.valeur_fonciere && t.surface_reelle_bati
                  ? Math.round(t.valeur_fonciere / t.surface_reelle_bati) : null;
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
function LeftSidebar({ communes, transactions, selectedCommune, onSelectCommune, search, onSearch }) {
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
            <button className="text-[10px] text-slate-500 hover:text-primary underline">Réinitialiser</button>
          </div>
          <div className="space-y-2">
            {["Appartement", "Maison", "Studio"].map((t, i) => (
              <label key={t} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input type="checkbox" defaultChecked={i < 2} className="rounded border-slate-700 bg-slate-800 accent-primary size-4" />
                {t}
              </label>
            ))}
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-400">Année de vente</span>
              <span className="text-primary mono-nums">2019 – 2024</span>
            </div>
            <input type="range" min="2019" max="2024" defaultValue="2024" className="w-full h-1 bg-slate-700 rounded-lg accent-primary cursor-pointer" />
          </div>
        </div>

        {/* Résultats */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-bold text-primary uppercase tracking-widest">
              Résultats <span className="text-slate-500">({transactions.length})</span>
            </h3>
            <span className="material-symbols-outlined text-slate-500 cursor-pointer" style={{ fontSize: 16 }}>sort</span>
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
export default function MapView() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markersRef = useRef([]);

  const [allCommunes, setAllCommunes] = useState([]);
  const [communes, setCommunes] = useState([]);
  const [selectedCommune, setSelectedCommune] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [search, setSearch] = useState("");
  const [is3D, setIs3D] = useState(false);

  useEffect(() => {
    axios.get("/api/v1/communes?limit=50").then(r => {
      if (r.data.data) { setAllCommunes(r.data.data); setCommunes(r.data.data); }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!search) { setCommunes(allCommunes); return; }
    const q = search.toLowerCase();
    setCommunes(allCommunes.filter(c => c.nom.toLowerCase().includes(q) || (c.code_postal || "").includes(q)));
  }, [search, allCommunes]);

  const handleSelectCommune = useCallback((commune) => {
    setSelectedCommune(commune);
    const coords = COMMUNE_COORDS[commune.code_insee];
    if (coords && map.current) map.current.flyTo({ center: coords, zoom: 13, duration: 900 });
    axios.get(`/api/v1/transactions?commune=${commune.code_insee}&limit=100`).then(r => {
      const data = r.data.data || [];
      setTransactions(data);
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      data.forEach(t => {
        if (!t.longitude || !t.latitude) return;
        const el = document.createElement("div");
        el.style.cssText = "width:10px;height:10px;background:#3c83f6;border-radius:50%;border:2px solid rgba(255,255,255,0.6);cursor:pointer;box-shadow:0 0 8px rgba(60,131,246,0.7);transition:transform .15s";
        el.addEventListener("mouseenter", () => { el.style.transform = "scale(1.5)"; });
        el.addEventListener("mouseleave", () => { el.style.transform = "scale(1)"; });
        const dpePopupColors = { A:"#22c55e",B:"#4ade80",C:"#facc15",D:"#fb923c",E:"#f97316",F:"#ef4444",G:"#dc2626" };
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
              ${t.classe_energie ? `<span style="font-weight:900;font-size:11px;padding:1px 6px;border-radius:4px;background:${dpePopupColors[t.classe_energie] || "#64748b"}20;color:${dpePopupColors[t.classe_energie] || "#64748b"};border:1px solid ${dpePopupColors[t.classe_energie] || "#64748b"}50">DPE ${t.classe_energie}</span>` : ""}
            </div>
            ${prixM2Popup ? `<div style="font-size:10px;color:#475569;margin-top:4px">€${prixM2Popup.toLocaleString()}/m²</div>` : ""}
          </div>`);
        markersRef.current.push(new maplibregl.Marker(el).setLngLat([t.longitude, t.latitude]).setPopup(popup).addTo(map.current));
      });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (allCommunes.length && !selectedCommune) {
      const paris = allCommunes.find(c => c.code_insee === "75056") || allCommunes[0];
      handleSelectCommune(paris);
    }
  }, [allCommunes, selectedCommune, handleSelectCommune]);

  useEffect(() => {
    if (map.current) return;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      center: [2.3488, 48.8534],
      zoom: 12,
    });
    map.current.addControl(new maplibregl.NavigationControl(), "bottom-right");
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  const breadcrumb = selectedCommune
    ? ["Île-de-France", selectedCommune.nom, selectedCommune.code_postal]
    : ["Île-de-France"];

  return (
    <div className="flex h-full overflow-hidden">
      <LeftSidebar
        communes={communes}
        transactions={transactions}
        selectedCommune={selectedCommune}
        onSelectCommune={handleSelectCommune}
        search={search}
        onSearch={setSearch}
      />

      <div className="relative flex-1">
        {/* MapLibre 2D — toujours monté pour garder l'état, juste caché en mode 3D */}
        <div ref={mapContainer} className="w-full h-full" style={{ display: is3D ? "none" : "block" }} />

        {/* Cesium 3D — monté uniquement quand activé */}
        {is3D && (
          <CesiumView3D
            selectedCommune={selectedCommune}
            transactions={transactions}
          />
        )}

        {/* Breadcrumb */}
        <div className="absolute top-4 left-4 flex items-center gap-2 z-10 rounded-full px-4 py-1.5 text-xs font-medium"
          style={{ background: "rgba(16,23,34,0.8)", backdropFilter: "blur(12px)", border: "1px solid rgba(60,131,246,0.2)" }}>
          {breadcrumb.map((s, i, a) => (
            <React.Fragment key={s}>
              <span className={i === a.length-1 ? "text-slate-100 font-semibold" : "text-slate-400 hover:text-primary cursor-pointer"}>{s}</span>
              {i < a.length-1 && <span className="material-symbols-outlined text-slate-600" style={{ fontSize: 14 }}>chevron_right</span>}
            </React.Fragment>
          ))}
        </div>

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
            onClick={() => setIs3D(v => !v)}
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

          <button className="size-11 rounded-xl glass-panel flex items-center justify-center hover:bg-primary/20 transition-all">
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

        {/* FAB assistant */}
        <button className="absolute bottom-10 right-4 z-10 bg-primary rounded-full flex items-center justify-center shadow-2xl shadow-primary/40 hover:scale-105 transition-transform"
          style={{ width: 52, height: 52 }}>
          <span className="material-symbols-outlined text-white" style={{ fontSize: 26 }}>smart_toy</span>
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

      <RightPanel commune={selectedCommune} transactions={transactions} />
    </div>
  );
}
