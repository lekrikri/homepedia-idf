const KEY = "hp_favorites";

export function getFavorites() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}

export function isFavorite(code) {
  return getFavorites().some(f => f.code_commune === code);
}

export function addFavorite(commune) {
  const list = getFavorites().filter(f => f.code_commune !== commune.code_commune);
  list.unshift({
    code_commune: commune.code_commune,
    city: commune.city,
    code_departement: commune.code_departement,
    prix_median_m2: commune.prix_median_m2,
    score_investissement: commune.score_investissement,
    score_qualite_vie: commune.score_qualite_vie,
    saved_at: new Date().toISOString(),
  });
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event("hp_favorites_changed"));
}

export function removeFavorite(code) {
  const list = getFavorites().filter(f => f.code_commune !== code);
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event("hp_favorites_changed"));
}
