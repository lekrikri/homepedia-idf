import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const STEPS = [
  {
    icon: "domain",
    title: "Bienvenue sur HomePedia IDF",
    subtitle: "Votre outil d'analyse immobilière en Île-de-France",
    description:
      "HomePedia centralise 1 266 communes d'IDF, 1,9 million de transactions DVF, les données DPE, loyers, IPS scolaire, risques naturels BRGM et des prévisions Prophet 2025-2026. Tout pour prendre des décisions immobilières éclairées.",
    tips: ["1 266 communes analysées", "40+ indicateurs par commune", "IA conversationnelle intégrée"],
    color: "#3c83f6",
    colorDim: "rgba(60,131,246,0.12)",
    nav: null,
    navLabel: null,
  },
  {
    icon: "map",
    title: "Carte Interactive",
    subtitle: "Heatmap des prix + timeline animée",
    description:
      "La carte affiche une heatmap des prix médians par commune. Activez la timeline pour animer l'évolution 2021 → 2026 (les années 2025-2026 sont des prévisions Prophet en violet). Cliquez sur une commune pour afficher sa fiche complète.",
    tips: [
      "Icône 'layers' → activer la heatmap",
      "▶ Play pour animer 2021-2026",
      "Cliquez une commune → panel détail à droite",
    ],
    color: "#f59e0b",
    colorDim: "rgba(245,158,11,0.12)",
    nav: "/carte",
    navLabel: "Ouvrir la carte",
  },
  {
    icon: "analytics",
    title: "Fiche Commune",
    subtitle: "Prix, forecast, DPE, rendement, POI",
    description:
      "Chaque commune dispose d'une fiche enrichie : graphique prix historique + prévision Prophet, courbe Appartement vs Maison, score DPE, IPS scolaire, rendement locatif brut, risques naturels (BRGM) et points d'intérêt.",
    tips: [
      "Ligne violette pointillée = prévision 2025-2026",
      "Chart bleu/vert = Appartement vs Maison",
      "Section 'Pourquoi cette commune ?' = insights vs IDF",
    ],
    color: "#10b981",
    colorDim: "rgba(16,185,129,0.12)",
    nav: "/carte",
    navLabel: "Voir une commune",
  },
  {
    icon: "receipt_long",
    title: "Transactions DVF",
    subtitle: "1,9 M ventes brutes filtrables",
    description:
      "Explorez toutes les transactions DVF 2019-2024 avec filtres combinables : commune, département, type de bien, classe DPE, fourchette de prix. Exportez jusqu'à 10 000 lignes en CSV (compatible Excel avec BOM UTF-8).",
    tips: [
      "Filtres : DPE A/B, Maison, plage de prix",
      "CSV (page) → données affichées",
      "CSV (tout) → jusqu'à 10 000 résultats",
    ],
    color: "#8b5cf6",
    colorDim: "rgba(139,92,246,0.12)",
    nav: "/transactions",
    navLabel: "Explorer les transactions",
  },
  {
    icon: "bar_chart",
    title: "Dashboard",
    subtitle: "Vue macro → méso → micro",
    description:
      "3 niveaux d'analyse : macro (IDF global : prix médian, tendances), méso (par département : classement), micro (commune précise : DPE, IPS, sécurité). Idéal pour situer rapidement une commune dans le contexte régional.",
    tips: [
      "Macro : vue IDF entière",
      "Méso : comparaison par département",
      "Micro : indicateurs fins d'une commune",
    ],
    color: "#ec4899",
    colorDim: "rgba(236,72,153,0.12)",
    nav: "/dashboard",
    navLabel: "Voir le dashboard",
  },
  {
    icon: "compare_arrows",
    title: "Comparer",
    subtitle: "Deux communes côte à côte",
    description:
      "Sélectionnez deux communes et comparez leurs indicateurs : prix au m², rendement, DPE, IPS, sécurité. L'URL est partageable (?a=75012&b=94300). Un radar chart multicritère visualise les forces et faiblesses de chaque commune.",
    tips: [
      "URL partageable avec ?a=&b=",
      "Radar chart sur 5 dimensions",
      "Top 5 communes par critère (investissement, QV...)",
    ],
    color: "#06b6d4",
    colorDim: "rgba(6,182,212,0.12)",
    nav: "/comparer",
    navLabel: "Comparer deux communes",
  },
  {
    icon: "scatter_plot",
    title: "Pareto Front",
    subtitle: "Les meilleurs compromis rendement / risque",
    description:
      "Le front de Pareto identifie les communes où il est impossible d'améliorer le rendement locatif sans augmenter le risque. Ce sont les choix objectivement optimaux. La ligne pointillée verte est la frontière efficiente.",
    tips: [
      "Points gros avec contour blanc = front optimal",
      "Haut-gauche = meilleur rendement / faible risque",
      "Filtrez par département pour affiner",
    ],
    color: "#a78bfa",
    colorDim: "rgba(167,139,250,0.12)",
    nav: "/pareto",
    navLabel: "Voir le Pareto Front",
  },
  {
    icon: "smart_toy",
    title: "HomePedia IA",
    subtitle: "Posez vos questions en langage naturel",
    description:
      "L'assistant IA comprend vos questions sur l'immobilier IDF : budget d'achat, comparaisons de communes, meilleures opportunités par critère, prévisions des prix... Il interroge directement la base de données et génère une réponse en langage naturel.",
    tips: [
      "« j'ai 300 000€, que puis-je acheter ? »",
      "« Comparer Versailles et Vincennes »",
      "« Meilleur rendement locatif en Essonne »",
    ],
    color: "#f97316",
    colorDim: "rgba(249,115,22,0.12)",
    nav: "/carte",
    navLabel: "Ouvrir le chatbot",
  },
];

export default function OnboardingTour({ open, onClose }) {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  if (!open) return null;

  const cur = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const handleNav = () => {
    if (cur.nav) navigate(cur.nav);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: "rgba(8,13,24,0.85)", backdropFilter: "blur(8px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl"
        style={{
          background: "#0f1724",
          border: `1px solid ${cur.color}30`,
          boxShadow: `0 0 60px ${cur.color}18`,
        }}
      >
        {/* Barre de progression */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-slate-800">
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${((step + 1) / STEPS.length) * 100}%`,
              background: cur.color,
            }}
          />
        </div>

        {/* Header coloré */}
        <div className="px-6 pt-8 pb-5" style={{ background: cur.colorDim }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className="size-11 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: cur.color + "22", border: `1px solid ${cur.color}40` }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22, color: cur.color }}>
                  {cur.icon}
                </span>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: cur.color }}>
                  Étape {step + 1} / {STEPS.length}
                </p>
                <h2 className="text-base font-bold text-white leading-tight">{cur.title}</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">{cur.subtitle}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 p-1 text-slate-500 hover:text-slate-200 transition-colors mt-1"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
            </button>
          </div>
        </div>

        {/* Contenu */}
        <div className="px-6 py-5">
          <p className="text-sm text-slate-300 leading-relaxed mb-4">{cur.description}</p>

          {/* Tips */}
          <div className="space-y-2 mb-5">
            {cur.tips.map((tip, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div
                  className="size-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold"
                  style={{ background: cur.color + "22", color: cur.color }}
                >
                  {i + 1}
                </div>
                <p className="text-[12px] text-slate-400 leading-relaxed">{tip}</p>
              </div>
            ))}
          </div>

          {/* Indicateurs dots */}
          <div className="flex items-center justify-center gap-1.5 mb-5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className="rounded-full transition-all duration-300"
                style={{
                  width: i === step ? 20 : 6,
                  height: 6,
                  background: i === step ? cur.color : i < step ? cur.color + "60" : "#1e293b",
                }}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {step > 0 && (
              <button
                onClick={() => setStep(s => s - 1)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 transition-colors"
                style={{ background: "rgba(30,41,59,0.6)", border: "1px solid rgba(30,41,59,0.8)" }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chevron_left</span>
                Précédent
              </button>
            )}

            <div className="flex-1 flex items-center justify-end gap-2">
              {cur.nav && (
                <button
                  onClick={handleNav}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                  style={{
                    background: cur.color + "18",
                    border: `1px solid ${cur.color}40`,
                    color: cur.color,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>open_in_new</span>
                  {cur.navLabel}
                </button>
              )}

              {isLast ? (
                <button
                  onClick={onClose}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-bold text-white transition-all"
                  style={{ background: cur.color, boxShadow: `0 4px 14px ${cur.color}40` }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check</span>
                  Terminer
                </button>
              ) : (
                <button
                  onClick={() => setStep(s => s + 1)}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-bold text-white transition-all"
                  style={{ background: cur.color, boxShadow: `0 4px 14px ${cur.color}40` }}
                >
                  Suivant
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chevron_right</span>
                </button>
              )}
            </div>
          </div>

          {step === 0 && (
            <button
              onClick={onClose}
              className="w-full text-center text-[11px] text-slate-600 hover:text-slate-400 transition-colors mt-3"
            >
              Passer le didacticiel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
