import React, { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

function RightPanel() {
  return (
    <aside className="w-80 h-full flex-shrink-0 overflow-y-auto"
      style={{ background: "rgba(16,23,34,0.7)", backdropFilter: "blur(12px)", borderLeft: "1px solid rgba(60,131,246,0.1)" }}>
      <div className="p-6">
        <header className="mb-6">
          <h2 className="text-sm font-bold text-primary mb-1">Détail Zone</h2>
          <h3 className="text-lg font-bold text-slate-100">IRIS 750010101</h3>
          <p className="text-xs text-slate-400">Quartier Saint-Germain-l'Auxerrois</p>
        </header>

        <div className="bg-slate-900/50 p-4 rounded-xl border border-primary/10 mb-6">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Prix Médian / m²</p>
          <div className="text-3xl font-bold mono-nums text-amber-400">8,450 €</div>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-green-400 text-xs flex items-center gap-0.5">
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>trending_up</span> +4.2%
            </span>
            <span className="text-slate-500 text-[10px]">sur 12 mois</span>
          </div>
          <div className="mt-4 h-12 w-full flex items-end gap-1">
            {[50, 65, 50, 75, 100, 85].map((h, i) => (
              <div key={i} className="flex-1 rounded-t-sm"
                style={{ height: `${h}%`, background: i === 5 ? "#3c83f6" : `rgba(60,131,246,${0.2 + i * 0.08})` }} />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="p-3 bg-slate-800/30 rounded-lg border border-slate-700/50">
            <span className="material-symbols-outlined text-primary" style={{ fontSize: 16 }}>handshake</span>
            <div className="text-sm font-bold mono-nums mt-1">127</div>
            <p className="text-[9px] text-slate-500 uppercase">Transactions</p>
          </div>
          <div className="p-3 bg-slate-800/30 rounded-lg border border-slate-700/50">
            <span className="material-symbols-outlined text-green-400" style={{ fontSize: 16 }}>bolt</span>
            <div className="text-sm font-bold mono-nums mt-1">B</div>
            <p className="text-[9px] text-slate-500 uppercase">DPE Moyen</p>
          </div>
        </div>

        <div className="mb-6 flex items-center justify-between p-4 rounded-xl border border-primary/20"
          style={{ background: "rgba(60,131,246,0.05)" }}>
          <div>
            <h4 className="text-xs font-bold text-slate-100 mb-1">Score Investissement</h4>
            <p className="text-[10px] text-slate-400">Basé sur 12 indicateurs</p>
          </div>
          <div className="relative size-16 flex items-center justify-center">
            <svg className="size-full -rotate-90" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="28" fill="transparent" stroke="#1e293b" strokeWidth="6" />
              <circle cx="32" cy="32" r="28" fill="transparent" stroke="#3c83f6" strokeWidth="6" strokeDasharray="175" strokeDashoffset="40" />
            </svg>
            <span className="absolute text-xs font-bold mono-nums">82</span>
          </div>
        </div>

        <div>
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Dernières ventes</h4>
          <div className="space-y-4">
            {[
              { type: "T2 - 42 m²", prix: "610k€",  date: "Jan 2024 • 12 Rue Saint-Honoré",   active: true },
              { type: "T4 - 89 m²", prix: "1.2M€",  date: "Dec 2023 • 5 Rue du Louvre",        active: false },
              { type: "T1 - 18 m²", prix: "245k€",  date: "Nov 2023 • 1 Place du Châtelet",    active: false },
            ].map((v, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className={`size-2 rounded-full ${v.active ? "bg-primary" : "bg-slate-700"}`} />
                <div className="flex-1">
                  <div className="flex justify-between text-[11px] font-medium">
                    <span>{v.type}</span>
                    <span className={`mono-nums ${!v.active ? "text-primary" : ""}`}>{v.prix}</span>
                  </div>
                  <div className="text-[9px] text-slate-500">{v.date}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

function LeftSidebar() {
  return (
    <aside className="w-72 h-full flex-shrink-0 overflow-y-auto z-20"
      style={{ background: "rgba(16,23,34,0.7)", backdropFilter: "blur(12px)", borderRight: "1px solid rgba(60,131,246,0.1)" }}>
      <div className="p-5 flex flex-col gap-6">
        <div>
          <h3 className="text-xs font-bold text-primary uppercase tracking-widest mb-3">Recherche</h3>
          <input className="w-full bg-slate-900/60 border border-slate-700 rounded-lg py-2 px-3 text-sm focus:border-primary outline-none text-slate-100"
            defaultValue="75001 Paris" />
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-primary uppercase tracking-widest">Filtres</h3>
            <button className="text-[10px] text-slate-500 hover:text-primary underline">Réinitialiser</button>
          </div>
          <div className="space-y-2">
            {["Appartement", "Maison"].map((t, i) => (
              <label key={t} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input type="checkbox" defaultChecked={i === 0} className="rounded border-slate-700 bg-slate-800 accent-primary size-4" />
                {t}
              </label>
            ))}
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-400">Année de vente</span>
              <span className="text-primary mono-nums">2019 - 2024</span>
            </div>
            <input type="range" min="2019" max="2024" defaultValue="2024" className="w-full h-1 bg-slate-700 rounded-lg accent-primary cursor-pointer" />
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-400">Prix m² range</span>
              <span className="text-primary mono-nums">4k€ - 18k€</span>
            </div>
            <div className="h-1 bg-primary/30 relative rounded-full">
              <div className="absolute left-1/4 right-1/4 h-full bg-primary rounded-full" />
              <div className="absolute left-1/4 top-1/2 -translate-y-1/2 size-3 bg-white rounded-full border-2 border-primary cursor-pointer" />
              <div className="absolute right-1/4 top-1/2 -translate-y-1/2 size-3 bg-white rounded-full border-2 border-primary cursor-pointer" />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-xs font-bold text-primary uppercase tracking-widest">Résultats (127)</h3>
            <span className="material-symbols-outlined text-slate-500 cursor-pointer" style={{ fontSize: 18 }}>sort</span>
          </div>
          {[
            { addr: "12 RUE DE RIVOLI", prix: "842,000 €",   info: "54 m² • T3", ppm: "15,592 €/m²", annee: "2024", active: true },
            { addr: "4 PL. VENDÔME",    prix: "1,890,000 €", info: "92 m² • T4", ppm: "20,543 €/m²", annee: "2023", active: false },
            { addr: "22 RUE DE RIVOLI", prix: "650,000 €",   info: "42 m² • T2", ppm: "15,476 €/m²", annee: "2023", active: false },
          ].map((t, i) => (
            <div key={i} className={`p-3 rounded-lg cursor-pointer transition-all ${
              t.active ? "border border-primary/20 glow-border" : "bg-slate-900/40 border border-slate-800 hover:border-primary/30"
            }`} style={t.active ? { background: "rgba(60,131,246,0.05)" } : {}}>
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] mono-nums text-slate-400">{t.addr}</span>
                <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${t.active ? "bg-green-500/20 text-green-400" : "bg-slate-800 text-slate-400"}`}>{t.annee}</span>
              </div>
              <div className="text-sm font-bold text-slate-100 mono-nums">{t.prix}</div>
              <div className="flex justify-between items-center mt-2">
                <span className="text-[10px] text-slate-400">{t.info}</span>
                <span className={`text-[10px] mono-nums ${t.active ? "text-primary" : "text-slate-400"}`}>{t.ppm}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

export default function MapView() {
  const mapContainer = useRef(null);
  const map = useRef(null);

  useEffect(() => {
    if (map.current) return;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      center: [2.3488, 48.8534],
      zoom: 13,
    });
    map.current.addControl(new maplibregl.NavigationControl(), "bottom-right");
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      <LeftSidebar />

      <div className="relative flex-1">
        <div ref={mapContainer} className="w-full h-full" />

        {/* Breadcrumb */}
        <div className="absolute top-4 left-4 flex items-center gap-2 z-10 rounded-full px-4 py-1.5 text-xs font-medium"
          style={{ background: "rgba(16,23,34,0.7)", backdropFilter: "blur(12px)", border: "1px solid rgba(60,131,246,0.2)" }}>
          {["Île-de-France","Paris","75001","Rue de Rivoli"].map((s, i, a) => (
            <React.Fragment key={s}>
              <span className={i === a.length-1 ? "text-slate-100" : "text-slate-400 hover:text-primary cursor-pointer"}>{s}</span>
              {i < a.length-1 && <span className="material-symbols-outlined text-slate-600" style={{ fontSize: 14 }}>chevron_right</span>}
            </React.Fragment>
          ))}
        </div>

        {/* Floating controls */}
        <div className="absolute bottom-20 right-4 z-10 flex flex-col gap-3">
          {["layers","3d_rotation"].map(icon => (
            <button key={icon} className="size-12 rounded-xl glass-panel flex items-center justify-center hover:bg-primary/20 transition-all">
              <span className="material-symbols-outlined text-slate-100" style={{ fontSize: 22 }}>{icon}</span>
            </button>
          ))}
          <div className="flex flex-col glass-panel rounded-xl overflow-hidden divide-y divide-primary/10">
            {["add","remove"].map(icon => (
              <button key={icon} className="size-12 flex items-center justify-center hover:bg-primary/20 transition-all">
                <span className="material-symbols-outlined text-slate-100" style={{ fontSize: 22 }}>{icon}</span>
              </button>
            ))}
          </div>
        </div>

        {/* AI Chat */}
        <button className="absolute bottom-10 right-4 z-10 size-14 bg-primary rounded-full flex items-center justify-center shadow-2xl shadow-primary/40 hover:scale-105 transition-transform">
          <span className="material-symbols-outlined text-white" style={{ fontSize: 28 }}>smart_toy</span>
          <span className="absolute -top-1 -right-1 size-4 bg-green-500 border-2 border-background-dark rounded-full animate-pulse" />
        </button>

        {/* Status bar */}
        <div className="absolute bottom-0 left-0 right-0 h-8 border-t border-primary/20 flex items-center justify-between px-4 z-10"
          style={{ background: "rgba(16,23,34,0.9)", backdropFilter: "blur(8px)" }}>
          <div className="flex items-center gap-4">
            <span className="text-[10px] text-slate-500 mono-nums">Données DVF 2024</span>
            <span className="h-3 w-px bg-slate-700" />
            <span className="text-[10px] text-slate-500 mono-nums">48.8606° N, 2.3376° E</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[10px] text-slate-500">Heatmap:</span>
            <div className="w-24 h-2 rounded-full bg-gradient-to-r from-blue-600 via-yellow-500 to-red-600" />
            <span className="h-3 w-px bg-slate-700" />
            <span className="text-[10px] text-slate-500">Zoom: <span className="text-primary mono-nums">13.0 z</span></span>
          </div>
        </div>
      </div>

      <RightPanel />
    </div>
  );
}
