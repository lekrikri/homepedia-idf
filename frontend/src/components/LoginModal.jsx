import React, { useState, useEffect } from "react";

export default function LoginModal({ onClose }) {
  const [tab, setTab] = useState("login"); // "login" | "register"
  const [showPwd, setShowPwd] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });

  // Close on Escape
  useEffect(() => {
    const handler = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(16,23,34,0.6)", backdropFilter: "blur(6px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass-panel glow-border modal-enter w-full max-w-[440px] rounded-xl overflow-hidden">

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 text-slate-500 hover:text-slate-200 transition-colors z-10"
          style={{ position: "absolute" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 22 }}>close</span>
        </button>

        {/* Branding */}
        <div className="pt-8 pb-4 text-center">
          <div className="inline-flex items-center justify-center p-3 rounded-full mb-4" style={{ background: "rgba(60,131,246,0.15)" }}>
            <span className="material-symbols-outlined text-primary" style={{ fontSize: 32 }}>home_pin</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight">HomePedia IDF</h2>
          <p className="text-slate-400 text-sm mt-1">L'immobilier intelligent en Île-de-France</p>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-6" style={{ borderColor: "rgba(60,131,246,0.2)" }}>
          {[["login", "Connexion"], ["register", "Inscription"]].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 py-4 text-sm font-bold border-b-2 transition-colors ${
                tab === key
                  ? "border-primary text-slate-100"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Form */}
        <div className="p-8 flex flex-col gap-5">
          <div className="flex flex-col gap-4">

            {/* Name — inscription only */}
            {tab === "register" && (
              <div className="flex flex-col gap-2">
                <label className="text-slate-300 text-sm font-medium px-1">Nom complet</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" style={{ fontSize: 20 }}>person</span>
                  <input
                    type="text"
                    value={form.name}
                    onChange={set("name")}
                    placeholder="Jean Dupont"
                    className="w-full pl-12 pr-4 h-12 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary"
                    style={{ background: "rgba(15,23,42,0.5)", border: "1px solid rgba(60,131,246,0.2)" }}
                  />
                </div>
              </div>
            )}

            {/* Email */}
            <div className="flex flex-col gap-2">
              <label className="text-slate-300 text-sm font-medium px-1">Email</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" style={{ fontSize: 20 }}>mail</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={set("email")}
                  placeholder="votre@email.com"
                  className="w-full pl-12 pr-4 h-12 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary"
                  style={{ background: "rgba(15,23,42,0.5)", border: "1px solid rgba(60,131,246,0.2)" }}
                />
              </div>
            </div>

            {/* Password */}
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center px-1">
                <label className="text-slate-300 text-sm font-medium">Mot de passe</label>
                {tab === "login" && (
                  <a href="#" className="text-xs text-primary hover:underline">Mot de passe oublié ?</a>
                )}
              </div>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" style={{ fontSize: 20 }}>lock</span>
                <input
                  type={showPwd ? "text" : "password"}
                  value={form.password}
                  onChange={set("password")}
                  placeholder="••••••••"
                  className="w-full pl-12 pr-12 h-12 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary"
                  style={{ background: "rgba(15,23,42,0.5)", border: "1px solid rgba(60,131,246,0.2)" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                  style={{ fontSize: 20 }}
                >
                  {showPwd ? "visibility_off" : "visibility"}
                </button>
              </div>
            </div>

            {/* Confirm password — inscription only */}
            {tab === "register" && (
              <div className="flex flex-col gap-2">
                <label className="text-slate-300 text-sm font-medium px-1">Confirmer le mot de passe</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" style={{ fontSize: 20 }}>lock</span>
                  <input
                    type="password"
                    value={form.confirm}
                    onChange={set("confirm")}
                    placeholder="••••••••"
                    className="w-full pl-12 pr-4 h-12 rounded-lg text-slate-100 text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary"
                    style={{ background: "rgba(15,23,42,0.5)", border: "1px solid rgba(60,131,246,0.2)" }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Submit */}
          <button className="glow-button w-full h-12 bg-primary hover:bg-primary/90 text-white font-bold rounded-lg flex items-center justify-center gap-2 group">
            <span>{tab === "login" ? "Se connecter" : "Créer un compte"}</span>
            <span className="material-symbols-outlined group-hover:translate-x-1 transition-transform" style={{ fontSize: 20 }}>arrow_forward</span>
          </button>

          {/* Divider */}
          <div className="flex items-center gap-4 py-1">
            <div className="h-px flex-1 bg-slate-700" />
            <span className="text-xs text-slate-500 font-medium uppercase tracking-widest">ou continuer avec</span>
            <div className="h-px flex-1 bg-slate-700" />
          </div>

          {/* Social */}
          <div className="grid grid-cols-2 gap-4">
            <button className="flex items-center justify-center gap-2 h-11 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 transition-colors text-slate-200 text-sm font-medium">
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Google
            </button>
            <button className="flex items-center justify-center gap-2 h-11 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 transition-colors text-slate-200 text-sm font-medium">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>smartphone</span>
              Apple
            </button>
          </div>

          {/* Footer link */}
          <p className="text-center text-slate-400 text-sm">
            {tab === "login" ? (
              <>Pas encore de compte ?{" "}
                <button onClick={() => setTab("register")} className="text-primary font-bold hover:underline ml-1">Créer un compte</button>
              </>
            ) : (
              <>Déjà un compte ?{" "}
                <button onClick={() => setTab("login")} className="text-primary font-bold hover:underline ml-1">Se connecter</button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
