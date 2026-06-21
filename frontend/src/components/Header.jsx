import React, { useState, useEffect, useRef, useCallback } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import LoginModal from "./LoginModal";

const NAV = [
  { to: "/",             label: "Accueil",      end: true },
  { to: "/carte",        label: "Carte" },
  { to: "/transactions", label: "Transactions" },
  { to: "/dashboard",    label: "Dashboard" },
  { to: "/comparer",     label: "Comparer" },
  { to: "/pipeline",     label: "Pipeline" },
];

function getInitials(user) {
  if (!user) return "?";
  if (user.full_name) {
    const parts = user.full_name.trim().split(" ");
    return (parts[0]?.[0] + (parts[1]?.[0] || "")).toUpperCase();
  }
  return user.email?.[0]?.toUpperCase() || "?";
}

export default function Header() {
  const navigate = useNavigate();
  const [search,       setSearch]       = useState("");
  const [suggestions,  setSuggestions]  = useState([]);
  const [showDrop,     setShowDrop]     = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [showLogin,    setShowLogin]    = useState(false);
  const [user,         setUser]         = useState(null);
  const [showMenu,     setShowMenu]     = useState(false);
  const menuRef   = useRef(null);
  const searchRef = useRef(null);
  const debounce  = useRef(null);

  // Autocomplete via api-adresse.data.gouv.fr (gratuit, sans clé, IDF uniquement)
  const fetchSuggestions = useCallback((q) => {
    if (!q || q.length < 3) { setSuggestions([]); return; }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setLoading(true);
      fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=6&lat=48.8566&lon=2.3488`)
        .then(r => r.json())
        .then(d => {
          setSuggestions(d.features || []);
          setShowDrop(true);
        })
        .catch(() => setSuggestions([]))
        .finally(() => setLoading(false));
    }, 300);
  }, []);

  const handleSelect = (feature) => {
    const [lon, lat] = feature.geometry.coordinates;
    const label = feature.properties.label;
    setSearch(label);
    setSuggestions([]);
    setShowDrop(false);
    // Naviguer vers /carte avec les coordonnées en params
    navigate(`/carte?lat=${lat}&lng=${lon}&zoom=16&q=${encodeURIComponent(label)}`);
  };

  // Fermer dropdown si clic en dehors
  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowDrop(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Restore session from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("hp_user");
      if (stored) setUser(JSON.parse(stored));
    } catch {}
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleLogin = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem("hp_token");
    localStorage.removeItem("hp_user");
    setUser(null);
    setShowMenu(false);
  };

  return (
    <>
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
            {NAV.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end ?? false}
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
          <div className="relative group" ref={searchRef}>
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" style={{ fontSize: 18 }}>
              {loading ? "sync" : "search"}
            </span>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); fetchSuggestions(e.target.value); }}
              onFocus={() => suggestions.length > 0 && setShowDrop(true)}
              onKeyDown={e => e.key === "Escape" && setShowDrop(false)}
              className="w-full bg-slate-800/50 border-none rounded-lg pl-10 py-2 text-sm focus:ring-1 focus:ring-primary/50 placeholder:text-slate-500 outline-none text-slate-100"
              placeholder="Rechercher une adresse, un quartier..."
            />
            {search && (
              <button onClick={() => { setSearch(""); setSuggestions([]); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
              </button>
            )}

            {/* Dropdown suggestions */}
            {showDrop && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-xl overflow-hidden shadow-2xl z-[100]"
                style={{ background: "#0f1724", border: "1px solid rgba(60,131,246,0.3)" }}>
                {suggestions.map((f, i) => {
                  const p = f.properties;
                  const typeIcon = p.type === "street" ? "route" : p.type === "municipality" ? "location_city" : "location_on";
                  return (
                    <button key={i} onMouseDown={() => handleSelect(f)}
                      className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-primary/10 transition-colors border-b border-slate-800/60 last:border-0">
                      <span className="material-symbols-outlined text-primary/60 mt-0.5 shrink-0" style={{ fontSize: 16 }}>{typeIcon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-100 font-medium truncate">{p.name}</p>
                        <p className="text-[11px] text-slate-500 truncate">{p.postcode} {p.city}{p.context ? ` · ${p.context}` : ""}</p>
                      </div>
                      <span className="text-[10px] text-slate-600 shrink-0 mt-1 uppercase tracking-wider">{p.type}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-4">
          <button className="p-2 text-slate-400 hover:text-slate-100 relative">
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>notifications</span>
            <span className="absolute top-2 right-2 size-2 bg-red-500 rounded-full border-2 border-background-dark" />
          </button>

          {user ? (
            /* Logged-in user menu */
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowMenu(v => !v)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <div className="size-8 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold">
                  {getInitials(user)}
                </div>
                <span className="text-sm font-medium text-slate-200 max-w-[120px] truncate">
                  {user.full_name || user.email}
                </span>
                <span className="material-symbols-outlined text-slate-400" style={{ fontSize: 16 }}>expand_more</span>
              </button>

              {showMenu && (
                <div className="absolute right-0 top-full mt-2 w-48 rounded-xl overflow-hidden shadow-xl z-50"
                  style={{ background: "#0f1724", border: "1px solid rgba(60,131,246,0.2)" }}>
                  <div className="px-4 py-3 border-b border-slate-800">
                    <p className="text-xs font-semibold text-slate-200 truncate">{user.full_name || "Utilisateur"}</p>
                    <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
                    {user.role === "admin" && (
                      <span className="inline-block mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 uppercase">Admin</span>
                    )}
                  </div>
                  <div className="py-1">
                    {[
                      { icon: "person", label: "Mon profil" },
                      { icon: "favorite", label: "Favoris" },
                      { icon: "settings", label: "Paramètres" },
                    ].map(item => (
                      <button key={item.label}
                        className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-slate-300 hover:bg-primary/10 hover:text-primary transition-colors">
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{item.icon}</span>
                        {item.label}
                      </button>
                    ))}
                    <div className="border-t border-slate-800 mt-1 pt-1">
                      <button
                        onClick={handleLogout}
                        className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors">
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>logout</span>
                        Se déconnecter
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Not logged in */
            <>
              <button
                onClick={() => setShowLogin(true)}
                className="bg-primary hover:bg-primary/90 text-white px-5 py-2 rounded-lg text-sm font-bold transition-all shadow-lg shadow-primary/20"
              >
                Connexion
              </button>
              <div className="size-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
                <span className="material-symbols-outlined text-slate-400" style={{ fontSize: 18 }}>person</span>
              </div>
            </>
          )}
        </div>
      </header>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} onLogin={handleLogin} />}
    </>
  );
}
