import React, { useEffect, useState } from "react";
import axios from "axios";

const STATUS_CFG = {
  success: { bg: "bg-emerald-500/15", border: "border-emerald-500/40", text: "text-emerald-400", dot: "bg-emerald-400", glow: "shadow-emerald-500/20", label: "Succès" },
  error:   { bg: "bg-red-500/15",     border: "border-red-500/40",     text: "text-red-400",     dot: "bg-red-400",     glow: "shadow-red-500/20",     label: "Erreur" },
  running: { bg: "bg-blue-500/15",    border: "border-blue-500/40",    text: "text-blue-400",    dot: "bg-blue-400",    glow: "shadow-blue-500/20",    label: "En cours" },
};

const STEPS_CFG = [
  { key: "gold",         label: "Export communes",    icon: "apartment",   color: "bg-amber-400",   textColor: "text-amber-400" },
  { key: "transactions", label: "Export transactions", icon: "swap_horiz",  color: "bg-blue-400",    textColor: "text-blue-400"  },
  { key: "enrichments",  label: "Enrichissements",    icon: "database",    color: "bg-purple-400",  textColor: "text-purple-400"},
  { key: "scores",       label: "Calcul des scores",  icon: "analytics",   color: "bg-emerald-400", textColor: "text-emerald-400"},
];

function fmt(s) {
  if (!s) return "—";
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}
function fmtDate(s) {
  return new Date(s).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtNum(n) {
  if (n == null) return "—";
  return n.toLocaleString("fr-FR");
}

function StatusBadge({ status }) {
  const c = STATUS_CFG[status] || STATUS_CFG.running;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${c.bg} ${c.border} ${c.text}`}>
      <span className={`w-2 h-2 rounded-full ${c.dot} ${status === "running" ? "animate-pulse" : ""}`} />
      {c.label}
    </span>
  );
}

function StepTimeline({ steps, total }) {
  if (!steps || total <= 0) return null;
  return (
    <div className="space-y-3">
      {STEPS_CFG.map(s => {
        const dur = steps[s.key] || 0;
        const pct = Math.max(1, Math.round((dur / total) * 100));
        return (
          <div key={s.key} className="flex items-center gap-3">
            <span className={`material-symbols-outlined shrink-0 ${s.textColor}`} style={{ fontSize: 15 }}>{s.icon}</span>
            <span className="text-xs text-slate-400 w-36 shrink-0">{s.label}</span>
            <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
              <div className={`h-full ${s.color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
            </div>
            <span className={`text-xs font-mono font-semibold w-14 text-right ${s.textColor}`}>{fmt(dur)}</span>
            <span className="text-[10px] text-slate-600 w-8 text-right">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

function RunCard({ run, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const steps = run.steps_duration ? (() => { try { return JSON.parse(run.steps_duration); } catch { return null; } })() : null;
  const total = run.duration_s || 0;
  const c = STATUS_CFG[run.status] || STATUS_CFG.running;

  return (
    <div className={`border rounded-xl overflow-hidden transition-all shadow-lg ${c.glow} ${open ? "border-slate-600" : "border-slate-800/80 hover:border-slate-700"}`}>

      {/* ── Header cliquable ─────────────────────────────────────────── */}
      <button onClick={() => setOpen(o => !o)} className="w-full text-left">
        <div className="px-5 pt-4 pb-3 flex items-start gap-4">

          {/* Statut + titre */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap mb-2">
              <StatusBadge status={run.status} />
              <h3 className="text-base font-bold text-white">
                Pipeline {run.annee || "—"}
              </h3>
              {run.execution_id && (
                <span className="text-[11px] text-slate-500 font-mono hidden lg:block">
                  exec/{run.execution_id.split("-").slice(-1)[0]}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Démarré le {fmtDate(run.started_at)}
              {run.finished_at && ` · Terminé le ${fmtDate(run.finished_at)}`}
            </p>
          </div>

          {/* Métriques inline */}
          <div className="flex items-center gap-5 shrink-0">
            <div className="text-center">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Durée</p>
              <p className="text-lg font-bold text-white leading-none">{fmt(total) || "—"}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Communes</p>
              <p className="text-lg font-bold text-amber-400 leading-none">{fmtNum(run.nb_communes_exported)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Transactions</p>
              <p className="text-lg font-bold text-blue-400 leading-none">{fmtNum(run.nb_transactions_exported)}</p>
            </div>
            <span
              className="material-symbols-outlined text-slate-600 shrink-0 transition-transform"
              style={{ fontSize: 20, transform: open ? "rotate(180deg)" : "" }}
            >
              expand_more
            </span>
          </div>
        </div>

        {/* Step bars — toujours visibles dans le header */}
        {steps && total > 0 && (
          <div className="px-5 pb-4">
            <div className="flex gap-1 h-3 rounded-full overflow-hidden">
              {STEPS_CFG.map(s => {
                const dur = steps[s.key] || 0;
                const pct = Math.max(1, Math.round((dur / total) * 100));
                return (
                  <div
                    key={s.key}
                    title={`${s.label}: ${fmt(dur)} (${pct}%)`}
                    className={`${s.color} opacity-70 hover:opacity-100 transition-opacity`}
                    style={{ width: `${pct}%` }}
                  />
                );
              })}
            </div>
            <div className="flex gap-4 mt-1.5">
              {STEPS_CFG.map(s => {
                const dur = steps[s.key] || 0;
                const pct = Math.max(1, Math.round((dur / total) * 100));
                return (
                  <span key={s.key} className={`text-[10px] ${s.textColor} flex items-center gap-1`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${s.color}`} />
                    {s.label} · {fmt(dur)} ({pct}%)
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </button>

      {/* ── Détails expandés ─────────────────────────────────────────── */}
      {open && (
        <div className="border-t border-slate-800 px-5 py-5 bg-slate-900/50 space-y-5">

          {/* Timeline détaillée */}
          {steps && total > 0 && (
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-3 font-semibold">Chronologie des étapes</p>
              <StepTimeline steps={steps} total={total} />
            </div>
          )}

          {/* Grille de détails */}
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-3 font-semibold">Informations détaillées</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {[
                { label: "Année cible",    value: run.annee || "—",              icon: "calendar_month", color: "text-slate-300"   },
                { label: "Statut final",   value: (STATUS_CFG[run.status] || STATUS_CFG.running).label, icon: "info", color: (STATUS_CFG[run.status] || STATUS_CFG.running).text },
                { label: "Durée totale",   value: fmt(total),                    icon: "timer",          color: "text-slate-300"   },
                { label: "Communes maj",   value: fmtNum(run.nb_communes_exported),  icon: "apartment",  color: "text-amber-400"   },
                { label: "Transactions",   value: fmtNum(run.nb_transactions_exported), icon: "swap_horiz", color: "text-blue-400"  },
                { label: "Démarré le",     value: fmtDate(run.started_at),       icon: "schedule",       color: "text-slate-300"   },
                { label: "Terminé le",     value: run.finished_at ? fmtDate(run.finished_at) : "—", icon: "done_all", color: "text-slate-300" },
                { label: "Execution ID",   value: run.execution_id ? run.execution_id.split("-").slice(-1)[0] : "—", icon: "tag", color: "text-slate-500" },
              ].map(m => (
                <div key={m.label} className="bg-slate-800/60 border border-slate-700/30 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="material-symbols-outlined text-slate-500" style={{ fontSize: 13 }}>{m.icon}</span>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide">{m.label}</p>
                  </div>
                  <p className={`text-sm font-semibold ${m.color} break-all`}>{m.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Erreur si présente */}
          {run.error_message && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="material-symbols-outlined text-red-400" style={{ fontSize: 14 }}>error</span>
                <p className="text-[10px] text-red-400 uppercase tracking-wider font-semibold">Message d'erreur</p>
              </div>
              <p className="text-xs text-red-300 font-mono break-all leading-relaxed">{run.error_message}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Pipeline() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [user] = useState(() => {
    try { return JSON.parse(localStorage.getItem("hp_user")); } catch { return null; }
  });

  const load = () => {
    setLoading(true);
    setError(null);
    const token = localStorage.getItem("hp_token");
    axios.get("/api/v1/pipeline/runs", token ? { headers: { Authorization: `Bearer ${token}` } } : {})
      .then(r => setRuns(r.data.data || []))
      .catch(() => setError("Impossible de charger l'historique du pipeline."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (user) load(); else setLoading(false); }, []);

  const successRuns   = runs.filter(r => r.status === "success");
  const totalTx       = successRuns.reduce((acc, r) => acc + (r.nb_transactions_exported || 0), 0);
  const avgDuration   = successRuns.length ? Math.round(successRuns.reduce((a, r) => a + (r.duration_s || 0), 0) / successRuns.length) : 0;
  const successRate   = runs.length ? Math.round(successRuns.length / runs.length * 100) : 0;
  const lastSuccess   = successRuns[0];

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-sm">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-6" style={{ background: "rgba(60,131,246,0.1)", border: "1px solid rgba(60,131,246,0.2)" }}>
            <span className="material-symbols-outlined text-primary" style={{ fontSize: 32 }}>lock</span>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Accès restreint</h2>
          <p className="text-slate-400 text-sm mb-6">
            La page Pipeline est réservée aux comptes administrateurs.<br />
            Connectez-vous avec vos identifiants admin pour y accéder.
          </p>
          <p className="text-xs text-slate-600 font-mono">admin@homepedia.fr · Homepedia2026!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 lg:px-10 flex flex-col gap-6">

      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Pipeline d'ingestion</h1>
          <p className="text-sm text-slate-400 mt-1">
            Cloud Run Job <span className="font-mono text-slate-300">homepedia-pipeline</span>
            {" · "}Supabase PostgreSQL · Dernière mise à jour automatique
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm text-slate-300 transition-colors shrink-0"
        >
          <span className={`material-symbols-outlined ${loading ? "animate-spin" : ""}`} style={{ fontSize: 16 }}>refresh</span>
          Actualiser
        </button>
      </div>

      {/* ── KPI Cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Exécutions totales",
            value: loading ? "…" : runs.length,
            sub: `${successRuns.length} succès · ${runs.filter(r => r.status === "error").length} erreurs`,
            icon: "history",
            color: "text-slate-300",
            iconColor: "text-slate-400",
          },
          {
            label: "Taux de succès",
            value: loading ? "…" : `${successRate}%`,
            sub: lastSuccess ? `Dernière : ${new Date(lastSuccess.started_at).toLocaleDateString("fr-FR")}` : "Aucun run réussi",
            icon: "check_circle",
            color: successRate >= 80 ? "text-emerald-400" : "text-amber-400",
            iconColor: "text-emerald-400",
          },
          {
            label: "Transactions insérées",
            value: loading ? "…" : fmtNum(lastSuccess?.nb_transactions_exported ?? null),
            sub: `Dernier run · cumul : ${fmtNum(totalTx)}`,
            icon: "swap_horiz",
            color: "text-blue-400",
            iconColor: "text-blue-400",
          },
          {
            label: "Durée moyenne",
            value: loading ? "…" : fmt(avgDuration),
            sub: lastSuccess ? `Dernier : ${fmt(lastSuccess.duration_s)}` : "—",
            icon: "timer",
            color: "text-purple-400",
            iconColor: "text-purple-400",
          },
        ].map(k => (
          <div key={k.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-slate-500 uppercase tracking-wider">{k.label}</p>
              <span className={`material-symbols-outlined ${k.iconColor}`} style={{ fontSize: 18 }}>{k.icon}</span>
            </div>
            <p className={`text-2xl font-bold ${k.color} mb-1`}>{k.value}</p>
            <p className="text-[11px] text-slate-500">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Diagramme pipeline ──────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-4 font-semibold">Flux du pipeline</p>
        <div className="flex items-center gap-0 overflow-x-auto pb-1">
          {[
            { icon: "cloud_download", label: "DVF → GCS",   sub: "Annuel (WSL)",           color: "text-slate-400",   bg: "bg-slate-700/30" },
            null,
            { icon: "storage",        label: "dbt run",     sub: "bronze→silver→gold",      color: "text-amber-400",   bg: "bg-amber-500/10" },
            null,
            { icon: "swap_horiz",     label: "Export BQ",   sub: "gold → Supabase",         color: "text-blue-400",    bg: "bg-blue-500/10"  },
            null,
            { icon: "analytics",      label: "Scores",      sub: "IPS+DPE+OSM",             color: "text-emerald-400", bg: "bg-emerald-500/10"},
            null,
            { icon: "public",         label: "API live",    sub: "Supabase → Go API",       color: "text-purple-400",  bg: "bg-purple-500/10"},
          ].map((s, i) => s === null ? (
            <span key={i} className="material-symbols-outlined text-slate-700 mx-3 shrink-0" style={{ fontSize: 16 }}>arrow_forward</span>
          ) : (
            <div key={i} className={`flex flex-col items-center gap-1.5 min-w-[90px] shrink-0 px-3 py-2 rounded-lg ${s.bg}`}>
              <span className={`material-symbols-outlined ${s.color}`} style={{ fontSize: 24 }}>{s.icon}</span>
              <p className={`text-xs font-semibold ${s.color}`}>{s.label}</p>
              <p className="text-[10px] text-slate-500 text-center">{s.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Légende des étapes ──────────────────────────────────────── */}
      <div className="flex items-center gap-6 flex-wrap">
        <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Légende :</p>
        {STEPS_CFG.map(s => (
          <span key={s.key} className={`flex items-center gap-1.5 text-xs ${s.textColor}`}>
            <span className={`w-2 h-2 rounded-full ${s.color}`} />
            {s.label}
          </span>
        ))}
      </div>

      {/* ── Historique ──────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
            Historique des exécutions
            {!loading && runs.length > 0 && <span className="ml-2 text-slate-600">({runs.length} runs)</span>}
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16 text-slate-500 gap-2">
            <span className="material-symbols-outlined animate-spin" style={{ fontSize: 22 }}>refresh</span>
            Chargement de l'historique…
          </div>
        )}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5 text-red-400 text-sm">
            <span className="material-symbols-outlined mr-2 align-middle" style={{ fontSize: 16 }}>error</span>
            {error}
          </div>
        )}
        {!loading && !error && runs.length === 0 && (
          <div className="bg-slate-900 border border-slate-800 border-dashed rounded-xl p-12 text-center">
            <span className="material-symbols-outlined text-slate-600 block mb-3" style={{ fontSize: 40 }}>history</span>
            <p className="text-slate-400 text-sm font-medium">Aucune exécution enregistrée</p>
            <p className="text-slate-500 text-xs mt-1">Le premier run apparaîtra ici dès que le pipeline aura tourné.</p>
          </div>
        )}

        <div className="space-y-4">
          {runs.map((r, i) => (
            <RunCard key={r.id} run={r} defaultOpen={i === 0} />
          ))}
        </div>
      </div>
    </div>
  );
}
