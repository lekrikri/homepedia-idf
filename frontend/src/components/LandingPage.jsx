import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";

const gridBg = {
  backgroundImage: "radial-gradient(circle at 2px 2px, rgba(60,131,246,0.07) 1px, transparent 0)",
  backgroundSize: "28px 28px",
};

const FEATURES = [
  {
    icon: "travel_explore",
    title: "Où chercher ?",
    desc: "Comparez les communes sur ce qui compte pour vous — prix, performance énergétique, transports — sous contrainte de budget, et repartez avec un dossier à emporter en visite.",
    color: "#3c83f6",
    link: "/dossier",
  },
  {
    icon: "calculate",
    title: "Ce prix est-il justifié ?",
    desc: "Situez un bien parmi les ventes réelles comparables : percentile, marge de négociation chiffrée, capacité d'emprunt et coût des travaux énergétiques.",
    color: "#10b981",
    link: "/estimation",
  },
  {
    icon: "key",
    title: "Ce loyer est-il correct ?",
    desc: "Comparez un loyer au marché local et vérifiez si la commune applique l'encadrement des loyers — un dépassement est récupérable.",
    color: "#f59e0b",
    link: "/loyer",
  },
  {
    icon: "map",
    title: "Carte interactive MVT",
    desc: "Tuiles vectorielles PostGIS — naviguez sur 1 266 communes IDF avec prix au m² et transactions DVF en temps réel.",
    color: "#3c83f6",
    link: "/carte",
  },
  {
    icon: "schedule",
    title: "Timeline animée 2021–2026",
    desc: "Slider temporel sur la heatmap des prix — visualisez l'évolution réelle 2021–2024 et les prévisions Prophet 2025–2026.",
    color: "#f59e0b",
    link: "/carte",
  },
  {
    icon: "scatter_plot",
    title: "Pareto Front multicritère",
    desc: "Scatter plot rendement locatif vs risque BRGM pour 1 264 communes — identifiez les opportunités sur le front optimal.",
    color: "#10b981",
    link: "/pareto",
  },
  {
    icon: "warning",
    title: "Risques environnementaux",
    desc: "Données BRGM par commune : retrait-gonflement argile et risque inondation (0 → 3) + score global géorisques.",
    color: "#ef4444",
    link: "/carte",
  },
  {
    icon: "compare_arrows",
    title: "Villes jumelles",
    desc: "Trouvez des communes au profil similaire mais moins chères (−8% minimum) grâce à la distance euclidienne 5D.",
    color: "#a78bfa",
    link: "/carte",
  },
  {
    icon: "trending_up",
    title: "Prévisions Prophet 2025–2026",
    desc: "Modèle bayésien (Meta Prophet) entraîné commune par commune sur DVF 2019–2024 — graphique historique + prévisions avec intervalles de confiance 80% dans chaque fiche.",
    color: "#a78bfa",
    link: "/carte",
  },
  {
    icon: "directions_walk",
    title: "Isochrones & accessibilité",
    desc: "Visualisez les zones accessibles à pied, en vélo ou en voiture depuis n'importe quel point d'Île-de-France.",
    color: "#06b6d4",
    link: "/carte",
  },
  {
    icon: "smart_toy",
    title: "Assistant IA (RAG streaming)",
    desc: "16 intents — prix, rendement, risques BRGM, DPE, sécurité. Réponses en temps réel via Qwen2.5-0.5B + ChromaDB.",
    color: "#ec4899",
    link: "/carte?chat=open",
  },
  {
    icon: "api",
    title: "API publique documentée",
    desc: "Spec OpenAPI 3.0.3 complète — tous les endpoints documentés avec exemples. Swagger UI accessible via /docs.",
    color: "#22c55e",
    link: null,
  },
  {
    icon: "savings",
    title: "Portfolio investisseur",
    desc: "Simulateur cash-flow (apport, taux, durée, loyer, charges) avec graphique SVG sur 20 ans.",
    color: "#f59e0b",
    link: "/portfolio",
  },
  {
    icon: "home_work",
    title: "Gestion locative DIY",
    desc: "Gérez vos biens, suivez les loyers mois par mois, générez les quittances PDF et calculez l'indexation IRL — sans abonnement.",
    color: "#8b5cf6",
    link: "/gestion",
  },
  {
    icon: "key",
    title: "Espace locataire",
    desc: "Portail dédié aux locataires : fiche logement, historique des paiements et téléchargement des quittances PDF en autonomie.",
    color: "#06b6d4",
    link: "/mon-logement",
  },
];

const SOURCES = [
  { label: "DVF", full: "Demandes de Valeurs Foncières", color: "#3c83f6" },
  { label: "INSEE", full: "Statistiques socio-démographiques", color: "#22c55e" },
  { label: "ADEME DPE", full: "Performance Énergétique + enrichissement transactions", color: "#f59e0b" },
  { label: "OSM", full: "OpenStreetMap — Points d'intérêt", color: "#a78bfa" },
  { label: "IPS / MEN", full: "Indice de Position Sociale des écoles", color: "#ec4899" },
  { label: "SSMSI", full: "Statistiques de criminalité par commune", color: "#ef4444" },
  { label: "BRGM", full: "Géorisques — argile & inondation", color: "#f97316" },
];

export default function LandingPage() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    axios.get("/api/v1/stats").then(r => setStats(r.data)).catch(() => {});
  }, []);

  const kpis = [
    {
      // Ventes de logements exploitables : la base compte 1,9 M de lignes DVF,
      // mais plus de la moitié sont des dépendances sans surface habitable.
      value: stats?.nb_transactions ? stats.nb_transactions.toLocaleString("fr-FR") : "~867 000",
      label: "Ventes de logements",
      icon: "handshake",
      color: "#3c83f6",
    },
    {
      value: stats?.avg_prix_m2 ? `${Math.round(stats.avg_prix_m2).toLocaleString("fr-FR")} €` : "—",
      label: "Prix médian / m²",
      icon: "euro",
      color: "#f59e0b",
    },
    {
      value: "1 266",
      label: "Communes couvertes",
      icon: "location_city",
      color: "#22c55e",
    },
    {
      value: "40+",
      label: "Indicateurs / commune",
      icon: "equalizer",
      color: "#a78bfa",
    },
  ];

  return (
    <div className="h-full overflow-y-auto bg-background-dark" style={gridBg}>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center justify-center text-center px-6 pt-24 pb-20 overflow-hidden">
        {/* Glow orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-10 pointer-events-none"
          style={{ background: "radial-gradient(circle, #3c83f6 0%, transparent 70%)", filter: "blur(60px)" }} />
        <div className="absolute bottom-0 right-1/4 w-64 h-64 rounded-full opacity-8 pointer-events-none"
          style={{ background: "radial-gradient(circle, #a78bfa 0%, transparent 70%)", filter: "blur(60px)" }} />

        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-6 text-xs font-bold uppercase tracking-widest"
          style={{ background: "rgba(60,131,246,0.12)", border: "1px solid rgba(60,131,246,0.3)", color: "#3c83f6" }}>
          <span className="size-1.5 rounded-full bg-primary animate-pulse" />
          Projet T-DAT-902 · Epitech Paris 2026
        </div>

        {/* Title */}
        <h1 className="text-5xl md:text-6xl font-black tracking-tight text-white mb-4 leading-tight">
          Savoir quoi proposer<br />
          <span style={{ background: "linear-gradient(90deg, #3c83f6, #a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            avant de signer
          </span>
        </h1>

        <p className="text-lg text-slate-400 max-w-xl mb-10 leading-relaxed">
          Où chercher, si un prix est justifié, si un loyer est correct — répondu à partir
          de 867 000 ventes de logements réelles sur les 1 266 communes d'Île-de-France.
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            to="/dossier"
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl font-bold text-white text-sm transition-all hover:scale-105 active:scale-95"
            style={{ background: "#3c83f6", boxShadow: "0 0 30px rgba(60,131,246,0.4)" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>travel_explore</span>
            Où chercher ?
          </Link>
          <Link
            to="/estimation"
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl font-bold text-white text-sm transition-all hover:scale-105 active:scale-95"
            style={{ background: "#10b981", boxShadow: "0 0 30px rgba(16,185,129,0.35)" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>calculate</span>
            Estimer un bien
          </Link>
          <Link
            to="/carte"
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl font-bold text-slate-200 text-sm border border-slate-700 hover:border-primary/50 hover:bg-slate-800 transition-all"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>map</span>
            Explorer la carte
          </Link>
          <Link
            to="/carte?chat=open"
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl font-bold text-slate-200 text-sm border border-slate-700 hover:border-primary/50 hover:bg-slate-800 transition-all"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>smart_toy</span>
            Interroger l'IA
          </Link>
        </div>

        {/* KPI strip */}
        <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-3xl">
          {kpis.map(k => (
            <div key={k.label} className="flex flex-col items-center gap-1 p-4 rounded-xl"
              style={{ background: "rgba(15,23,42,0.6)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <span className="material-symbols-outlined mb-1" style={{ fontSize: 22, color: k.color }}>{k.icon}</span>
              <span className="text-2xl font-black mono-nums text-white">{k.value}</span>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider text-center">{k.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Timeline preview banner ───────────────────────────────────── */}
      <section className="px-6 md:px-16 pb-12">
        <div className="relative rounded-2xl overflow-hidden border border-amber-500/20 p-6 flex flex-col md:flex-row items-center gap-6"
          style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.07) 0%, rgba(167,139,250,0.05) 100%)" }}>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-amber-400" style={{ fontSize: 20 }}>schedule</span>
              <span className="text-amber-400 font-bold text-sm">Timeline animée</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Évolution des prix 2021 → 2026</h3>
            <p className="text-sm text-slate-400">
              Activez la heatmap sur la carte, puis utilisez le slider pour naviguer dans le temps.
              Données DVF réelles 2021–2024 · Prévisions Prophet 2025–2026.
            </p>
          </div>
          {/* Fake timeline */}
          <div className="flex items-end gap-2 h-16">
            {[2021, 2022, 2023, 2024, 2025, 2026].map((y, i) => {
              const heights = [55, 65, 72, 68, 74, 80];
              const isForecast = y >= 2025;
              return (
                <div key={y} className="flex flex-col items-center gap-1">
                  <div className="w-8 rounded-t-md transition-all"
                    style={{
                      height: heights[i],
                      background: isForecast
                        ? "linear-gradient(180deg, #a78bfa 0%, rgba(167,139,250,0.3) 100%)"
                        : "linear-gradient(180deg, #f59e0b 0%, rgba(245,158,11,0.3) 100%)",
                      border: `1px solid ${isForecast ? "rgba(167,139,250,0.4)" : "rgba(245,158,11,0.4)"}`,
                    }} />
                  <span className={`text-[9px] font-bold ${isForecast ? "text-purple-400" : "text-amber-400"}`}>{y}</span>
                </div>
              );
            })}
          </div>
          <Link to="/carte"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-white text-sm transition-all hover:scale-105 shrink-0"
            style={{ background: "#f59e0b", boxShadow: "0 0 20px rgba(245,158,11,0.3)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>play_arrow</span>
            Animer
          </Link>
        </div>
      </section>

      {/* ── Map preview ──────────────────────────────────────────────── */}
      <section className="px-6 md:px-16 pb-20">
        <div className="relative rounded-2xl overflow-hidden border border-primary/15"
          style={{ background: "linear-gradient(135deg, #0a1628 0%, #0d1b2e 100%)", minHeight: 320 }}>
          <div className="absolute inset-0 opacity-20"
            style={{ backgroundImage: "radial-gradient(circle at 2px 2px, rgba(60,131,246,0.3) 1px, transparent 0)", backgroundSize: "20px 20px" }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-64 h-64 rounded-full opacity-15"
              style={{ background: "radial-gradient(circle, #3c83f6 0%, transparent 60%)", filter: "blur(40px)" }} />
          </div>

          {[
            { x: "30%", y: "40%", v: "450 k€", t: "Appt 65 m²" },
            { x: "55%", y: "30%", v: "1,2 M€", t: "Maison 120 m²" },
            { x: "45%", y: "60%", v: "320 k€", t: "Studio 28 m²" },
            { x: "70%", y: "45%", v: "780 k€", t: "Appt 95 m²" },
            { x: "20%", y: "65%", v: "290 k€", t: "Appt 42 m²" },
          ].map((m, i) => (
            <div key={i} className="absolute" style={{ left: m.x, top: m.y, transform: "translate(-50%,-50%)" }}>
              <div className="size-3 rounded-full bg-primary border-2 border-white/60"
                style={{ boxShadow: "0 0 10px rgba(60,131,246,0.8)", animation: `pulse 2s ease-in-out ${i * 0.4}s infinite` }} />
              <div className="absolute left-5 top-1/2 -translate-y-1/2 whitespace-nowrap px-2 py-1 rounded-lg text-xs font-bold text-white"
                style={{ background: "rgba(16,23,34,0.95)", border: "1px solid rgba(60,131,246,0.3)", minWidth: 90 }}>
                <div className="text-primary">{m.v}</div>
                <div className="text-slate-400 text-[10px]">{m.t}</div>
              </div>
            </div>
          ))}

          <div className="absolute top-6 right-6 px-3 py-2 rounded-xl text-xs font-bold"
            style={{ background: "rgba(16,23,34,0.9)", border: "1px solid rgba(34,197,94,0.3)", color: "#22c55e" }}>
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>equalizer</span>
              Score composite · 1 266 communes
            </div>
          </div>

          <div className="absolute bottom-6 left-6 right-6 flex items-center justify-between">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium text-slate-300"
              style={{ background: "rgba(16,23,34,0.8)", border: "1px solid rgba(60,131,246,0.2)" }}>
              <span className="size-1.5 rounded-full bg-green-400 animate-pulse" />
              Tuiles vectorielles PostGIS
            </div>
            <Link to="/carte"
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold text-white transition-all hover:scale-105"
              style={{ background: "#3c83f6", boxShadow: "0 0 15px rgba(60,131,246,0.4)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>open_in_full</span>
              Ouvrir la carte
            </Link>
          </div>
        </div>
      </section>

      {/* ── Features grid ────────────────────────────────────────────── */}
      <section className="px-6 md:px-16 pb-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-white mb-3">Tout ce dont vous avez besoin</h2>
          <p className="text-slate-400 max-w-lg mx-auto">
            Une plateforme complète pour analyser, comparer et investir dans l'immobilier francilien
            grâce à 7 sources de données open data officielles.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(f => {
            const card = (
              <div
                className="p-6 rounded-xl transition-all hover:border-primary/30 group h-full"
                style={{ background: "rgba(15,23,42,0.6)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="size-10 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"
                  style={{ background: `${f.color}18`, border: `1px solid ${f.color}35` }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: f.color }}>{f.icon}</span>
                </div>
                <h3 className="font-bold text-slate-100 mb-2">{f.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
              </div>
            );
            return f.link ? (
              <Link key={f.title} to={f.link} className="block">{card}</Link>
            ) : (
              <div key={f.title}>{card}</div>
            );
          })}
        </div>
      </section>

      {/* ── Data sources ─────────────────────────────────────────────── */}
      <section className="px-6 md:px-16 pb-20">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-white mb-2">7 sources de données officielles</h2>
          <p className="text-slate-500 text-sm">Données publiques certifiées, conformes RGPD, mises à jour régulièrement</p>
        </div>
        <div className="flex flex-wrap justify-center gap-4">
          {SOURCES.map(s => (
            <div key={s.label}
              className="flex items-center gap-3 px-5 py-3 rounded-xl"
              style={{ background: "rgba(15,23,42,0.7)", border: `1px solid ${s.color}25` }}>
              <div className="size-2.5 rounded-full" style={{ background: s.color }} />
              <div>
                <p className="text-sm font-bold" style={{ color: s.color }}>{s.label}</p>
                <p className="text-[10px] text-slate-500">{s.full}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Stats évolution prix ──────────────────────────────────────── */}
      {stats?.evolution && (
        <section className="px-6 md:px-16 pb-20">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-white mb-2">Évolution des prix IDF</h2>
            <p className="text-slate-500 text-sm">Prix médian au m² en Île-de-France (transactions DVF)</p>
          </div>
          <div className="max-w-3xl mx-auto p-6 rounded-2xl"
            style={{ background: "rgba(15,23,42,0.6)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-end justify-between gap-2 h-40">
              {stats.evolution.map((e, i) => {
                const max = Math.max(...stats.evolution.map(x => x.prix_m2));
                const pct = (e.prix_m2 / max) * 100;
                return (
                  <div key={e.year} className="flex flex-col items-center gap-2 flex-1">
                    <span className="text-xs text-primary font-bold">
                      {(e.prix_m2 / 1000).toFixed(1)}k
                    </span>
                    <div className="w-full rounded-t-lg transition-all"
                      style={{
                        height: `${pct}%`,
                        background: i === stats.evolution.length - 1
                          ? "linear-gradient(180deg, #3c83f6 0%, #a78bfa 100%)"
                          : "rgba(60,131,246,0.3)",
                        border: "1px solid rgba(60,131,246,0.3)",
                      }} />
                    <span className="text-[10px] text-slate-500">{e.year}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── CTA bottom ───────────────────────────────────────────────── */}
      <section className="px-6 md:px-16 pb-24 text-center">
        <div className="max-w-2xl mx-auto p-10 rounded-2xl"
          style={{ background: "linear-gradient(135deg, rgba(60,131,246,0.1) 0%, rgba(167,139,250,0.08) 100%)", border: "1px solid rgba(60,131,246,0.2)" }}>
          <h2 className="text-3xl font-black text-white mb-3">Commencez à explorer</h2>
          <p className="text-slate-400 mb-8">
            1,9M transactions DVF, timeline animée 2021–2026, Pareto Front multicritère,
            risques BRGM, villes jumelles et assistant IA — tout en un.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              to="/carte"
              className="inline-flex items-center gap-2 px-10 py-4 rounded-xl font-bold text-white text-sm transition-all hover:scale-105 active:scale-95"
              style={{ background: "#3c83f6", boxShadow: "0 0 40px rgba(60,131,246,0.35)" }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>explore</span>
              Lancer HomePedia IDF
            </Link>
            <Link
              to="/pareto"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl font-bold text-white text-sm transition-all hover:scale-105 active:scale-95"
              style={{ background: "#10b981", boxShadow: "0 0 30px rgba(16,185,129,0.25)" }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>scatter_plot</span>
              Pareto Front
            </Link>
            <Link
              to="/carte?chat=open"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl font-bold text-slate-200 text-sm border border-slate-700 hover:border-primary/50 hover:bg-slate-800 transition-all"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>smart_toy</span>
              Parler à l'IA
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 md:px-16 py-6 border-t border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="size-6 bg-primary rounded flex items-center justify-center">
            <span className="material-symbols-outlined text-white" style={{ fontSize: 14 }}>domain</span>
          </div>
          <span className="text-sm font-bold text-slate-300">HomePedia IDF</span>
        </div>
        <p className="text-xs text-slate-600">
          T-DAT-902 · Epitech Paris · 2026 · 7 sources open data officielles · API OpenAPI 3.0
        </p>
      </footer>
    </div>
  );
}
