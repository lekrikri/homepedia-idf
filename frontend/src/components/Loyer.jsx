import { useState, useEffect, useRef, useMemo } from "react";
import axios from "axios";

/**
 * Contrôle de loyer — pendant locatif de l'estimation.
 *
 * L'application ne couvrait le locataire qu'après la signature du bail. Or c'est
 * avant de signer que les décisions coûtent : un loyer surévalué se paie chaque
 * mois pendant des années, et en zone d'encadrement il est récupérable.
 */

const fmtEur = n => (n == null ? "—" : Math.round(n).toLocaleString("fr-FR") + " €");

function couleurEcart(ecart) {
  if (ecart == null) return "#94a3b8";
  if (ecart <= -5) return "#34d399";
  if (ecart < 10) return "#3b82f6";
  if (ecart < 25) return "#f59e0b";
  return "#ef4444";
}

function ChoixCommune({ communes, value, onSelect }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const resultats = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return communes.filter(c => c.nom?.toLowerCase().includes(q) || c.code_insee?.startsWith(q)).slice(0, 8);
  }, [query, communes]);

  return (
    <div className="relative" ref={ref}>
      <label className="text-xs text-slate-400 block mb-1">Commune</label>
      <input
        value={open || !value ? query : value.nom}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(""); setOpen(true); }}
        placeholder="Aubervilliers, 93001…"
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white
                   focus:border-blue-500 focus:outline-none"
      />
      {open && resultats.length > 0 && (
        <div className="absolute z-30 mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg shadow-2xl max-h-64 overflow-y-auto">
          {resultats.map(c => (
            <button key={c.code_insee} onMouseDown={() => { onSelect(c); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-slate-800 transition-colors">
              <p className="text-sm text-slate-100">{c.nom}</p>
              <p className="text-[11px] text-slate-500">{c.code_insee} · Dép. {c.departement}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Loyer() {
  const [communes, setCommunes] = useState([]);
  const [commune, setCommune] = useState(null);
  const [surface, setSurface] = useState("");
  const [loyer, setLoyer] = useState("");
  // Le plafond légal dépend du nombre de pièces et du caractère meublé :
  // sans ces deux informations, on ne peut donner qu'une fourchette.
  const [pieces, setPieces] = useState(2);
  const [meuble, setMeuble] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    axios.get("/api/v1/communes/list")
      .then(({ data }) => setCommunes(data.data || []))
      .catch(() => setCommunes([]));
  }, []);

  async function verifier(e) {
    e?.preventDefault();
    if (!commune) { setErreur("Choisissez une commune."); return; }
    setLoading(true); setErreur(null);
    try {
      const { data } = await axios.get("/api/v1/loyer", {
        params: {
          commune: commune.code_insee,
          surface: surface || undefined,
          loyer: loyer || undefined,
          pieces: pieces || undefined,
          meuble: meuble ? "true" : undefined,
        },
      });
      setData(data);
    } catch (err) {
      setErreur(err.response?.data?.error || "Vérification indisponible.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Ce loyer est-il correct ?</h1>
        <p className="text-slate-400 text-sm mt-1">
          Situez un loyer par rapport au marché local, avant de signer.
        </p>
      </div>

      <form onSubmit={verifier} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ChoixCommune communes={communes} value={commune} onSelect={setCommune} />
          <div>
            <label className="text-xs text-slate-400 block mb-1">Surface (m²)</label>
            <input type="number" value={surface} onChange={e => setSurface(e.target.value)} placeholder="40"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Loyer <strong className="text-slate-300">hors charges</strong> (€/mois)
            </label>
            <input type="number" value={loyer} onChange={e => setLoyer(e.target.value)} placeholder="750"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
            <p className="text-[10px] text-slate-600 mt-1">
              Le loyer principal de votre quittance, sans les provisions pour charges.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Nombre de pièces</label>
            <select value={pieces} onChange={e => setPieces(Number(e.target.value))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
              {[1, 2, 3, 4].map(p => <option key={p} value={p}>{p} pièce{p > 1 ? "s" : ""}</option>)}
              <option value={4}>4 pièces et plus</option>
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer pb-2">
            <input type="checkbox" checked={meuble} onChange={e => setMeuble(e.target.checked)}
              className="accent-blue-500" />
            <span className="text-xs text-slate-400">Logement meublé</span>
          </label>
        </div>

        <button type="submit" disabled={loading}
          className="w-full sm:w-auto px-5 py-2.5 rounded-lg text-sm font-medium transition-all hover:brightness-110 disabled:opacity-50"
          style={{ background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", color: "white" }}>
          {loading ? "Vérification…" : "Vérifier"}
        </button>

        {erreur && <p className="text-red-400 text-xs">{erreur}</p>}
      </form>

      {data && (
        <>
          {data.verdict && (
            <div className="bg-slate-900/60 border rounded-xl p-4"
              style={{ borderColor: couleurEcart(data.ecart_pct) + "55" }}>
              <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
                <h3 className="font-semibold text-white text-sm">Verdict</h3>
                <span className="text-xs px-2 py-0.5 rounded-md font-medium"
                  style={{ background: couleurEcart(data.ecart_pct) + "22", color: couleurEcart(data.ecart_pct) }}>
                  {data.ecart_pct > 0 ? "+" : ""}{data.ecart_pct} % vs marché
                </span>
              </div>
              <p className="text-slate-300 text-sm">{data.verdict}</p>
              <p className="text-slate-500 text-xs mt-1">
                {fmtEur(data.loyer_demande)} hors charges pour {data.surface_m2} m², soit{" "}
                {data.loyer_m2_demande} €/m². Référence ajustée à cette surface :{" "}
                {data.loyer_reference_ajuste_m2?.toFixed(1)} €/m²
                {data.loyer_reference_ajuste_m2 > data.loyer_median_m2 && (
                  <span className="text-slate-600">
                    {" "}(la moyenne communale, {data.loyer_median_m2} €/m², couvre toutes
                    les surfaces — les petits logements se louent plus cher au m²)
                  </span>
                )}.
              </p>
              {data.note_methode && (
                <p className="text-[11px] text-slate-600 mt-2 pt-2 border-t border-slate-800">
                  {data.note_methode}
                </p>
              )}
            </div>
          )}

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
            <h3 className="font-semibold text-white text-sm mb-3">Loyer de marché — {data.ville}</h3>
            {data.loyer_estime ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <p className="text-[11px] text-slate-500">Fourchette basse</p>
                  <p className="text-slate-300">{fmtEur(data.loyer_bas)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Loyer de marché</p>
                  <p className="text-white font-semibold text-lg">{fmtEur(data.loyer_estime)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Fourchette haute</p>
                  <p className="text-slate-300">{fmtEur(data.loyer_haut)}</p>
                </div>
              </div>
            ) : (
              <p className="text-slate-400 text-sm">
                Loyer médian : <strong className="text-white">{data.loyer_median_m2} €/m²</strong> par mois.
                Indiquez une surface pour obtenir une estimation.
              </p>
            )}
            <p className="text-[11px] text-slate-600 mt-3">
              Fourchette large à dessein : le loyer médian communal ne distingue ni le type
              de bien, ni l'étage, ni l'état, ni le caractère meublé.
            </p>
          </div>

          {data.controle_encadrement && (
            <div className="bg-slate-900/60 border rounded-xl p-4"
              style={{ borderColor: data.controle_encadrement.depassement
                ? "rgba(239,68,68,0.45)" : "rgba(52,211,153,0.35)" }}>
              <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
                <h3 className="font-semibold text-sm"
                  style={{ color: data.controle_encadrement.depassement ? "#f87171" : "#34d399" }}>
                  {data.controle_encadrement.depassement
                    ? "Ce loyer dépasse le plafond légal"
                    : "Contrôle de l'encadrement des loyers"}
                </h3>
                <span className="text-[11px] text-slate-500">
                  plafonds {data.controle_encadrement.millesime}
                </span>
              </div>

              {data.controle_encadrement.depassement_mensuel > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3 pb-3 border-b border-slate-800">
                  <div>
                    <p className="text-[11px] text-slate-500">Dépassement mensuel</p>
                    <p className="text-lg font-bold" style={{ color: "#f87171" }}>
                      {fmtEur(data.controle_encadrement.depassement_mensuel)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500">Sur un an</p>
                    <p className="text-lg font-bold" style={{ color: "#f87171" }}>
                      {fmtEur(data.controle_encadrement.depassement_annuel)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500">Récupérable sur 3 ans</p>
                    <p className="text-lg font-bold text-white">
                      {fmtEur(data.controle_encadrement.depassement_annuel * 3)}
                    </p>
                  </div>
                </div>
              )}

              <p className="text-[13px] text-slate-300">{data.controle_encadrement.message}</p>

              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-[11px] text-slate-500">
                <span>Votre loyer : <strong className="text-slate-300">
                  {data.controle_encadrement.loyer_m2_demande} €/m²</strong></span>
                <span>Plafonds de la commune : {data.controle_encadrement.loyer_majore_min} à{" "}
                  {data.controle_encadrement.loyer_majore_max} €/m²</span>
              </div>
            </div>
          )}

          {data.encadrement_applicable && !data.controle_encadrement && (
            <div className="bg-slate-900/60 border rounded-xl p-4" style={{ borderColor: "rgba(52,211,153,0.35)" }}>
              <h3 className="font-semibold text-sm mb-2" style={{ color: "#34d399" }}>
                Encadrement des loyers applicable — {data.zone_encadrement}
              </h3>
              <p className="text-[13px] text-slate-300">{data.note_encadrement}</p>
              <p className="text-[11px] text-slate-500 mt-2">
                Les plafonds de cette intercommunalité ne sont pas encore publiés dans un
                format exploitable : nous ne pouvons pas chiffrer un éventuel dépassement.
                Le loyer de référence doit figurer dans votre bail — réclamez-le.
              </p>
            </div>
          )}

          {data.comparaison_achat && (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
              <h3 className="font-semibold text-white text-sm mb-2">Louer ou acheter ?</h3>
              <p className="text-[13px] text-slate-300">{data.comparaison_achat}</p>
              <p className="text-[11px] text-slate-500 mt-2">
                Comparaison indicative, hors charges de copropriété, taxe foncière et
                travaux. Les frais d'acquisition, environ 8 % du prix, sont perdus en cas
                de revente rapide : l'achat devient généralement pertinent au-delà de cinq
                à sept ans de détention.
              </p>
            </div>
          )}

          <p className="text-[11px] text-slate-600">
            Source : loyers de marché observés par commune. Un loyer se juge toujours avec
            le montant des charges et la classe DPE : un logement mal isolé coûte cher à
            chauffer, et les classes G sont déjà interdites à la location.
          </p>
        </>
      )}
    </div>
  );
}
