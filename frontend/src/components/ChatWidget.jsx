import { useState, useRef, useEffect } from "react";

const CHAT_API = import.meta.env.VITE_CHAT_API_URL || "http://localhost:5001";

// Couleurs du site (dark theme)
const C = {
  bg:         "rgba(10,16,28,0.98)",
  bgMessage:  "rgba(255,255,255,0.06)",
  border:     "rgba(60,131,246,0.25)",
  borderFocus:"rgba(60,131,246,0.7)",
  accent:     "#3C83F6",
  accentHover:"#2563EB",
  text:       "#E2E8F0",
  textMuted:  "rgba(226,232,240,0.5)",
  inputBg:    "rgba(255,255,255,0.07)",
  headerBg:   "rgba(7,11,20,0.99)",
  shadow:     "0 24px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(60,131,246,0.2)",
  fabShadow:  "0 0 20px rgba(60,131,246,0.5), 0 4px 16px rgba(0,0,0,0.6)",
};

const SUGGESTIONS = [
  "Où investir avec un bon rendement ?",
  "Communes les plus sûres d'IDF ?",
  "Meilleur DPE, moins de 4000€/m² ?",
  "Compare Versailles et Vincennes",
];

// Rendu markdown minimaliste (**bold** uniquement)
function renderText(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i} style={{ color: "#93C5FD", fontWeight: 600 }}>{p.slice(2, -2)}</strong>
      : p
  );
}

function BotIcon() {
  return (
    <div style={{ background: C.accent }} className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">
      HP
    </div>
  );
}

function Message({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && <BotIcon />}
      <div
        style={isUser
          ? { background: C.accent, color: "#fff" }
          : { background: C.bgMessage, color: C.text, border: `1px solid ${C.border}` }
        }
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
          isUser ? "rounded-tr-sm" : "rounded-tl-sm"
        }`}
      >
        {renderText(msg.content)}
        {msg.data && msg.data.length > 0 && (
          <div style={{ borderTop: `1px solid ${C.border}` }} className="mt-2 pt-2 space-y-1">
            {msg.data.slice(0, 5).map((row, i) => (
              <div key={i} className="text-xs flex gap-1 flex-wrap" style={{ color: C.textMuted }}>
                <span style={{ color: "#93C5FD", fontWeight: 500 }}>{row.commune}</span>
                {row.prix_m2 && <span>· {Number(row.prix_m2).toLocaleString("fr-FR")} €/m²</span>}
                {row.rendement_pct && <span>· {row.rendement_pct}% rdt</span>}
                {row.score_global && <span>· score {row.score_global}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Bonjour ! Je suis HomePedia IA 🏠\nPosez-moi vos questions sur l'immobilier en Île-de-France : prix, investissement, DPE, sécurité...",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  async function sendMessage(question) {
    const q = (question || input).trim();
    if (!q || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setLoading(true);

    try {
      const res = await fetch(`${CHAT_API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.answer, data: data.data, intent: data.intent },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Désolé, une erreur est survenue. Veuillez réessayer." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Bouton FAB */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ background: C.accent, boxShadow: C.fabShadow }}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95"
        title="HomePedia IA"
      >
        {open ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </button>

      {/* Fenêtre chat */}
      {open && (
        <div
          style={{ background: C.bg, boxShadow: C.shadow, border: `1px solid ${C.border}` }}
          className="fixed bottom-24 right-3 left-3 sm:left-auto sm:right-6 z-50 sm:w-96 h-[70vh] sm:h-[520px] rounded-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div style={{ background: C.headerBg, borderBottom: `1px solid ${C.border}` }} className="px-4 py-3 flex items-center gap-2 shrink-0">
            <div style={{ background: "rgba(60,131,246,0.2)", border: `1px solid ${C.border}` }} className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" >
              <span style={{ color: "#93C5FD" }}>HP</span>
            </div>
            <div>
              <div className="text-sm font-semibold" style={{ color: C.text }}>HomePedia IA</div>
              <div className="text-xs flex items-center gap-1" style={{ color: C.textMuted }}>
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                Immobilier Île-de-France
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3" style={{ scrollbarWidth: "thin", scrollbarColor: `${C.border} transparent` }}>
            {messages.map((msg, i) => (
              <Message key={i} msg={msg} />
            ))}
            {loading && (
              <div className="flex gap-2 items-center">
                <BotIcon />
                <div style={{ background: C.bgMessage, border: `1px solid ${C.border}` }} className="rounded-2xl rounded-tl-sm px-3 py-2 flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full animate-bounce"
                      style={{ background: C.accent, animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Suggestions */}
          {messages.length <= 1 && (
            <div className="px-3 pb-2 flex flex-wrap gap-1 shrink-0">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  style={{
                    background: "rgba(60,131,246,0.12)",
                    color: "#93C5FD",
                    border: `1px solid rgba(60,131,246,0.25)`,
                  }}
                  className="text-xs rounded-full px-2 py-1 transition-all hover:bg-blue-600 hover:text-white"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{ borderTop: `1px solid ${C.border}`, background: C.headerBg }} className="p-3 flex gap-2 shrink-0">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="Posez votre question..."
              disabled={loading}
              style={{
                background: C.inputBg,
                color: "#F1F5F9",
                border: `1px solid ${inputFocused ? C.borderFocus : C.border}`,
                outline: "none",
                caretColor: C.accent,
              }}
              className="flex-1 text-sm rounded-xl px-3 py-2 disabled:opacity-50 transition-colors placeholder:text-slate-500"
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              style={{ background: input.trim() && !loading ? C.accent : "rgba(60,131,246,0.3)" }}
              className="text-white rounded-xl px-3 py-2 transition-all hover:scale-105 active:scale-95 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
