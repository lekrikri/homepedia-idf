import React from "react";
import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="not-found">
      <h1>404</h1>
      <p>Page introuvable.</p>
      <Link to="/">Retour à la carte</Link>
    </div>
  );
}
