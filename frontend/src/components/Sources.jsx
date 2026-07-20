import { useState, useEffect } from "react";
import axios from "axios";

/**
 * Provenance des données.
 *
 * Chaque chiffre affiché dans l'application vient de quelque part, à une date
 * donnée, avec une couverture partielle et des limites. Les exposer sert deux
 * publics : l'utilisateur, qui sait alors ce qu'il peut conclure ; et l'équipe,
 * pour qui une lacune visible finit par être comblée. L'absence de coordonnées
 * géographiques avant 2023 est restée invisible deux ans.
 */
export default function Sources() {
  const [sources, setSources] = useState([]);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    axios.get("/api/v1/sources")
      .then(({ data }) => setSources(data.sources || []))
      .catch(() => setSources([]))
      .finally(() => setChargement(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">D'où viennent nos données</h1>
        <p className="text-slate-400 text-sm mt-1">
          Toutes les données sont publiques et gratuites. Voici leur origine, leur
          millésime, et surtout ce qu'elles ne permettent pas de conclure.
        </p>
      </div>

      {chargement ? (
        <p className="text-slate-500 text-sm">Chargement…</p>
      ) : sources.length === 0 ? (
        <p className="text-slate-500 text-sm">Provenance momentanément indisponible.</p>
      ) : (
        <div className="space-y-3">
          {sources.map(s => (
            <div key={s.cle} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <h2 className="font-semibold text-white text-sm">{s.libelle}</h2>
                <span className="text-[11px] text-slate-500">{s.organisme}</span>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px]">
                {s.millesime && (
                  <span className="px-2 py-0.5 rounded-md"
                    style={{ background: "rgba(60,131,246,0.15)", color: "#93c5fd" }}>
                    millésime {s.millesime}
                  </span>
                )}
                {s.couverture && <span className="text-slate-400">{s.couverture}</span>}
              </div>

              {s.limite && (
                <p className="text-[12px] text-slate-400 mt-2.5 pt-2.5 border-t border-slate-800 leading-relaxed">
                  <span className="text-amber-500/90 font-medium">Ce qu'elle ne dit pas — </span>
                  {s.limite}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-slate-600">
        Une donnée présentée sans sa limite est plus trompeuse qu'une donnée absente.
        C'est pourquoi certains indicateurs sont masqués lorsqu'ils reposent sur un
        effectif trop faible, plutôt qu'affichés avec une fausse précision.
      </p>
    </div>
  );
}
