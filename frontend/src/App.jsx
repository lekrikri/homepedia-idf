import React, { useState, useEffect, lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import Header from "./components/Header.jsx";
import { CommunesProvider } from "./contexts/CommunesContext.jsx";
import { FavorisProvider } from "./contexts/FavorisContext.jsx";
import { useFavorisContext } from "./contexts/FavorisContext.jsx";
import FavorisPanel from "./components/FavorisPanel.jsx";
import ChatWidget from "./components/ChatWidget.jsx";
import OnboardingTour from "./components/OnboardingTour.jsx";

// Lazy loading — code splitting par page
const LandingPage   = lazy(() => import("./components/LandingPage.jsx"));
const MapView       = lazy(() => import("./components/MapView.jsx"));
const Transactions  = lazy(() => import("./components/Transactions.jsx"));
const Dashboard     = lazy(() => import("./components/Dashboard.jsx"));
const Pipeline      = lazy(() => import("./components/Pipeline.jsx"));
const Comparer      = lazy(() => import("./components/Comparer.jsx"));
const Portfolio     = lazy(() => import("./components/Portfolio.jsx"));
const ParetoFront   = lazy(() => import("./components/ParetoFront.jsx"));
const NotFound      = lazy(() => import("./components/NotFound.jsx"));
const CommunePage      = lazy(() => import("./components/CommunePage.jsx"));
const GestionLocative  = lazy(() => import("./components/GestionLocative.jsx"));
const MonLogement      = lazy(() => import("./components/MonLogement.jsx"));
const Estimation       = lazy(() => import("./components/Estimation.jsx"));
const Loyer            = lazy(() => import("./components/Loyer.jsx"));
const Dossier          = lazy(() => import("./components/Dossier.jsx"));

function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <span className="material-symbols-outlined text-primary animate-spin" style={{ fontSize: 32 }}>
        progress_activity
      </span>
    </div>
  );
}

function AppInner() {
  const [tourOpen, setTourOpen] = useState(false);
  const [showFavoris, setShowFavoris] = useState(false);
  const { favoris } = useFavorisContext();

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
    <div className="dark h-screen flex flex-col bg-background-dark text-slate-100 overflow-hidden font-display">
      <Header
        onOpenTour={() => setTourOpen(true)}
        onOpenFavoris={() => setShowFavoris(true)}
        favorisCount={favoris.length}
      />
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/"             element={<LandingPage />} />
            <Route path="/carte"        element={<MapView />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/dashboard"    element={<Dashboard />} />
            <Route path="/pipeline"     element={<Pipeline />} />
            <Route path="/comparer"     element={<Comparer />} />
            <Route path="/portfolio"    element={<Portfolio />} />
            <Route path="/pareto"       element={<ParetoFront />} />
            <Route path="/commune/:slug" element={<CommunePage />} />
            <Route path="/gestion"       element={<GestionLocative />} />
            <Route path="/mon-logement" element={<MonLogement />} />
            <Route path="/estimation"   element={<Estimation />} />
            <Route path="/loyer"        element={<Loyer />} />
            <Route path="/dossier"      element={<Dossier />} />
            <Route path="*"             element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <ChatWidget />
      <OnboardingTour open={tourOpen} onClose={handleTourClose} />
      {showFavoris && <FavorisPanel onClose={() => setShowFavoris(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <CommunesProvider>
      <FavorisProvider>
        <AppInner />
      </FavorisProvider>
    </CommunesProvider>
  );
}
