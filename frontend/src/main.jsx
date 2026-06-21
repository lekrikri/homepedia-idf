import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import axios from "axios";
import App from "./App.jsx";
import "./index.css";

// En production (Cloud Run), VITE_API_URL = URL du backend Cloud Run
// En développement local, VITE_API_URL est vide → URLs relatives (Vite proxy)
const PROD_BACKEND = "https://homepedia-backend-714876351060.europe-west1.run.app";
const apiUrl = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? PROD_BACKEND : "");
if (apiUrl) {
  axios.defaults.baseURL = apiUrl;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
