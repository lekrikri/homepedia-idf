import { useNavigate } from "react-router-dom";
import { useFavorisContext } from "../contexts/FavorisContext.jsx";

export default function FavorisPanel({ onClose }) {
  const { favoris, toggle } = useFavorisContext();
  const navigate = useNavigate();

  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-end pt-14 pr-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-80 rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: "#0f1724", border: "1px solid rgba(30,41,59,0.8)" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-red-400" style={{ fontSize: 18 }}>favorite</span>
            <span className="font-bold text-slate-100 text-sm">Favoris</span>
            <span className="text-xs text-slate-500 ml-1">({favoris.length})</span>
          </div>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-300">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>

        {favoris.length === 0 ? (
          <div className="px-4 py-8 text-center text-slate-600 text-sm">
            <span className="material-symbols-outlined block mb-2" style={{ fontSize: 32 }}>favorite_border</span>
            Aucun favori. Cliquez sur ♡ dans une fiche commune.
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {favoris.map(f => {
              const code = f.code_commune || f.code;
              const dept = f.code_departement || f.dept || "";
              const prix = f.prix_median_m2 || f.prix_m2;
              return (
                <div key={code}
                  className="flex items-center gap-3 px-4 py-3 border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30 transition-colors">
                  <button
                    onClick={() => { navigate(`/carte?commune=${encodeURIComponent(f.city)}`); onClose(); }}
                    className="flex-1 text-left min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{f.city}</p>
                    <p className="text-[10px] text-slate-600">
                      Dép. {dept.trim()}{prix ? ` · ${Math.round(prix).toLocaleString("fr-FR")} €/m²` : ""}
                    </p>
                  </button>
                  <button onClick={() => toggle(f)}
                    className="shrink-0 text-red-400 hover:text-slate-500 transition-colors"
                    title="Retirer des favoris">
                    <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>favorite</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
