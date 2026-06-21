import React, { useState } from "react";

const DEPTS = [
  { code: "", label: "Toute l'Île-de-France" },
  { code: "75", label: "Paris (75)" },
  { code: "77", label: "Seine-et-Marne (77)" },
  { code: "78", label: "Yvelines (78)" },
  { code: "91", label: "Essonne (91)" },
  { code: "92", label: "Hauts-de-Seine (92)" },
  { code: "93", label: "Seine-Saint-Denis (93)" },
  { code: "94", label: "Val-de-Marne (94)" },
  { code: "95", label: "Val-d'Oise (95)" },
];

function load(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; }
}

export default function SettingsModal({ onClose }) {
  const [dept,        setDept]        = useState(() => load("hp_pref_dept", ""));
  const [typeBien,    setTypeBien]    = useState(() => load("hp_pref_type", "Appartement"));
  const [notifs,      setNotifs]      = useState(() => load("hp_pref_notifs", true));
  const [showScores,  setShowScores]  = useState(() => load("hp_pref_scores", true));
  const [saved, setSaved] = useState(false);

  const save = () => {
    localStorage.setItem("hp_pref_dept",   JSON.stringify(dept));
    localStorage.setItem("hp_pref_type",   JSON.stringify(typeBien));
    localStorage.setItem("hp_pref_notifs", JSON.stringify(notifs));
    localStorage.setItem("hp_pref_scores", JSON.stringify(showScores));
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 800);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(16,23,34,0.7)", backdropFilter: "blur(6px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-xl overflow-hidden shadow-2xl"
        style={{ background: "#0f1724", border: "1px solid rgba(60,131,246,0.2)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary" style={{ fontSize: 22 }}>settings</span>
            <h2 className="text-base font-bold text-white">Paramètres</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
          </button>
        </div>

        <div className="p-6 space-y-6">

          {/* Département par défaut */}
          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
              Département par défaut
            </label>
            <select
              value={dept}
              onChange={e => setDept(e.target.value)}
              className="w-full h-10 rounded-lg text-sm text-slate-200 px-3 outline-none focus:ring-1 focus:ring-primary"
              style={{ background: "rgba(15,23,42,0.8)", border: "1px solid rgba(60,131,246,0.2)" }}
            >
              {DEPTS.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
            </select>
          </div>

          {/* Type de bien */}
          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
              Type de bien préféré
            </label>
            <div className="flex gap-2">
              {["Appartement", "Maison", "Tous"].map(t => (
                <button
                  key={t}
                  onClick={() => setTypeBien(t)}
                  className={`flex-1 h-9 rounded-lg text-sm font-medium border transition-colors ${
                    typeBien === t
                      ? "bg-primary/20 border-primary text-primary"
                      : "border-slate-700 text-slate-400 hover:border-slate-600"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Affichage</label>
            {[
              { label: "Afficher les scores composites", val: showScores, set: setShowScores },
              { label: "Activer les notifications",      val: notifs,     set: setNotifs },
            ].map(({ label, val, set }) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-slate-800">
                <span className="text-sm text-slate-300">{label}</span>
                <button
                  onClick={() => set(v => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${val ? "bg-primary" : "bg-slate-700"}`}
                >
                  <span className={`absolute top-1 size-4 rounded-full bg-white transition-transform ${val ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 pb-6">
          <button
            onClick={save}
            className={`w-full h-10 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${
              saved ? "bg-emerald-600 text-white" : "bg-primary hover:bg-primary/90 text-white"
            }`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{saved ? "check" : "save"}</span>
            {saved ? "Enregistré !" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}
