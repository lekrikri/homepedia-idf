import React from "react";
import { Routes, Route } from "react-router-dom";
import Header from "./components/Header.jsx";
import MapView from "./components/MapView.jsx";
import Dashboard from "./components/Dashboard.jsx";
import NotFound from "./components/NotFound.jsx";
import "./App.css";

export default function App() {
  return (
    <div className="app">
      <Header />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<MapView />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}
