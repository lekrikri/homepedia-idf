import React, { useState, useEffect } from "react";
import { ReleveCompte } from "./GestionLocative.jsx";

const API = import.meta.env.VITE_API_URL || "";

function authHeaders() {
  const t = localStorage.getItem("hp_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const DOC_CATS_LOCATAIRE = [
  { value: "piece_identite",        label: "Pièce d'identité" },
  { value: "fiche_de_paie",         label: "Fiche de paie" },
  { value: "avis_imposition",       label: "Avis d'imposition" },
  { value: "contrat_travail",       label: "Contrat de travail" },
  { value: "attestation_assurance", label: "Attestation d'assurance habitation" },
  { value: "justificatif_domicile", label: "Justificatif de domicile" },
  { value: "rib",                   label: "RIB" },
  { value: "garant_piece_identite", label: "Pièce d'identité garant" },
  { value: "garant_revenus",        label: "Justificatif revenus garant" },
  { value: "autre",                 label: "Autre document" },
];

const DOC_LABELS = {
  // proprio
  bail: "Bail de location", avenant_bail: "Avenant au bail",
  etat_lieux_entree: "État des lieux d'entrée", etat_lieux_sortie: "État des lieux de sortie",
  inventaire: "Inventaire du mobilier", avis_echeance: "Avis d'échéance",
  quittance_archivee: "Quittance archivée", plan_appartement: "Plan de l'appartement",
  diagnostic_dpe: "Diagnostic DPE", diagnostic_plomb: "Diagnostic plomb",
  diagnostic_amiante: "Diagnostic amiante", diagnostic_electricite: "Diagnostic électricité",
  diagnostic_gaz: "Diagnostic gaz", diagnostic_etat_risques: "État des risques",
  assurance_pno: "Assurance PNO", reglement_copropriete: "Règlement de copropriété",
  notice_information: "Notice ALUR", taxe_fonciere: "Taxe foncière",
  // locataire
  piece_identite: "Pièce d'identité", fiche_de_paie: "Fiche de paie",
  avis_imposition: "Avis d'imposition", contrat_travail: "Contrat de travail",
  attestation_assurance: "Attestation d'assurance", justificatif_domicile: "Justificatif de domicile",
  rib: "RIB", garant_piece_identite: "Pièce d'identité garant",
  garant_revenus: "Justificatif revenus garant", autre: "Autre document",
};

function fmtTaille(o) {
  if (!o) return "";
  if (o < 1024) return `${o} o`;
  if (o < 1048576) return `${(o / 1024).toFixed(0)} Ko`;
  return `${(o / 1048576).toFixed(1)} Mo`;
}

const MOIS_LABELS = ["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août","Sep","Oct","Nov","Déc"];
const MOIS_FULL   = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

function genererQuittance({ locataire, bien, paiement, proprioEmail }) {
  const moisLabel = MOIS_FULL[paiement.mois - 1];
  const loyer     = Number(locataire.loyer_mensuel || 0);
  const charges   = Number(locataire.charges_mensuelles || 0);
  const total     = loyer + charges;
  const adresse   = `${bien.adresse}${bien.code_postal ? ", " + bien.code_postal : ""}${bien.ville ? " " + bien.ville : ""}`;
  const datePmt   = paiement.date_paiement
    ? new Date(paiement.date_paiement).toLocaleDateString("fr-FR")
    : new Date().toLocaleDateString("fr-FR");

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Quittance ${moisLabel} ${paiement.annee}</title>
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
</style></head><body>
<div class="header">
  <h1>QUITTANCE DE LOYER</h1>
  <p class="sub">Période : <strong>${moisLabel} ${paiement.annee}</strong> · Bien : ${adresse}</p>
</div>
<div class="parties">
  <div class="partie">
    <h3>Bailleur</h3>
    <p>${proprioEmail}</p>
  </div>
  <div class="partie">
    <h3>Locataire</h3>
    <p><strong>${locataire.prenom} ${locataire.nom}</strong></p>
    <p>${adresse}</p>
  </div>
</div>
<table>
  <thead><tr><th>Désignation</th><th>Montant</th></tr></thead>
  <tbody>
    <tr><td>Loyer hors charges — ${moisLabel} ${paiement.annee}</td><td>${loyer.toFixed(2)} €</td></tr>
    ${charges > 0 ? `<tr><td>Provisions pour charges</td><td>${charges.toFixed(2)} €</td></tr>` : ""}
    <tr class="total"><td>Total charges comprises</td><td>${total.toFixed(2)} €</td></tr>
  </tbody>
</table>
<div class="decl">
  Je soussigné(e), bailleur du logement désigné ci-dessus, déclare avoir reçu de ${locataire.prenom} ${locataire.nom}
  la somme de <strong>${total.toFixed(2)} €</strong> au titre du loyer et des charges pour la période de
  <strong>${moisLabel} ${paiement.annee}</strong>. Cette quittance est délivrée en conformité avec l'article 21
  de la loi n° 89-462 du 6 juillet 1989.
</div>
<div class="sig">
  <p>Fait le ${datePmt}</p>
  <div class="line"></div>
  <p>Signature du bailleur</p>
</div>
<div class="footer">
  Document généré par HomePedia IDF — Gestion locative · Ce document tient lieu de quittance au sens de l'article 21 de la loi 89-462.
</div>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 500);
}

export default function MonLogement() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  // Documents
  const [docs,          setDocs]          = useState([]);
  const [docsLoading,   setDocsLoading]   = useState(false);
  const [uploadOpen,    setUploadOpen]    = useState(false);
  const [uploadForm,    setUploadForm]    = useState({ categorie: "piece_identite", fichier: null });
  const [uploading,     setUploading]     = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API}/api/v1/mon-logement`, { headers: authHeaders() });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || `Erreur ${res.status}`);
        } else {
          setData(await res.json());
        }
      } catch (e) {
        setError("Impossible de charger votre logement.");
      } finally {
        setLoading(false);
      }
    }
    load();
    loadDocs();

    // Symétrique du côté bailleur : une quittance ou un document déposé par le
    // propriétaire n'apparaissait qu'après rechargement complet de la page.
    const auRetour = () => {
      if (document.visibilityState === "visible") {
        load();
        loadDocs();
      }
    };
    document.addEventListener("visibilitychange", auRetour);
    window.addEventListener("focus", auRetour);
    return () => {
      document.removeEventListener("visibilitychange", auRetour);
      window.removeEventListener("focus", auRetour);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDocs() {
    setDocsLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/mon-logement/documents`, { headers: authHeaders() });
      if (res.ok) setDocs(await res.json());
    } finally {
      setDocsLoading(false);
    }
  }

  async function uploadDoc(e) {
    e.preventDefault();
    if (!uploadForm.fichier) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("fichier", uploadForm.fichier);
    fd.append("categorie", uploadForm.categorie);
    try {
      const res = await fetch(`${API}/api/v1/mon-logement/documents/upload`, {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      if (res.ok) {
        setUploadOpen(false);
        setUploadForm({ categorie: "piece_identite", fichier: null });
        await loadDocs();
      }
    } finally {
      setUploading(false);
    }
  }

  function downloadDoc(docId, nomFichier) {
    const token = localStorage.getItem("hp_token");
    fetch(`${API}/api/v1/documents/${docId}/download`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = nomFichier;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="material-symbols-outlined text-primary animate-spin" style={{ fontSize: 32 }}>progress_activity</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
        <span className="material-symbols-outlined text-red-400" style={{ fontSize: 48 }}>error</span>
        <p className="text-slate-300 text-center">{error}</p>
        <p className="text-slate-500 text-sm text-center">
          Votre compte locataire n'est lié à aucun logement actif.<br/>
          Contactez votre bailleur pour activer l'accès.
        </p>
      </div>
    );
  }

  const { locataire, bien, proprio_email, paiements } = data;

  // Build map of payments by (annee, mois)
  const pmtMap = {};
  paiements.forEach(p => { pmtMap[`${p.annee}-${p.mois}`] = p; });

  // Generate last 12 months grid
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ annee: d.getFullYear(), mois: d.getMonth() + 1 });
  }

  const loyer   = Number(locataire.loyer_mensuel || 0);
  const charges = Number(locataire.charges_mensuelles || 0);
  const total   = loyer + charges;

  return (
    <div className="flex-1 overflow-auto p-4 md:p-8" style={{ background: "var(--bg-dark, #0a0f1a)" }}>
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Bienvenue */}
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(60,131,246,0.15)" }}>
            <span className="material-symbols-outlined text-primary" style={{ fontSize: 26 }}>house</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Bonjour, {locataire.prenom} !</h1>
            <p className="text-slate-400 text-sm">Espace locataire · {bien.adresse}{bien.ville ? `, ${bien.ville}` : ""}</p>
          </div>
        </div>

        {/* Fiche logement */}
        <div className="rounded-2xl border border-slate-800 p-5 space-y-4"
          style={{ background: "rgba(15,23,42,0.7)" }}>
          <h2 className="font-semibold text-white text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>apartment</span>
            Mon logement
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-slate-500 text-xs mb-1">Adresse</p>
              <p className="text-white font-medium">{bien.adresse}</p>
              {(bien.code_postal || bien.ville) && (
                <p className="text-slate-400">{bien.code_postal} {bien.ville}</p>
              )}
            </div>
            <div>
              <p className="text-slate-500 text-xs mb-1">Type de bien</p>
              <p className="text-white capitalize">{bien.type_bien}</p>
              {bien.surface_m2 && <p className="text-slate-400">{bien.surface_m2} m²</p>}
            </div>
            <div>
              <p className="text-slate-500 text-xs mb-1">Bail</p>
              <p className="text-white capitalize">{locataire.type_bail}</p>
              {locataire.date_entree && (
                <p className="text-slate-400">Depuis {new Date(locataire.date_entree).toLocaleDateString("fr-FR")}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-800 text-sm">
            <div>
              <p className="text-slate-500 text-xs mb-1">Loyer HC</p>
              <p className="text-emerald-400 font-bold text-lg">{loyer.toFixed(0)} €</p>
            </div>
            {charges > 0 && (
              <div>
                <p className="text-slate-500 text-xs mb-1">Charges</p>
                <p className="text-white font-medium">{charges.toFixed(0)} €</p>
              </div>
            )}
            <div>
              <p className="text-slate-500 text-xs mb-1">Total CC</p>
              <p className="text-white font-bold text-lg">{total.toFixed(0)} €/mois</p>
            </div>
          </div>
        </div>

        {/* Historique paiements / quittances */}
        <div className="rounded-2xl border border-slate-800 p-5 space-y-4"
          style={{ background: "rgba(15,23,42,0.7)" }}>
          <h2 className="font-semibold text-white text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>receipt_long</span>
            Quittances de loyer
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {months.map(({ annee, mois }) => {
              const key = `${annee}-${mois}`;
              const pmt = pmtMap[key];
              const paye = pmt?.statut === "paye";
              return (
                <button
                  key={key}
                  onClick={() => paye && genererQuittance({ locataire, bien, paiement: pmt, proprioEmail: proprio_email })}
                  disabled={!paye}
                  className={`relative rounded-xl p-3 text-left transition-all ${
                    paye
                      ? "border border-emerald-500/30 hover:border-emerald-400/60 hover:bg-emerald-500/5 cursor-pointer"
                      : "border border-slate-800 opacity-50 cursor-default"
                  }`}
                  style={paye ? { background: "rgba(16,185,129,0.06)" } : { background: "rgba(15,23,42,0.5)" }}
                >
                  <p className="text-xs font-medium text-slate-300">{MOIS_LABELS[mois - 1]}</p>
                  <p className="text-xs text-slate-500">{annee}</p>
                  {paye ? (
                    <div className="mt-2 flex items-center gap-1">
                      <span className="material-symbols-outlined text-emerald-400" style={{ fontSize: 14 }}>check_circle</span>
                      <span className="text-emerald-400 text-xs font-bold">Payé</span>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-1">
                      <span className="material-symbols-outlined text-slate-600" style={{ fontSize: 14 }}>radio_button_unchecked</span>
                      <span className="text-slate-500 text-xs">—</span>
                    </div>
                  )}
                  {paye && (
                    <p className="text-xs text-emerald-300/60 mt-1 flex items-center gap-1">
                      <span className="material-symbols-outlined" style={{ fontSize: 11 }}>download</span>
                      Télécharger
                    </p>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-slate-600 text-xs">
            Cliquez sur un mois payé pour télécharger la quittance (PDF).
          </p>
        </div>

        {/* Relevé de compte — la première chose qu'un locataire vient vérifier.
            Le même calcul que côté bailleur : un solde qui différerait selon qui
            le consulte serait pire que pas de solde du tout. */}
        <ReleveCompte token={localStorage.getItem("hp_token")} />

        {/* Documents */}
        <div className="rounded-2xl border border-slate-800 p-5 space-y-4"
          style={{ background: "rgba(15,23,42,0.7)" }}>

          {/* Bailleur → Locataire */}
          <div>
            <h2 className="font-semibold text-white text-sm flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>folder_shared</span>
              Documents partagés par votre bailleur
            </h2>
            {docsLoading ? (
              <p className="text-slate-500 text-xs">Chargement…</p>
            ) : docs.filter(d => d.uploaded_by === "proprio").length === 0 ? (
              <p className="text-slate-600 text-xs">Aucun document partagé par votre bailleur.</p>
            ) : (
              <div className="space-y-1.5">
                {docs.filter(d => d.uploaded_by === "proprio").map(doc => (
                  <div key={doc.id}
                    className="flex items-center gap-3 rounded-lg px-3 py-2"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <span className="material-symbols-outlined text-slate-400 shrink-0" style={{ fontSize: 18 }}>
                      {doc.mime_type === "application/pdf" ? "picture_as_pdf" : "image"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-medium truncate">{doc.nom_fichier}</p>
                      <p className="text-slate-500 text-[10px]">
                        {DOC_LABELS[doc.categorie] || doc.categorie}
                        {doc.taille_octets ? ` · ${fmtTaille(doc.taille_octets)}` : ""}
                      </p>
                    </div>
                    <button onClick={() => downloadDoc(doc.id, doc.nom_fichier)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-blue-400/10 transition-all shrink-0"
                      title="Télécharger">
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pièces justificatives locataire */}
          <div className="border-t border-slate-800 pt-4">
            <div className="flex justify-between items-center mb-3">
              <h2 className="font-semibold text-white text-sm flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400" style={{ fontSize: 18 }}>badge</span>
                Mes pièces justificatives
              </h2>
              <button onClick={() => setUploadOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)", color: "#fbbf24" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>upload</span>
                Ajouter
              </button>
            </div>
            {docs.filter(d => d.uploaded_by === "locataire").length === 0 ? (
              <p className="text-slate-600 text-xs">Aucune pièce justificative enregistrée.</p>
            ) : (
              <div className="space-y-1.5">
                {docs.filter(d => d.uploaded_by === "locataire").map(doc => (
                  <div key={doc.id}
                    className="flex items-center gap-3 rounded-lg px-3 py-2"
                    style={{ background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.15)" }}>
                    <span className="material-symbols-outlined text-amber-500/60 shrink-0" style={{ fontSize: 18 }}>
                      {doc.mime_type === "application/pdf" ? "picture_as_pdf" : "image"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-medium truncate">{doc.nom_fichier}</p>
                      <p className="text-slate-500 text-[10px]">
                        {DOC_LABELS[doc.categorie] || doc.categorie}
                        {doc.taille_octets ? ` · ${fmtTaille(doc.taille_octets)}` : ""}
                      </p>
                    </div>
                    <button onClick={() => downloadDoc(doc.id, doc.nom_fichier)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-400/10 transition-all shrink-0"
                      title="Télécharger">
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Contact bailleur */}
        <div className="rounded-2xl border border-slate-800 p-5"
          style={{ background: "rgba(15,23,42,0.7)" }}>
          <h2 className="font-semibold text-white text-sm flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>contact_mail</span>
            Contact bailleur
          </h2>
          <a href={`mailto:${proprio_email}`}
            className="flex items-center gap-2 text-primary hover:underline text-sm">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>mail</span>
            {proprio_email}
          </a>
        </div>

      </div>

      {/* Modale upload pièce justificative */}
      {uploadOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-5">
              <h3 className="font-bold text-white text-lg">Ajouter une pièce justificative</h3>
              <button onClick={() => setUploadOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={uploadDoc} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Type de document</label>
                <select
                  value={uploadForm.categorie}
                  onChange={e => setUploadForm(f => ({ ...f, categorie: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white">
                  {DOC_CATS_LOCATAIRE.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Fichier (PDF, JPEG, PNG — max 10 Mo)</label>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  required
                  onChange={e => setUploadForm(f => ({ ...f, fichier: e.target.files[0] }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-amber-600 file:text-white"
                />
              </div>
              <p className="text-slate-500 text-xs">
                Vos pièces justificatives sont partagées avec votre bailleur uniquement.
              </p>
              <button type="submit" disabled={uploading}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
                style={{ background: "rgba(245,158,11,0.4)", border: "1px solid rgba(245,158,11,0.5)" }}>
                {uploading ? "Envoi en cours…" : "Envoyer"}
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
