import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";

const STEPS = [
  {
    icon: "domain",
    title: "Bienvenue sur HomePedia IDF",
    subtitle: "Trois questions, des données réelles pour y répondre",
    description:
      "HomePedia réunit les 1 266 communes d'Île-de-France, 1,9 million de transactions DVF, les DPE, loyers, IPS scolaire, risques naturels et prévisions de prix. De quoi répondre aux trois questions qui comptent vraiment : où chercher, ce prix est-il justifié, et ce loyer est-il correct.",
    tips: [
      "Où chercher : comparer les communes selon vos critères",
      "Ce prix est-il justifié : situer un bien dans les ventes réelles",
      "Ce loyer est-il correct : vérifier avant de signer",
    ],
    color: "#3c83f6",
    colorDim: "rgba(60,131,246,0.12)",
    nav: null,
    navLabel: null,
  },
  {
    icon: "travel_explore",
    title: "Où chercher ?",
    subtitle: "La première question, avant même de visiter",
    description:
      "Indiquez votre budget et ce qui compte le plus pour vous — le prix, la performance énergétique du parc, les transports, le cadre de vie ou la sécurité. HomePedia classe les communes accessibles selon ce critère et vous laisse repartir avec un dossier à emporter en visite.",
    tips: [
      "Le critère énergétique change tout : certaines communes n'ont que 1 % de logements bien classés",
      "Seules les communes avec 40 ventes comparables minimum sont retenues",
      "Dossier PDF : sélection, grille de visite et méthode de négociation",
    ],
    color: "#3c83f6",
    colorDim: "rgba(60,131,246,0.12)",
    nav: "/dossier",
    navLabel: "Lancer une recherche",
  },
  {
    icon: "calculate",
    title: "Ce prix est-il justifié ?",
    subtitle: "Situer un bien parmi les ventes réelles",
    description:
      "Une annonce en main, HomePedia place son prix dans la distribution des ventes comparables. Vous savez alors si vous êtes au-dessus ou en dessous du marché, et de combien négocier. La médiane donne un chiffre ; le percentile vous dit où viser.",
    tips: [
      "Entre le premier et le troisième quartile, l'écart dépasse souvent 30 % du prix",
      "Cible de négociation chiffrée, du prix médian au premier quartile",
      "Capacité d'emprunt et coût des travaux énergétiques, aides déduites",
    ],
    color: "#10b981",
    colorDim: "rgba(16,185,129,0.12)",
    nav: "/estimation",
    navLabel: "Estimer un bien",
  },
  {
    icon: "key",
    title: "Ce loyer est-il correct ?",
    subtitle: "Pour les locataires, avant de signer",
    description:
      "Comparez un loyer au marché local et vérifiez si la commune applique l'encadrement des loyers. À Paris, Plaine Commune et Est Ensemble, un loyer supérieur au loyer de référence majoré est contestable — et le trop-perçu récupérable.",
    tips: [
      "Le bail doit mentionner le loyer de référence en zone d'encadrement",
      "Comparaison avec une mensualité de crédit pour un bien équivalent",
      "Un loyer se juge toujours avec les charges et la classe DPE",
    ],
    color: "#f59e0b",
    colorDim: "rgba(245,158,11,0.12)",
    nav: "/loyer",
    navLabel: "Vérifier un loyer",
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
    title: "Comparer et arbitrer",
    subtitle: "Deux communes côte à côte, ou le front de Pareto",
    description:
      "Le comparateur met deux communes face à face sur le prix, le rendement, le DPE, l'IPS et la sécurité, avec une URL partageable. Le front de Pareto va plus loin : il isole les communes où l'on ne peut plus améliorer le rendement sans accepter davantage de risque — les choix objectivement optimaux.",
    tips: [
      "Comparateur : radar sur 5 dimensions, URL partageable ?a=&b=",
      "Pareto : les points cerclés de blanc forment la frontière efficiente",
      "Haut-gauche du Pareto = meilleur rendement pour un risque faible",
    ],
    color: "#06b6d4",
    colorDim: "rgba(6,182,212,0.12)",
    nav: "/comparer",
    navLabel: "Comparer deux communes",
  },
  {
    icon: "smart_toy",
    title: "HomePedia IA",
    subtitle: "Le marché, vos droits, et la méthode",
    description:
      "L'assistant répond sur les 1 266 communes, mais aussi sur le droit du logement — bail, dépôt de garantie, préavis, aides — et sur la méthode d'achat : comment lire un percentile, quoi vérifier en copropriété, comment négocier. Hors de ce périmètre, il le dit plutôt que d'inventer.",
    tips: [
      "« Quel est le prix immobilier à Vincennes ? »",
      "« Quel dépôt de garantie pour un meublé ? »",
      "« Comment négocier le prix d'un appartement ? »",
    ],
    color: "#f97316",
    colorDim: "rgba(249,115,22,0.12)",
    nav: "/carte",
    navLabel: "Ouvrir le chatbot",
  },
  {
    icon: "home_work",
    title: "Mon Patrimoine",
    subtitle: "Gestion locative sans abonnement",
    description:
      "Enregistrez vos biens, associez vos locataires et suivez les loyers mois par mois. Générez des quittances PDF conformes à la loi 89-462, calculez l'indexation IRL et exportez un CSV comptable annuel. 100% gratuit, aucun logiciel à installer.",
    tips: [
      "Ajout bien → locataire → suivi loyers en 3 clics",
      "Clic sur mois payé → quittance A4 prête à imprimer",
      "Calcul IRL automatique avec valeurs INSEE",
    ],
    color: "#8b5cf6",
    colorDim: "rgba(139,92,246,0.12)",
    nav: "/gestion",
    navLabel: "Gérer mon patrimoine",
  },
  {
    icon: "key",
    title: "Espace Locataire",
    subtitle: "Portail dédié pour les locataires",
    description:
      "Le bailleur invite son locataire en un clic : un compte est créé automatiquement. Le locataire se connecte, consulte sa fiche logement, l'historique des paiements et télécharge ses quittances PDF en toute autonomie — sans déranger son propriétaire.",
    tips: [
      "Invitation depuis la fiche bien → mot de passe temporaire",
      "Connexion → redirigé vers 'Mon logement'",
      "Quittances téléchargeables pour les 12 derniers mois",
    ],
    color: "#06b6d4",
    colorDim: "rgba(6,182,212,0.12)",
    nav: "/mon-logement",
    navLabel: "Voir l'espace locataire",
  },
];

export default function OnboardingTour({ open, onClose }) {
  const [step, setStep] = useState(0);
  const [sommaireOuvert, setSommaireOuvert] = useState(false);
  const [recherche, setRecherche] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      setStep(0);
      setSommaireOuvert(false);
      setRecherche("");
    }
  }, [open]);

  // Douze étapes, c'est trop pour être parcouru linéairement quand on cherche
  // une réponse précise : la recherche porte sur le titre, le sous-titre, la
  // description et les astuces, pas seulement sur le titre.
  // Les accents sont retirés des deux côtés : personne ne tape « négociation »
  // avec son accent dans un champ de recherche.
  const resultats = useMemo(() => {
    const sansAccent = t =>
      (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const q = sansAccent(recherche.trim());
    if (!q) return STEPS.map((s, i) => ({ ...s, index: i }));
    return STEPS
      .map((s, i) => ({ ...s, index: i }))
      .filter(s =>
        sansAccent([s.title, s.subtitle, s.description, ...(s.tips || [])].join(" "))
          .includes(q)
      );
  }, [recherche]);

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
            <div className="flex items-start gap-1 shrink-0">
              <button
                onClick={() => setSommaireOuvert(v => !v)}
                title="Chercher une rubrique"
                aria-expanded={sommaireOuvert}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/5 transition-colors mt-0.5"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 19 }}>
                  {sommaireOuvert ? "close_fullscreen" : "search"}
                </span>
              </button>
            <button
              onClick={onClose}
              className="shrink-0 p-1 text-slate-500 hover:text-slate-200 transition-colors mt-1"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
            </button>
            </div>
          </div>
        </div>

        {/* Sommaire cherchable — accès direct à une rubrique */}
        {sommaireOuvert && (
          <div className="border-b border-slate-800" style={{ background: "#0b1220" }}>
            <div className="px-6 pt-4 pb-3">
              <input
                autoFocus
                value={recherche}
                onChange={e => setRecherche(e.target.value)}
                placeholder="Chercher une rubrique : loyer, DPE, négocier, percentile…"
                className="w-full bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white
                           placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="max-h-64 overflow-y-auto pb-2">
              {resultats.length === 0 ? (
                <p className="px-6 py-4 text-xs text-slate-500">
                  Aucune rubrique ne correspond. Essayez « prix », « loyer », « travaux »…
                </p>
              ) : (
                resultats.map(s => (
                  <button
                    key={s.index}
                    onClick={() => { setStep(s.index); setSommaireOuvert(false); setRecherche(""); }}
                    className={`w-full text-left px-6 py-2.5 flex items-start gap-3 transition-colors ${
                      s.index === step ? "bg-white/5" : "hover:bg-white/5"
                    }`}
                  >
                    <span className="material-symbols-outlined shrink-0 mt-0.5"
                      style={{ fontSize: 17, color: s.color }}>{s.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-[13px] text-slate-100">{s.title}</span>
                      <span className="block text-[11px] text-slate-500 truncate">{s.subtitle}</span>
                    </span>
                    <span className="ml-auto text-[10px] text-slate-600 shrink-0 mt-1">
                      {s.index + 1}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

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
