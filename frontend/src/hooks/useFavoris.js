import { useState, useCallback, useEffect } from "react";

// Partage la même clé que utils/favorites.js pour cohérence
const KEY = "hp_favorites";

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); }
  catch { return []; }
}

export function useFavoris() {
  const [favoris, setFavoris] = useState(load);

  // Synchroniser si MapView modifie les favoris via utils/favorites.js
  useEffect(() => {
    const handler = () => setFavoris(load());
    window.addEventListener("hp_favorites_changed", handler);
    return () => window.removeEventListener("hp_favorites_changed", handler);
  }, []);

  const toggle = useCallback((commune) => {
    // commune = { code, city, dept, prix_m2? }
    // Accepte aussi le format de utils/favorites.js : { code_commune, city, code_departement, prix_median_m2 }
    const code = commune.code || commune.code_commune;
    const city = commune.city;
    const dept = commune.dept || commune.code_departement;
    const prix_median_m2 = commune.prix_m2 || commune.prix_median_m2;

    setFavoris(prev => {
      const exists = prev.some(f => (f.code_commune || f.code) === code);
      const next = exists
        ? prev.filter(f => (f.code_commune || f.code) !== code)
        : [...prev, {
            code_commune: code,
            city,
            code_departement: dept,
            prix_median_m2,
            saved_at: new Date().toISOString(),
          }];
      localStorage.setItem(KEY, JSON.stringify(next));
      window.dispatchEvent(new Event("hp_favorites_changed"));
      return next;
    });
  }, []);

  const isFavori = useCallback((code) =>
    favoris.some(f => (f.code_commune || f.code) === code),
  [favoris]);

  const clear = useCallback(() => {
    setFavoris([]);
    localStorage.removeItem(KEY);
    window.dispatchEvent(new Event("hp_favorites_changed"));
  }, []);

  return { favoris, toggle, isFavori, clear };
}
