import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";

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
                style={{ width: `${Math.round((a / max) * 100)}%` }}
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
                style={{ width: `${Math.round((b / max) * 100)}%` }}
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
  const pct = val != null ? Math.min(Math.max(Number(val), 0), 10) * 10 : 0;
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-xs text-slate-400 w-28 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-bold text-slate-200 w-8 text-right">{val != null ? Number(val).toFixed(1) : "—"}</span>
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
          c.city?.toLowerCase().includes(q.toLowerCase())
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
    setQuery(commune.city);
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
                <p className="text-sm font-medium text-slate-100 truncate">{c.city}</p>
                <p className="text-[11px] text-slate-500">{c.code_commune} · Dép. {c.code_departement}</p>
              </div>
              {c.prix_median_m2 && (
                <span className="text-xs text-blue-400 shrink-0">{fmt(c.prix_median_m2)} €/m²</span>
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
      <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${color}`}>{side === "left" ? "Commune A" : "Commune B"}</p>
      <h2 className="text-xl font-bold text-slate-100">{data.city}</h2>
      <p className="text-xs text-slate-400 mt-0.5">Code INSEE {data.code_commune} · Dép. {data.code_departement}</p>
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
    </div>
  );
}

// ── Section groupée ───────────────────────────────────────────────────────────

function Section({ title, icon, children }) {
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
  const [allCommunes, setAllCommunes] = useState([]);

  // Charger toutes les communes au démarrage (pour l'autocomplete)
  useEffect(() => {
    axios.get("/api/v1/communes/agregat?limit=1300")
      .then(r => setAllCommunes(r.data.data || []))
      .catch(() => {});
  }, []);

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
    setCommuneA(c);
    if (c) setSearchParams(p => { p.set("a", c.code_commune); return p; });
    else setSearchParams(p => { p.delete("a"); return p; });
  };

  const handleSelectB = (c) => {
    setCommuneB(c);
    if (c) setSearchParams(p => { p.set("b", c.code_commune); return p; });
    else setSearchParams(p => { p.delete("b"); return p; });
  };

  const A = communeA;
  const B = communeB;

  // Filtrage local pour l'autocomplete (on utilise allCommunes pré-chargées)
  const searchInAll = useCallback((query) => {
    if (!query || query.length < 2) return [];
    return allCommunes.filter(c => c.city?.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
  }, [allCommunes]);

  return (
    <div className="flex flex-col h-full overflow-auto bg-background-dark p-6 gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Comparer deux communes</h1>
        <p className="text-sm text-slate-400 mt-1">Analyse côte à côte des métriques immobilières, qualité de vie et énergie.</p>
      </div>

      {/* Sélecteurs */}
      <div className="grid grid-cols-2 gap-6">
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

      {/* En-têtes communes */}
      <div className="flex gap-0">
        <CommuneHeader data={A} color="text-blue-400" side="left" />
        <div className="flex items-center justify-center w-12 shrink-0">
          <div className="w-px h-full bg-slate-700/50" />
          <span className="absolute bg-slate-800 text-slate-400 text-xs font-bold px-2 py-1 rounded-full border border-slate-700">VS</span>
        </div>
        <CommuneHeader data={B} color="text-violet-400" side="right" />
      </div>

      {/* Comparaisons */}
      {(A || B) && (
        <div className="flex flex-col gap-4">
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
              <ScoreBar label="Qualité de vie" val={A?.score_qualite_vie} color="bg-emerald-500" />
              <ScoreBar label="Investissement" val={A?.score_investissement} color="bg-blue-500" />
              <ScoreBar label="Stabilité" val={A?.score_stabilite} color="bg-amber-500" />
              <ScoreBar label="Sécurité" val={A?.score_securite} color="bg-violet-500" />
            </div>

            {/* Scores B */}
            <div className="rounded-xl p-5" style={{ background: "rgba(15,23,36,0.8)", border: "1px solid rgba(139,92,246,0.2)" }}>
              <p className="text-xs font-bold text-violet-400 uppercase tracking-wider mb-3">{B?.city || "Commune B"} — Scores synthèse</p>
              <ScoreBar label="Qualité de vie" val={B?.score_qualite_vie} color="bg-emerald-500" />
              <ScoreBar label="Investissement" val={B?.score_investissement} color="bg-blue-500" />
              <ScoreBar label="Stabilité" val={B?.score_stabilite} color="bg-amber-500" />
              <ScoreBar label="Sécurité" val={B?.score_securite} color="bg-violet-500" />
            </div>
          </div>

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
    if (value) setQuery(value.city || "");
  }, [value?.city]);

  const search = (q) => {
    setQuery(q);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if (q.length < 2) { setResults([]); setOpen(false); return; }
      const filtered = communes.filter(c => c.city?.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
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
    return () => document.removeEventListener("mousedown", handler);
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
                <p className="text-sm font-medium text-slate-100 truncate">{c.city}</p>
                <p className="text-[11px] text-slate-500">{c.code_commune} · Dép. {c.code_departement}</p>
              </div>
              {c.prix_median_m2 && (
                <span className="text-xs text-blue-400 shrink-0">{fmt(c.prix_median_m2)} €/m²</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
