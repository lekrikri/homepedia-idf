import { useState, useEffect } from "react";
import { IRL, TRIMESTRES, IRL_SOURCE, IRL_RELEVE_LE } from "./outils/irl.js";

const API = import.meta.env.VITE_API_URL || "";

const MOIS = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
const MOIS_LONG = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

// L'IRL vit dans outils/irl.js, adossé à la série INSEE : la table saisie ici
// était fausse à partir du 3e trimestre 2023 et aurait conduit à des révisions
// supérieures à ce que la loi autorise.

function authHeaders() {
  const token = localStorage.getItem("hp_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Catégories de documents ───────────────────────────────────────────────────

export const DOC_CATS_PROPRIO = [
  { value: "bail",                label: "Bail de location" },
  { value: "avenant_bail",        label: "Avenant au bail" },
  { value: "etat_lieux_entree",   label: "État des lieux d'entrée" },
  { value: "etat_lieux_sortie",   label: "État des lieux de sortie" },
  { value: "inventaire",          label: "Inventaire du mobilier" },
  { value: "avis_echeance",       label: "Avis d'échéance" },
  { value: "quittance_archivee",  label: "Quittance archivée" },
  { value: "plan_appartement",    label: "Plan de l'appartement" },
  { value: "diagnostic_dpe",      label: "Diagnostic DPE" },
  { value: "diagnostic_plomb",    label: "Diagnostic plomb (CREP)" },
  { value: "diagnostic_amiante",  label: "Diagnostic amiante" },
  { value: "diagnostic_electricite", label: "Diagnostic électricité" },
  { value: "diagnostic_gaz",      label: "Diagnostic gaz" },
  { value: "diagnostic_etat_risques", label: "État des risques (ERNT)" },
  { value: "assurance_pno",       label: "Assurance PNO" },
  { value: "reglement_copropriete", label: "Règlement de copropriété" },
  { value: "notice_information",  label: "Notice d'information (ALUR)" },
  { value: "taxe_fonciere",       label: "Taxe foncière" },
  // La révision annuelle et la TEOM sont les deux pièces que le locataire
  // réclame le plus : la première parce qu'elle justifie l'augmentation, la
  // seconde parce qu'elle lui est refacturée et qu'il a le droit d'en voir
  // le décompte.
  { value: "revision_loyer",      label: "Révision de loyer (IRL)" },
  { value: "taxe_ordures",        label: "Taxe d'enlèvement des ordures ménagères" },
  { value: "autre",               label: "Autre document" },
];

export const DOC_CATS_LOCATAIRE = [
  { value: "piece_identite",          label: "Pièce d'identité" },
  { value: "fiche_de_paie",           label: "Fiche de paie" },
  { value: "avis_imposition",         label: "Avis d'imposition" },
  { value: "contrat_travail",         label: "Contrat de travail" },
  { value: "attestation_assurance",   label: "Attestation d'assurance habitation" },
  { value: "justificatif_domicile",   label: "Justificatif de domicile" },
  { value: "rib",                     label: "RIB" },
  { value: "garant_piece_identite",   label: "Pièce d'identité garant" },
  { value: "garant_revenus",          label: "Justificatif revenus garant" },
  { value: "autre",                   label: "Autre document" },
];

const ALL_DOC_LABELS = Object.fromEntries(
  [...DOC_CATS_PROPRIO, ...DOC_CATS_LOCATAIRE].map(c => [c.value, c.label])
);

function fmtTaille(octets) {
  if (!octets) return "";
  if (octets < 1024) return `${octets} o`;
  if (octets < 1048576) return `${(octets / 1024).toFixed(0)} Ko`;
  return `${(octets / 1048576).toFixed(1)} Mo`;
}

// ── Relevé de compte ──────────────────────────────────────────────────────────
//
// Le suivi mensuel dit « ce mois est-il réglé ? ». Le relevé dit « où en est-on ? »,
// qui est la question réellement posée : chaque échéance au débit, chaque
// règlement au crédit, et un solde qui court d'une ligne à l'autre. Un solde qui
// dérive rend un mois oublié visible bien mieux qu'une case restée grise.
// `bienId` désigne la vue bailleur ; sans lui, le composant interroge l'espace
// locataire, qui atteint le même relevé par le compte plutôt que par le bien.
// Un solde qui différerait selon qui le consulte serait pire que pas de solde.
export function ReleveCompte({ bienId, token }) {
  const [releve, setReleve] = useState(null);
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    setChargement(true);
    const API = import.meta.env.VITE_API_URL || "";
    const url = bienId
      ? `${API}/api/v1/gestion/biens/${bienId}/releve?annee=${annee}`
      : `${API}/api/v1/mon-logement/releve?annee=${annee}`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => (r.ok ? r.json() : null))
      .then(setReleve)
      .catch(() => setReleve(null))
      .finally(() => setChargement(false));
  }, [bienId, annee, token]);

  const eur = n => (n == null ? "" : n.toLocaleString("fr-FR",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €");

  const soldeCouleur = s => (Math.abs(s) < 0.5 ? "#34d399" : s < 0 ? "#f87171" : "#fbbf24");

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>
            account_balance_wallet
          </span>
          <h3 className="text-white font-semibold text-sm">Relevé de compte</h3>
        </div>
        <select value={annee} onChange={e => setAnnee(Number(e.target.value))}
          className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white">
          {[0, 1, 2].map(d => {
            const a = new Date().getFullYear() - d;
            return <option key={a} value={a}>{a}</option>;
          })}
        </select>
      </div>

      {chargement ? (
        <p className="text-slate-500 text-xs">Chargement…</p>
      ) : !releve ? (
        <p className="text-slate-500 text-xs">Relevé indisponible.</p>
      ) : (
        <>
          <div className="rounded-lg p-3 mb-3" style={{ background: "rgba(148,163,184,0.08)" }}>
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Solde au terme de {releve.annee}</div>
            <div className="text-2xl font-bold" style={{ color: soldeCouleur(releve.solde), fontVariantNumeric: "tabular-nums" }}>
              {eur(releve.solde)}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">{releve.commentaire}</p>
          </div>

          {releve.ecritures.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="text-left font-medium pb-2 pr-3">Date</th>
                    <th className="text-left font-medium pb-2 px-2">Intitulé</th>
                    <th className="text-right font-medium pb-2 px-2">Débit</th>
                    <th className="text-right font-medium pb-2 px-2">Crédit</th>
                    <th className="text-right font-medium pb-2 pl-2">Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {releve.ecritures.map((e, i) => (
                    <tr key={i} className="border-t border-slate-800">
                      <td className="py-2 pr-3 text-slate-400 text-xs whitespace-nowrap">
                        {e.date.split("-").reverse().join("/")}
                      </td>
                      <td className="px-2 text-slate-300 text-xs">
                        {e.libelle}
                        {e.en_attente && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px]"
                            style={{ background: "rgba(248,113,113,0.15)", color: "#f87171" }}>
                            en attente
                          </span>
                        )}
                      </td>
                      <td className="text-right px-2 text-xs" style={{ color: e.debit ? "#f87171" : "transparent" }}>
                        {e.debit ? "−" + eur(e.debit) : "—"}
                      </td>
                      <td className="text-right px-2 text-xs" style={{ color: e.credit ? "#34d399" : "transparent" }}>
                        {e.credit ? "+" + eur(e.credit) : "—"}
                      </td>
                      <td className="text-right pl-2 text-xs font-medium" style={{ color: soldeCouleur(e.solde) }}>
                        {eur(e.solde)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-[11px] text-slate-600 mt-3">
            Appelé sur l'année : {eur(releve.total_appele)} · Réglé : {eur(releve.total_regle)}.
            Le relevé se construit à partir des loyers saisis dans le suivi des paiements.
          </p>
        </>
      )}
    </div>
  );
}

function DocSection({ documents, loading, onUpload, onDownload, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(null);

  const grouped = {};
  documents.forEach(d => {
    const g = d.uploaded_by === "locataire" ? "Pièces locataire" : "Documents bailleur";
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(d);
  });
  const nbPiecesLocataire = (grouped["Pièces locataire"] || []).length;

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-white text-sm flex items-center gap-2 flex-wrap">
          <span className="material-symbols-outlined text-blue-400" style={{ fontSize: 18 }}>folder_open</span>
          Documents locatifs
          {documents.length > 0 && (
            <span className="text-[10px] font-normal text-slate-400 px-1.5 py-0.5 rounded-md bg-slate-800">
              {documents.length}
            </span>
          )}
          {nbPiecesLocataire > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md"
              style={{ background: "rgba(16,185,129,0.15)", color: "#34d399" }}>
              {nbPiecesLocataire} pièce{nbPiecesLocataire > 1 ? "s" : ""} locataire
            </span>
          )}
        </h3>
        <button onClick={onUpload}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:brightness-110"
          style={{ background: "rgba(60,131,246,0.2)", border: "1px solid rgba(60,131,246,0.4)", color: "#60a5fa" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>upload</span>
          Ajouter
        </button>
      </div>

      {loading ? (
        <p className="text-slate-500 text-xs text-center py-4">Chargement…</p>
      ) : documents.length === 0 ? (
        <p className="text-slate-600 text-xs text-center py-6">Aucun document pour ce bien.</p>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([group, docs]) => (
            <div key={group}>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">{group}</p>
              <div className="space-y-1.5">
                {docs.map(doc => (
                  <div key={doc.id}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 group"
                    style={{ background: "rgba(15,23,42,0.6)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <span className="material-symbols-outlined text-slate-500 shrink-0" style={{ fontSize: 18 }}>
                      {doc.mime_type === "application/pdf" ? "picture_as_pdf" : "image"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-medium truncate">{doc.nom_fichier}</p>
                      <p className="text-slate-500 text-[10px]">
                        {ALL_DOC_LABELS[doc.categorie] || doc.categorie}
                        {doc.taille_octets ? ` · ${fmtTaille(doc.taille_octets)}` : ""}
                        {!doc.visible_par_locataire && doc.uploaded_by === "proprio" && (
                          <span className="ml-1 text-amber-500/70">· privé</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => onDownload(doc.id, doc.nom_fichier)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-blue-400/10 transition-all"
                        title="Télécharger">
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
                      </button>
                      {doc.uploaded_by === "proprio" && (
                        <button onClick={() => setConfirmDel(doc.id)}
                          className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-400/10 transition-all"
                          title="Supprimer">
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmDel && (
        <ConfirmModal
          message="Supprimer ce document définitivement ?"
          onConfirm={() => { onDelete(confirmDel); setConfirmDel(null); }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}

// ── Dashboard stats ───────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = "#3c83f6" }) {
  return (
    <div className="rounded-xl p-4 border border-slate-800 bg-slate-900/60">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

// ── Calcul indexation IRL ─────────────────────────────────────────────────────
function IRLCalculator({ loyer }) {
  const trimestres = TRIMESTRES;
  const [refOld, setRefOld] = useState(trimestres[1]);
  const [refNew, setRefNew] = useState(trimestres[0]);

  const irlOld = IRL[refOld];
  const irlNew = IRL[refNew];
  const nouveauLoyer = loyer * (irlNew / irlOld);
  const diff = nouveauLoyer - loyer;

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-amber-400" style={{ fontSize: 18 }}>trending_up</span>
        <h3 className="font-semibold text-white text-sm">Révision IRL</h3>
        <span className="text-[10px] text-slate-500 ml-1">Source : INSEE</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div>
          <p className="text-xs text-slate-500 mb-1">IRL de référence (bail)</p>
          <select value={refOld} onChange={e => setRefOld(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white">
            {trimestres.map(t => <option key={t} value={t}>{t} — {IRL[t]}</option>)}
          </select>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">IRL de révision (actuel)</p>
          <select value={refNew} onChange={e => setRefNew(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white">
            {trimestres.map(t => <option key={t} value={t}>{t} — {IRL[t]}</option>)}
          </select>
        </div>
      </div>
      <div className="flex items-center justify-between bg-slate-800/60 rounded-lg px-4 py-3">
        <div>
          <p className="text-xs text-slate-400">Loyer actuel</p>
          <p className="text-white font-bold">{loyer.toFixed(2)} €</p>
        </div>
        <span className="material-symbols-outlined text-slate-500" style={{ fontSize: 20 }}>arrow_forward</span>
        <div className="text-right">
          <p className="text-xs text-slate-400">Nouveau loyer</p>
          <p className="font-bold text-emerald-400">{nouveauLoyer.toFixed(2)} €</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">Variation</p>
          <p className={`font-bold text-sm ${diff >= 0 ? "text-amber-400" : "text-red-400"}`}>
            {diff >= 0 ? "+" : ""}{diff.toFixed(2)} €/mois
          </p>
        </div>
      </div>
      <p className="text-[10px] text-slate-600 mt-2">
        Formule légale : Loyer × IRL({refNew}) / IRL({refOld}) · Art. 17-1 loi 89-462
      </p>
    </div>
  );
}

// ── Export CSV comptable ───────────────────────────────────────────────────────
// Le fichier est destiné à un tableur français : séparateur « ; » et virgule
// décimale. Avec un point, Excel lit « 900.00 » comme du texte et refuse d'en
// faire la somme — le défaut ne se voit qu'au moment d'additionner la colonne.
const nombreFr = n => Number(n || 0).toFixed(2).replace(".", ",");

const STATUT_LIBELLE = {
  paye: "Payé",
  partiel: "Partiel",
  impaye: "Impayé",
  non_renseigne: "Non renseigné",
};

const dateFr = d => {
  if (!d) return "";
  const [a, m, j] = String(d).slice(0, 10).split("-");
  return j ? `${j}/${m}/${a}` : String(d);
};

async function exportCSVComptable(biens, annee, token) {
  const API = import.meta.env.VITE_API_URL || "";
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const rows = [["Bien","Adresse","Locataire","Mois","Année","Loyer HC (€)","Charges (€)","Total CC (€)","Statut","Date paiement"]];
  let totalHC = 0, totalCharges = 0;

  await Promise.all(biens.map(async b => {
    try {
      const res = await fetch(`${API}/api/v1/gestion/biens/${b.id}/paiements?annee=${annee}`, { headers });
      if (!res.ok) return;
      const paiements = await res.json();
      const locNom = b.locataire ? `${b.locataire.prenom} ${b.locataire.nom}` : "Vacant";
      const loyerHC = b.locataire?.loyer_mensuel || 0;
      const charges = b.locataire?.charges_mensuelles || 0;

      // La ville enregistrée porte déjà le code postal entre parenthèses ; le
      // préfixer une seconde fois donnait « 93300 AUBERVILLIERS (93300) ».
      const ville = (b.ville || "").trim();
      const cp = (b.code_postal || "").trim();
      const adresse = ville.includes(cp) ? ville : `${cp} ${ville}`.trim();

      for (let mois = 1; mois <= 12; mois++) {
        const p = paiements.find(p => p.mois === mois);
        rows.push([
          b.adresse,
          adresse,
          locNom,
          MOIS_LONG[mois - 1],
          annee,
          nombreFr(loyerHC),
          nombreFr(charges),
          nombreFr(loyerHC + charges),
          STATUT_LIBELLE[p?.statut] || STATUT_LIBELLE.non_renseigne,
          dateFr(p?.date_paiement),
        ]);
        totalHC += loyerHC;
        totalCharges += charges;
      }
    } catch {}
  }));

  // Ligne de total : c'est le chiffre que l'on reporte sur la déclaration 2044.
  if (rows.length > 1) {
    rows.push([]);
    rows.push(["TOTAL", "", "", "", annee,
      nombreFr(totalHC), nombreFr(totalCharges), nombreFr(totalHC + totalCharges), "", ""]);
  }

  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `gestion_locative_${annee}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Formulaire bien ───────────────────────────────────────────────────────────
function FormBien({ onSave, onClose }) {
  const [form, setForm] = useState({
    adresse: "", code_postal: "", ville: "", type_bien: "appartement",
    surface_m2: "", nb_pieces: "", loyer_nu: "", charges: "", depot_garantie: "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    const toNum = (v) => v !== "" && v !== null ? Number(v) : null;
    const body = {
      adresse: form.adresse,
      code_postal: form.code_postal || null,
      ville: form.ville || null,
      type_bien: form.type_bien,
      surface_m2: toNum(form.surface_m2),
      nb_pieces: toNum(form.nb_pieces),
      loyer_nu: toNum(form.loyer_nu),
      charges: toNum(form.charges),
      depot_garantie: toNum(form.depot_garantie),
    };
    const res = await fetch(`${API}/api/v1/gestion/biens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (res.ok) { onSave(); onClose(); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 sm:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-white">Ajouter un bien</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input required placeholder="Adresse *" value={form.adresse}
            onChange={e => set("adresse", e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input placeholder="Code postal" value={form.code_postal}
              onChange={e => set("code_postal", e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
            <input placeholder="Ville" value={form.ville}
              onChange={e => set("ville", e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <select value={form.type_bien} onChange={e => set("type_bien", e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
              {["appartement","maison","studio","parking","local"].map(t => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>
              ))}
            </select>
            <input type="number" placeholder="Surface m²" value={form.surface_m2}
              onChange={e => set("surface_m2", e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
            <input type="number" placeholder="Pièces" value={form.nb_pieces}
              onChange={e => set("nb_pieces", e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <input type="number" placeholder="Loyer HC (€)" value={form.loyer_nu}
              onChange={e => set("loyer_nu", e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
            <input type="number" placeholder="Charges (€)" value={form.charges}
              onChange={e => set("charges", e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
            <input type="number" placeholder="Dépôt garantie (€)" value={form.depot_garantie}
              onChange={e => set("depot_garantie", e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-xl text-sm text-slate-400 border border-slate-700">
              Annuler
            </button>
            <button type="submit"
              className="flex-1 py-2 rounded-xl text-sm font-bold text-white"
              style={{ background: "rgba(60,131,246,0.3)", border: "1px solid rgba(60,131,246,0.5)" }}>
              Ajouter
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Modale confirmation ────────────────────────────────────────────────────────
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-red-500/30 rounded-2xl p-6 w-full max-w-sm text-center space-y-4">
        <span className="material-symbols-outlined text-red-400" style={{ fontSize: 40 }}>warning</span>
        <p className="text-white text-sm">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2 rounded-xl text-sm text-slate-400 border border-slate-700">Annuler</button>
          <button onClick={onConfirm} className="flex-1 py-2 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-500">Confirmer</button>
        </div>
      </div>
    </div>
  );
}

// ── Fiche bien + locataire + paiements ────────────────────────────────────────
function BienDetail({ bien, onBack, onRefresh }) {
  const [paiements, setPaiements] = useState([]);
  const [annee, setAnnee] = useState(new Date().getFullYear());

  // Formulaire création locataire
  const [showFormLoc, setShowFormLoc] = useState(false);
  const [formLoc, setFormLoc] = useState({
    prenom: "", nom: "", email: "", telephone: "",
    date_entree: "", type_bail: "vide", loyer_mensuel: "", charges_mensuelles: "", depot_garantie: "",
  });

  // Édition locataire existant
  const [editLocOpen, setEditLocOpen] = useState(false);
  const [editLocForm, setEditLocForm] = useState({});

  // Édition bien
  const [editBienOpen, setEditBienOpen] = useState(false);
  const [editBienForm, setEditBienForm] = useState({});

  // Confirmations
  const [confirmDeleteLoc, setConfirmDeleteLoc] = useState(false);
  const [confirmDeleteBien, setConfirmDeleteBien] = useState(false);

  // Menu action paiement (mois payé : quittance ou marquer impayé)
  const [paiementMenu, setPaiementMenu] = useState(null); // { mois, x, y }

  // Invitation locataire
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteResult, setInviteResult]   = useState(null);
  // Sauvegarde locataire
  const [savingLoc, setSavingLoc] = useState(false);

  // Documents
  const [documents, setDocuments]         = useState([]);
  const [docsLoading, setDocsLoading]     = useState(false);
  const [uploadDocOpen, setUploadDocOpen] = useState(false);
  const [uploadDocForm, setUploadDocForm] = useState({ categorie: "bail", fichier: null, visible: true });
  const [uploadDocLoading, setUploadDocLoading] = useState(false);

  useEffect(() => { fetchPaiements(); }, [annee]);
  useEffect(() => { fetchDocuments(); }, [bien.id]);

  // Les actions locales déclenchent déjà un rechargement, mais rien ne signale
  // ce qui change côté locataire : un justificatif déposé pendant que la fiche
  // est ouverte restait invisible jusqu'au prochain changement de bien.
  // On recharge au retour sur l'onglet plutôt que d'interroger en boucle.
  useEffect(() => {
    const auRetour = () => {
      if (document.visibilityState === "visible") {
        fetchDocuments();
        fetchPaiements();
      }
    };
    document.addEventListener("visibilitychange", auRetour);
    window.addEventListener("focus", auRetour);
    return () => {
      document.removeEventListener("visibilitychange", auRetour);
      window.removeEventListener("focus", auRetour);
    };
  }, [bien.id, annee]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchPaiements() {
    const res = await fetch(`${API}/api/v1/gestion/biens/${bien.id}/paiements?annee=${annee}`,
      { headers: authHeaders() });
    if (res.ok) setPaiements(await res.json());
  }

  async function marquerPaye(mois) {
    const locID = bien.locataire?.id;
    if (!locID) return;
    await fetch(`${API}/api/v1/gestion/paiements`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        bien_id: bien.id, locataire_id: locID,
        mois, annee, statut: "paye",
        montant_loyer: bien.locataire.loyer_mensuel || 0,
        montant_charges: bien.locataire.charges_mensuelles || 0,
        date_paiement: new Date().toISOString().split("T")[0],
        montant_recu: (bien.locataire.loyer_mensuel || 0) + (bien.locataire.charges_mensuelles || 0),
      }),
    });
    fetchPaiements();
  }

  async function saveLoc(e) {
    e.preventDefault();
    setSavingLoc(true);
    // Capturer avant tout await pour éviter stale closure
    const emailForInvite = formLoc.email;
    const phoneForInvite = formLoc.telephone;
    const toNum = (v) => v !== "" && v !== null ? Number(v) : null;
    const body = {
      prenom: formLoc.prenom,
      nom: formLoc.nom,
      email: emailForInvite || null,
      telephone: phoneForInvite || null,
      date_entree: formLoc.date_entree || null,
      type_bail: formLoc.type_bail,
      loyer_mensuel: toNum(formLoc.loyer_mensuel),
      charges_mensuelles: toNum(formLoc.charges_mensuelles),
      depot_garantie: toNum(formLoc.depot_garantie),
    };
    const res = await fetch(`${API}/api/v1/gestion/biens/${bien.id}/locataire`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    const newLocID = data.id;
    setShowFormLoc(false);
    await onRefresh();
    setSavingLoc(false);

    // Auto-invite si email fourni
    if (emailForInvite && newLocID) {
      setInviteLoading(true);
      try {
        const invRes = await fetch(`${API}/api/v1/gestion/locataires/${newLocID}/inviter`, {
          method: "POST",
          headers: authHeaders(),
        });
        const invData = await invRes.json();
        setInviteResult({ ...invData, _phone: phoneForInvite });
      } catch {
        setInviteResult({ error: "Locataire créé mais erreur lors de la création du compte." });
      } finally {
        setInviteLoading(false);
      }
    }
  }

  async function fetchDocuments() {
    setDocsLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/gestion/biens/${bien.id}/documents`, { headers: authHeaders() });
      if (res.ok) setDocuments(await res.json());
    } finally {
      setDocsLoading(false);
    }
  }

  async function uploadDocument(e) {
    e.preventDefault();
    if (!uploadDocForm.fichier) return;
    setUploadDocLoading(true);
    const fd = new FormData();
    fd.append("fichier", uploadDocForm.fichier);
    fd.append("categorie", uploadDocForm.categorie);
    // Même sémantique que la checkbox (l. "visible !== false") : sans ça, un état
    // initial sans clé `visible` envoyait "false" alors que la case s'affichait cochée.
    fd.append("visible_par_locataire", uploadDocForm.visible !== false ? "true" : "false");
    try {
      const res = await fetch(`${API}/api/v1/gestion/biens/${bien.id}/documents`, {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      if (res.ok) {
        setUploadDocOpen(false);
        setUploadDocForm({ categorie: "bail", fichier: null, visible: true });
        await fetchDocuments();
      }
    } finally {
      setUploadDocLoading(false);
    }
  }

  async function deleteDocument(docId) {
    await fetch(`${API}/api/v1/gestion/documents/${docId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    setDocuments(prev => prev.filter(d => d.id !== docId));
  }

  function downloadDocument(docId, nomFichier) {
    const token = localStorage.getItem("hp_token");
    const url = `${API}/api/v1/documents/${docId}/download`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = nomFichier;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  }

  async function inviterLocataire() {
    const locID = bien.locataire?.id;
    if (!locID) return;
    setInviteLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/gestion/locataires/${locID}/inviter`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await res.json();
      setInviteResult({ ...data, _phone: bien.locataire?.telephone });
    } catch {
      setInviteResult({ error: "Erreur réseau. Réessayez." });
    } finally {
      setInviteLoading(false);
    }
  }

  async function updateBien(e) {
    e.preventDefault();
    const toNum = (v) => v !== "" && v !== null ? Number(v) : null;
    await fetch(`${API}/api/v1/gestion/biens/${bien.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        adresse: editBienForm.adresse,
        code_postal: editBienForm.code_postal || null,
        ville: editBienForm.ville || null,
        type_bien: editBienForm.type_bien,
        surface_m2: toNum(editBienForm.surface_m2),
        nb_pieces: toNum(editBienForm.nb_pieces),
        loyer_nu: toNum(editBienForm.loyer_nu),
        charges: toNum(editBienForm.charges),
        depot_garantie: toNum(editBienForm.depot_garantie),
      }),
    });
    setEditBienOpen(false);
    onRefresh();
  }

  async function updateLocataire(e) {
    e.preventDefault();
    const toNum = (v) => v !== "" && v !== null ? Number(v) : null;
    await fetch(`${API}/api/v1/gestion/locataires/${bien.locataire.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        prenom: editLocForm.prenom,
        nom: editLocForm.nom,
        email: editLocForm.email || null,
        telephone: editLocForm.telephone || null,
        date_entree: editLocForm.date_entree || null,
        type_bail: editLocForm.type_bail || "vide",
        loyer_mensuel: toNum(editLocForm.loyer_mensuel),
        charges_mensuelles: toNum(editLocForm.charges_mensuelles),
        depot_garantie: toNum(editLocForm.depot_garantie),
        actif: true,
      }),
    });
    setEditLocOpen(false);
    onRefresh();
  }

  async function desactiverLocataire() {
    await fetch(`${API}/api/v1/gestion/locataires/${bien.locataire.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    setConfirmDeleteLoc(false);
    onRefresh();
  }

  async function deleteBien() {
    await fetch(`${API}/api/v1/gestion/biens/${bien.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    setConfirmDeleteBien(false);
    onBack();
    onRefresh();
  }

  async function marquerImpaye(mois) {
    const p = paiementsMois[mois];
    if (!p) return;
    await fetch(`${API}/api/v1/gestion/paiements/${p.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    setPaiementMenu(null);
    fetchPaiements();
  }

  const paiementsMois = {};
  paiements.forEach(p => { paiementsMois[p.mois] = p; });

  function genererQuittance(mois) {
    const loc = bien.locataire;
    if (!loc) return;
    let bailleurNom = "Le bailleur";
    try { const u = JSON.parse(localStorage.getItem("hp_user") || "{}"); bailleurNom = u.full_name || u.email || bailleurNom; } catch {}
    const moisLabel = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"][mois - 1];
    const loyer = Number(loc.loyer_mensuel || 0);
    const charges = Number(loc.charges_mensuelles || 0);
    const total = loyer + charges;
    const adresseBien = `${bien.adresse}${bien.code_postal ? ", " + bien.code_postal : ""}${bien.ville ? " " + bien.ville : ""}`;
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Quittance ${moisLabel} ${annee}</title>
<style>
@page{size:A4;margin:2cm}
body{font-family:Arial,sans-serif;font-size:12pt;color:#111;line-height:1.6;margin:0}
.header{border-bottom:3px solid #111;padding-bottom:16px;margin-bottom:28px}
h1{font-size:22pt;margin:0 0 4px;letter-spacing:-0.5px}
.sub{color:#555;font-size:10pt}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:28px}
.partie h3{font-size:9pt;text-transform:uppercase;letter-spacing:.08em;color:#777;margin:0 0 6px;border-bottom:1px solid #ddd;padding-bottom:4px}
table{width:100%;border-collapse:collapse;margin:24px 0}
th{background:#f4f4f4;padding:9px 14px;text-align:left;font-size:10pt;border:1px solid #ddd}
td{padding:9px 14px;border:1px solid #ddd;font-size:11pt}
.total td{font-weight:700;background:#efefef}
.decl{background:#f9f9f9;border:1px solid #e0e0e0;padding:18px;border-radius:4px;margin:24px 0;font-size:10.5pt}
.sig{margin-top:48px;text-align:right}
.sig .line{display:inline-block;border-bottom:1px solid #111;width:220px;height:52px;vertical-align:bottom}
.sig p{font-size:10pt;color:#555;margin:4px 0 0}
.footer{margin-top:40px;font-size:9pt;color:#888;border-top:1px solid #ddd;padding-top:12px}
@media print{.no-print{display:none}}
</style></head><body>
<div class="header">
  <h1>QUITTANCE DE LOYER</h1>
  <p class="sub">Période : <strong>${moisLabel} ${annee}</strong> · Bien : ${adresseBien}</p>
</div>
<div class="parties">
  <div class="partie">
    <h3>Bailleur</h3>
    <p><strong>${bailleurNom}</strong></p>
  </div>
  <div class="partie">
    <h3>Locataire</h3>
    <p><strong>${loc.prenom} ${loc.nom}</strong></p>
    <p>${adresseBien}</p>
  </div>
</div>
<div class="decl">
  Je soussigné(e) <strong>${bailleurNom}</strong>, bailleur du logement situé <strong>${adresseBien}</strong>, déclare avoir reçu de <strong>${loc.prenom} ${loc.nom}</strong> la somme de <strong>${total.toFixed(2)} €</strong> au titre du loyer et des charges du mois de <strong>${moisLabel} ${annee}</strong>, et lui en donne quittance, sous réserve de tous mes droits.
</div>
<table>
  <thead><tr><th>Désignation</th><th>Montant</th></tr></thead>
  <tbody>
    <tr><td>Loyer hors charges</td><td>${loyer.toFixed(2)} €</td></tr>
    <tr><td>Provision pour charges</td><td>${charges.toFixed(2)} €</td></tr>
    <tr class="total"><td>Total charges comprises</td><td>${total.toFixed(2)} €</td></tr>
  </tbody>
</table>
<div class="sig">
  <div class="line"></div>
  <p>Signature du bailleur — Fait le ${new Date().toLocaleDateString("fr-FR")}</p>
</div>
<div class="footer">
  Cette quittance annule tous les reçus établis précédemment pour ce loyer. Le locataire peut à tout moment exiger une quittance du bailleur (art. 21, loi n° 89-462 du 6 juillet 1989). Générée via HomePedia IDF.
</div>
<script>window.onload=()=>window.print()</script>
</body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  }

  const btnSmall = "text-xs px-2.5 py-1 rounded-lg border transition-colors flex items-center gap-1";

  return (
    <div className="space-y-6">

      {/* ── Header bien ──────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <button onClick={onBack} className="text-slate-400 hover:text-white mt-1 shrink-0">← Retour</button>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-white text-lg truncate">{bien.adresse}</h2>
          <p className="text-slate-400 text-sm">{bien.ville} · {bien.type_bien} · {bien.surface_m2 ? `${bien.surface_m2} m²` : "—"}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => setEditBienOpen(true) || setEditBienForm({
              adresse: bien.adresse, code_postal: bien.code_postal || "", ville: bien.ville || "",
              type_bien: bien.type_bien, surface_m2: bien.surface_m2 || "", nb_pieces: bien.nb_pieces || "",
              loyer_nu: bien.loyer_nu || "", charges: bien.charges || "", depot_garantie: bien.depot_garantie || "",
            })}
            className={btnSmall} style={{ color: "#94a3b8", borderColor: "rgba(148,163,184,0.25)", background: "rgba(148,163,184,0.06)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>edit</span> Modifier
          </button>
          <button onClick={() => setConfirmDeleteBien(true)}
            className={btnSmall} style={{ color: "#f87171", borderColor: "rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.06)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span> Supprimer
          </button>
        </div>
      </div>

      {/* ── Locataire ────────────────────────────────────────────────────────── */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold text-white text-sm">Locataire actuel</h3>
          {!bien.locataire ? (
            <button onClick={() => setShowFormLoc(true)}
              className={btnSmall} style={{ color: "#60a5fa", borderColor: "rgba(96,165,250,0.3)", background: "rgba(96,165,250,0.06)" }}>
              + Ajouter
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setEditLocOpen(true) || setEditLocForm({
                  prenom: bien.locataire.prenom, nom: bien.locataire.nom,
                  email: bien.locataire.email || "", telephone: bien.locataire.telephone || "",
                  date_entree: bien.locataire.date_entree || "", type_bail: bien.locataire.type_bail || "vide",
                  loyer_mensuel: bien.locataire.loyer_mensuel || "", charges_mensuelles: bien.locataire.charges_mensuelles || "",
                  depot_garantie: bien.locataire.depot_garantie || "",
                })}
                className={btnSmall} style={{ color: "#94a3b8", borderColor: "rgba(148,163,184,0.25)", background: "rgba(148,163,184,0.06)" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>edit</span> Modifier
              </button>
              <button onClick={() => setConfirmDeleteLoc(true)}
                className={btnSmall} style={{ color: "#f87171", borderColor: "rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.06)" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>person_off</span> Désactiver
              </button>
            </div>
          )}
        </div>
        {bien.locataire ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <p className="text-slate-500 text-xs">Nom</p>
                <p className="text-white font-medium">{bien.locataire.prenom} {bien.locataire.nom}</p>
              </div>
              {bien.locataire.email && (
                <div>
                  <p className="text-slate-500 text-xs">Email</p>
                  <p className="text-slate-300">{bien.locataire.email}</p>
                </div>
              )}
              {bien.locataire.loyer_mensuel && (
                <div>
                  <p className="text-slate-500 text-xs">Loyer CC</p>
                  <p className="text-emerald-400 font-bold">
                    {(bien.locataire.loyer_mensuel + (bien.locataire.charges_mensuelles || 0)).toFixed(0)} €/mois
                  </p>
                </div>
              )}
            </div>
            {bien.locataire.email && (
              <button onClick={inviterLocataire} disabled={inviteLoading}
                className={`${btnSmall} disabled:opacity-50`}
                style={{ color: "#818cf8", borderColor: "rgba(129,140,248,0.3)", background: "rgba(129,140,248,0.06)" }}>
                {inviteLoading
                  ? <span className="material-symbols-outlined animate-spin" style={{ fontSize: 13 }}>progress_activity</span>
                  : <span className="material-symbols-outlined" style={{ fontSize: 13 }}>send</span>
                }
                {inviteLoading ? "Création..." : "Espace locataire (inviter)"}
              </button>
            )}
          </div>
        ) : (
          <p className="text-slate-500 text-sm">Aucun locataire enregistré</p>
        )}
      </div>

      {/* Indexation IRL */}
      {bien.locataire?.loyer_mensuel && (
        <IRLCalculator loyer={bien.locataire.loyer_mensuel} />
      )}

      {/* ── Documents locatifs ──────────────────────────────────────────────────
          Placés avant le suivi des loyers (12 cartes) : en fin de page, la section
          passait sous la ligne de flottaison et les pièces déposées par le
          locataire n'étaient jamais vues. */}
      <DocSection
        documents={documents}
        loading={docsLoading}
        onUpload={() => setUploadDocOpen(true)}
        onDownload={downloadDocument}
        onDelete={deleteDocument}
        apiBase={API}
      />

      {/* Le relevé précède le suivi mensuel : il donne la réponse (« où en est-on ? »)
          avant le détail qui permet de la vérifier. */}
      {bien.locataire && (
        <ReleveCompte bienId={bien.id} token={localStorage.getItem("hp_token")} />
      )}

      {/* ── Suivi paiements ──────────────────────────────────────────────────── */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold text-white text-sm">Suivi des loyers</h3>
          <select value={annee} onChange={e => setAnnee(Number(e.target.value))}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white">
            {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {MOIS.map((m, i) => {
            const mois = i + 1;
            const p = paiementsMois[mois];
            const isPast = annee < new Date().getFullYear()
              || (annee === new Date().getFullYear() && mois <= new Date().getMonth() + 1);
            const statut = p?.statut || (isPast ? "en_attente" : "futur");
            const colors = {
              paye:       { bg: "rgba(16,185,129,0.15)", border: "rgba(16,185,129,0.4)",  text: "#10b981" },
              impaye:     { bg: "rgba(239,68,68,0.15)",  border: "rgba(239,68,68,0.4)",   text: "#ef4444" },
              en_attente: { bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.3)",  text: "#f59e0b" },
              futur:      { bg: "rgba(255,255,255,0.02)", border: "rgba(255,255,255,0.06)", text: "#64748b" },
            }[statut] || {};
            return (
              <button key={mois}
                onClick={() => {
                  if (!bien.locataire || statut === "futur") return;
                  if (statut === "paye") setPaiementMenu(paiementMenu?.mois === mois ? null : { mois });
                  else marquerPaye(mois);
                }}
                disabled={statut === "futur" || !bien.locataire}
                className="rounded-lg p-2 text-center transition-all relative"
                style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
                <p className="text-xs font-medium" style={{ color: colors.text }}>{m}</p>
                <p className="text-[10px] mt-0.5" style={{ color: colors.text }}>
                  {statut === "paye" ? "✓ payé" : statut === "futur" ? "—" : "en att."}
                </p>
                {/* Mini menu sur mois payé */}
                {statut === "paye" && paiementMenu?.mois === mois && (
                  <div className="absolute bottom-full left-0 mb-1 z-30 bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-hidden text-left w-40"
                    onClick={e => e.stopPropagation()}>
                    <button className="w-full px-3 py-2 text-xs text-emerald-400 hover:bg-slate-700 flex items-center gap-2"
                      onClick={() => { genererQuittance(mois); setPaiementMenu(null); }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>download</span>
                      Télécharger quittance
                    </button>
                    <button className="w-full px-3 py-2 text-xs text-red-400 hover:bg-slate-700 flex items-center gap-2"
                      onClick={() => marquerImpaye(mois)}>
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>undo</span>
                      Marquer impayé
                    </button>
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {bien.locataire && (
          <p className="text-[11px] text-slate-500 mt-3">
            Mois en attente → cliquer pour marquer payé · Mois payés → cliquer pour quittance / marquer impayé
          </p>
        )}
      </div>

      {/* ══════════════ MODALES (toutes au niveau racine) ══════════════════════ */}

      {/* Formulaire création locataire */}
      {showFormLoc && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 sm:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-white">Nouveau locataire</h3>
              <button onClick={() => setShowFormLoc(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={saveLoc} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[["prenom","Prénom *"],["nom","Nom *"],["email","Email"],["telephone","Téléphone"]].map(([k,p]) => (
                  <input key={k} required={k==="prenom"||k==="nom"} placeholder={p} value={formLoc[k]}
                    onChange={e => setFormLoc(f => ({ ...f, [k]: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input type="date" value={formLoc.date_entree}
                  onChange={e => setFormLoc(f => ({ ...f, date_entree: e.target.value }))}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                <select value={formLoc.type_bail} onChange={e => setFormLoc(f => ({ ...f, type_bail: e.target.value }))}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="vide">Bail vide</option>
                  <option value="meuble">Bail meublé</option>
                  <option value="colocation">Colocation</option>
                </select>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[["loyer_mensuel","Loyer HC (€)"],["charges_mensuelles","Charges (€)"],["depot_garantie","Dépôt (€)"]].map(([k,p]) => (
                  <input key={k} type="number" placeholder={p} value={formLoc[k]}
                    onChange={e => setFormLoc(f => ({ ...f, [k]: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                ))}
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowFormLoc(false)} disabled={savingLoc}
                  className="flex-1 py-2 rounded-xl text-sm text-slate-400 border border-slate-700 disabled:opacity-40">Annuler</button>
                <button type="submit" disabled={savingLoc}
                  className="flex-1 py-2 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60"
                  style={{ background: "rgba(60,131,246,0.3)", border: "1px solid rgba(60,131,246,0.5)" }}>
                  {savingLoc
                    ? <><span className="material-symbols-outlined animate-spin" style={{ fontSize: 16 }}>progress_activity</span>Enregistrement...</>
                    : "Enregistrer"
                  }
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Formulaire édition locataire */}
      {editLocOpen && bien.locataire && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 sm:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-white">Modifier le locataire</h3>
              <button onClick={() => setEditLocOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={updateLocataire} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[["prenom","Prénom *"],["nom","Nom *"],["email","Email"],["telephone","Téléphone"]].map(([k,p]) => (
                  <input key={k} required={k==="prenom"||k==="nom"} placeholder={p} value={editLocForm[k] ?? ""}
                    onChange={e => setEditLocForm(f => ({ ...f, [k]: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Date d'entrée</label>
                  <input type="date" value={editLocForm.date_entree ?? ""}
                    onChange={e => setEditLocForm(f => ({ ...f, date_entree: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Type de bail</label>
                  <select value={editLocForm.type_bail ?? "vide"} onChange={e => setEditLocForm(f => ({ ...f, type_bail: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                    <option value="vide">Bail vide</option>
                    <option value="meuble">Bail meublé</option>
                    <option value="colocation">Colocation</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[["loyer_mensuel","Loyer HC (€)"],["charges_mensuelles","Charges (€)"],["depot_garantie","Dépôt (€)"]].map(([k,p]) => (
                  <input key={k} type="number" placeholder={p} value={editLocForm[k] ?? ""}
                    onChange={e => setEditLocForm(f => ({ ...f, [k]: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                ))}
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setEditLocOpen(false)}
                  className="flex-1 py-2 rounded-xl text-sm text-slate-400 border border-slate-700">Annuler</button>
                <button type="submit" className="flex-1 py-2 rounded-xl text-sm font-bold text-white"
                  style={{ background: "rgba(60,131,246,0.3)", border: "1px solid rgba(60,131,246,0.5)" }}>
                  Sauvegarder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Formulaire édition bien */}
      {editBienOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 sm:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-white">Modifier le bien</h3>
              <button onClick={() => setEditBienOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={updateBien} className="space-y-3">
              <input required placeholder="Adresse *" value={editBienForm.adresse ?? ""}
                onChange={e => setEditBienForm(f => ({ ...f, adresse: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[["code_postal","Code postal"],["ville","Ville"]].map(([k,p]) => (
                  <input key={k} placeholder={p} value={editBienForm[k] ?? ""}
                    onChange={e => setEditBienForm(f => ({ ...f, [k]: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <select value={editBienForm.type_bien ?? "appartement"}
                  onChange={e => setEditBienForm(f => ({ ...f, type_bien: e.target.value }))}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                  {["appartement","maison","studio","parking","local"].map(t => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>
                  ))}
                </select>
                {[["surface_m2","Surface m²"],["nb_pieces","Pièces"]].map(([k,p]) => (
                  <input key={k} type="number" placeholder={p} value={editBienForm[k] ?? ""}
                    onChange={e => setEditBienForm(f => ({ ...f, [k]: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[["loyer_nu","Loyer HC (€)"],["charges","Charges (€)"],["depot_garantie","Dépôt (€)"]].map(([k,p]) => (
                  <input key={k} type="number" placeholder={p} value={editBienForm[k] ?? ""}
                    onChange={e => setEditBienForm(f => ({ ...f, [k]: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                ))}
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setEditBienOpen(false)}
                  className="flex-1 py-2 rounded-xl text-sm text-slate-400 border border-slate-700">Annuler</button>
                <button type="submit" className="flex-1 py-2 rounded-xl text-sm font-bold text-white"
                  style={{ background: "rgba(60,131,246,0.3)", border: "1px solid rgba(60,131,246,0.5)" }}>
                  Sauvegarder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modale résultat invitation */}
      {inviteResult && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-center mb-5">
              <h3 className="font-bold text-white text-lg">Espace locataire</h3>
              <button onClick={() => setInviteResult(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            {inviteResult.error ? (
              <p className="text-red-400 text-sm">{inviteResult.error}</p>
            ) : inviteResult.password ? (
              /* ── Credentials disponibles ── */
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-emerald-400">
                  <span className="material-symbols-outlined" style={{ fontSize: 22 }}>check_circle</span>
                  <span className="font-bold">{inviteResult.message || "Identifiants prêts à partager"}</span>
                </div>

                {/* Bloc credentials */}
                <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(15,23,42,0.9)", border: "1px solid rgba(60,131,246,0.4)" }}>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400 text-xs uppercase tracking-wide">Email</span>
                    <span className="text-white font-mono text-sm">{inviteResult.email}</span>
                  </div>
                  <div className="h-px bg-slate-700" />
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400 text-xs uppercase tracking-wide">Mot de passe</span>
                    <span className="text-yellow-300 font-mono font-bold text-xl tracking-widest">{inviteResult.password}</span>
                  </div>
                </div>

                {/* Actions partage */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {/* Copier */}
                  <button
                    onClick={() => navigator.clipboard.writeText(`Email : ${inviteResult.email}\nMot de passe : ${inviteResult.password}`)}
                    className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-medium transition-all hover:brightness-110"
                    style={{ background: "rgba(60,131,246,0.15)", border: "1px solid rgba(60,131,246,0.3)", color: "#60a5fa" }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>content_copy</span>
                    Copier
                  </button>

                  {/* Envoyer par email */}
                  <a
                    href={`mailto:${inviteResult.email}?subject=${encodeURIComponent("Vos accès à votre espace locataire")}&body=${encodeURIComponent(`Bonjour,\n\nVoici vos identifiants pour accéder à votre espace locataire sur HomePedia :\n\nEmail : ${inviteResult.email}\nMot de passe : ${inviteResult.password}\n\nConnectez-vous sur https://homepedia-frontend-pijv7nfnna-ew.a.run.app\n\nAprès connexion, vous serez redirigé vers « Mon logement » où vous pourrez consulter vos loyers et télécharger vos quittances.\n\nCordialement`)}`}
                    className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-medium transition-all hover:brightness-110 text-center"
                    style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)", color: "#34d399" }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>mail</span>
                    Email
                  </a>

                  {/* Envoyer par SMS */}
                  <a
                    href={`sms:${inviteResult._phone || ""}${inviteResult._phone ? "?body=" : "?body="}${encodeURIComponent(`HomePedia - Vos accès locataire :\nEmail : ${inviteResult.email}\nMdp : ${inviteResult.password}\nhttps://homepedia-frontend-pijv7nfnna-ew.a.run.app`)}`}
                    className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-medium transition-all hover:brightness-110 text-center"
                    style={{ background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)", color: "#c084fc" }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>sms</span>
                    SMS
                  </a>
                </div>

                <p className="text-slate-500 text-xs text-center">
                  Le locataire peut changer son mot de passe après connexion.
                </p>
              </div>
            ) : (
              /* ── Email sans compte (ne devrait plus arriver avec le nouveau backend) ── */
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-slate-400">
                  <span className="material-symbols-outlined" style={{ fontSize: 22 }}>info</span>
                  <span className="font-bold">Information</span>
                </div>
                <p className="text-slate-300 text-sm">{inviteResult.message || "Opération effectuée."}</p>
                {inviteResult.email && (
                  <div className="rounded-xl p-3 text-sm" style={{ background: "rgba(60,131,246,0.1)", border: "1px solid rgba(60,131,246,0.3)" }}>
                    <span className="text-slate-400">Email : </span><strong className="text-white">{inviteResult.email}</strong>
                  </div>
                )}
              </div>
            )}

            <button onClick={() => setInviteResult(null)}
              className="mt-5 w-full py-2.5 rounded-xl text-sm font-bold text-white"
              style={{ background: "rgba(60,131,246,0.3)", border: "1px solid rgba(60,131,246,0.5)" }}>
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Modale upload document */}
      {uploadDocOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-5">
              <h3 className="font-bold text-white text-lg">Ajouter un document</h3>
              <button onClick={() => setUploadDocOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={uploadDocument} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Catégorie</label>
                <select
                  value={uploadDocForm.categorie}
                  onChange={e => setUploadDocForm(f => ({ ...f, categorie: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white"
                >
                  {DOC_CATS_PROPRIO.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Fichier (PDF, JPEG, PNG — max 10 Mo)</label>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  required
                  onChange={e => setUploadDocForm(f => ({ ...f, fichier: e.target.files[0] }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-blue-600 file:text-white"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={uploadDocForm.visible !== false}
                  onChange={e => setUploadDocForm(f => ({ ...f, visible: e.target.checked }))}
                  className="w-4 h-4 rounded accent-blue-500" />
                Visible par le locataire
              </label>
              <button type="submit" disabled={uploadDocLoading}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
                style={{ background: "rgba(60,131,246,0.5)", border: "1px solid rgba(60,131,246,0.6)" }}>
                {uploadDocLoading ? "Envoi en cours…" : "Envoyer"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Confirmations */}
      {confirmDeleteLoc && (
        <ConfirmModal
          message={`Désactiver le locataire ${bien.locataire?.prenom} ${bien.locataire?.nom} ? Il n'aura plus accès à son espace locataire.`}
          onConfirm={desactiverLocataire}
          onCancel={() => setConfirmDeleteLoc(false)}
        />
      )}
      {confirmDeleteBien && (
        <ConfirmModal
          message={`Supprimer définitivement le bien "${bien.adresse}" et toutes ses données ?`}
          onConfirm={deleteBien}
          onCancel={() => setConfirmDeleteBien(false)}
        />
      )}

      {/* Fermer le menu paiement si clic ailleurs */}
      {paiementMenu && (
        <div className="fixed inset-0 z-20" onClick={() => setPaiementMenu(null)} />
      )}
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function GestionLocative() {
  const [biens, setBiens] = useState([]);
  const [stats, setStats] = useState(null);
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editBienModal, setEditBienModal] = useState({ open: false, id: null, form: {} });
  const anneeExport = new Date().getFullYear();

  useEffect(() => { fetchAll(); }, []);

  async function updateBienFromList(e) {
    e.preventDefault();
    const f = editBienModal.form;
    const toNum = (v) => v !== "" && v !== null ? Number(v) : null;
    await fetch(`${API}/api/v1/gestion/biens/${editBienModal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        adresse: f.adresse, code_postal: f.code_postal || null, ville: f.ville || null,
        type_bien: f.type_bien, surface_m2: toNum(f.surface_m2), nb_pieces: toNum(f.nb_pieces),
        loyer_nu: toNum(f.loyer_nu), charges: toNum(f.charges), depot_garantie: toNum(f.depot_garantie),
      }),
    });
    setEditBienModal({ open: false, id: null, form: {} });
    fetchAll();
  }

  async function fetchAll() {
    setLoading(true);
    setAuthError(false);
    const [rBiens, rStats] = await Promise.all([
      fetch(`${API}/api/v1/gestion/biens`, { headers: authHeaders() }),
      fetch(`${API}/api/v1/gestion/dashboard`, { headers: authHeaders() }),
    ]);
    if (rBiens.status === 401 || rStats.status === 401) {
      setAuthError(true);
      setLoading(false);
      return [];
    }
    const freshBiens = rBiens.ok ? await rBiens.json() : [];
    setBiens(freshBiens);
    if (rStats.ok) setStats(await rStats.json());
    setLoading(false);
    return freshBiens;
  }

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <p className="text-slate-400">Chargement...</p>
    </div>
  );

  if (authError) return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
      <span className="material-symbols-outlined text-slate-500" style={{ fontSize: 48 }}>lock</span>
      <p className="text-white font-semibold text-lg">Connexion requise</p>
      <p className="text-slate-400 text-sm">Connectez-vous pour accéder à votre espace gestion locative.</p>
      <button
        onClick={() => {
          document.dispatchEvent(new CustomEvent("hp:open-login"));
        }}
        className="mt-2 px-6 py-2.5 rounded-xl text-sm font-bold text-white"
        style={{ background: "rgba(60,131,246,0.3)", border: "1px solid rgba(60,131,246,0.5)" }}
      >
        Se connecter
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Mon patrimoine</h1>
            <p className="text-slate-400 text-sm mt-1">Gestion locative · propriétaires bailleurs</p>
          </div>
          {!selected && (
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  setExporting(true);
                  await exportCSVComptable(biens, anneeExport, localStorage.getItem("hp_token"));
                  setExporting(false);
                }}
                disabled={exporting || biens.length === 0}
                className="px-3 py-2 rounded-xl text-sm font-medium text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/10 disabled:opacity-40 flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
                {exporting ? "Export..." : `CSV ${anneeExport}`}
              </button>
              <button onClick={() => setShowForm(true)}
                className="px-4 py-2 rounded-xl text-sm font-bold text-white"
                style={{ background: "rgba(60,131,246,0.3)", border: "1px solid rgba(60,131,246,0.5)" }}>
                + Ajouter un bien
              </button>
            </div>
          )}
        </div>

        {/* Stats */}
        {!selected && stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <StatCard label="Biens" value={stats.nb_biens} />
            <StatCard label="Locataires actifs" value={stats.nb_locataires} />
            <StatCard label="Loyers mensuels" value={`${Math.round(stats.loyer_mensuel)} €`} color="#10b981" />
            <StatCard label="Impayés" value={`${Math.round(stats.impayes_total)} €`}
              color={stats.impayes_total > 0 ? "#ef4444" : "#10b981"} />
          </div>
        )}

        {/* Détail bien */}
        {selected ? (
          <BienDetail
            bien={selected}
            onBack={() => setSelected(null)}
            onRefresh={async () => {
              const freshBiens = await fetchAll();
              const updated = (freshBiens || []).find(b => b.id === selected.id);
              if (updated) setSelected(updated);
            }}
          />
        ) : (
          /* Liste biens */
          <div className="space-y-3">
            {biens.length === 0 && (
              <div className="text-center py-16 text-slate-500">
                <p className="text-4xl mb-3">🏠</p>
                <p className="font-medium text-white mb-1">Aucun bien enregistré</p>
                <p className="text-sm">Ajoutez votre premier bien locatif pour commencer</p>
              </div>
            )}
            {biens.map(b => (
              <div key={b.id}
                className="flex items-center gap-2 bg-slate-900/60 border border-slate-800 rounded-xl p-4 hover:border-blue-500/40 transition-all">
                <button className="flex-1 text-left" onClick={() => setSelected(b)}>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold text-white">{b.adresse}</p>
                      <p className="text-slate-400 text-sm">{b.ville} · {b.type_bien} {b.surface_m2 ? `· ${b.surface_m2} m²` : ""}</p>
                    </div>
                    <div className="text-right">
                      {b.locataire ? (
                        <>
                          <p className="text-emerald-400 font-bold text-sm">
                            {((b.locataire.loyer_mensuel || 0) + (b.locataire.charges_mensuelles || 0)).toFixed(0)} €/mois
                          </p>
                          <p className="text-slate-500 text-xs">{b.locataire.prenom} {b.locataire.nom}</p>
                        </>
                      ) : (
                        <p className="text-slate-500 text-xs">Vacant</p>
                      )}
                    </div>
                  </div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditBienModal({
                      open: true, id: b.id,
                      form: {
                        adresse: b.adresse, code_postal: b.code_postal || "", ville: b.ville || "",
                        type_bien: b.type_bien, surface_m2: b.surface_m2 || "", nb_pieces: b.nb_pieces || "",
                        loyer_nu: b.loyer_nu || "", charges: b.charges || "", depot_garantie: b.depot_garantie || "",
                      },
                    });
                  }}
                  className="p-2 text-slate-600 hover:text-blue-400 transition-colors shrink-0"
                  title="Modifier ce bien">
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
                </button>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!window.confirm(`Supprimer "${b.adresse}" ?`)) return;
                    await fetch(`${API}/api/v1/gestion/biens/${b.id}`, { method: "DELETE", headers: authHeaders() });
                    fetchAll();
                  }}
                  className="p-2 text-slate-600 hover:text-red-400 transition-colors shrink-0"
                  title="Supprimer ce bien">
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && <FormBien onSave={fetchAll} onClose={() => setShowForm(false)} />}

      {editBienModal.open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 sm:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-white">Modifier le bien</h3>
              <button onClick={() => setEditBienModal({ open: false, id: null, form: {} })} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={updateBienFromList} className="space-y-3">
              <input required placeholder="Adresse *" value={editBienModal.form.adresse ?? ""}
                onChange={e => setEditBienModal(m => ({ ...m, form: { ...m.form, adresse: e.target.value } }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[["code_postal","Code postal"],["ville","Ville"]].map(([k,p]) => (
                  <input key={k} placeholder={p} value={editBienModal.form[k] ?? ""}
                    onChange={e => setEditBienModal(m => ({ ...m, form: { ...m.form, [k]: e.target.value } }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <select value={editBienModal.form.type_bien ?? "appartement"}
                  onChange={e => setEditBienModal(m => ({ ...m, form: { ...m.form, type_bien: e.target.value } }))}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                  {["appartement","maison","studio","parking","local"].map(t => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>
                  ))}
                </select>
                {[["surface_m2","Surface m²"],["nb_pieces","Pièces"]].map(([k,p]) => (
                  <input key={k} type="number" placeholder={p} value={editBienModal.form[k] ?? ""}
                    onChange={e => setEditBienModal(m => ({ ...m, form: { ...m.form, [k]: e.target.value } }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[["loyer_nu","Loyer HC (€)"],["charges","Charges (€)"],["depot_garantie","Dépôt (€)"]].map(([k,p]) => (
                  <input key={k} type="number" placeholder={p} value={editBienModal.form[k] ?? ""}
                    onChange={e => setEditBienModal(m => ({ ...m, form: { ...m.form, [k]: e.target.value } }))}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                ))}
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setEditBienModal({ open: false, id: null, form: {} })}
                  className="flex-1 py-2 rounded-xl text-sm text-slate-400 border border-slate-700">Annuler</button>
                <button type="submit" className="flex-1 py-2 rounded-xl text-sm font-bold text-white"
                  style={{ background: "rgba(60,131,246,0.3)", border: "1px solid rgba(60,131,246,0.5)" }}>
                  Sauvegarder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
