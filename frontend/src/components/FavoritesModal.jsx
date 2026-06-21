import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getFavorites, removeFavorite } from "../utils/favorites.js";

function fmt(v) {
  if (v == null) return "—";
  return Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
}

export default function FavoritesModal({ onClose }) {
  const navigate = useNavigate();
  const [list, setList] = useState(getFavorites());

  useEffect(() => {
    const handler = () => setList(getFavorites());
    window.addEventListener("hp_favorites_changed", handler);
    return () => window.removeEventListener("hp_favorites_changed", handler);
  }, []);

  useEffect(() => {
    const handler = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleCompare = (code) => {
    const others = list.filter(f => f.code_commune !== code);
    const b = others[0]?.code_commune || "";
    navigate(`/comparer?a=${code}${b ? `&b=${b}` : ""}`);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(16,23,34,0.7)", backdropFilter: "blur(6px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-xl overflow-hidden shadow-2xl"
        style={{ background: "#0f1724", border: "1px solid rgba(60,131,246,0.2)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-red-400" style={{ fontSize: 22 }}>favorite</span>
            <h2 className="text-base font-bold text-white">Mes communes favorites</h2>
            {list.length > 0 && (
              <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">{list.length}</span>
            )}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 max-h-[420px] overflow-y-auto">
          {list.length === 0 ? (
            <div className="text-center py-12">
              <span className="material-symbols-outlined text-slate-700 block mb-3" style={{ fontSize: 40 }}>favorite_border</span>
              <p className="text-slate-400 text-sm font-medium">Aucune commune en favori</p>
              <p className="text-slate-600 text-xs mt-1">Cliquez sur ♥ sur une commune pour la sauvegarder</p>
            </div>
          ) : (
            <div className="space-y-2">
              {list.map(f => (
                <div key={f.code_commune}
                  className="flex items-center gap-4 p-3 rounded-lg border border-slate-800 hover:border-slate-700 transition-colors"
                  style={{ background: "rgba(15,23,42,0.5)" }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{f.city}</p>
                    <p className="text-xs text-slate-500">Dép. {f.code_departement} · {f.code_commune}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-primary">{fmt(f.prix_median_m2)} €/m²</p>
                    {f.score_investissement != null && (
                      <p className="text-[10px] text-slate-500">Score invest. {Number(f.score_investissement).toFixed(1)}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => handleCompare(f.code_commune)}
                      title="Comparer cette commune"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>compare</span>
                    </button>
                    <button
                      onClick={() => removeFavorite(f.code_commune)}
                      title="Retirer des favoris"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {list.length > 0 && (
          <div className="px-4 pb-4">
            <button
              onClick={() => navigate(`/comparer?a=${list[0]?.code_commune || ""}&b=${list[1]?.code_commune || ""}`)}
              className="w-full h-10 bg-primary hover:bg-primary/90 text-white text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>compare</span>
              Comparer les 2 premiers favoris
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
