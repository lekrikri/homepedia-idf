import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";

export function useGlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);

  const search = useCallback((q) => {
    setQuery(q);
    if (!q || q.length < 2) { setResults([]); setOpen(false); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await axios.get(`/api/v1/communes?q=${encodeURIComponent(q)}&limit=8`);
        const list = r.data?.data ?? r.data ?? [];
        setResults(list);
        setOpen(list.length > 0);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 220);
  }, []);

  const clear = useCallback(() => {
    setQuery(""); setResults([]); setOpen(false);
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  return { query, results, loading, open, setOpen, search, clear };
}
