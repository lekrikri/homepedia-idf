import React, { useState, useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import Header from "./components/Header.jsx";
import LandingPage from "./components/LandingPage.jsx";
import MapView from "./components/MapView.jsx";
import Transactions from "./components/Transactions.jsx";
import Dashboard from "./components/Dashboard.jsx";
import Pipeline from "./components/Pipeline.jsx";
import Comparer from "./components/Comparer.jsx";
import Portfolio from "./components/Portfolio.jsx";
import ParetoFront from "./components/ParetoFront.jsx";
import NotFound from "./components/NotFound.jsx";
import { CommunesProvider } from "./contexts/CommunesContext.jsx";
import ChatWidget from "./components/ChatWidget.jsx";
import OnboardingTour from "./components/OnboardingTour.jsx";

export default function App() {
  const [tourOpen, setTourOpen] = useState(false);

  // Auto-déclenchement 1ère visite
  useEffect(() => {
    const done = localStorage.getItem("hp_tour_done");
    if (!done) {
      const t = setTimeout(() => setTourOpen(true), 800);
      return () => clearTimeout(t);
    }
  }, []);

  const handleTourClose = () => {
    setTourOpen(false);
    localStorage.setItem("hp_tour_done", "1");
  };

  return (
    <CommunesProvider>
      <div className="dark h-screen flex flex-col bg-background-dark text-slate-100 overflow-hidden font-display">
        <Header onOpenTour={() => setTourOpen(true)} />
        <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <Routes>
            <Route path="/"             element={<LandingPage />} />
            <Route path="/carte"        element={<MapView />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/dashboard"    element={<Dashboard />} />
            <Route path="/pipeline"     element={<Pipeline />} />
            <Route path="/comparer"     element={<Comparer />} />
            <Route path="/portfolio"    element={<Portfolio />} />
            <Route path="/pareto"       element={<ParetoFront />} />
            <Route path="*"             element={<NotFound />} />
          </Routes>
        </main>
        <ChatWidget />
        <OnboardingTour open={tourOpen} onClose={handleTourClose} />
      </div>
    </CommunesProvider>
  );
}
