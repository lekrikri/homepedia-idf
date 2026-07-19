import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import axios from "axios";

function slugToCity(slug) {
  // "saint-germain-en-laye" → "Saint-Germain-en-Laye"
  const lower = ["de", "du", "en", "les", "la", "le", "sur", "sous", "lès", "des"];
  return slug
    .split("-")
    .map((w, i) => (i === 0 || !lower.includes(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join("-");
}

export default function CommunePage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!slug) return;
    const city = slugToCity(slug);
    // 1. Recherche de la commune par nom → récupère code_insee
    axios
      .get(`/api/v1/communes?q=${encodeURIComponent(city)}&limit=1`)
      .then((r) => {
        const commune = r.data?.data?.[0];
        if (!commune?.code_insee) {
          setError(true);
          setLoading(false);
          return null;
        }
        // 2. Charger la fiche agrégat complète via code_insee
        return axios.get(`/api/v1/communes/${commune.code_insee}/agregat`);
      })
      .then((r) => {
        if (r) {
          // GetCommuneAgregat retourne l'objet directement (pas de wrapper data)
          setData(r.data);
          setLoading(false);
        }
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [slug]);

  if (loading)
    return (
      <div className="flex items-center justify-center h-full text-slate-400 p-8">
        <span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>
        Chargement de la commune…
      </div>
    );

  if (error || !data)
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <Helmet>
          <title>Commune introuvable — HomePedia IDF</title>
        </Helmet>
        <span className="material-symbols-outlined text-slate-600" style={{ fontSize: 48 }}>
          location_off
        </span>
        <p className="text-slate-400">Commune « {slug} » introuvable.</p>
        <button
          onClick={() => navigate("/carte")}
          className="px-4 py-2 rounded-lg text-sm bg-primary text-white"
        >
          Voir la carte
        </button>
      </div>
    );

  const city = data.city || slugToCity(slug);
  const dept = data.code_departement?.trim() || "";
  const prix = data.prix_median_m2
    ? `${Math.round(data.prix_median_m2).toLocaleString("fr-FR")} €/m²`
    : null;
  const rendement = data.rendement_locatif_brut
    ? `${Number(data.rendement_locatif_brut).toFixed(2)}%`
    : null;
  const scoreInvest = data.score_investissement ? Math.round(data.score_investissement) : null;
  const scoreQV = data.score_qualite_vie ? Math.round(data.score_qualite_vie) : null;

  const title = `${city} (${dept}) — Prix immobilier, investissement & qualité de vie | HomePedia IDF`;
  const description = [
    `${city} (dép. ${dept}) en Île-de-France.`,
    prix ? `Prix médian : ${prix}.` : "",
    rendement ? `Rendement locatif brut : ${rendement}.` : "",
    scoreInvest ? `Score investissement : ${scoreInvest}/100.` : "",
    scoreQV ? `Score qualité de vie : ${scoreQV}/100.` : "",
    "Données DVF 2019-2024, DPE, IPS scolaire, prévisions Prophet 2025-2026.",
  ]
    .filter(Boolean)
    .join(" ");

  const canonicalUrl = `https://www.homepedia.org/commune/${slug}`;

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />

        {/* Open Graph */}
        <meta property="og:type" content="article" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:site_name" content="HomePedia IDF" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />

        {/* Données structurées JSON-LD */}
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Place",
            name: city,
            addressRegion: "Île-de-France",
            addressCountry: "FR",
            description: description,
            url: canonicalUrl,
          })}
        </script>
      </Helmet>

      <div className="flex flex-col h-full bg-[#0f1117] text-slate-200 overflow-auto">
        {/* Header commune */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3 mb-1">
            <button
              onClick={() => navigate(-1)}
              className="text-slate-500 hover:text-slate-200 transition-colors"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                arrow_back
              </span>
            </button>
            <div>
              <h1 className="text-xl font-bold text-white">{city}</h1>
              <p className="text-xs text-slate-400">Département {dept} — Île-de-France</p>
            </div>
          </div>
        </div>

        {/* Métriques clés */}
        <div className="px-6 py-5 grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Prix médian", value: prix, icon: "home", color: "#3c83f6" },
            { label: "Rendement brut", value: rendement, icon: "trending_up", color: "#10b981" },
            {
              label: "Score investissement",
              value: scoreInvest ? `${scoreInvest}/100` : null,
              icon: "analytics",
              color: "#f59e0b",
            },
            {
              label: "Qualité de vie",
              value: scoreQV ? `${scoreQV}/100` : null,
              icon: "park",
              color: "#a78bfa",
            },
          ].map(
            ({ label, value, icon, color }) =>
              value && (
                <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 16, color }}
                    >
                      {icon}
                    </span>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</p>
                  </div>
                  <p className="text-lg font-bold text-white mono-nums">{value}</p>
                </div>
              )
          )}
        </div>

        {/* CTA vers la carte */}
        <div className="px-6 pb-6">
          <button
            onClick={() => navigate(`/carte?commune=${encodeURIComponent(city)}`)}
            className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-white transition-all"
            style={{ background: "#3c83f6", boxShadow: "0 4px 14px rgba(60,131,246,0.3)" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              map
            </span>
            Voir {city} sur la carte interactive
          </button>
        </div>

        {/* Sources et liens internes */}
        <div className="px-6 pb-6 text-xs text-slate-600">
          <p>
            Données sources : DVF (Demandes de Valeurs Foncières) 2019-2024 · DPE (Diagnostic de
            Performance Énergétique) · IPS scolaire · BRGM risques naturels · Prévisions Prophet
            2025-2026
          </p>
          <p className="mt-1">
            <a href="/commune/paris" className="hover:text-slate-400 underline">
              Paris
            </a>
            {" · "}
            <a href="/commune/versailles" className="hover:text-slate-400 underline">
              Versailles
            </a>
            {" · "}
            <a href="/commune/boulogne-billancourt" className="hover:text-slate-400 underline">
              Boulogne-Billancourt
            </a>
            {" · "}
            <a href="/commune/saint-denis" className="hover:text-slate-400 underline">
              Saint-Denis
            </a>
            {" · "}
            <a href="/commune/nanterre" className="hover:text-slate-400 underline">
              Nanterre
            </a>
          </p>
        </div>
      </div>
    </>
  );
}
