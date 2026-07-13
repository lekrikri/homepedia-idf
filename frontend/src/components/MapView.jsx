import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import axios from "axios";
import "maplibre-gl/dist/maplibre-gl.css";
import CesiumView3D from "./CesiumView3D";
import { isFavorite, addFavorite, removeFavorite } from "../utils/favorites.js";
import { useCommunes } from "../contexts/CommunesContext.jsx";

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

// Cache POI par commune — L1 : Map JS session (accès immédiat O(1))
// L2 : cache HTTP navigateur (géré automatiquement via Cache-Control: public, max-age=86400)
// Les données viennent du backend Go /api/v1/poi/:code (pré-ingérées via ingest_poi.py)
// Plus d'appel direct à Overpass en production.
const POI_CACHE   = new Map();
const POI_PENDING = new Map();

async function fetchPOIBatch(code, _lat, _lon, signal) {
  // L1 — RAM session (hit immédiat si déjà chargé)
  if (POI_CACHE.has(code)) return POI_CACHE.get(code);
  // Requête déjà en cours pour ce code — dédupliquer
  if (POI_PENDING.has(code)) return POI_PENDING.get(code);

  const p = (async () => {
    const res = await fetch(`/api/v1/poi/${code}`, { signal });
    if (!res.ok) throw new Error(`POI fetch error ${res.status}`);
    const b = await res.json();
    POI_CACHE.set(code, b);
    POI_PENDING.delete(code);
    return b;
  })();
  p.catch(() => POI_PENDING.delete(code));
  POI_PENDING.set(code, p);
  return p;
}

const DPE_COLORS = {
  A: { bg: "bg-green-500",   text: "text-green-400",   ring: "ring-green-500/40",   hex: "#22c55e" },
  B: { bg: "bg-green-400",   text: "text-green-400",   ring: "ring-green-400/40",   hex: "#84cc16" },
  C: { bg: "bg-yellow-400",  text: "text-yellow-400",  ring: "ring-yellow-400/40",  hex: "#eab308" },
  D: { bg: "bg-orange-400",  text: "text-orange-400",  ring: "ring-orange-400/40",  hex: "#f97316" },
  E: { bg: "bg-orange-500",  text: "text-orange-500",  ring: "ring-orange-500/40",  hex: "#ef4444" },
  F: { bg: "bg-red-400",     text: "text-red-400",     ring: "ring-red-400/40",     hex: "#dc2626" },
  G: { bg: "bg-red-600",     text: "text-red-500",     ring: "ring-red-600/40",     hex: "#991b1b" },
};

// Moyennes IDF de référence (ENEDIS/GRDF 2022)
const IDF_AVG_ELEC_MWH = 5.1;   // MWh/logement/an
const IDF_AVG_GAZ_MWH  = 12.5;  // MWh/logement/an
const IPS_NATIONAL_AVG = 100;   // échelle 0-200
const DPE_LETTERS = ["A","B","C","D","E","F","G"];

// Score tooltips descriptions
const SCORE_DETAILS = {
  qv: {
    label: "Qualité de Vie",
    color: "#10b981",
    items: [
      { pct: "30%", desc: "IPS moyen (environnement scolaire)" },
      { pct: "20%", desc: "% logements DPE A/B" },
      { pct: "20%", desc: "Densité équipements de proximité" },
      { pct: "15%", desc: "Conso électricité (inversée)" },
      { pct: "15%", desc: "% écoles favorisées" },
    ],
  },
  inv: {
    label: "Investissement",
    color: "#3c83f6",
    items: [
      { pct: "25%", desc: "Volume de transactions" },
      { pct: "25%", desc: "IPS moyen (attractivité)" },
      { pct: "20%", desc: "% logements DPE A/B" },
      { pct: "15%", desc: "Prix médian au m² (inversé)" },
      { pct: "15%", desc: "Commerces bio/premium" },
    ],
  },
  stab: {
    label: "Stabilité DPE",
    color: "#f59e0b",
    items: [
      { pct: "30%", desc: "Score DPE moyen (inversé)" },
      { pct: "25%", desc: "Conso énergie moyenne (inversée)" },
      { pct: "25%", desc: "Émissions GES (inversées)" },
      { pct: "20%", desc: "% logements bons DPE (A/B)" },
    ],
  },
};

// ─── Right Panel ───────────────────────────────────────────────────────────────
// ── Transports en commun (Overpass OSM) ──────────────────────────────────────

const TRANSPORT_ICONS = {
  subway:    { icon: "directions_subway", label: "Métro",      color: "#3c83f6" },
  tram:      { icon: "tram",             label: "Tramway",    color: "#a78bfa" },
  train:     { icon: "train",            label: "RER / Trans.", color: "#10b981" },
  bus:       { icon: "directions_bus",   label: "Bus",        color: "#f59e0b" },
  other:     { icon: "commute",          label: "Transports", color: "#64748b" },
};

function detectType(tags = {}) {
  if (tags.subway === "yes" || tags.station === "subway") return "subway";
  if (tags.tram === "yes" || tags.railway === "tram_stop") return "tram";
  if (tags.train === "yes" || tags.station === "train" || (tags.railway === "station" && (tags.operator || "").match(/SNCF|Transilien/i))) return "train";
  if (tags.bus === "yes") return "bus";
  return "other";
}

const TRANSPORT_MARKER_CFG = {
  subway: { bg: "#3c83f6", letter: "M", shape: "circle" },
  tram:   { bg: "#a78bfa", letter: "T", shape: "circle" },
  train:  { bg: "#10b981", letter: "R", shape: "circle" },
  bus:    { bg: "#f59e0b", letter: "B", shape: "square" },
  other:  { bg: "#64748b", letter: "⬡", shape: "circle" },
};

function createTransportMarkerEl(type, name) {
  const cfg = TRANSPORT_MARKER_CFG[type] || TRANSPORT_MARKER_CFG.other;
  const el = document.createElement("div");
  el.title = name || "";
  el.style.cssText = `width:18px;height:18px;background:${cfg.bg};border-radius:${cfg.shape === "square" ? "4px" : "50%"};border:2px solid rgba(255,255,255,0.85);display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:900;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.5),0 0 0 1px ${cfg.bg}44;pointer-events:none;`;
  el.textContent = cfg.letter;
  return el;
}

// Taux SSMSI 2022 par département IDF (fallback quand BDD non peuplée)
const DEPT_SECURITE_FALLBACK = {
  "75": { taux_cambriolages: 8.2,  taux_vols_violence: 7.1,  score: 55 },
  "77": { taux_cambriolages: 5.8,  taux_vols_violence: 4.2,  score: 69 },
  "78": { taux_cambriolages: 4.7,  taux_vols_violence: 3.9,  score: 74 },
  "91": { taux_cambriolages: 5.1,  taux_vols_violence: 4.5,  score: 71 },
  "92": { taux_cambriolages: 5.4,  taux_vols_violence: 4.8,  score: 70 },
  "93": { taux_cambriolages: 9.3,  taux_vols_violence: 10.2, score: 43 },
  "94": { taux_cambriolages: 6.3,  taux_vols_violence: 5.6,  score: 65 },
  "95": { taux_cambriolages: 6.8,  taux_vols_violence: 5.9,  score: 62 },
};

function TransportsSection({ lat, lon, code }) {
  const [stops, setStops] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();

    async function load() {
      try {
        let elems = [];
        if (code) {
          // Cache POI L1 RAM (hit immédiat) ou L2 HTTP navigateur (via /api/v1/poi/:code)
          const b = await fetchPOIBatch(code, lat, lon, ctrl.signal);
          elems = b.transports || [];
        } else {
          // Fallback sans code_insee : requête Overpass séparée (sessionStorage seulement)
          const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
          const cached = sessionStorage.getItem(`transport_${cacheKey}`);
          if (cached) { setStops(JSON.parse(cached)); return; }
          const q = `[out:json][timeout:15];(node["public_transport"="station"](around:3000,${lat},${lon});node["railway"~"station|tram_stop"](around:2500,${lat},${lon}););out body;`;
          const r = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`, { signal: ctrl.signal });
          const d = await r.json();
          elems = d.elements || [];
          const seen2 = new Set();
          const res2 = elems.filter(el => {
            const name = el.tags?.name || el.tags?.["name:fr"];
            if (!name) return false;
            const k = `${detectType(el.tags)}:${name}`;
            if (seen2.has(k)) return false;
            seen2.add(k);
            return true;
          }).slice(0, 8).map(el => ({
            name: el.tags?.name || el.tags?.["name:fr"] || "Station",
            type: detectType(el.tags),
            lines: [el.tags?.ref, el.tags?.["ref:SNCF"], el.tags?.["network"]].filter(Boolean).join(" · "),
          }));
          sessionStorage.setItem(`transport_${cacheKey}`, JSON.stringify(res2));
          setStops(res2);
          return;
        }
        const seen = new Set();
        const results = elems.filter(el => {
          const name = el.tags?.name || el.tags?.["name:fr"];
          if (!name) return false;
          const k = `${detectType(el.tags)}:${name}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        }).slice(0, 8).map(el => ({
          name: el.tags?.name || el.tags?.["name:fr"] || "Station",
          type: detectType(el.tags),
          lines: [el.tags?.ref, el.tags?.["ref:SNCF"], el.tags?.["network"]].filter(Boolean).join(" · "),
        }));
        setStops(results);
      } catch(err) {
        if (err?.name !== "AbortError") setStops([]);
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => ctrl.abort();
  }, [code, lat, lon]);

  if (loading) return (
    <div className="rounded-xl p-4 animate-pulse" style={{ background: "rgba(22,32,48,0.8)", border: "1px solid rgba(60,131,246,0.12)" }}>
      <div className="h-3 w-32 bg-slate-700 rounded mb-3" />
      <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-8 bg-slate-700/50 rounded-lg" />)}</div>
    </div>
  );

  if (!stops || stops.length === 0) return null;

  return (
    <div className="rounded-xl p-4" style={{ background: "rgba(22,32,48,0.8)", border: "1px solid rgba(60,131,246,0.12)" }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-blue-400" style={{ fontSize: 13 }}>directions_transit</span>
        <p className="text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Transports en commun</p>
        <span className="ml-auto text-[8px] text-slate-600">OSM · rayon 3 km</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {stops.map((s, i) => {
          const t = TRANSPORT_ICONS[s.type] || TRANSPORT_ICONS.other;
          return (
            <div key={i} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg"
              style={{ background: t.color + "12", border: `1px solid ${t.color}25` }}>
              <span className="material-symbols-outlined shrink-0" style={{ fontSize: 14, color: t.color }}>{t.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-slate-200 truncate">{s.name}</p>
                {s.lines && <p className="text-[9px] text-slate-500 truncate">{s.lines}</p>}
              </div>
              <span className="text-[8px] font-bold shrink-0" style={{ color: t.color }}>{t.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RightPanel({ commune, transactions, agregat, isLocked, onUnlock }) {
  const [activeScoreTip, setActiveScoreTip] = useState(null);
  const codeCommune = agregat?.code_commune || commune?.code_insee;
  const [fav, setFav] = useState(() => codeCommune ? isFavorite(codeCommune) : false);
  useEffect(() => { setFav(codeCommune ? isFavorite(codeCommune) : false); }, [codeCommune]);

  const toggleFav = () => {
    if (!codeCommune) return;
    if (fav) {
      removeFavorite(codeCommune);
      setFav(false);
    } else {
      addFavorite({
        code_commune:       codeCommune,
        city:               agregat?.city || commune?.nom,
        code_departement:   agregat?.code_departement || commune?.departement,
        prix_median_m2:     agregat?.prix_median_m2 ?? commune?.prix_m2_median,
        score_investissement: agregat?.score_investissement,
        score_qualite_vie:  agregat?.score_qualite_vie,
      });
      setFav(true);
    }
  };

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

  const dpePrincipal = useMemo(() =>
    commune?.dpe_dominant
    ?? Object.entries(
        transactions.reduce((acc, t) => {
          if (t.classe_energie) acc[t.classe_energie] = (acc[t.classe_energie] || 0) + 1;
          return acc;
        }, {})
       ).sort((a, b) => b[1] - a[1])[0]?.[0]
  , [commune?.dpe_dominant, transactions]);

  const dpeStyle = dpePrincipal ? DPE_COLORS[dpePrincipal] : null;
  const nbTransactions = agregat?.nb_transactions ?? commune?.nb_transactions ?? transactions.length;
  const scoreInv  = agregat?.score_investissement != null ? Math.round(agregat.score_investissement) : null;
  const scoreQV   = agregat?.score_qualite_vie    != null ? Math.round(agregat.score_qualite_vie)    : null;
  const scoreStab = agregat?.score_stabilite      != null ? Math.round(agregat.score_stabilite)      : null;
  const lastSales = transactions.slice(0, 4);

  // DPE dominant calculé depuis score_dpe_moyen (1=A…7=G)
  const dpeMoyenLetter = agregat?.score_dpe_moyen != null
    ? DPE_LETTERS[Math.min(6, Math.max(0, Math.round(agregat.score_dpe_moyen) - 1))]
    : null;

  const panelBase = "fixed md:relative bottom-0 left-0 right-0 md:inset-auto w-full md:w-80 md:h-full flex-shrink-0 z-30 md:z-20 transition-transform duration-300 rounded-t-2xl md:rounded-none overflow-y-auto";
  const panelStyle = { background: "rgba(11,17,27,0.97)", backdropFilter: "blur(16px)", borderTop: "1px solid rgba(60,131,246,0.2)", borderLeft: "1px solid rgba(60,131,246,0.12)" };

  if (!commune) return (
    <aside className={`${panelBase} hidden md:flex items-center justify-center`} style={panelStyle}>
      <div className="text-center p-6">
        <span className="material-symbols-outlined text-primary/30 mb-3 block" style={{ fontSize: 44 }}>map</span>
        <p className="text-slate-500 text-sm">Sélectionnez une commune<br/>pour voir ses statistiques</p>
      </div>
    </aside>
  );

  if (!agregat) return (
    <aside className={`${panelBase} translate-y-0`} style={{ ...panelStyle, maxHeight: "72vh" }}>
      <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mt-3 mb-1 md:hidden" />
      <div className="p-5 space-y-3 animate-pulse">
        <div className="h-6 bg-slate-700/60 rounded w-3/4" />
        <div className="h-4 bg-slate-700/40 rounded w-1/2" />
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-16 bg-slate-800/60 rounded-lg" />
        ))}
      </div>
    </aside>
  );

  // ── IPS helpers ────────────────────────────────────────────────────────────
  const ipsLabel = agregat?.ips_moyen != null
    ? agregat.ips_moyen >= 110 ? { text: "Très favorisé", color: "#10b981", bg: "#10b98118" }
    : agregat.ips_moyen >= 80  ? { text: "Intermédiaire", color: "#f59e0b", bg: "#f59e0b18" }
    :                            { text: "Défavorisé",    color: "#ef4444", bg: "#ef444418" }
    : null;
  const ipsDelta = agregat?.ips_moyen != null ? (agregat.ips_moyen - IPS_NATIONAL_AVG) : null;

  return (
    <aside className={`${panelBase} translate-y-0`} style={{ ...panelStyle, maxHeight: "72vh" }}>
      {/* Drag handle mobile */}
      <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mt-3 mb-1 md:hidden" />
      <div className="p-5 space-y-3">

        {/* ── HEADER ────────────────────────────────────────────────────── */}
        <header className="pt-1">
          <div className="flex items-start justify-between mb-1">
            <div className="flex-1 min-w-0">
              <h3 className="text-xl font-bold text-slate-100 leading-tight">{commune.nom}</h3>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                  style={{ background: "rgba(60,131,246,0.15)", color: "#3c83f6", border: "1px solid rgba(60,131,246,0.3)" }}>
                  {commune.departement?.trim()} — {agregat?.code_departement?.trim() === "75" ? "PARIS" : commune.departement?.trim() === "92" ? "HAUTS-DE-SEINE" : commune.departement?.trim() === "93" ? "SEINE-ST-DENIS" : commune.departement?.trim() === "94" ? "VAL-DE-MARNE" : "IDF"}
                </span>
                {agregat?.population_totale && (
                  <span className="text-[10px] text-slate-500 mono-nums">
                    {Math.round(agregat.population_totale / 1000)}k hab.
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 ml-2 shrink-0">
              {isLocked && (
                <button
                  onClick={onUnlock}
                  title="Déverrouiller la commune — permet de sélectionner une autre commune"
                  className="size-9 rounded-xl flex items-center justify-center transition-all bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>lock_open</span>
                </button>
              )}
              <button
                onClick={toggleFav}
                title={fav ? "Retirer des favoris" : "Ajouter aux favoris"}
                className={`size-9 rounded-xl flex items-center justify-center transition-all ${
                  fav
                    ? "bg-red-500/20 border border-red-500/40 text-red-400"
                    : "bg-slate-800/60 border border-slate-700 text-slate-500 hover:text-red-400 hover:border-red-500/40 hover:bg-red-500/10"
                }`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: fav ? "'FILL' 1" : "'FILL' 0" }}>
                  favorite
                </span>
              </button>
            </div>
          </div>
        </header>

        {/* ── SCORES COMPOSITES ─────────────────────────────────────────── */}
        {(scoreQV != null || scoreInv != null || scoreStab != null) && (
          <div className="rounded-xl p-4" style={{ background: "rgba(22,32,48,0.8)", border: "1px solid rgba(60,131,246,0.12)" }}>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-3 font-semibold">Scores Composites</p>
            <div className="grid grid-cols-3 gap-1">
              {[
                { key: "qv",   val: scoreQV,   ...SCORE_DETAILS.qv   },
                { key: "inv",  val: scoreInv,  ...SCORE_DETAILS.inv  },
                { key: "stab", val: scoreStab, ...SCORE_DETAILS.stab },
              ].map(({ key, label, val, color, items }, i) => (
                <div key={key} className="flex flex-col items-center gap-1.5 relative">
                  <div className="relative" style={{ width: 58, height: 58 }}>
                    <svg className="-rotate-90" width="58" height="58" viewBox="0 0 58 58">
                      <circle cx="29" cy="29" r="24" fill="transparent" stroke="rgba(30,41,59,0.8)" strokeWidth="5" />
                      {val != null && <circle cx="29" cy="29" r="24" fill="transparent" stroke={color} strokeWidth="5"
                        strokeDasharray="150.8" strokeDashoffset={Math.round(150.8 - (val / 100) * 150.8)}
                        strokeLinecap="round" />}
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-base font-black mono-nums" style={{ color: val != null ? "white" : "#475569" }}>
                        {val ?? "—"}
                      </span>
                    </div>
                    <button onClick={() => setActiveScoreTip(activeScoreTip === key ? null : key)}
                      className="absolute -top-0.5 -right-0.5 size-4 rounded-full flex items-center justify-center"
                      style={{ background: activeScoreTip === key ? color : "#0f1724", border: `1px solid ${color}60` }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 9, color: activeScoreTip === key ? "white" : color }}>info</span>
                    </button>
                  </div>
                  <p className="text-[9px] text-center leading-tight" style={{ color: "#64748b" }}>{label}</p>
                  {activeScoreTip === key && (
                    <div
                      className={`absolute top-full mt-2 z-50 w-52 rounded-xl p-3 shadow-2xl ${i === 0 ? "left-0" : i === 2 ? "right-0" : "left-1/2 -translate-x-1/2"}`}
                      style={{ background: "#0a1120", border: `1px solid ${color}50` }}>
                      <p className="text-[10px] font-bold mb-2" style={{ color }}>{label}</p>
                      {items.map(({ pct, desc }) => (
                        <div key={desc} className="flex items-start gap-2 mb-1">
                          <span className="text-[9px] font-bold shrink-0 mono-nums" style={{ color }}>{pct}</span>
                          <span className="text-[9px] text-slate-400">{desc}</span>
                        </div>
                      ))}
                      <p className="text-[8px] text-slate-600 mt-2 pt-1.5 border-t border-slate-800/50">Percentile IDF · 0-100</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── MARCHÉ IMMOBILIER ─────────────────────────────────────────── */}
        <div className="rounded-xl p-4" style={{ background: "rgba(22,32,48,0.8)", border: "1px solid rgba(60,131,246,0.12)" }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px]">€</span>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Marché Immobilier</p>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-2">
            <div>
              <p className="text-[9px] text-slate-500 uppercase tracking-wide mb-0.5">Médian / m²</p>
              <p className="text-2xl font-black mono-nums text-primary">{prixMedian ? `${prixMedian.toLocaleString()} €` : "—"}</p>
            </div>
            {agregat?.prix_moyen_m2 && (
              <div>
                <p className="text-[9px] text-slate-500 uppercase tracking-wide mb-0.5">Moyen / m²</p>
                <p className="text-2xl font-black mono-nums text-slate-200">{Math.round(agregat.prix_moyen_m2).toLocaleString()} €</p>
              </div>
            )}
          </div>
          {nbTransactions && (
            <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
              <span className="text-[10px] text-slate-500">Volume de transactions</span>
              <span className="text-[11px] font-bold mono-nums text-primary">{Number(nbTransactions).toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* ── RENDEMENT LOCATIF ────────────────────────────────────────── */}
        {agregat?.loyer_median_m2 != null && (
          <div className="rounded-xl p-4" style={{ background: "rgba(22,32,48,0.8)", border: "1px solid rgba(16,185,129,0.18)" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-400" style={{ fontSize: 13 }}>account_balance</span>
                <p className="text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Rendement locatif</p>
              </div>
              {agregat.zone_tendue && (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                  style={{ color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)" }}>
                  Zone tendue
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 mb-2">
              <div>
                <p className="text-[9px] text-slate-500 uppercase tracking-wide mb-0.5">Loyer médian / m²</p>
                <p className="text-xl font-black mono-nums text-emerald-400">
                  {agregat.loyer_median_m2.toFixed(1)} €
                  <span className="text-[10px] font-normal text-slate-500 ml-1">/mois</span>
                </p>
              </div>
              {agregat.rendement_locatif_brut != null && (
                <div>
                  <p className="text-[9px] text-slate-500 uppercase tracking-wide mb-0.5">Rendement brut</p>
                  <p className="text-xl font-black mono-nums"
                    style={{ color: agregat.rendement_locatif_brut >= 5 ? "#10b981" : agregat.rendement_locatif_brut >= 3.5 ? "#f59e0b" : "#ef4444" }}>
                    {agregat.rendement_locatif_brut.toFixed(2)}%
                  </p>
                </div>
              )}
            </div>
            {agregat.rendement_locatif_brut != null && (
              <div className="pt-2 border-t border-slate-800/60">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] text-slate-500">Faible</span>
                  <span className="text-[9px] text-slate-500">Moyen</span>
                  <span className="text-[9px] text-slate-500">Élevé</span>
                </div>
                <div className="relative w-full h-2 rounded-full" style={{ background: "linear-gradient(to right, #ef4444, #f59e0b 45%, #10b981 75%)" }}>
                  <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow border-2 border-slate-900"
                    style={{ left: `${Math.min(96, Math.max(4, (agregat.rendement_locatif_brut - 2) / 6 * 100))}%`, transform: "translate(-50%,-50%)" }} />
                </div>
                <p className="text-[9px] text-slate-600 mt-1.5">Source : CLAMEUR 2022 + gradient géographique IDF</p>
              </div>
            )}
          </div>
        )}

        {/* ── ÉDUCATION & IPS ──────────────────────────────────────────── */}
        {agregat?.ips_moyen != null && (
          <div className="rounded-xl p-4" style={{ background: "rgba(22,32,48,0.8)", border: "1px solid rgba(60,131,246,0.12)" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-400" style={{ fontSize: 13 }}>school</span>
                <p className="text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Éducation & IPS</p>
              </div>
              {ipsLabel && (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                  style={{ color: ipsLabel.color, background: ipsLabel.bg, border: `1px solid ${ipsLabel.color}40` }}>
                  {ipsLabel.text}
                </span>
              )}
            </div>
            {/* Valeur + contexte */}
            <p className="text-[11px] font-semibold text-slate-300 mb-1">
              IPS {agregat.ips_moyen.toFixed(1)} — {ipsDelta >= 0 ? "Au-dessus" : "En dessous"} de la moyenne nationale (100)
            </p>
            {agregat.nb_ecoles > 0 && (
              <p className="text-[9px] text-slate-500 mb-2">Basé sur {agregat.nb_ecoles} établissements scolaires</p>
            )}
            {/* Barre gradient rouge→vert avec curseur */}
            <div className="relative w-full h-2.5 rounded-full mb-1" style={{ background: "linear-gradient(to right, #ef4444, #f59e0b 40%, #10b981 75%)" }}>
              <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-lg border-2 border-slate-900"
                style={{ left: `${Math.min(98, Math.max(2, ((agregat.ips_moyen - 60) / 100) * 100))}%`, transform: "translate(-50%, -50%)" }} />
            </div>
            <div className="flex justify-between text-[8px] text-slate-600 mb-3">
              <span>60</span><span>Moy. nat. 100</span><span>160</span>
            </div>
            {/* Stats */}
            <div className="grid grid-cols-2 gap-2">
              {agregat.pct_ecoles_favorisees != null && (
                <div>
                  <p className="text-[9px] text-slate-500 mb-0.5">Écoles favorisées</p>
                  <p className="text-base font-bold mono-nums text-slate-100">{agregat.pct_ecoles_favorisees.toFixed(1)}%</p>
                </div>
              )}
              {agregat.nb_ecoles > 0 && (
                <div>
                  <p className="text-[9px] text-slate-500 mb-0.5">Établissements</p>
                  <p className="text-base font-bold mono-nums text-slate-100">{agregat.nb_ecoles} écoles</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── DIAGNOSTIC DE PERFORMANCE ÉNERGÉTIQUE ────────────────────── */}
        {agregat?.score_dpe_moyen != null && (
          <div className="rounded-xl p-4" style={{ background: "rgba(22,32,48,0.8)", border: "1px solid rgba(60,131,246,0.12)" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400" style={{ fontSize: 13 }}>bolt</span>
                <p className="text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Diagnostic Perf. Énergétique</p>
              </div>
              {dpeMoyenLetter && (
                <span className="text-[9px] font-black px-2 py-0.5 rounded"
                  style={{ background: DPE_COLORS[dpeMoyenLetter]?.hex + "30", color: DPE_COLORS[dpeMoyenLetter]?.hex, border: `1px solid ${DPE_COLORS[dpeMoyenLetter]?.hex}60` }}>
                  Classe {dpeMoyenLetter}
                </span>
              )}
            </div>
            {/* Barre continue A→G — style Stitch */}
            <div className="flex rounded-lg overflow-hidden h-7 mb-1">
              {DPE_LETTERS.map((l, i) => {
                const idx = i + 1;
                const isActive = l === dpeMoyenLetter;
                return (
                  <div key={l} className="flex-1 flex items-center justify-center relative"
                    style={{ background: DPE_COLORS[l]?.hex, opacity: isActive ? 1 : 0.25, transition: "opacity .2s" }}>
                    <span style={{ fontSize: isActive ? 11 : 9, fontWeight: isActive ? 900 : 400, color: "white", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>{l}</span>
                    {isActive && <div className="absolute -bottom-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[8px] text-slate-600 mb-3">
              <span>Excellent</span><span>Énergivore</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {agregat.conso_energie_moyenne && (
                <div>
                  <p className="text-[9px] text-slate-500 mb-0.5">Conso. énergie primaire</p>
                  <p className="text-[13px] font-bold mono-nums text-slate-200">{Math.round(agregat.conso_energie_moyenne)} <span className="text-[9px] font-normal text-slate-500">kWh/m²/an</span></p>
                </div>
              )}
              {agregat.emission_ges_moyenne && (
                <div>
                  <p className="text-[9px] text-slate-500 mb-0.5">Émissions GES</p>
                  <p className="text-[13px] font-bold mono-nums text-slate-200">{Math.round(agregat.emission_ges_moyenne)} <span className="text-[9px] font-normal text-slate-500">kgCO₂/m²/an</span></p>
                </div>
              )}
              {agregat.pct_dpe_bon != null && (
                <div>
                  <p className="text-[9px] text-slate-500 mb-0.5">Logements A/B/C</p>
                  <p className="text-[13px] font-bold mono-nums text-green-400">{(agregat.pct_dpe_bon * 100).toFixed(1)}% <span className="text-[9px] font-normal text-slate-500">bon DPE</span></p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── CONSOMMATION ÉNERGÉTIQUE ENEDIS/GRDF ─────────────────────── */}
        {(agregat?.conso_elec_par_logement != null || agregat?.conso_gaz_par_logement != null) && (
          <div className="rounded-xl p-4" style={{ background: "rgba(22,32,48,0.8)", border: "1px solid rgba(60,131,246,0.12)" }}>
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-blue-400" style={{ fontSize: 13 }}>electric_bolt</span>
              <p className="text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Consommation Énergétique</p>
            </div>
            {/* Électricité */}
            {agregat.conso_elec_par_logement != null && (() => {
              const val = agregat.conso_elec_par_logement;
              const diff = val - IDF_AVG_ELEC_MWH;
              const pct = Math.round((diff / IDF_AVG_ELEC_MWH) * 100);
              return (
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-slate-400">Électricité</span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full mono-nums"
                      style={{ background: diff > 0 ? "#ef444420" : "#10b98120", color: diff > 0 ? "#ef4444" : "#10b981", border: `1px solid ${diff > 0 ? "#ef444440" : "#10b98140"}` }}>
                      {diff > 0 ? "+" : ""}{pct}% vs IDF
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xl font-black mono-nums text-slate-100">{val.toFixed(2)}</span>
                    <span className="text-[10px] text-slate-500">MWh/log</span>
                  </div>
                  <p className="text-[9px] text-slate-600 mt-0.5">vs moy. IDF : {IDF_AVG_ELEC_MWH} MWh</p>
                </div>
              );
            })()}
            {/* Gaz */}
            {agregat.conso_gaz_par_logement != null && (() => {
              const val = agregat.conso_gaz_par_logement;
              const diff = val - IDF_AVG_GAZ_MWH;
              const pct = Math.round((diff / IDF_AVG_GAZ_MWH) * 100);
              return (
                <div className="pt-3 border-t border-slate-800/60">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-slate-400">Gaz</span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full mono-nums"
                      style={{ background: diff > 0 ? "#ef444420" : "#10b98120", color: diff > 0 ? "#ef4444" : "#10b981", border: `1px solid ${diff > 0 ? "#ef444440" : "#10b98140"}` }}>
                      {diff > 0 ? "+" : ""}{pct}% vs IDF
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xl font-black mono-nums text-slate-100">{val.toFixed(2)}</span>
                    <span className="text-[10px] text-slate-500">MWh/log</span>
                  </div>
                  <p className="text-[9px] text-slate-600 mt-0.5">vs moy. IDF : {IDF_AVG_GAZ_MWH} MWh</p>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── SÉCURITÉ & DÉLINQUANCE ───────────────────────────────────── */}
        {(() => {
          const dept = (commune?.code_departement || agregat?.code_departement || "").trim();
          const fb = DEPT_SECURITE_FALLBACK[dept];
          const s = agregat?.score_securite != null
            ? Math.round(agregat.score_securite)
            : (fb?.score ?? null);
          const tauxCambrio  = agregat?.taux_cambriolages  ?? fb?.taux_cambriolages;
          const tauxViolence = agregat?.taux_vols_violence ?? fb?.taux_vols_violence;
          if (s == null) return null;
          const badge = s >= 65 ? { text: "Sûr",        icon: "verified_user", color: "#10b981" }
                      : s >= 40 ? { text: "Modéré",     icon: "security",      color: "#f59e0b" }
                      :           { text: "Vigilance",   icon: "gpp_bad",       color: "#ef4444" };
          const isFallback = agregat?.score_securite == null;
          return (
            <div className="rounded-xl p-4" style={{ background: "rgba(22,32,48,0.8)", border: "1px solid rgba(60,131,246,0.12)" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined" style={{ fontSize: 13, color: badge.color }}>{badge.icon}</span>
                  <p className="text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Sécurité & Délinquance</p>
                </div>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                  style={{ color: badge.color, background: badge.color + "18", border: `1px solid ${badge.color}40` }}>
                  {badge.text}
                </span>
              </div>
              {/* Score + barre */}
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(30,41,59,0.8)" }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, s))}%`, background: badge.color, transition: "width .4s ease" }} />
                </div>
                <span className="text-xl font-black mono-nums" style={{ color: badge.color, minWidth: 38, textAlign: "right" }}>{s}<span className="text-[9px] font-normal text-slate-500">/100</span></span>
              </div>
              {/* Taux détaillés */}
              <div className="grid grid-cols-2 gap-2 mb-2">
                {tauxCambrio != null && (
                  <div className="rounded-lg p-2" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="material-symbols-outlined text-red-400" style={{ fontSize: 11 }}>home_work</span>
                      <p className="text-[8px] text-slate-500">Cambriolages</p>
                    </div>
                    <p className="text-[13px] font-bold mono-nums text-slate-200">
                      {tauxCambrio.toFixed(1)}<span className="text-[8px] font-normal text-slate-500"> ‰ log.</span>
                    </p>
                  </div>
                )}
                {tauxViolence != null && (
                  <div className="rounded-lg p-2" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="material-symbols-outlined text-amber-400" style={{ fontSize: 11 }}>personal_injury</span>
                      <p className="text-[8px] text-slate-500">Coups & blessures</p>
                    </div>
                    <p className="text-[13px] font-bold mono-nums text-slate-200">
                      {tauxViolence.toFixed(1)}<span className="text-[8px] font-normal text-slate-500"> ‰ hab.</span>
                    </p>
                  </div>
                )}
              </div>
              {/* Contexte IDF */}
              {dept && (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="material-symbols-outlined text-slate-600" style={{ fontSize: 10 }}>info</span>
                  <p className="text-[8px] text-slate-600">
                    Source SSMSI · Dép. {dept} · moy. IDF : 6.5‰ cambriolages
                    {isFallback && " · estimation département"}
                  </p>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── ÉQUIPEMENTS & SERVICES (chips) ────────────────────────────── */}
        {agregat?.nb_poi_total > 0 && (
          <div className="rounded-xl p-4" style={{ background: "rgba(22,32,48,0.8)", border: "1px solid rgba(60,131,246,0.12)" }}>
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-primary/70" style={{ fontSize: 13 }}>location_on</span>
              <p className="text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Équipements & Services</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { icon: "train",          label: "Transport", val: agregat.nb_transport,    color: "#3c83f6" },
                { icon: "school",         label: "Éducation", val: agregat.nb_education,    color: "#10b981" },
                { icon: "local_hospital", label: "Santé",     val: agregat.nb_sante,        color: "#ef4444" },
                { icon: "storefront",     label: "Commerce",  val: agregat.nb_commerce,     color: "#f59e0b" },
                { icon: "restaurant",     label: "Restos",    val: agregat.nb_restauration, color: "#a78bfa" },
                { icon: "park",           label: "Parcs",     val: agregat.nb_parcs,        color: "#34d399" },
              ].filter(x => x.val > 0).map(({ icon, label, val, color }) => (
                <div key={label} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                  style={{ background: color + "18", border: `1px solid ${color}30` }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 12, color }}>{icon}</span>
                  <span className="text-[10px] font-bold mono-nums" style={{ color }}>{Number(val).toLocaleString()}</span>
                </div>
              ))}
            </div>
            {agregat.nb_bio_bobo > 0 && (
              <div className="mt-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg w-fit"
                style={{ background: "#10b98118", border: "1px solid #10b98130" }}>
                <span className="material-symbols-outlined text-emerald-400" style={{ fontSize: 12 }}>eco</span>
                <span className="text-[10px] text-emerald-400 font-bold">{agregat.nb_bio_bobo} bio/bobo</span>
              </div>
            )}
          </div>
        )}

        {/* ── TRANSPORTS EN COMMUN ─────────────────────────────────────── */}
        {agregat?.centroid_lat && agregat?.centroid_lon && (
          <TransportsSection lat={agregat.centroid_lat} lon={agregat.centroid_lon} code={agregat.code_commune} />
        )}

        {/* ── DERNIÈRES VENTES ──────────────────────────────────────────── */}
        <div className="rounded-xl p-4" style={{ background: "rgba(22,32,48,0.8)", border: "1px solid rgba(60,131,246,0.12)" }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-primary/70" style={{ fontSize: 13 }}>receipt_long</span>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Dernières Ventes</p>
          </div>
          {lastSales.length === 0
            ? <p className="text-[11px] text-slate-600 text-center py-2">Aucune transaction disponible</p>
            : <div className="space-y-2">
              {lastSales.map((t, i) => {
                const prix = t.valeur_fonciere
                  ? t.valeur_fonciere >= 1e6
                    ? `${(t.valeur_fonciere / 1e6).toFixed(2)}M€`
                    : `${(t.valeur_fonciere / 1000).toFixed(0)}k€`
                  : "—";
                const ppm = t.valeur_fonciere && t.surface_reelle_bati
                  ? `${Math.round(t.valeur_fonciere / t.surface_reelle_bati).toLocaleString()} €/m²` : null;
                const dpeColor = t.classe_energie ? DPE_COLORS[t.classe_energie]?.hex : null;
                return (
                  <div key={t.id} className="flex items-center justify-between p-2.5 rounded-lg"
                    style={{ background: i === 0 ? "rgba(60,131,246,0.07)" : "rgba(15,23,36,0.5)", border: `1px solid ${i === 0 ? "rgba(60,131,246,0.2)" : "rgba(30,41,59,0.5)"}` }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[10px] text-slate-400">{t.type_local || "Bien"} · {t.surface_reelle_bati?.toFixed(0) ?? "?"}m²</span>
                        {dpeColor && (
                          <span className="text-[8px] font-black px-1 rounded" style={{ background: dpeColor + "25", color: dpeColor }}>{t.classe_energie}</span>
                        )}
                      </div>
                      {ppm && <p className="text-[9px] text-slate-600 mono-nums">{ppm}</p>}
                    </div>
                    <span className="text-[12px] font-black mono-nums ml-2" style={{ color: i === 0 ? "#3c83f6" : "#94a3b8" }}>{prix}</span>
                  </div>
                );
              })}
            </div>
          }
        </div>

        {/* ── CTA — Voir transactions ───────────────────────────────────── */}
        <button
          onClick={() => {/* navigate to transactions with commune filter */}}
          className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all hover:brightness-110"
          style={{ background: "linear-gradient(135deg, #2563eb, #3c83f6)", color: "white" }}>
          Voir les transactions
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_forward</span>
        </button>

        <div className="h-2" />
      </div>
    </aside>
  );
}

// ─── Left Sidebar ──────────────────────────────────────────────────────────────
function LeftSidebar({ communes, transactions, selectedCommune, onSelectCommune, onSelectTransaction, search, onSearch,
  activeTypes, onToggleType, anneeMax, onAnneeChange, onReset, sortDesc, onToggleSort,
  hoveredTxId, onHoverTx, isLocked, onUnlock, open, onClose }) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [localSearch, setLocalSearch] = useState(search);
  const debounceRef = useRef(null);

  // Sync si le parent remet search à "" (ex: après sélection)
  useEffect(() => { setLocalSearch(search); }, [search]);

  const handleSearchChange = (e) => {
    const v = e.target.value;
    setLocalSearch(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearch(v), 200);
    setShowSuggestions(true);
  };

  const suggestions = useMemo(() =>
    search.length >= 1
      ? communes.filter(c => c.nom.toLowerCase().includes(search.toLowerCase()) || (c.code_postal || "").includes(search)).slice(0, 6)
      : []
  , [search, communes]);

  return (
    <aside className={`fixed md:relative inset-y-0 left-0 w-72 h-full flex-shrink-0 overflow-y-auto z-30 md:z-20 transition-transform duration-300 ${open ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      style={{ background: "rgba(16,23,34,0.95)", backdropFilter: "blur(12px)", borderRight: "1px solid rgba(60,131,246,0.1)" }}>
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
              value={localSearch}
              onChange={handleSearchChange}
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
              <span className="text-primary mono-nums">{ANNEE_MIN} – {anneeMax}</span>
            </div>
            <input type="range" min={ANNEE_MIN} max={ANNEE_MAX} value={anneeMax}
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
          ) : isLocked ? (
            <>
              {/* Bandeau lock */}
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg mb-1"
                style={{ background: "rgba(60,131,246,0.08)", border: "1px solid rgba(60,131,246,0.2)" }}>
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 13 }}>lock</span>
                <span className="text-[10px] text-primary font-semibold flex-1">Vue détaillée — {transactions.length} ventes</span>
                <button onClick={onUnlock} className="text-[9px] text-slate-400 hover:text-primary transition-colors underline">Déverr.</button>
              </div>
              {/* Cartes détaillées */}
              {transactions.map(t => {
                const addr = [t.adresse_numero, t.adresse].filter(Boolean).join(" ") || "Adresse non renseignée";
                const ppm = t.valeur_fonciere && t.surface_reelle_bati ? Math.round(t.valeur_fonciere / t.surface_reelle_bati) : null;
                const prix = t.valeur_fonciere
                  ? t.valeur_fonciere >= 1e6 ? `${(t.valeur_fonciere / 1e6).toFixed(2)}M €` : `${Math.round(t.valeur_fonciere / 1000)}k €`
                  : "—";
                const dpeS = t.classe_energie ? DPE_COLORS[t.classe_energie] : null;
                const date = t.date_mutation
                  ? new Date(t.date_mutation).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })
                  : null;
                const isHov = hoveredTxId === t.id;
                return (
                  <div key={t.id}
                    onClick={() => onSelectTransaction(t)}
                    onMouseEnter={() => onHoverTx(t.id)}
                    onMouseLeave={() => onHoverTx(null)}
                    className="rounded-lg cursor-pointer transition-all"
                    style={{
                      padding: "10px 12px",
                      background: isHov ? "rgba(60,131,246,0.12)" : "rgba(15,23,42,0.5)",
                      border: isHov ? "1px solid rgba(60,131,246,0.5)" : "1px solid rgba(51,65,85,0.5)",
                      transform: isHov ? "translateX(2px)" : "none",
                    }}>
                    {/* Adresse + DPE */}
                    <div className="flex items-start justify-between gap-1 mb-1.5">
                      <span className="text-[10px] text-slate-300 leading-snug flex-1">{addr}</span>
                      {dpeS && (
                        <span className={`shrink-0 text-[8px] font-black px-1.5 py-0.5 rounded ${dpeS.text}`}
                          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid currentColor", opacity: 0.9 }}>
                          DPE {t.classe_energie}
                        </span>
                      )}
                    </div>
                    {/* Prix */}
                    <div className="flex items-end justify-between mb-2">
                      <span className="text-[15px] font-bold text-white mono-nums">{prix}</span>
                      {ppm && <span className="text-[11px] font-semibold text-primary mono-nums">{ppm.toLocaleString("fr-FR")} €/m²</span>}
                    </div>
                    {/* Détails */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      {t.surface_reelle_bati && (
                        <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                          <span className="material-symbols-outlined" style={{ fontSize: 11 }}>straighten</span>
                          {t.surface_reelle_bati} m²
                        </span>
                      )}
                      {t.nombre_pieces && (
                        <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                          <span className="material-symbols-outlined" style={{ fontSize: 11 }}>meeting_room</span>
                          T{t.nombre_pieces}
                        </span>
                      )}
                      {t.type_local && <span className="text-[10px] text-slate-500">{t.type_local}</span>}
                      {date && <span className="text-[9px] text-slate-600 ml-auto">{date}</span>}
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
            // Mode compact
            transactions.slice(0, 8).map((t, i) => {
              const addr = [t.adresse_numero, t.adresse].filter(Boolean).join(" ").toUpperCase();
              const ppm = t.valeur_fonciere && t.surface_reelle_bati
                ? Math.round(t.valeur_fonciere / t.surface_reelle_bati).toLocaleString() : "—";
              const prix = t.valeur_fonciere
                ? t.valeur_fonciere >= 1e6 ? `${(t.valeur_fonciere / 1e6).toFixed(2)}M €` : `${(t.valeur_fonciere / 1000).toFixed(0)}k €`
                : "—";
              const info = `${t.surface_reelle_bati?.toFixed(0) ?? "?"}m² · T${t.nombre_pieces ?? "?"}`;
              const dpeS = t.classe_energie ? DPE_COLORS[t.classe_energie] : null;
              const isHov = hoveredTxId === t.id;
              return (
                <div key={t.id}
                  onClick={() => onSelectTransaction(t)}
                  onMouseEnter={() => onHoverTx(t.id)}
                  onMouseLeave={() => onHoverTx(null)}
                  className="p-3 rounded-lg cursor-pointer transition-all group"
                  style={{
                    background: isHov ? "rgba(60,131,246,0.10)" : i === 0 ? "rgba(60,131,246,0.06)" : "rgba(15,23,42,0.4)",
                    border: isHov ? "1px solid rgba(60,131,246,0.5)" : i === 0 ? "1px solid rgba(60,131,246,0.25)" : "1px solid rgba(51,65,85,0.5)",
                    transform: isHov ? "translateX(2px)" : "none",
                  }}>
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
                    <span className={`text-[10px] mono-nums ${isHov || i === 0 ? "text-primary" : "text-slate-500 group-hover:text-primary"} transition-colors`}>€{ppm}/m²</span>
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
const ANNEE_MIN = 2021;
const ANNEE_MAX = 2025;
const TYPES_ALL = ["Appartement", "Maison"];

export default function MapView() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markersRef = useRef([]);
  const popupsRef = useRef([]);
  const markerClickedRef = useRef(false);
  const highlightMarkerRef = useRef(null);
  const mapClickHandlerRef = useRef(null);
  const allCommunesRef = useRef([]);       // ref stable → accessible dans les handlers map
  const handleSelectRef = useRef(null);   // idem pour handleSelectCommune
  const navigate = useNavigate();
  const initialSelectDone = useRef(false);

  const [searchParams] = useSearchParams();
  const { communes: contextCommunes } = useCommunes();
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
  const [mapClickLoading, setMapClickLoading] = useState(false);
  const [hoveredTxId, setHoveredTxId] = useState(null);
  const [lockedCommune, setLockedCommune] = useState(null);
  const lockedRef = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const txMarkerElsRef = useRef(new Map());
  const txTooltipDataRef = useRef(new Map());
  const hoverTipRef = useRef(null);
  const txHoverDivRef = useRef(null);
  const [txHover, setTxHover] = useState(null); // { x, y, html }
  const setTxHoverRef = useRef(null);
  useEffect(() => { setTxHoverRef.current = setTxHover; }, []);
  const setHoveredTxIdRef = useRef(null);
  const agregatAbortRef = useRef(null);
  const txAbortRef = useRef(null);
  const poiLoadingRef = useRef(null);
  const selectedCommuneRef = useRef(null);
  const [showTransports, setShowTransports] = useState(false);
  const transportMarkersRef = useRef([]);
  const [showSecurity, setShowSecurity] = useState(false);
  const securityMarkersRef = useRef([]);
  const [showRestaurants, setShowRestaurants] = useState(false);
  const restaurantMarkersRef = useRef([]);
  const [showSchools, setShowSchools] = useState(false);
  const schoolMarkersRef = useRef([]);
  const [showParks, setShowParks] = useState(false);
  const parkMarkersRef = useRef([]);
  const [showShops, setShowShops] = useState(false);
  const shopMarkersRef = useRef([]);
  const communeCenterRef = useRef(null);

  useEffect(() => { setHoveredTxIdRef.current = setHoveredTxId; }, []);
  // Synchronise lockedRef avec le state pour les closures des handlers de carte
  useEffect(() => { lockedRef.current = !!lockedCommune; }, [lockedCommune]);
  // Synchronise selectedCommuneRef pour les callbacks async (sans stale closure)
  useEffect(() => { selectedCommuneRef.current = selectedCommune; }, [selectedCommune]);

  useEffect(() => {
    if (contextCommunes.length > 0) {
      setAllCommunes(contextCommunes);
      setCommunes(contextCommunes);
    }
  }, [contextCommunes]);

  useEffect(() => {
    if (!search) { setCommunes(allCommunes); return; }
    const q = search.toLowerCase();
    setCommunes(allCommunes.filter(c => c.nom.toLowerCase().includes(q)));
  }, [search, allCommunes]);

  // Recharge les transactions quand commune ou filtres changent
  const loadAgregat = useCallback((commune) => {
    if (!commune?.code_insee) return;
    agregatAbortRef.current?.abort();
    agregatAbortRef.current = new AbortController();
    setAgregat(null);
    const code = commune.code_insee.startsWith("751") && commune.code_insee !== "75056"
      ? "75056"
      : commune.code_insee;
    axios.get(`/api/v1/communes/${code}/agregat`, { signal: agregatAbortRef.current.signal })
      .then(r => setAgregat(r.data))
      .catch(err => { if (!axios.isCancel(err)) setAgregat(null); });
  }, []);

  const loadTransactions = useCallback((commune, types, maxAnnee, fly = true) => {
    if (!commune) return;
    txAbortRef.current?.abort();
    txAbortRef.current = new AbortController();
    const typeParam = types.size === 1 ? `&type_local=${[...types][0]}` : "";
    const anneeParam = maxAnnee < ANNEE_MAX ? `&annee=${maxAnnee}` : "";
    axios.get(`/api/v1/transactions?commune=${commune.code_insee}&limit=100${typeParam}${anneeParam}`, { signal: txAbortRef.current.signal }).then(r => {
      const data = r.data.data || [];
      setTransactions(data);
      popupsRef.current.forEach(p => p.remove());
      popupsRef.current = [];
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      txMarkerElsRef.current.clear();
      txTooltipDataRef.current.clear();
      setTxHoverRef.current?.(null);

      // FlyTo seulement lors d'un changement de commune, pas lors d'un filtre
      if (fly) {
        const withCoords = data.filter(t => t.longitude && t.latitude);
        if (withCoords.length && map.current) {
          const avgLon = withCoords.reduce((s, t) => s + t.longitude, 0) / withCoords.length;
          const avgLat = withCoords.reduce((s, t) => s + t.latitude, 0) / withCoords.length;
          communeCenterRef.current = [avgLon, avgLat];
          map.current.flyTo({ center: [avgLon, avgLat], zoom: 13, duration: 900 });
          // Prefetch POI immédiatement — dès qu'on connaît les coordonnées
          const poiCode = commune.code_insee;
          if (poiCode && !POI_CACHE.has(poiCode) && !POI_PENDING.has(poiCode)) {
            poiLoadingRef.current?.abort();
            poiLoadingRef.current = new AbortController();
            fetchPOIBatch(poiCode, avgLat, avgLon, poiLoadingRef.current.signal).catch(() => {});
          }
        }
      }


      data.forEach(t => {
        if (!t.longitude || !t.latitude) return;
        // Wrapper 26px avec fond presque invisible pour capturer les events souris
        const el = document.createElement("div");
        el.style.cssText = "width:26px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;background:rgba(60,131,246,0.08);";
        const dot = document.createElement("div");
        dot.style.cssText = "width:10px;height:10px;background:#3c83f6;border-radius:50%;border:2px solid rgba(255,255,255,0.65);box-shadow:0 0 8px rgba(60,131,246,0.7);transition:transform .15s,box-shadow .15s;pointer-events:none;";
        el.appendChild(dot);
        const dpeColors = { A:"#22c55e",B:"#4ade80",C:"#facc15",D:"#fb923c",E:"#f97316",F:"#ef4444",G:"#dc2626" };
        const prixM2 = t.valeur_fonciere && t.surface_reelle_bati ? Math.round(t.valeur_fonciere / t.surface_reelle_bati) : null;
        const prixFmt = t.valeur_fonciere
          ? (t.valeur_fonciere >= 1e6 ? (t.valeur_fonciere/1e6).toFixed(2)+"M €" : Math.round(t.valeur_fonciere/1000)+"k €")
          : "—";
        const dpeC = t.classe_energie ? (dpeColors[t.classe_energie] || "#64748b") : null;
        const adresse = [t.adresse_numero, t.adresse].filter(Boolean).join(" ") || "Adresse non renseignée";
        const date = t.date_mutation ? new Date(t.date_mutation).toLocaleDateString("fr-FR", { month:"short", year:"numeric" }) : "";

        const tipHtml = `
          <div style="font-family:Inter,sans-serif;padding:2px 0;min-width:180px">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
              <div style="width:6px;height:6px;background:#3c83f6;border-radius:50%;flex-shrink:0"></div>
              <span style="font-size:10px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px">${adresse}</span>
            </div>
            <div style="font-size:20px;font-weight:900;color:#fff;letter-spacing:-0.5px;line-height:1.1">${prixFmt}</div>
            ${prixM2 ? `<div style="font-size:11px;color:#3c83f6;font-weight:700;margin-top:2px">${prixM2.toLocaleString("fr-FR")} €/m²</div>` : ""}
            <div style="height:1px;background:rgba(255,255,255,0.07);margin:7px 0"></div>
            <div style="display:flex;align-items:center;gap:8px;font-size:10px">
              ${t.surface_reelle_bati ? `<span style="color:#cbd5e1">${t.surface_reelle_bati} m²</span>` : ""}
              ${t.nombre_pieces ? `<span style="color:#cbd5e1">T${t.nombre_pieces}</span>` : ""}
              ${t.type_local ? `<span style="color:#64748b">${t.type_local}</span>` : ""}
              ${dpeC ? `<span style="font-weight:800;font-size:10px;padding:0 5px;border-radius:3px;background:${dpeC}22;color:${dpeC};border:1px solid ${dpeC}44;margin-left:auto">DPE ${t.classe_energie}</span>` : ""}
            </div>
            ${date ? `<div style="font-size:9px;color:#475569;margin-top:5px;text-align:right">${date}</div>` : ""}
          </div>`;

        txTooltipDataRef.current.set(t.id, { lngLat: [t.longitude, t.latitude], html: tipHtml });

        el.addEventListener("mouseenter", (e) => {
          setHoveredTxIdRef.current?.(t.id);
          dot.style.transform = "scale(1.7)";
          dot.style.boxShadow = "0 0 14px rgba(60,131,246,0.95)";
          const rect = mapContainer.current?.getBoundingClientRect();
          if (rect) {
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            setTxHoverRef.current?.({ x: px, y: py, html: tipHtml });
          }
        });
        el.addEventListener("mouseleave", () => {
          setHoveredTxIdRef.current?.(null);
          dot.style.transform = "scale(1)";
          dot.style.boxShadow = "0 0 8px rgba(60,131,246,0.7)";
          setTxHoverRef.current?.(null);
        });
        const popup = new maplibregl.Popup({ offset: 16, closeButton: true, maxWidth: "280px", closeOnClick: false })
          .setHTML(`<div style="font-family:Inter,sans-serif;min-width:220px;padding:4px 2px">
            <div style="font-size:10px;color:#94a3b8;margin-bottom:6px;display:flex;align-items:center;gap:4px">
              <svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#3c83f6" opacity="0.4"/><circle cx="5" cy="5" r="2" fill="#3c83f6"/></svg>
              ${adresse}
            </div>
            <div style="font-size:24px;font-weight:900;color:#3c83f6;letter-spacing:-0.5px;line-height:1">${prixFmt}</div>
            ${prixM2 ? `<div style="font-size:12px;color:#94a3b8;margin-top:3px;font-weight:600">${prixM2.toLocaleString("fr-FR")} €/m²</div>` : ""}
            <div style="height:1px;background:rgba(60,131,246,0.15);margin:8px 0"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:10px">
              ${t.surface_reelle_bati ? `<div><div style="color:#64748b">Surface</div><div style="color:#cbd5e1;font-weight:700">${t.surface_reelle_bati} m²</div></div>` : ""}
              ${t.nombre_pieces ? `<div><div style="color:#64748b">Pièces</div><div style="color:#cbd5e1;font-weight:700">T${t.nombre_pieces}</div></div>` : ""}
              ${t.type_local ? `<div><div style="color:#64748b">Type</div><div style="color:#cbd5e1;font-weight:700">${t.type_local}</div></div>` : ""}
              ${t.date_mutation ? `<div><div style="color:#64748b">Vente</div><div style="color:#cbd5e1;font-weight:700">${new Date(t.date_mutation).toLocaleDateString("fr-FR",{month:"short",year:"numeric"})}</div></div>` : ""}
            </div>
            ${dpeC ? `<div style="margin-top:8px;display:flex;align-items:center;gap:6px"><span style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Performance énergétique</span><span style="font-weight:900;font-size:11px;padding:1px 7px;border-radius:4px;background:${dpeC}20;color:${dpeC};border:1px solid ${dpeC}44">DPE ${t.classe_energie}</span></div>` : ""}
          </div>`);
        // Gérer le popup manuellement — verrou pour empêcher le handler de commune de réagir
        el.addEventListener("click", e => {
          e.stopPropagation();
          markerClickedRef.current = true;
          setTimeout(() => { markerClickedRef.current = false; }, 100);
          if (popup.isOpen()) {
            popup.remove();
          } else {
            popup.setLngLat([t.longitude, t.latitude]).addTo(map.current);
          }
        });
        txMarkerElsRef.current.set(t.id, el);
        popupsRef.current.push(popup);
        markersRef.current.push(new maplibregl.Marker(el).setLngLat([t.longitude, t.latitude]).addTo(map.current));
      });
    }).catch(err => { if (!axios.isCancel(err)) console.warn("loadTransactions:", err); });
  }, []);

  const handleSelectCommune = useCallback((commune) => {
    setSelectedCommune(commune);
    setLockedCommune(commune);
    loadTransactions(commune, activeTypes, anneeMax);
    loadAgregat(commune);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTransactions, loadAgregat, activeTypes, anneeMax]);

  const handleHoverTx = useCallback((txId) => {
    setHoveredTxId(txId);
    txMarkerElsRef.current.forEach((el, id) => {
      const d = el.firstChild || el;
      if (id === txId) {
        d.style.transform = "scale(1.7)";
        d.style.boxShadow = "0 0 14px rgba(60,131,246,0.95)";
      } else {
        d.style.transform = "scale(1)";
        d.style.boxShadow = "0 0 8px rgba(60,131,246,0.7)";
      }
    });
    if (txId && map.current) {
      const data = txTooltipDataRef.current.get(txId);
      if (data) {
        const px = map.current.project(data.lngLat);
        setTxHover({ x: px.x, y: px.y, html: data.html });
      }
    } else {
      setTxHover(null);
    }
  }, []);

  const handleUnlock = useCallback(() => {
    setLockedCommune(null);
  }, []);

  const handleLock = useCallback((commune) => {
    if (!commune) return;
    setLockedCommune(commune);
  }, []);

  const loadTransportMarkers = useCallback(async () => {
    transportMarkersRef.current.forEach(m => m.remove());
    transportMarkersRef.current = [];
    const center = communeCenterRef.current;
    const code = selectedCommuneRef.current?.code_insee;
    if (!center || !map.current || !code) return;
    const [lon, lat] = center;
    try {
      const data = await fetchPOIBatch(code, lat, lon, poiLoadingRef.current?.signal);
      if (!data || !map.current) return;
      const seen = new Set();
      data.transports
        .filter(stop => {
          const name = stop.tags?.name;
          if (!name) return false;
          const key = `${detectType(stop.tags)}:${name}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 30)
        .forEach(stop => {
          const type = detectType(stop.tags);
          const el = createTransportMarkerEl(type, stop.tags?.name || "");
          transportMarkersRef.current.push(
            new maplibregl.Marker({ element: el, anchor: "center" })
              .setLngLat([stop.lon, stop.lat])
              .addTo(map.current)
          );
        });
    } catch (err) { console.warn("Overpass transports:", err); }
  }, []);

  const SECURITY_OSM_CFG = {
    police:       { bg: "#1e40af", letter: "P", label: "Police" },
    fire_station: { bg: "#dc2626", letter: "F", label: "Pompiers" },
    hospital:     { bg: "#db2777", letter: "H", label: "Hôpital" },
    pharmacy:     { bg: "#059669", letter: "Rx", label: "Pharmacie" },
  };

  const loadSecurityMarkers = useCallback(async () => {
    securityMarkersRef.current.forEach(m => m.remove());
    securityMarkersRef.current = [];
    const center = communeCenterRef.current;
    const code = selectedCommuneRef.current?.code_insee;
    if (!center || !map.current || !code) return;
    const [lon, lat] = center;
    try {
      const data = await fetchPOIBatch(code, lat, lon, poiLoadingRef.current?.signal);
      if (!data || !map.current) return;
      const seen = new Set();
      data.security.slice(0, 50).forEach(el => {
        const type = el.tags?.amenity;
        const name = el.tags?.name || type;
        const key = `${type}:${name}`;
        if (seen.has(key)) return;
        seen.add(key);
        const cfg = SECURITY_OSM_CFG[type] || { bg: "#475569", letter: "?" };
        const dom = document.createElement("div");
        dom.title = name;
        dom.style.cssText = `width:16px;height:16px;background:${cfg.bg};border-radius:50%;border:2px solid rgba(255,255,255,0.9);display:flex;align-items:center;justify-content:center;font-size:6px;font-weight:900;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,0.6),0 0 0 1px ${cfg.bg}44;pointer-events:none;`;
        dom.textContent = cfg.letter;
        securityMarkersRef.current.push(
          new maplibregl.Marker({ element: dom, anchor: "center" })
            .setLngLat([el.lon, el.lat])
            .addTo(map.current)
        );
      });
    } catch (err) { console.warn("Overpass sécurité:", err); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (showSecurity && selectedCommune) {
      loadSecurityMarkers();
    } else {
      securityMarkersRef.current.forEach(m => m.remove());
      securityMarkersRef.current = [];
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSecurity, selectedCommune]);

  const createPOIMkr = (letter, bg, name) => {
    const dom = document.createElement("div");
    dom.title = name;
    dom.style.cssText = `width:16px;height:16px;background:${bg};border-radius:50%;border:2px solid rgba(255,255,255,0.9);display:flex;align-items:center;justify-content:center;font-size:${letter.length > 1 ? "5px" : "7px"};font-weight:900;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,0.6),0 0 0 1px ${bg}44;pointer-events:none;`;
    dom.textContent = letter;
    return dom;
  };

  const loadRestaurantMarkers = useCallback(async () => {
    restaurantMarkersRef.current.forEach(m => m.remove());
    restaurantMarkersRef.current = [];
    const center = communeCenterRef.current;
    const code = selectedCommuneRef.current?.code_insee;
    if (!center || !map.current || !code) return;
    const [lon, lat] = center;
    try {
      const data = await fetchPOIBatch(code, lat, lon, poiLoadingRef.current?.signal);
      if (!data || !map.current) return;
      const seen = new Set();
      data.restaurants
        .filter(el => {
          const key = `${el.tags?.name || ""}:${Math.round(el.lat * 1000)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 40)
        .forEach(el => {
          restaurantMarkersRef.current.push(
            new maplibregl.Marker({ element: createPOIMkr("R", "#f97316", el.tags?.name || "Restaurant"), anchor: "center" })
              .setLngLat([el.lon, el.lat]).addTo(map.current)
          );
        });
    } catch (err) { console.warn("Overpass restaurants:", err); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (showRestaurants && selectedCommune) loadRestaurantMarkers();
    else { restaurantMarkersRef.current.forEach(m => m.remove()); restaurantMarkersRef.current = []; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRestaurants, selectedCommune]);

  const loadSchoolMarkers = useCallback(async () => {
    schoolMarkersRef.current.forEach(m => m.remove());
    schoolMarkersRef.current = [];
    const center = communeCenterRef.current;
    const code = selectedCommuneRef.current?.code_insee;
    if (!center || !map.current || !code) return;
    const [lon, lat] = center;
    try {
      const data = await fetchPOIBatch(code, lat, lon, poiLoadingRef.current?.signal);
      if (!data || !map.current) return;
      const seen = new Set();
      data.schools
        .filter(el => {
          const key = `${el.tags?.name || ""}:${Math.round(el.lat * 1000)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 30)
        .forEach(el => {
          const type = el.tags?.amenity;
          const cfg = type === "kindergarten" ? { letter: "M", bg: "#fbbf24" }
                    : type === "university" || type === "college" ? { letter: "U", bg: "#3b82f6" }
                    : { letter: "É", bg: "#0ea5e9" };
          schoolMarkersRef.current.push(
            new maplibregl.Marker({ element: createPOIMkr(cfg.letter, cfg.bg, el.tags?.name || "École"), anchor: "center" })
              .setLngLat([el.lon, el.lat]).addTo(map.current)
          );
        });
    } catch (err) { console.warn("Overpass écoles:", err); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (showSchools && selectedCommune) loadSchoolMarkers();
    else { schoolMarkersRef.current.forEach(m => m.remove()); schoolMarkersRef.current = []; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSchools, selectedCommune]);

  const loadParkMarkers = useCallback(async () => {
    parkMarkersRef.current.forEach(m => m.remove());
    parkMarkersRef.current = [];
    const center = communeCenterRef.current;
    const code = selectedCommuneRef.current?.code_insee;
    if (!center || !map.current || !code) return;
    const [lon, lat] = center;
    try {
      const data = await fetchPOIBatch(code, lat, lon, poiLoadingRef.current?.signal);
      if (!data || !map.current) return;
      const seen = new Set();
      data.parks
        .filter(el => {
          const key = `${el.tags?.name || ""}:${Math.round(el.lat * 1000)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 25)
        .forEach(el => {
          const type = el.tags?.leisure;
          const cfg = type === "playground" ? { letter: "J", bg: "#22c55e" }
                    : type === "nature_reserve" ? { letter: "N", bg: "#15803d" }
                    : { letter: "P", bg: "#84cc16" };
          parkMarkersRef.current.push(
            new maplibregl.Marker({ element: createPOIMkr(cfg.letter, cfg.bg, el.tags?.name || "Parc"), anchor: "center" })
              .setLngLat([el.lon, el.lat]).addTo(map.current)
          );
        });
    } catch (err) { console.warn("Overpass parcs:", err); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (showParks && selectedCommune) loadParkMarkers();
    else { parkMarkersRef.current.forEach(m => m.remove()); parkMarkersRef.current = []; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showParks, selectedCommune]);

  const loadShopMarkers = useCallback(async () => {
    shopMarkersRef.current.forEach(m => m.remove());
    shopMarkersRef.current = [];
    const center = communeCenterRef.current;
    const code = selectedCommuneRef.current?.code_insee;
    if (!center || !map.current || !code) return;
    const [lon, lat] = center;
    try {
      const data = await fetchPOIBatch(code, lat, lon, poiLoadingRef.current?.signal);
      if (!data || !map.current) return;
      const seen = new Set();
      data.shops
        .filter(el => {
          const key = `${el.tags?.name || ""}:${Math.round(el.lat * 1000)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 30)
        .forEach(el => {
          const type = el.tags?.shop;
          const cfg = type === "supermarket" || type === "mall" ? { letter: "S", bg: "#7c3aed" }
                    : type === "bakery" ? { letter: "B", bg: "#d97706" }
                    : { letter: "C", bg: "#a855f7" };
          shopMarkersRef.current.push(
            new maplibregl.Marker({ element: createPOIMkr(cfg.letter, cfg.bg, el.tags?.name || "Commerce"), anchor: "center" })
              .setLngLat([el.lon, el.lat]).addTo(map.current)
          );
        });
    } catch (err) { console.warn("Overpass commerces:", err); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (showShops && selectedCommune) loadShopMarkers();
    else { shopMarkersRef.current.forEach(m => m.remove()); shopMarkersRef.current = []; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showShops, selectedCommune]);

  // Garder les refs à jour pour les handlers enregistrés sur la carte
  useEffect(() => { allCommunesRef.current = allCommunes; }, [allCommunes]);
  useEffect(() => { handleSelectRef.current = handleSelectCommune; }, [handleSelectCommune]);

  useEffect(() => {
    if (showTransports && selectedCommune) {
      loadTransportMarkers();
    } else {
      transportMarkersRef.current.forEach(m => m.remove());
      transportMarkersRef.current = [];
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTransports, selectedCommune]);

  const handleToggleType = (type) => {
    setActiveTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) { if (next.size > 1) next.delete(type); }
      else next.add(type);
      loadTransactions(selectedCommune, next, anneeMax, false);
      return next;
    });
  };

  const handleAnneeChange = (val) => {
    setAnneeMax(val);
    loadTransactions(selectedCommune, activeTypes, val, false);
  };

  const handleReset = () => {
    setActiveTypes(new Set(TYPES_ALL));
    setAnneeMax(ANNEE_MAX);
    loadTransactions(selectedCommune, new Set(TYPES_ALL), ANNEE_MAX, false);
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
      window.history.replaceState({}, "", window.location.pathname);
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
    window.history.replaceState({}, "", window.location.pathname);
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
    // Contrôles zoom/navigation gérés par les boutons custom (éviter superposition)

    // ── Chargement polygones IDF + hover ────────────────────────────────────
    map.current.on("load", async () => {
      try {
        const res = await fetch(
          "https://geo.api.gouv.fr/communes?codeRegion=11&geometry=contour&format=geojson&fields=nom,code",
          { signal: AbortSignal.timeout(5000) }
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

        let prefetchHoveredCode = null;
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
          // Prefetch POI silencieux — résultat mis en L1 RAM + cache HTTP navigateur
          const hoverCode = e.features[0].properties.code;
          if (hoverCode && hoverCode !== prefetchHoveredCode && !POI_CACHE.has(hoverCode)) {
            prefetchHoveredCode = hoverCode;
            fetch(`/api/v1/poi/${hoverCode}`).then(r => r.json()).then(b => POI_CACHE.set(hoverCode, b)).catch(() => {});
          }
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
          if (lockedRef.current) return;
          if (!e.features?.length) return;
          if (markerClickedRef.current) return; // clic sur marqueur, ignorer
          e.originalEvent._communeHandled = true;
          const { code, nom } = e.features[0].properties;
          const found = allCommunesRef.current.find(c => c.code_insee === code)
            || allCommunesRef.current.find(c => c.nom.toLowerCase() === nom.toLowerCase());
          if (found && handleSelectRef.current) handleSelectRef.current(found);
        });

      } catch (err) {
        console.warn("GeoJSON IDF non chargé:", err);
      }
    });

    return () => {
      markersRef.current.forEach(m => m.remove());
      popupsRef.current.forEach(p => p.remove());
      hoverTipRef.current?.remove();
      [transportMarkersRef, securityMarkersRef, restaurantMarkersRef, schoolMarkersRef, parkMarkersRef, shopMarkersRef]
        .forEach(ref => ref.current.forEach(m => m.remove()));
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // ── Clic sur la carte → géocoder la commune ───────────────────────────────
  useEffect(() => {
    if (!map.current) return;

    // Dé-enregistrer l'ancien handler
    if (mapClickHandlerRef.current) {
      map.current.off("click", mapClickHandlerRef.current);
    }

    mapClickHandlerRef.current = async (e) => {
      if (lockedRef.current) return;
      // Ignorer si déjà traité par le layer GeoJSON ou un marqueur de transaction
      if (e.originalEvent?._communeHandled) return;
      if (markerClickedRef.current) return;
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
          `https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lng}&fields=nom,code,codesPostaux&limit=1`,
          { signal: AbortSignal.timeout(5000) }
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
    <div className="relative flex h-full">
      {/* Backdrop mobile — ferme sidebar au clic dehors */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 bg-black/50 z-20" onClick={() => setSidebarOpen(false)} />
      )}

      <LeftSidebar
        communes={communes}
        transactions={sortDesc ? [...transactions].sort((a,b) => (b.valeur_fonciere||0)-(a.valeur_fonciere||0)) : transactions}
        selectedCommune={selectedCommune}
        onSelectCommune={(c) => { handleSelectCommune(c); setSidebarOpen(false); }}
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
        hoveredTxId={hoveredTxId}
        onHoverTx={handleHoverTx}
        isLocked={!!lockedCommune}
        onUnlock={handleUnlock}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="relative flex-1">
        {/* Bouton hamburger — mobile uniquement */}
        <button
          className="md:hidden absolute bottom-24 left-4 z-20 size-12 rounded-full shadow-lg flex items-center justify-center"
          style={{ background: "rgba(60,131,246,0.95)", boxShadow: "0 4px 16px rgba(60,131,246,0.4)" }}
          onClick={() => setSidebarOpen(v => !v)}
        >
          <span className="material-symbols-outlined text-white" style={{ fontSize: 22 }}>
            {sidebarOpen ? "close" : "menu"}
          </span>
        </button>

        {/* MapLibre 2D — toujours monté pour garder l'état, juste caché en mode 3D */}
        <div ref={mapContainer} className="w-full h-full" style={{ display: is3D ? "none" : "block", cursor: mapClickLoading ? "wait" : "crosshair" }} />

        {/* Cesium 3D — monté uniquement quand activé */}
        {is3D && (
          <CesiumView3D
            selectedCommune={selectedCommune}
            transactions={transactions}
            agregat={agregat}
            initCenter={cesiumInitCenter}
            flyTarget={cesiumFlyTarget}
          />
        )}

        {/* ── Hover tooltip transaction — overlay React ── */}
        {txHover && (() => {
          const containerW = mapContainer.current?.offsetWidth ?? 800;
          const left = txHover.x + 18 + 255 > containerW ? txHover.x - 265 : txHover.x + 18;
          return (
            <div
              style={{
                position: "absolute",
                left: Math.max(4, left),
                top: Math.max(4, txHover.y - 20),
                zIndex: 9999,
                pointerEvents: "none",
                minWidth: 200,
                maxWidth: 250,
                borderRadius: 12,
                padding: "12px 14px",
                background: "rgba(10,16,28,0.97)",
                border: "1px solid rgba(60,131,246,0.5)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
                backdropFilter: "blur(8px)",
                fontFamily: "Inter,sans-serif",
              }}
              dangerouslySetInnerHTML={{ __html: txHover.html }}
            />
          );
        })()}

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

          {/* Toggles couches OSM — désactivés en vue 3D (marqueurs MapLibre non visibles) */}
          <div className={`flex flex-col gap-2 ${is3D ? "opacity-40 pointer-events-none" : ""}`}>
          {/* Toggle sécurité */}
          <button
            onClick={() => setShowSecurity(v => !v)}
            title={showSecurity ? "Masquer services sécurité" : "Afficher police, pompiers, hôpitaux"}
            className={`size-11 rounded-xl flex items-center justify-center transition-all ${
              showSecurity ? "text-white shadow-lg" : "glass-panel hover:bg-primary/20 text-slate-300"
            }`}
            style={showSecurity ? { background: "#1e40af", boxShadow: "0 4px 20px rgba(30,64,175,0.4)" } : {}}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>local_police</span>
          </button>

          {/* Toggle transports */}
          <button
            onClick={() => setShowTransports(v => !v)}
            title={showTransports ? "Masquer les transports" : "Afficher les stations de transport"}
            className={`size-11 rounded-xl flex items-center justify-center transition-all ${
              showTransports ? "text-white shadow-lg" : "glass-panel hover:bg-primary/20 text-slate-300"
            }`}
            style={showTransports ? { background: "#10b981", boxShadow: "0 4px 20px rgba(16,185,129,0.4)" } : {}}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>directions_transit</span>
          </button>

          {/* Toggle restaurants */}
          <button
            onClick={() => setShowRestaurants(v => !v)}
            title={showRestaurants ? "Masquer les restaurants" : "Afficher restaurants & cafés"}
            className={`size-11 rounded-xl flex items-center justify-center transition-all ${
              showRestaurants ? "text-white shadow-lg" : "glass-panel hover:bg-primary/20 text-slate-300"
            }`}
            style={showRestaurants ? { background: "#f97316", boxShadow: "0 4px 20px rgba(249,115,22,0.4)" } : {}}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>restaurant</span>
          </button>

          {/* Toggle écoles */}
          <button
            onClick={() => setShowSchools(v => !v)}
            title={showSchools ? "Masquer les écoles" : "Afficher écoles & universités"}
            className={`size-11 rounded-xl flex items-center justify-center transition-all ${
              showSchools ? "text-white shadow-lg" : "glass-panel hover:bg-primary/20 text-slate-300"
            }`}
            style={showSchools ? { background: "#0ea5e9", boxShadow: "0 4px 20px rgba(14,165,233,0.4)" } : {}}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>school</span>
          </button>

          {/* Toggle parcs */}
          <button
            onClick={() => setShowParks(v => !v)}
            title={showParks ? "Masquer les parcs" : "Afficher parcs & jardins"}
            className={`size-11 rounded-xl flex items-center justify-center transition-all ${
              showParks ? "text-white shadow-lg" : "glass-panel hover:bg-primary/20 text-slate-300"
            }`}
            style={showParks ? { background: "#84cc16", boxShadow: "0 4px 20px rgba(132,204,22,0.4)" } : {}}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>park</span>
          </button>

          {/* Toggle commerces */}
          <button
            onClick={() => setShowShops(v => !v)}
            title={showShops ? "Masquer les commerces" : "Afficher supermarchés & commerces"}
            className={`size-11 rounded-xl flex items-center justify-center transition-all ${
              showShops ? "text-white shadow-lg" : "glass-panel hover:bg-primary/20 text-slate-300"
            }`}
            style={showShops ? { background: "#a855f7", boxShadow: "0 4px 20px rgba(168,85,247,0.4)" } : {}}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>storefront</span>
          </button>
          </div>

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

        {/* FAB Lock/Unlock — bas gauche, rouge quand verrouillé */}
        {selectedCommune && (
          <button
            onClick={lockedCommune ? handleUnlock : () => handleLock(selectedCommune)}
            title={lockedCommune ? `Déverrouiller — ${lockedCommune.nom}` : "Verrouiller cette commune"}
            className="absolute bottom-10 left-4 z-20 rounded-full flex items-center justify-center hover:scale-105 transition-all"
            style={{
              width: 52, height: 52,
              background: lockedCommune ? "#ef4444" : "rgba(22,32,48,0.9)",
              border: lockedCommune ? "none" : "1px solid rgba(239,68,68,0.5)",
              boxShadow: lockedCommune
                ? "0 0 0 0 rgba(239,68,68,0.4), 0 4px 24px rgba(239,68,68,0.5)"
                : "0 4px 16px rgba(0,0,0,0.4)",
            }}>
            <span className="material-symbols-outlined text-white" style={{ fontSize: 24, fontVariationSettings: "'FILL' 1" }}>
              {lockedCommune ? "lock" : "lock_open"}
            </span>
            {lockedCommune && (
              <span className="absolute -top-1 -right-1 size-4 bg-amber-400 border-2 border-background-dark rounded-full animate-pulse" />
            )}
          </button>
        )}

        {/* Légendes empilées — sécurité en bas, transport au dessus, puis POI (masquées en vue 3D) */}
        {(showTransports || showSecurity || showRestaurants || showSchools || showParks || showShops) && !is3D && (
          <div className="absolute bottom-10 left-[72px] z-10 flex flex-col gap-1.5">
            {showSecurity && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl"
                style={{ background: "rgba(10,16,28,0.92)", border: "1px solid rgba(30,64,175,0.3)", backdropFilter: "blur(8px)" }}>
                {[
                  { letter: "P",  bg: "#1e40af", label: "Police" },
                  { letter: "F",  bg: "#dc2626", label: "Pompiers" },
                  { letter: "H",  bg: "#db2777", label: "Hôpital" },
                  { letter: "Rx", bg: "#059669", label: "Pharmacie" },
                ].map(({ letter, bg, label }) => (
                  <div key={letter} className="flex items-center gap-1">
                    <span className="flex items-center justify-center font-black text-white"
                      style={{ width: 14, height: 14, fontSize: 6, background: bg, borderRadius: "50%", border: "1.5px solid rgba(255,255,255,0.7)" }}>
                      {letter}
                    </span>
                    <span className="text-[9px] text-slate-400">{label}</span>
                  </div>
                ))}
              </div>
            )}
            {showTransports && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl"
                style={{ background: "rgba(10,16,28,0.92)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(8px)" }}>
                {[
                  { letter: "M", bg: "#3c83f6", label: "Métro" },
                  { letter: "R", bg: "#10b981", label: "RER" },
                  { letter: "T", bg: "#a78bfa", label: "Tram" },
                  { letter: "B", bg: "#f59e0b", label: "Bus", square: true },
                ].map(({ letter, bg, label, square }) => (
                  <div key={letter} className="flex items-center gap-1">
                    <span className="flex items-center justify-center text-[8px] font-black text-white"
                      style={{ width: 14, height: 14, background: bg, borderRadius: square ? 3 : "50%", border: "1.5px solid rgba(255,255,255,0.7)" }}>
                      {letter}
                    </span>
                    <span className="text-[9px] text-slate-400">{label}</span>
                  </div>
                ))}
              </div>
            )}
            {showRestaurants && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl"
                style={{ background: "rgba(10,16,28,0.92)", border: "1px solid rgba(249,115,22,0.3)", backdropFilter: "blur(8px)" }}>
                {[
                  { letter: "R", bg: "#f97316", label: "Restaurant" },
                  { letter: "R", bg: "#f97316", label: "Café/Bar" },
                ].map(({ letter, bg, label }, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <span className="flex items-center justify-center font-black text-white"
                      style={{ width: 14, height: 14, fontSize: 7, background: bg, borderRadius: "50%", border: "1.5px solid rgba(255,255,255,0.7)" }}>
                      {letter}
                    </span>
                    <span className="text-[9px] text-slate-400">{label}</span>
                  </div>
                ))}
              </div>
            )}
            {showSchools && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl"
                style={{ background: "rgba(10,16,28,0.92)", border: "1px solid rgba(14,165,233,0.3)", backdropFilter: "blur(8px)" }}>
                {[
                  { letter: "É", bg: "#0ea5e9", label: "École" },
                  { letter: "U", bg: "#3b82f6", label: "Université" },
                  { letter: "M", bg: "#fbbf24", label: "Maternelle" },
                ].map(({ letter, bg, label }) => (
                  <div key={label} className="flex items-center gap-1">
                    <span className="flex items-center justify-center font-black text-white"
                      style={{ width: 14, height: 14, fontSize: 6, background: bg, borderRadius: "50%", border: "1.5px solid rgba(255,255,255,0.7)" }}>
                      {letter}
                    </span>
                    <span className="text-[9px] text-slate-400">{label}</span>
                  </div>
                ))}
              </div>
            )}
            {showParks && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl"
                style={{ background: "rgba(10,16,28,0.92)", border: "1px solid rgba(132,204,22,0.3)", backdropFilter: "blur(8px)" }}>
                {[
                  { letter: "P", bg: "#84cc16", label: "Parc/Jardin" },
                  { letter: "J", bg: "#22c55e", label: "Jeux" },
                  { letter: "N", bg: "#15803d", label: "Nature" },
                ].map(({ letter, bg, label }) => (
                  <div key={label} className="flex items-center gap-1">
                    <span className="flex items-center justify-center font-black text-white"
                      style={{ width: 14, height: 14, fontSize: 7, background: bg, borderRadius: "50%", border: "1.5px solid rgba(255,255,255,0.7)" }}>
                      {letter}
                    </span>
                    <span className="text-[9px] text-slate-400">{label}</span>
                  </div>
                ))}
              </div>
            )}
            {showShops && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl"
                style={{ background: "rgba(10,16,28,0.92)", border: "1px solid rgba(168,85,247,0.3)", backdropFilter: "blur(8px)" }}>
                {[
                  { letter: "S", bg: "#7c3aed", label: "Supermarché" },
                  { letter: "B", bg: "#d97706", label: "Boulangerie" },
                  { letter: "C", bg: "#a855f7", label: "Commerce" },
                ].map(({ letter, bg, label }) => (
                  <div key={label} className="flex items-center gap-1">
                    <span className="flex items-center justify-center font-black text-white"
                      style={{ width: 14, height: 14, fontSize: 6, background: bg, borderRadius: "50%", border: "1.5px solid rgba(255,255,255,0.7)" }}>
                      {letter}
                    </span>
                    <span className="text-[9px] text-slate-400">{label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Status bar */}
        <div className="absolute bottom-0 left-0 right-0 h-8 border-t border-primary/20 flex items-center justify-between px-4 z-10"
          style={{ background: "rgba(16,23,34,0.95)", backdropFilter: "blur(8px)" }}>
          <div className="flex items-center gap-4">
            <span className="text-[10px] text-slate-500 mono-nums">Données DVF {ANNEE_MIN}–{ANNEE_MAX}</span>
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

      <RightPanel commune={selectedCommune} transactions={transactions} agregat={agregat} isLocked={!!lockedCommune} onUnlock={handleUnlock} />
    </div>
  );
}
