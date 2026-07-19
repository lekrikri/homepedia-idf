import { useState, useRef, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8080";
const STORAGE_KEY = "hp_chat_history";
const MAX_HISTORY = 10; // Nombre max de messages envoyés au LLM (user + assistant)

const SUGGESTIONS = [
  "Parle-moi de Montreuil",
  "Quel est le prix moyen à Neuilly-sur-Seine ?",
  "Comment est le DPE à Antony ?",
  "Quels transports à Créteil ?",
];

const DEFAULT_GREETING = {
  role: "assistant",
  text: "Bonjour ! Posez-moi vos questions sur l'immobilier en Île-de-France. Je m'appuie sur les données réelles des 1266 communes.",
};

export default function ChatRAG() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(() => {
    // Restaurer l'historique depuis localStorage au chargement
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [DEFAULT_GREETING];
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);

  // Persister les messages dans localStorage à chaque changement
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {}
  }, [messages]);

  // Auto-scroll en bas à chaque nouveau message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const sendMessage = async (question) => {
    const q = (question ?? input).trim();
    if (!q || loading) return;

    // Construire l'historique à envoyer au LLM (exclut le greeting initial)
    const history = messages
      .filter((m) => m.role && m.text && m.text.trim())
      .filter((m, i) => !(i === 0 && m.text === DEFAULT_GREETING.text))
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.text }));

    setInput("");
    setLoading(true);
    setMessages((m) => [
      ...m,
      { role: "user", text: q },
      { role: "assistant", text: "", sources: [], streaming: true },
    ]);

    // AbortController pour pouvoir annuler la requête si l'utilisateur ferme le chat
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch(`${API}/api/v1/rag/query/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history }),
        signal: ctrl.signal,
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      // Parse du flux SSE : lignes "event: X\ndata: {...}\n\n"
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "message";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("event:")) {
              currentEvent = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              const payload = line.slice(5).trim();
              try {
                const data = JSON.parse(payload);
                applyStreamEvent(currentEvent, data);
              } catch {
                // ignore malformed payload
              }
            }
          }
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            role: "assistant",
            text: "Erreur de connexion au serveur RAG. Vérifiez qu'Ollama et le service RAG tournent.",
            streaming: false,
          };
          return copy;
        });
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last?.streaming) copy[copy.length - 1] = { ...last, streaming: false };
        return copy;
      });
    }
  };

  // Applique un événement SSE au dernier message (assistant en cours)
  const applyStreamEvent = (event, data) => {
    setMessages((m) => {
      const copy = [...m];
      const idx = copy.length - 1;
      const last = copy[idx];
      if (!last || last.role !== "assistant") return m;

      if (event === "sources") {
        copy[idx] = { ...last, sources: data.sources || [] };
      } else if (event === "token") {
        copy[idx] = { ...last, text: (last.text || "") + (data.text || "") };
      } else if (event === "done") {
        copy[idx] = { ...last, latency_ms: data.latency_ms, streaming: false };
      } else if (event === "error") {
        copy[idx] = { ...last, text: `Erreur : ${data.error}`, streaming: false };
      }
      return copy;
    });
  };

  const handleClose = () => {
    if (abortRef.current) abortRef.current.abort();
    setOpen(false);
  };

  const handleClearHistory = () => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([DEFAULT_GREETING]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  return (
    <>
      {/* FAB — bouton flottant */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-[100] size-14 rounded-full bg-primary hover:bg-primary/90 shadow-2xl shadow-primary/40 flex items-center justify-center transition-all hover:scale-105"
          aria-label="Ouvrir le chat"
        >
          <span className="material-symbols-outlined text-white" style={{ fontSize: 28 }}>
            chat
          </span>
        </button>
      )}

      {/* Fenêtre de chat */}
      {open && (
        <div
          className="fixed bottom-6 right-6 z-[100] w-[380px] max-w-[calc(100vw-3rem)] h-[600px] max-h-[calc(100vh-3rem)] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
          style={{ background: "#0f1724", border: "1px solid rgba(60,131,246,0.3)" }}
        >
          {/* Header chat */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-3">
              <div className="size-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="material-symbols-outlined text-white" style={{ fontSize: 18 }}>
                  smart_toy
                </span>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-100">Assistant HomePedia</p>
                <p className="text-[11px] text-slate-500">
                  {loading ? "En train de répondre..." : "En ligne · Gemma 4"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleClearHistory}
                disabled={loading || messages.length <= 1}
                className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Nouvelle conversation"
                title="Nouvelle conversation"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>
              </button>
              <button
                onClick={handleClose}
                className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
                aria-label="Fermer"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m, i) => (
              <MessageBubble key={i} message={m} />
            ))}

            {/* Suggestions affichées uniquement au premier message */}
            {messages.length === 1 && !loading && (
              <div className="pt-2 space-y-2">
                <p className="text-[11px] text-slate-500 uppercase tracking-wider">Suggestions</p>
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(s)}
                    className="w-full text-left text-xs text-slate-300 px-3 py-2 rounded-lg bg-slate-800/40 hover:bg-primary/10 hover:text-primary transition-colors border border-slate-800"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-3 border-t border-slate-800 bg-slate-900/30">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                disabled={loading}
                rows={1}
                placeholder="Votre question..."
                className="flex-1 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:ring-1 focus:ring-primary/50 outline-none resize-none disabled:opacity-50"
                style={{ maxHeight: 100 }}
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading}
                className="size-9 bg-primary hover:bg-primary/90 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-lg flex items-center justify-center transition-colors shrink-0"
                aria-label="Envoyer"
              >
                <span className="material-symbols-outlined text-white" style={{ fontSize: 18 }}>
                  {loading ? "hourglass" : "send"}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1`}>
        <div
          className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? "bg-primary text-white rounded-br-sm"
              : "bg-slate-800/60 text-slate-100 rounded-bl-sm"
          }`}
        >
          {message.text || (message.streaming && <StreamingDots />)}
          {message.streaming && message.text && <span className="animate-pulse">▌</span>}
        </div>

        {!isUser && message.latency_ms && (
          <span className="text-[10px] text-slate-600 ml-1">
            {(message.latency_ms / 1000).toFixed(1)}s
          </span>
        )}
      </div>
    </div>
  );
}

function StreamingDots() {
  return (
    <span className="inline-flex gap-1">
      <span className="size-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="size-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="size-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
    </span>
  );
}
