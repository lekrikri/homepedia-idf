import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { getFavorites, removeFavorite } from "../utils/favorites.js";

function fmt(v) {
  if (v == null) return "—";
  return Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
}

function DeltaBadge({ saved, live }) {
  if (saved == null || live == null) return null;
  const delta = ((live - saved) / saved) * 100;
  if (Math.abs(delta) < 0.5) return null;
  const up = delta > 0;
  return (
    <span className={`text-[10px] font-bold mono-nums flex items-center gap-0.5 px-1.5 py-0.5 rounded-full ${up ? "text-red-400" : "text-emerald-400"}`}
      style={{ background: up ? "rgba(239,68,68,0.1)" : "rgba(16,185,129,0.1)" }}
      title={`Prix au moment de l'ajout : ${fmt(saved)} €/m²`}>
      <span className="material-symbols-outlined" style={{ fontSize: 9 }}>{up ? "trending_up" : "trending_down"}</span>
      {up ? "+" : ""}{delta.toFixed(1)}%
    </span>
  );
}

export default function FavoritesModal({ onClose }) {
  const navigate = useNavigate();
  const [list, setList] = useState(getFavorites());
  const [liveData, setLiveData] = useState({}); // code → {prix_median_m2}
  const [loadingLive, setLoadingLive] = useState(false);

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

  // Fetcher les prix live pour tous les favoris
  const fetchLivePrices = useCallback(async (favList) => {
    if (favList.length === 0) return;
    setLoadingLive(true);
    const results = await Promise.allSettled(
      favList.map(f =>
        axios.get(`/api/v1/communes/${f.code_commune}/agregat`)
          .then(r => ({ code: f.code_commune, prix: r.data?.prix_median_m2 ?? r.data?.prix_m2_median }))
          .catch(() => ({ code: f.code_commune, prix: null }))
      )
    );
    const map = {};
    results.forEach(r => { if (r.status === 'fulfilled') map[r.value.code] = r.value.prix; });
    setLiveData(map);
    setLoadingLive(false);
  }, []);

  useEffect(() => { fetchLivePrices(list); }, [list, fetchLivePrices]);

  const handleCompare = (code) => {
    const others = list.filter(f => f.code_commune !== code);
    const b = others[0]?.code_commune || "";
    navigate(`/comparer?a=${code}${b ? `&b=${b}` : ""}`);
    onClose();
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `homepedia_favoris_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
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
            <h2 className="text-base font-bold text-white">Mes communes surveillées</h2>
            {list.length > 0 && (
              <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">{list.length}</span>
            )}
            {loadingLive && (
              <span className="material-symbols-outlined animate-spin text-slate-500" style={{ fontSize: 14 }}>progress_activity</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {list.length > 0 && (
              <button onClick={handleExport} title="Exporter les favoris (JSON)"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
              </button>
            )}
            <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 max-h-[460px] overflow-y-auto">
          {list.length === 0 ? (
            <div className="text-center py-12">
              <span className="material-symbols-outlined text-slate-700 block mb-3" style={{ fontSize: 40 }}>favorite_border</span>
              <p className="text-slate-400 text-sm font-medium">Aucune commune en favori</p>
              <p className="text-slate-600 text-xs mt-1">Cliquez sur ♥ sur une commune pour la sauvegarder</p>
            </div>
          ) : (
            <div className="space-y-2">
              {list.map(f => {
                const livePrice = liveData[f.code_commune];
                const savedDays = f.saved_at
                  ? Math.floor((Date.now() - new Date(f.saved_at)) / 86400000)
                  : null;
                return (
                  <div key={f.code_commune}
                    className="flex items-center gap-3 p-3 rounded-lg border border-slate-800 hover:border-slate-700 transition-colors"
                    style={{ background: "rgba(15,23,42,0.5)" }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-white truncate">{f.city}</p>
                        <DeltaBadge saved={f.prix_median_m2} live={livePrice} />
                      </div>
                      <p className="text-[10px] text-slate-500">
                        Dép. {f.code_departement?.trim()}
                        {savedDays !== null && <span> · ajouté il y a {savedDays === 0 ? "aujourd'hui" : `${savedDays}j`}</span>}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-primary mono-nums">
                        {fmt(livePrice ?? f.prix_median_m2)} €/m²
                      </p>
                      {f.score_investissement != null && (
                        <p className="text-[10px] text-slate-500">Score {Number(f.score_investissement).toFixed(0)}/100</p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => { navigate(`/carte?commune=${f.code_commune}`); onClose(); }}
                        title="Voir sur la carte"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors">
                        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>map</span>
                      </button>
                      {(livePrice || f.prix_median_m2) && (
                        <button
                          onClick={() => {
                            const p = Math.round((livePrice ?? f.prix_median_m2) * 50);
                            navigate(`/portfolio?prix=${p}&commune=${encodeURIComponent(f.city || '')}`);
                            onClose();
                          }}
                          title="Simuler l'investissement"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors">
                          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>savings</span>
                        </button>
                      )}
                      <button
                        onClick={() => handleCompare(f.code_commune)}
                        title="Comparer"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors">
                        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>compare</span>
                      </button>
                      <button
                        onClick={() => removeFavorite(f.code_commune)}
                        title="Retirer des favoris"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>delete</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {list.length > 0 && (
          <div className="px-4 pb-4 flex gap-2">
            <button
              onClick={() => navigate(`/comparer?a=${list[0]?.code_commune || ""}&b=${list[1]?.code_commune || ""}`)}
              className="flex-1 h-10 bg-primary hover:bg-primary/90 text-white text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>compare</span>
              Comparer les 2 premiers
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
