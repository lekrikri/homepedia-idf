import { useState } from "react";

const STEPS = [
  {
    id: "profil",
    question: "Vous achetez pour quoi ?",
    icon: "person",
    options: [
      { value: "habiter", label: "Habiter", icon: "home", desc: "Résidence principale" },
      { value: "investir", label: "Investir", icon: "trending_up", desc: "Rendement locatif" },
      { value: "primo", label: "Primo-accédant", icon: "star", desc: "Premier achat" },
    ],
  },
  {
    id: "budget",
    question: "Quel est votre budget ?",
    icon: "payments",
    type: "slider",
    min: 100000, max: 800000, step: 10000, default: 300000,
    format: v => `${Math.round(v / 1000)} k€`,
  },
  {
    id: "priorites",
    question: "Vos priorités ?",
    icon: "tune",
    multi: true,
    options: [
      { value: "rendement", label: "Rendement", icon: "trending_up" },
      { value: "ecoles", label: "Écoles", icon: "school" },
      { value: "securite", label: "Sécurité", icon: "shield" },
      { value: "transports", label: "Transports", icon: "train" },
      { value: "nature", label: "Nature", icon: "park" },
      { value: "dpe", label: "Bon DPE", icon: "eco" },
    ],
  },
  {
    id: "dept",
    question: "Département préféré ?",
    icon: "map",
    options: [
      { value: "", label: "Toute l'IDF", icon: "public" },
      { value: "75", label: "Paris (75)", icon: "location_city" },
      { value: "77", label: "Seine-et-Marne (77)", icon: "forest" },
      { value: "78", label: "Yvelines (78)", icon: "terrain" },
      { value: "91", label: "Essonne (91)", icon: "science" },
      { value: "92", label: "Hauts-de-Seine (92)", icon: "business" },
      { value: "93", label: "Seine-Saint-Denis (93)", icon: "factory" },
      { value: "94", label: "Val-de-Marne (94)", icon: "park" },
      { value: "95", label: "Val-d'Oise (95)", icon: "grass" },
    ],
  },
];

function buildQuestion(answers) {
  const { profil, budget, priorites = [], dept } = answers;
  const budgetK = Math.round((budget || 300000) / 1000);
  const profilLabel = { habiter: "habiter", investir: "investir", primo: "un premier achat" }[profil] || "acheter";
  const prios = priorites.slice(0, 3).join(", ");
  return `Je cherche à ${profilLabel} avec un budget de ${budgetK} 000 €${dept ? ` dans le département ${dept}` : " en Île-de-France"}${prios ? `, avec comme priorités : ${prios}` : ""}. Quelles communes me conseilles-tu ?`;
}

export default function ConseillerIA({ onResult, onClose }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const currentStep = STEPS[step];
  const isLast = step === STEPS.length - 1;

  function handleSelect(key, value, multi) {
    if (multi) {
      const prev = answers[key] || [];
      const next = prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value];
      setAnswers(a => ({ ...a, [key]: next }));
    } else {
      const newAnswers = { ...answers, [key]: value };
      setAnswers(newAnswers);
      if (!isLast) {
        setTimeout(() => setStep(s => s + 1), 200);
      }
    }
  }

  async function handleFinish(ans) {
    const resolvedAnswers = ans ?? answers;
    setLoading(true);
    const question = buildQuestion(resolvedAnswers);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const CHAT_API = import.meta.env.VITE_CHAT_API_URL || "http://localhost:5001";
      const res = await fetch(`${CHAT_API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history: [] }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      const resultData = { answer: data.answer, data: data.data || [], question };
      setResult(resultData);
      onResult?.(resultData);
    } catch (err) {
      clearTimeout(timeout);
      const msg = err?.name === "AbortError"
        ? "Le service IA est en cours de démarrage, réessayez dans quelques secondes."
        : "Erreur lors de la recommandation. Réessayez.";
      setResult({ answer: msg, data: [], question: "" });
    }
    setLoading(false);
  }

  if (result) {
    return (
      <div className="flex flex-col h-full p-5 overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-blue-400" style={{ fontSize: 20 }}>auto_awesome</span>
            <h3 className="font-bold text-white text-sm">Recommandation personnalisée</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>
        <div className="bg-slate-900 rounded-xl p-4 text-[12px] text-slate-200 leading-relaxed mb-4 border border-slate-800">
          {result.answer}
        </div>
        {result.data.length > 0 && (
          <div className="space-y-2">
            {result.data.slice(0, 5).map((r, i) => (
              <div key={i} className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2 flex justify-between items-center">
                <span className="text-sm font-medium text-slate-200">
                  {r.commune} <span className="text-slate-500 text-[10px]">({r.dept})</span>
                </span>
                <div className="flex gap-3 text-[10px] text-slate-400">
                  {r.prix_m2 && <span>{Math.round(r.prix_m2).toLocaleString("fr-FR")} €/m²</span>}
                  {r.rendement_pct && <span className="text-emerald-400">{Number(r.rendement_pct).toFixed(1)}%</span>}
                  {r.score_global && <span className="text-blue-400">{Math.round(r.score_global)}/100</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => { setStep(0); setAnswers({}); setResult(null); }}
          className="mt-4 text-[11px] text-slate-500 hover:text-slate-300 text-center"
        >
          Recommencer
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header : progress + question */}
      <div className="px-5 pt-5 pb-0 shrink-0">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 mr-1">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
          </button>
          {STEPS.map((s, i) => (
            <div
              key={i}
              className="flex-1 h-1 rounded-full transition-all duration-300"
              style={{ background: i <= step ? "#3c83f6" : "#1e293b" }}
            />
          ))}
          <span className="text-[10px] text-slate-500 ml-1">{step + 1}/{STEPS.length}</span>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-blue-400" style={{ fontSize: 22 }}>{currentStep.icon}</span>
          <h3 className="font-bold text-white text-sm">{currentStep.question}</h3>
        </div>
      </div>

      {/* Zone scrollable : options */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-2">
        {currentStep.type === "slider" ? (
          <div className="flex flex-col items-center justify-center gap-6 h-full">
            <p className="text-3xl font-bold mono-nums text-blue-400">
              {currentStep.format(answers.budget ?? currentStep.default)}
            </p>
            <input
              type="range"
              min={currentStep.min}
              max={currentStep.max}
              step={currentStep.step}
              value={answers.budget ?? currentStep.default}
              onChange={e => setAnswers(a => ({ ...a, budget: Number(e.target.value) }))}
              className="w-full h-2 cursor-pointer"
              style={{ accentColor: "#3c83f6" }}
            />
            <div className="flex justify-between w-full text-[10px] text-slate-600">
              <span>100 k€</span><span>800 k€</span>
            </div>
          </div>
        ) : (
          <div className={`grid gap-2 ${currentStep.options.length > 4 ? "grid-cols-2" : "grid-cols-1"} content-start`}>
            {currentStep.options.map(opt => {
              const isSelected = currentStep.multi
                ? (answers[currentStep.id] || []).includes(opt.value)
                : answers[currentStep.id] === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => handleSelect(currentStep.id, opt.value, currentStep.multi)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
                  style={{
                    background: isSelected ? "rgba(60,131,246,0.15)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${isSelected ? "rgba(60,131,246,0.5)" : "rgba(255,255,255,0.06)"}`,
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 18, color: isSelected ? "#3c83f6" : "#64748b" }}
                  >
                    {opt.icon}
                  </span>
                  <div>
                    <p className="text-sm font-medium" style={{ color: isSelected ? "#93c5fd" : "#cbd5e1" }}>
                      {opt.label}
                    </p>
                    {opt.desc && <p className="text-[10px] text-slate-500">{opt.desc}</p>}
                  </div>
                  {isSelected && (
                    <span className="material-symbols-outlined ml-auto text-blue-400" style={{ fontSize: 16 }}>
                      check_circle
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Boutons navigation — toujours en bas, hors du scroll */}
      <div className="px-5 pb-5 pt-3 shrink-0">
        {currentStep.type === "slider" ? (
          <button
            onClick={() => setStep(s => s + 1)}
            className="w-full py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ background: "rgba(60,131,246,0.2)", border: "1px solid rgba(60,131,246,0.4)" }}
          >
            Confirmer →
          </button>
        ) : currentStep.multi ? (
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep(s => s - 1)}
                className="flex-1 py-2.5 rounded-xl text-sm text-slate-400 border border-slate-800"
              >
                ← Retour
              </button>
            )}
            <button
              onClick={() => setStep(s => s + 1)}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white"
              style={{ background: "rgba(60,131,246,0.3)", border: "1px solid rgba(60,131,246,0.5)" }}
            >
              Suivant →
            </button>
          </div>
        ) : isLast ? (
          <div className="flex gap-2">
            <button
              onClick={() => setStep(s => s - 1)}
              disabled={loading}
              className="py-2.5 px-4 rounded-xl text-sm text-slate-400 border border-slate-800 disabled:opacity-40"
            >
              ← Retour
            </button>
            <button
              onClick={() => handleFinish(answers)}
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: loading ? "rgba(60,131,246,0.15)" : "rgba(60,131,246,0.3)", border: "1px solid rgba(60,131,246,0.6)", color: "#93c5fd" }}
            >
              {loading ? (
                <>
                  <span className="material-symbols-outlined animate-spin" style={{ fontSize: 16 }}>progress_activity</span>
                  Analyse en cours...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>auto_awesome</span>
                  Voir ma recommandation
                </>
              )}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
