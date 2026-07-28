import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import axios from "axios";

/**
 * Rappel discret et EXACT de l'ancienneté des données, là où l'on lit des chiffres.
 *
 * L'éthos du projet est la transparence sur ce que la donnée permet — et ne permet
 * pas — de conclure. Autant que le millésime soit visible près des chiffres, pas
 * seulement sur la page Sources. Alimenté par l'API plutôt que codé en dur : la
 * ligne précédente affichait encore « DVF 2019-2024 », périmé depuis l'ingestion
 * de 2025.
 */
const LABELS = {
  dvf: "DVF",
  dpe: "DPE",
  securite: "Sécurité SSMSI",
  taxe_fonciere: "Taxe foncière",
  ips: "IPS écoles",
  revenus: "Revenus Filosofi",
  risques: "Risques",
};

export default function MillesimeFooter({ className = "" }) {
  const [sources, setSources] = useState([]);

  useEffect(() => {
    axios.get("/api/v1/sources")
      .then(({ data }) => setSources(data.sources || []))
      .catch(() => {});
  }, []);

  if (!sources.length) return null;

  const resume = Object.keys(LABELS)
    .map((cle) => sources.find((s) => s.cle === cle))
    .filter((s) => s && s.millesime)
    .map((s) => `${LABELS[s.cle]} ${s.millesime}`)
    .join(" · ");

  return (
    <p className={`text-xs text-slate-600 ${className}`}>
      Données : {resume}.{" "}
      <Link to="/sources" className="underline hover:text-slate-400">
        Détail, couverture et limites
      </Link>
    </p>
  );
}
