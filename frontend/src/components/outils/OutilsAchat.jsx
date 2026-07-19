import { useState, useMemo } from "react";
import { capaciteAchat, coutRenovation, CLASSES_DPE } from "./finance.js";

const fmt = n => (n == null ? "—" : Math.round(n).toLocaleString("fr-FR") + " €");

function Champ({ label, value, onChange, suffixe, type = "number", step }) {
  return (
    <div>
      <label className="text-xs text-slate-400 block mb-1">{label}</label>
      <div className="relative">
        <input type={type} step={step} value={value}
          onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white
                     focus:border-blue-500 focus:outline-none" />
        {suffixe && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">{suffixe}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Capacité d'emprunt.
 *
 * Placée à côté de l'estimation à dessein : savoir qu'un bien est au prix du
 * marché ne sert à rien si on ne peut pas le financer. C'est la première
 * question d'un acheteur, et le calcul se fait en local, sans appel serveur.
 */
export function CapaciteEmprunt({ prixCible }) {
  const [revenus, setRevenus] = useState(3000);
  const [charges, setCharges] = useState(0);
  const [apport, setApport] = useState(20000);
  const [taux, setTaux] = useState(3.5);
  const [duree, setDuree] = useState(20);

  const r = useMemo(
    () => capaciteAchat({ revenusNets: revenus || 0, chargesCredits: charges || 0, apport: apport || 0, taux: taux || 0, duree: duree || 1 }),
    [revenus, charges, apport, taux, duree]
  );

  const suffisant = prixCible ? r.budgetMax >= prixCible : null;
  const ecart = prixCible ? r.budgetMax - prixCible : null;

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
      <h3 className="font-semibold text-white text-sm mb-1">Puis-je l'acheter ?</h3>
      <p className="text-[11px] text-slate-500 mb-4">
        Capacité d'achat selon la règle des 35 % d'endettement, assurance comprise.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Champ label="Revenus nets du foyer" value={revenus} onChange={setRevenus} suffixe="€/mois" />
        <Champ label="Crédits en cours" value={charges} onChange={setCharges} suffixe="€/mois" />
        <Champ label="Apport disponible" value={apport} onChange={setApport} suffixe="€" />
        <Champ label="Taux du crédit" value={taux} onChange={setTaux} suffixe="%" step="0.1" />
        <Champ label="Durée" value={duree} onChange={setDuree} suffixe="ans" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-800">
        <div>
          <p className="text-[11px] text-slate-500">Mensualité maximale</p>
          <p className="text-white font-semibold">{fmt(r.mensualiteMax)}</p>
          <p className="text-[10px] text-slate-600">dont {fmt(r.assuranceMensuelle)} d'assurance</p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500">Capital empruntable</p>
          <p className="text-white font-semibold">{fmt(r.capital)}</p>
          <p className="text-[10px] text-slate-600">coût du crédit : {fmt(r.coutTotalCredit)}</p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500">Budget d'achat</p>
          <p className="text-lg font-bold" style={{ color: "#60a5fa" }}>{fmt(r.budgetMax)}</p>
          <p className="text-[10px] text-slate-600">frais de notaire : {fmt(r.fraisNotaire)}</p>
        </div>
      </div>

      {prixCible > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-800">
          <p className="text-sm" style={{ color: suffisant ? "#34d399" : "#f87171" }}>
            {suffisant
              ? `Ce bien à ${fmt(prixCible)} est dans votre budget (marge de ${fmt(ecart)}).`
              : `Ce bien à ${fmt(prixCible)} dépasse votre budget de ${fmt(-ecart)}.`}
          </p>
          {!suffisant && (
            <p className="text-[11px] text-slate-500 mt-1">
              Trois leviers : augmenter l'apport, allonger la durée (au prix d'un crédit
              plus cher au total), ou négocier le prix.
            </p>
          )}
        </div>
      )}

      <p className="text-[11px] text-slate-600 mt-3">
        Votre apport finance d'abord les frais de notaire, qui ne s'empruntent pas :
        il ne s'ajoute donc pas entièrement à votre budget. Reste à vivre estimé :
        {" "}{fmt(r.resteAVivre)} par mois.
      </p>
    </div>
  );
}

/**
 * Coût de rénovation énergétique.
 *
 * Un DPE F ou G se lit comme une contrainte ; chiffré aides déduites, il devient
 * un argument de négociation opposable au vendeur.
 */
export function RenovationDPE({ surfaceInitiale }) {
  const [classeActuelle, setClasseActuelle] = useState("F");
  const [classeCible, setClasseCible] = useState("D");
  const [surface, setSurface] = useState(surfaceInitiale || 40);
  const [modestes, setModestes] = useState(false);

  const r = useMemo(
    () => coutRenovation({ classeActuelle, classeCible, surface: surface || 0, revenusModestes: modestes }),
    [classeActuelle, classeCible, surface, modestes]
  );

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
      <h3 className="font-semibold text-white text-sm mb-1">Chiffrer les travaux énergétiques</h3>
      <p className="text-[11px] text-slate-500 mb-4">
        Les logements classés G sont interdits à la location depuis 2025, les F le seront en 2028.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="text-xs text-slate-400 block mb-1">Classe actuelle</label>
          <select value={classeActuelle} onChange={e => setClasseActuelle(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
            {CLASSES_DPE.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Classe visée</label>
          <select value={classeCible} onChange={e => setClasseCible(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
            {CLASSES_DPE.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <Champ label="Surface" value={surface} onChange={setSurface} suffixe="m²" />
      </div>

      <label className="flex items-center gap-2 mb-4 cursor-pointer">
        <input type="checkbox" checked={modestes} onChange={e => setModestes(e.target.checked)}
          className="accent-blue-500" />
        <span className="text-xs text-slate-400">
          Foyer aux revenus modestes ou très modestes (aides majorées)
        </span>
      </label>

      {!r ? (
        <p className="text-slate-500 text-xs py-3">
          Choisissez une classe visée meilleure que la classe actuelle.
        </p>
      ) : (
        <>
          <div className="space-y-1.5 mb-3">
            {r.postes.map(p => (
              <div key={p.cle} className="flex justify-between text-sm">
                <span className="text-slate-400">{p.label}</span>
                <span className="text-slate-300">{fmt(p.cout)}</span>
              </div>
            ))}
          </div>

          <div className="space-y-1.5 pt-3 border-t border-slate-800 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Total des travaux</span>
              <span className="text-white font-medium">{fmt(r.coutTravaux)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">MaPrimeRénov'</span>
              <span className="text-emerald-400">− {fmt(r.maPrimeRenov)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Certificats d'économies d'énergie</span>
              <span className="text-emerald-400">− {fmt(r.cee)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-slate-800">
              <span className="text-white font-medium">Reste à charge</span>
              <span className="text-white font-bold">{fmt(r.resteACharge)}</span>
            </div>
          </div>

          {r.ecoPtzMax > 0 && (
            <p className="text-[11px] text-slate-500 mt-3">
              Finançable par un éco-prêt à taux zéro ({fmt(r.ecoPtzMax)}), soit environ
              {" "}{fmt(r.mensualiteEcoPtz)} par mois sur 15 ans, sans intérêt.
            </p>
          )}

          <div className="mt-3 pt-3 border-t border-slate-800">
            <p className="text-[13px] text-slate-300">
              Argument de négociation : ces {fmt(r.resteACharge)} de reste à charge sont
              à déduire de votre offre. Un vendeur qui refuse devra trouver un acheteur
              prêt à les assumer — de plus en plus rare à mesure que 2028 approche.
            </p>
          </div>
        </>
      )}

      <p className="text-[11px] text-slate-600 mt-3">
        Ordres de grandeur indicatifs : seul un devis engage. En copropriété, l'isolation
        des façades relève d'un vote en assemblée générale et non du seul propriétaire.
      </p>
    </div>
  );
}
