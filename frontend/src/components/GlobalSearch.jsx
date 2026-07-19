import { useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGlobalSearch } from "../hooks/useGlobalSearch.js";

export default function GlobalSearch({ onSelectCommune }) {
  const { query, results, loading, open, setOpen, search, clear } = useGlobalSearch();
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  // Raccourci clavier "/"
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") { clear(); inputRef.current?.blur(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [clear]);

  // Fermer si clic extérieur
  useEffect(() => {
    const handler = (e) => { if (!containerRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [setOpen]);

  const handleSelect = (commune) => {
    clear();
    inputRef.current?.blur();
    // Naviguer vers la carte avec la commune sélectionnée
    const code = commune.code_commune || commune.code_insee || commune.code;
    const city = commune.city || commune.nom;
    if (onSelectCommune) onSelectCommune(code, city);
    navigate(`/carte?commune=${encodeURIComponent(city)}`);
  };

  return (
    <div ref={containerRef} className="relative" style={{ width: 260 }}>
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
        style={{ background: "rgba(15,23,36,0.8)", border: "1px solid rgba(30,41,59,0.8)" }}>
        {loading
          ? <span className="material-symbols-outlined text-slate-500 animate-spin" style={{ fontSize: 16 }}>progress_activity</span>
          : <span className="material-symbols-outlined text-slate-500" style={{ fontSize: 16 }}>search</span>
        }
        <input
          ref={inputRef}
          value={query}
          onChange={e => search(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Rechercher une commune…"
          className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 outline-none"
          style={{ minWidth: 0 }}
        />
        {query
          ? <button onClick={clear} className="text-slate-600 hover:text-slate-300">
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
            </button>
          : <kbd className="text-[9px] text-slate-700 px-1 py-0.5 rounded border border-slate-800">/</kbd>
        }
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 z-[100] rounded-xl overflow-hidden shadow-2xl"
          style={{ background: "#0f1724", border: "1px solid rgba(30,41,59,0.8)" }}>
          {results.map((c, i) => {
            const city = c.city || c.nom;
            const dept = (c.code_departement || c.dept || "").trim();
            const prix = c.prix_median_m2 ? `${Math.round(c.prix_median_m2).toLocaleString("fr-FR")} €/m²` : null;
            return (
              <button key={i} onClick={() => handleSelect(c)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-800/60 transition-colors border-b border-slate-800/50 last:border-0">
                <span className="material-symbols-outlined text-slate-600" style={{ fontSize: 14 }}>location_on</span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-slate-200">{city}</span>
                  <span className="text-xs text-slate-600 ml-1.5">Dép. {dept}</span>
                </div>
                {prix && <span className="text-xs text-slate-500 mono-nums shrink-0">{prix}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
