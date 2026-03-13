import React, { useEffect, useState } from "react";
import axios from "axios";

export default function Dashboard() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    axios
      .get("/api/v1/health")
      .then((res) => setHealth(res.data))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="dashboard">
      <h1>Tableau de bord</h1>

      <section className="dashboard-section">
        <h2>Statut des services</h2>
        {error && <p className="error">Erreur : {error}</p>}
        {health ? (
          <div className="health-grid">
            <div className="health-status">
              <span className="badge badge--ok">{health.status}</span>
            </div>
            {Object.entries(health.services ?? {}).map(([name, svc]) => (
              <div key={name} className="health-card">
                <strong>{name}</strong>
                <span>{svc.status}</span>
                {svc.host && <code>{svc.host}</code>}
              </div>
            ))}
          </div>
        ) : (
          !error && <p>Chargement…</p>
        )}
      </section>

      <section className="dashboard-section">
        <h2>Données immobilières IDF</h2>
        <p>Visualisations et statistiques à venir.</p>
      </section>
    </div>
  );
}
