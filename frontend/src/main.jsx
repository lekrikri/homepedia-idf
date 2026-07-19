import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import axios from "axios";
import App from "./App.jsx";
import "./index.css";
import { registerSW } from "virtual:pwa-register";
registerSW({ immediate: true });

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
