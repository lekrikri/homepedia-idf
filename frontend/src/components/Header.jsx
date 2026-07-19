import React, { useState, useEffect, useRef, useCallback } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import LoginModal from "./LoginModal";
import FavoritesModal from "./FavoritesModal";
import SettingsModal from "./SettingsModal";
import GlobalSearch from "./GlobalSearch.jsx";

// Douze entrées à plat rendaient la barre illisible. Elles sont regroupées par
// intention : ce que l'utilisateur cherche à faire, pas la façon dont l'app est
// découpée. "Mon projet" suit le parcours réel — chercher, estimer, financer.
const NAV_GROUPES = [
  {
    label: "Mon projet",
    icon: "home_work",
    liens: [
      { to: "/dossier",    label: "Où chercher ?",       icon: "travel_explore",
        aide: "Comparer les communes selon vos critères" },
      { to: "/estimation", label: "Ce prix est-il juste ?", icon: "calculate",
        aide: "Situer un bien dans les ventes réelles" },
      { to: "/loyer",      label: "Ce loyer est-il correct ?", icon: "key",
        aide: "Comparer un loyer au marché local" },
      { to: "/portfolio",  label: "Simuler un investissement", icon: "savings",
        aide: "Rendement locatif et cash-flow" },
    ],
  },
  {
    label: "Explorer",
    icon: "explore",
    liens: [
      { to: "/carte",        label: "Carte",        icon: "map",
        aide: "1 266 communes, prix au m² et bâtiments 3D" },
      { to: "/transactions", label: "Transactions", icon: "receipt_long",
        aide: "Les ventes DVF, filtrables et exportables" },
      { to: "/dashboard",    label: "Dashboard",    icon: "insights",
        aide: "Vue d'ensemble du marché francilien" },
      { to: "/comparer",     label: "Comparer",     icon: "compare_arrows",
        aide: "Deux communes côte à côte" },
      { to: "/pareto",       label: "Pareto",       icon: "scatter_plot",
        aide: "Rendement contre risque" },
    ],
  },
];

const NAV_ESPACE = { to: "/gestion", label: "Mon patrimoine", icon: "apartment" };

const NAV_LOCATAIRE = [
  { to: "/mon-logement", label: "Mon logement", icon: "house", end: true },
];

/** Groupe de navigation dépliable, avec une ligne d'aide par destination. */
function MenuGroupe({ groupe }) {
  const [ouvert, setOuvert] = useState(false);
  const ref = useRef(null);
  const location = useLocation();
  const actif = groupe.liens.some(l => location.pathname === l.to);

  useEffect(() => { setOuvert(false); }, [location.pathname]);

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOuvert(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOuvert(o => !o)}
        aria-expanded={ouvert}
        className={`flex items-center gap-1.5 font-medium text-sm transition-colors focus:outline-none
          focus-visible:ring-2 focus-visible:ring-primary/60 rounded px-1 py-0.5
          ${actif ? "text-primary font-semibold" : "text-slate-400 hover:text-slate-100"}`}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{groupe.icon}</span>
        {groupe.label}
        <span className="material-symbols-outlined transition-transform"
          style={{ fontSize: 16, transform: ouvert ? "rotate(180deg)" : "none" }}>
          expand_more
        </span>
      </button>

      {ouvert && (
        <div className="absolute left-0 top-full mt-2 w-72 rounded-xl shadow-2xl overflow-hidden z-50"
          style={{ background: "#0d1520", border: "1px solid rgba(60,131,246,0.22)" }}>
          {groupe.liens.map(l => (
            <NavLink key={l.to} to={l.to} onClick={() => setOuvert(false)}
              className={({ isActive }) =>
                `flex items-start gap-3 px-4 py-3 transition-colors ${
                  isActive ? "bg-primary/10" : "hover:bg-slate-800/60"
                }`}>
              <span className="material-symbols-outlined text-primary mt-0.5 shrink-0"
                style={{ fontSize: 18 }}>{l.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm text-slate-100">{l.label}</span>
                <span className="block text-[11px] text-slate-500 leading-snug">{l.aide}</span>
              </span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function getInitials(user) {
  if (!user) return "?";
  if (user.full_name) {
    const parts = user.full_name.trim().split(" ");
    return (parts[0]?.[0] + (parts[1]?.[0] || "")).toUpperCase();
  }
  return user.email?.[0]?.toUpperCase() || "?";
}

export default function Header({ onOpenTour, onOpenFavoris, favorisCount = 0 }) {
  const navigate = useNavigate();
  const [search,       setSearch]       = useState("");
  const [suggestions,  setSuggestions]  = useState([]);
  const [showDrop,     setShowDrop]     = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [showLogin,    setShowLogin]    = useState(false);
  const [showFav,      setShowFav]      = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile,  setShowProfile]  = useState(false);
  const [user,         setUser]         = useState(null);
  const [showMenu,     setShowMenu]     = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);
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

  // Écouter l'événement global pour ouvrir la modal de connexion
  useEffect(() => {
    const handler = () => setShowLogin(true);
    document.addEventListener("hp:open-login", handler);
    return () => document.removeEventListener("hp:open-login", handler);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleLogin = (userData) => {
    setUser(userData);
    if (userData?.role === "locataire") {
      navigate("/mon-logement");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("hp_token");
    localStorage.removeItem("hp_user");
    setUser(null);
    setShowMenu(false);
  };

  return (
    <>
      <header className="h-16 flex items-center justify-between px-4 md:px-6 border-b border-primary/20 bg-background-dark/80 backdrop-blur-md z-50 shrink-0">
        {/* Logo + Nav */}
        <div className="flex items-center gap-4 md:gap-8">
          {/* Bouton hamburger mobile */}
          <button className="md:hidden p-1 text-slate-400 hover:text-slate-100" onClick={() => setShowMobileNav(v => !v)}>
            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>{showMobileNav ? "close" : "menu"}</span>
          </button>

          <div className="flex items-center gap-3">
            <div className="size-8 bg-primary rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-white" style={{ fontSize: 18 }}>domain</span>
            </div>
            <h1 className="text-lg md:text-xl font-bold tracking-tight text-slate-100">
              HomePedia <span className="text-primary">IDF</span>
            </h1>
          </div>

          <nav className="hidden md:flex items-center gap-5">
            {user?.role === "locataire" ? (
              NAV_LOCATAIRE.map(({ to, label, end, icon }) => (
                <NavLink key={to} to={to} end={end ?? false}
                  className={({ isActive }) =>
                    isActive
                      ? "text-primary font-semibold text-sm flex items-center gap-1.5"
                      : "text-slate-400 hover:text-slate-100 font-medium text-sm transition-colors flex items-center gap-1.5"
                  }>
                  {icon && <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{icon}</span>}
                  {label}
                </NavLink>
              ))
            ) : (
              <>
                <NavLink to="/" end
                  className={({ isActive }) =>
                    isActive
                      ? "text-primary font-semibold text-sm"
                      : "text-slate-400 hover:text-slate-100 font-medium text-sm transition-colors"
                  }>
                  Accueil
                </NavLink>

                {NAV_GROUPES.map(g => <MenuGroupe key={g.label} groupe={g} />)}

                <NavLink to={NAV_ESPACE.to}
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 font-medium text-sm transition-colors ${
                      isActive ? "text-primary font-semibold" : "text-slate-400 hover:text-slate-100"
                    }`}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{NAV_ESPACE.icon}</span>
                  {NAV_ESPACE.label}
                </NavLink>

                {user?.role === "admin" && (
                  <NavLink to="/pipeline"
                    className={({ isActive }) =>
                      `font-medium text-sm transition-colors ${
                        isActive ? "text-primary font-semibold" : "text-slate-500 hover:text-slate-100"
                      }`}>
                    Pipeline
                  </NavLink>
                )}
              </>
            )}
          </nav>
        </div>

        {/* Search — masqué sur mobile */}
        <div className="hidden md:flex flex-1 items-center gap-3 max-w-2xl px-6">
          <GlobalSearch />
          <div className="relative group flex-1" ref={searchRef}>
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
        <div className="flex items-center gap-2 md:gap-4">
          <button
            onClick={onOpenFavoris}
            title="Favoris"
            className="hidden md:flex relative items-center justify-center size-9 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>favorite</span>
            {favorisCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center">
                {favorisCount > 9 ? "9+" : favorisCount}
              </span>
            )}
          </button>
          <button
            onClick={onOpenTour}
            title="Didacticiel — découvrir HomePedia"
            className="hidden md:flex items-center justify-center size-9 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>help_outline</span>
          </button>
          <button className="hidden md:block p-2 text-slate-400 hover:text-slate-100 relative" title="Notifications — bientôt disponible" disabled>
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>notifications</span>
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
                    <button onClick={() => { setShowProfile(true); setShowMenu(false); }}
                      className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-slate-300 hover:bg-primary/10 hover:text-primary transition-colors">
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>person</span>
                      Mon profil
                    </button>
                    <button onClick={() => { setShowFav(true); setShowMenu(false); }}
                      className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-slate-300 hover:bg-primary/10 hover:text-primary transition-colors">
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>favorite</span>
                      Favoris
                    </button>
                    <button onClick={() => { setShowSettings(true); setShowMenu(false); }}
                      className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-slate-300 hover:bg-primary/10 hover:text-primary transition-colors">
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>settings</span>
                      Paramètres
                    </button>
                    {user?.role === "admin" && (
                      <button onClick={() => { navigate("/pipeline"); setShowMenu(false); }}
                        className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-amber-400 hover:bg-amber-500/10 transition-colors">
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>schema</span>
                        Administration
                      </button>
                    )}
                    <div className="border-t border-slate-800 mt-1 pt-1">
                      <button onClick={handleLogout}
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

      {/* Drawer nav mobile */}
      {showMobileNav && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setShowMobileNav(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <nav className="absolute top-16 left-0 right-0 py-2 shadow-2xl"
            style={{ background: "#0b1117", borderBottom: "1px solid rgba(60,131,246,0.2)" }}
            onClick={e => e.stopPropagation()}>
            <NavLink to="/" end onClick={() => setShowMobileNav(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-6 py-3.5 text-sm font-medium transition-colors ${isActive ? "text-primary bg-primary/10 border-l-2 border-primary" : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/50"}`
              }>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>home</span>
              Accueil
            </NavLink>

            {NAV_GROUPES.map(g => (
              <div key={g.label}>
                <p className="px-6 pt-3 pb-1 text-[10px] uppercase tracking-widest text-slate-600">
                  {g.label}
                </p>
                {g.liens.map(({ to, label, icon }) => (
                  <NavLink key={to} to={to} onClick={() => setShowMobileNav(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-6 py-3 text-sm font-medium transition-colors ${isActive ? "text-primary bg-primary/10 border-l-2 border-primary" : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/50"}`
                    }>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{icon}</span>
                    {label}
                  </NavLink>
                ))}
              </div>
            ))}

            <div className="border-t border-slate-800 mt-2 pt-1">
              <NavLink to={NAV_ESPACE.to} onClick={() => setShowMobileNav(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-6 py-3.5 text-sm font-medium transition-colors ${isActive ? "text-primary bg-primary/10 border-l-2 border-primary" : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/50"}`
                }>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{NAV_ESPACE.icon}</span>
                {NAV_ESPACE.label}
              </NavLink>
              {user?.role === "admin" && (
                <NavLink to="/pipeline" onClick={() => setShowMobileNav(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-6 py-3.5 text-sm font-medium transition-colors ${isActive ? "text-primary bg-primary/10 border-l-2 border-primary" : "text-slate-500 hover:text-slate-100 hover:bg-slate-800/50"}`
                  }>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>account_tree</span>
                  Pipeline
                </NavLink>
              )}
            </div>
            {/* Barre de recherche dans le drawer mobile */}
            <div className="px-4 pb-4 pt-2 border-t border-slate-800 mt-2">
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); fetchSuggestions(e.target.value); }}
                className="w-full bg-slate-800/80 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-primary/50"
                placeholder="Rechercher une adresse..."
              />
            </div>
          </nav>
        </div>
      )}

      {showLogin    && <LoginModal    onClose={() => setShowLogin(false)}    onLogin={handleLogin} />}
      {showFav      && <FavoritesModal onClose={() => setShowFav(false)} />}
      {showSettings && <SettingsModal  onClose={() => setShowSettings(false)} />}

      {/* Modal profil simple */}
      {showProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(16,23,34,0.7)", backdropFilter: "blur(6px)" }}
          onClick={e => e.target === e.currentTarget && setShowProfile(false)}>
          <div className="w-full max-w-sm rounded-xl overflow-hidden shadow-2xl"
            style={{ background: "#0f1724", border: "1px solid rgba(60,131,246,0.2)" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 22 }}>person</span>
                <h2 className="text-base font-bold text-white">Mon profil</h2>
              </div>
              <button onClick={() => setShowProfile(false)} className="text-slate-500 hover:text-slate-200">
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-4">
                <div className="size-14 rounded-full bg-primary flex items-center justify-center text-white text-xl font-bold">
                  {getInitials(user)}
                </div>
                <div>
                  <p className="font-bold text-white">{user?.full_name || "Utilisateur"}</p>
                  <p className="text-sm text-slate-400">{user?.email}</p>
                  {user?.role === "admin" && (
                    <span className="inline-block mt-1 text-[9px] font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 uppercase tracking-wider">Admin</span>
                  )}
                </div>
              </div>
              <div className="space-y-2 pt-2 border-t border-slate-800">
                {[
                  { label: "Email", value: user?.email },
                  { label: "Rôle", value: user?.role === "admin" ? "Administrateur" : "Utilisateur" },
                  { label: "Plateforme", value: "HomePedia IDF" },
                ].map(row => (
                  <div key={row.label} className="flex justify-between text-sm">
                    <span className="text-slate-500">{row.label}</span>
                    <span className="text-slate-200 font-medium">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
