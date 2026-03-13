import React, { useState } from "react";
import { NavLink } from "react-router-dom";

const NAV = [
  { to: "/",             label: "Carte" },
  { to: "/transactions", label: "Transactions" },
  { to: "/dashboard",    label: "Statistiques" },
];

export default function Header() {
  const [search, setSearch] = useState("");

  return (
    <header className="h-16 flex items-center justify-between px-6 border-b border-primary/20 bg-background-dark/80 backdrop-blur-md z-50 shrink-0">
      {/* Logo + Nav */}
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-3">
          <div className="size-8 bg-primary rounded-lg flex items-center justify-center">
            <span className="material-symbols-outlined text-white" style={{ fontSize: 18 }}>domain</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">
            HomePedia <span className="text-primary">IDF</span>
          </h1>
        </div>

        <nav className="hidden md:flex items-center gap-6">
          {NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                isActive
                  ? "text-primary font-semibold text-sm border-b-2 border-primary pb-5 mt-5"
                  : "text-slate-400 hover:text-slate-100 font-medium text-sm transition-colors"
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Search */}
      <div className="flex-1 max-w-md px-10">
        <div className="relative group">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" style={{ fontSize: 18 }}>search</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-800/50 border-none rounded-lg pl-10 py-2 text-sm focus:ring-1 focus:ring-primary/50 placeholder:text-slate-500 outline-none text-slate-100"
            placeholder="Rechercher une adresse, un quartier..."
          />
        </div>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-4">
        <button className="p-2 text-slate-400 hover:text-slate-100 relative">
          <span className="material-symbols-outlined" style={{ fontSize: 22 }}>notifications</span>
          <span className="absolute top-2 right-2 size-2 bg-red-500 rounded-full border-2 border-background-dark" />
        </button>
        <button className="bg-primary hover:bg-primary/90 text-white px-5 py-2 rounded-lg text-sm font-bold transition-all shadow-lg shadow-primary/20">
          Connexion
        </button>
        <div className="size-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
          <span className="material-symbols-outlined text-slate-400" style={{ fontSize: 18 }}>person</span>
        </div>
      </div>
    </header>
  );
}
