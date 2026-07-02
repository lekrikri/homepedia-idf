import { createContext, useContext, useEffect, useState } from "react";
import axios from "axios";

const CommunesContext = createContext({ communes: [], loading: true });

// Un seul fetch au démarrage de l'app, partagé entre MapView / Dashboard / Comparer.
// Utilise /communes/list (payload léger ~150KB + cache 2h côté backend).
export function CommunesProvider({ children }) {
  const [communes, setCommunes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    axios
      .get("/api/v1/communes/list", { signal: ctrl.signal })
      .then(r => setCommunes(r.data?.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, []);

  return (
    <CommunesContext.Provider value={{ communes, loading }}>
      {children}
    </CommunesContext.Provider>
  );
}

export function useCommunes() {
  return useContext(CommunesContext);
}
