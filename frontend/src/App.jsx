import React from "react";
import { Routes, Route } from "react-router-dom";
import Header from "./components/Header.jsx";
import LandingPage from "./components/LandingPage.jsx";
import MapView from "./components/MapView.jsx";
import Transactions from "./components/Transactions.jsx";
import Dashboard from "./components/Dashboard.jsx";
import Pipeline from "./components/Pipeline.jsx";
import NotFound from "./components/NotFound.jsx";

export default function App() {
  return (
    <div className="dark h-screen flex flex-col bg-background-dark text-slate-100 overflow-hidden font-display">
      <Header />
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <Routes>
          <Route path="/"             element={<LandingPage />} />
          <Route path="/carte"        element={<MapView />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/dashboard"    element={<Dashboard />} />
          <Route path="/pipeline"     element={<Pipeline />} />
          <Route path="*"             element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}
