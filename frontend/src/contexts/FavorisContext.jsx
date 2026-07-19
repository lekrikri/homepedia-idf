import { createContext, useContext } from "react";
import { useFavoris } from "../hooks/useFavoris.js";

const FavorisContext = createContext(null);

export function FavorisProvider({ children }) {
  const favState = useFavoris();
  return <FavorisContext.Provider value={favState}>{children}</FavorisContext.Provider>;
}

export function useFavorisContext() {
  return useContext(FavorisContext);
}
