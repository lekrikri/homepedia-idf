import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import axios from "axios";
import App from "./App.jsx";
import "./index.css";
import { registerSW } from "virtual:pwa-register";
registerSW({ immediate: true });

// Le service worker PWA récupère la nouvelle version en tâche de fond, mais les
// assets déjà chargés restent périmés jusqu'à un rechargement — d'où des
// utilisateurs coincés sur une ancienne version après un déploiement (le chatbot
// « ne marchait plus », alors que c'était du cache). Quand un nouveau SW prend le
// contrôle, on recharge la page une seule fois : la mise à jour devient invisible.
if ("serviceWorker" in navigator) {
  let recharge = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (recharge) return;
    recharge = true;
    window.location.reload();
  });
}

// En production (Cloud Run), VITE_API_URL = URL du backend Cloud Run (injecté via --build-arg)
// En développement local, VITE_API_URL est vide → URLs relatives (Vite proxy → localhost:8080)
if (import.meta.env.VITE_API_URL) {
  axios.defaults.baseURL = import.meta.env.VITE_API_URL;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </HelmetProvider>
  </React.StrictMode>
);
