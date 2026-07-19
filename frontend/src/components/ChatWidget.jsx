import { useState, useRef, useEffect } from "react";
import ConseillerIA from "./ConseillerIA";

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

// Tâche 1 — 6 suggestions statiques (chat vide)
const SUGGESTED_QUESTIONS = [
  "Meilleures communes pour investir en Essonne ?",
  "Comparer Vincennes et Montreuil",
  "Communes avec rendement > 5% près de Paris",
  "Où acheter avec 300 000 € en IDF ?",
  "Quels coins ont les meilleures écoles en 78 ?",
  "Tendance des prix en Seine-Saint-Denis",
];

// Tâche 1 — Suggestions contextuelles par intent
const CONTEXTUAL_SUGGESTIONS = {
  rendement:        ["Et en Seine-et-Marne ?", "Rendement en 92 ?", "Communes avec loyer > 15 €/m² ?"],
  top_investissement: ["Et pour une famille ?", "Score DPE de ces communes ?", "Budget 250 000 € ?"],
  multi_criteria:   ["Comparer les 2 premières", "Prévisions prix de Palaiseau ?", "DPE de ces communes ?"],
  commune_detail:   ["Et les prévisions pour 2026 ?", "Communes similaires moins chères ?", "Rendement locatif ?"],
  comparaison:      ["Quelle commune a les meilleures écoles ?", "Et pour investir lequel choisir ?"],
  budget_achat:     ["Et en 77 ?", "Meilleur rendement dans ce budget ?", "Communes similaires ?"],
  default:          ["Meilleures communes 93 ?", "Investir à Massy ?", "DPE en 91 ?"],
};

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
        {msg.content ? renderText(msg.content) : null}
        {msg.streaming && (
          <span style={{ display: "inline-block", width: "2px", height: "14px", background: C.accent, verticalAlign: "middle", marginLeft: "2px", animation: "blink 1s step-end infinite" }} />
        )}
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

// Tâche 1 — Chips de suggestions
function SuggestionChips({ suggestions, onSelect }) {
  return (
    <div className="px-3 pb-2 flex flex-wrap gap-1.5 shrink-0">
      {suggestions.map((s) => (
        <button
          key={s}
          onClick={() => onSelect(s)}
          style={{
            background: "rgba(60,131,246,0.08)",
            color: "#60a5fa",
            border: "1px solid rgba(60,131,246,0.2)",
          }}
          className="text-[10px] rounded-full px-2.5 py-1 transition-all hover:bg-blue-500/20 hover:border-blue-400/40 hover:text-blue-300"
        >
          {s}
        </button>
      ))}
    </div>
  );
}

export default function ChatWidget() {
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get("chat") === "open");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Bonjour ! Je suis HomePedia IA 🏠\nPosez-moi vos questions sur l'immobilier en Île-de-France : prix, investissement, DPE, sécurité...",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  // Tâche 3 — état pour basculer vers ConseillerIA
  const [showConseiller, setShowConseiller] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open && !showConseiller) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open, showConseiller]);

  // Tâche 1 — calcul des suggestions à afficher
  const isEmpty = messages.length <= 1;
  const lastIntent = !isEmpty
    ? messages.slice().reverse().find(m => m.role === "assistant" && m.intent)?.intent
    : null;
  const contextualSuggestions = lastIntent
    ? (CONTEXTUAL_SUGGESTIONS[lastIntent] || CONTEXTUAL_SUGGESTIONS.default)
    : null;

  async function sendMessage(question) {
    const q = (question || input).trim();
    if (!q || loading) return;

    setInput("");
    setMessages((prev) => [...prev,
      { role: "user", content: q },
      { role: "assistant", content: "", streaming: true, data: [] },
    ]);
    setLoading(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const history = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content || "" }));

      const res = await fetch(`${CHAT_API}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.split("\n").find(l => l.startsWith("data:"));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") break;
          try {
            const ev = JSON.parse(payload);
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (!last || last.role !== "assistant") return prev;
              // Premier event : metadata (intent + data SQL)
              if (ev.intent !== undefined) {
                copy[copy.length - 1] = { ...last, data: ev.data || [], intent: ev.intent };
              // Event replace : hallucination détectée → remplacer le texte
              } else if (ev.replace !== undefined) {
                copy[copy.length - 1] = { ...last, content: ev.replace };
              // Chunk texte normal
              } else if (ev.chunk !== undefined) {
                copy[copy.length - 1] = { ...last, content: (last.content || "") + ev.chunk };
              }
              return copy;
            });
          } catch { /* payload malformé ignoré */ }
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: "Désolé, une erreur est survenue. Veuillez réessayer.", streaming: false };
          return copy;
        });
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.streaming) copy[copy.length - 1] = { ...last, streaming: false };
        return copy;
      });
    }
  }

  // Tâche 3 — injection résultat ConseillerIA dans l'historique chat
  function handleConseillerResult({ question, answer, data }) {
    if (question) {
      setMessages(prev => [
        ...prev,
        { role: "user", content: question },
        { role: "assistant", content: answer || "", data: data || [], streaming: false },
      ]);
    }
    setShowConseiller(false);
  }

  // Tâche 1 — click chip : injecter dans input ET envoyer
  function handleChipClick(text) {
    setInput(text);
    sendMessage(text);
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
            <div className="flex-1">
              <div className="text-sm font-semibold" style={{ color: C.text }}>HomePedia IA</div>
              <div className="text-xs flex items-center gap-1" style={{ color: C.textMuted }}>
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                Immobilier Île-de-France
              </div>
            </div>
            {/* Tâche 3 — Bouton Conseiller IA */}
            <button
              onClick={() => setShowConseiller(v => !v)}
              title="Conseiller IA"
              style={{
                background: showConseiller ? "rgba(60,131,246,0.25)" : "rgba(60,131,246,0.08)",
                border: `1px solid ${showConseiller ? "rgba(60,131,246,0.6)" : "rgba(60,131,246,0.2)"}`,
                color: showConseiller ? "#93c5fd" : "#60a5fa",
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all hover:bg-blue-500/20 shrink-0"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>auto_awesome</span>
              <span className="hidden sm:inline">Conseiller</span>
            </button>
          </div>

          {/* Tâche 3 — Vue ConseillerIA ou vue Chat */}
          {showConseiller ? (
            <div className="flex-1 overflow-hidden flex flex-col">
              <ConseillerIA
                onResult={handleConseillerResult}
                onClose={() => setShowConseiller(false)}
              />
            </div>
          ) : (
            <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3" style={{ scrollbarWidth: "thin", scrollbarColor: `${C.border} transparent` }}>
                {messages.map((msg, i) => (
                  <Message key={i} msg={msg} />
                ))}
                <div ref={bottomRef} />
              </div>

              {/* Tâche 1 — Suggestions chips */}
              {isEmpty ? (
                <SuggestionChips suggestions={SUGGESTED_QUESTIONS} onSelect={handleChipClick} />
              ) : contextualSuggestions ? (
                <SuggestionChips suggestions={contextualSuggestions} onSelect={handleChipClick} />
              ) : null}

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
            </>
          )}
        </div>
      )}
    </>
  );
}
