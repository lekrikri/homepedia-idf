import { useState, useRef, useEffect } from "react";
import ConseillerIA from "./ConseillerIA";

const CHAT_API = import.meta.env.VITE_CHAT_API_URL || "http://localhost:5001";
// Le RAG (Qwen 1,5 B) répond au droit du logement, à l'achat et aux aides ; il
// est servi par l'API Go. Le chatbot SQL, lui, répond aux données de commune
// (prix, DPE, classements) avec ses cartes.
const RAG_API = import.meta.env.VITE_API_URL || "http://localhost:8080";

// Aiguillage hybride. Deux cerveaux : le SQL pour la donnée chiffrée d'une
// commune, le RAG pour le juridique et le conseil. Un mot-clé juridique fait
// basculer vers le RAG — « le loyer est-il encadré à Aubervilliers ? » est une
// question de droit, même si elle nomme une commune. Les termes retenus
// n'apparaissent pas dans une demande de donnée commune (prix, DPE, sécurité,
// classement), qui reste donc sur le SQL et ses cartes.
const sansAccents = (s) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const JURIDIQUE_RE =
  // Bornes de début conservées ; pas de borne de fin, pour que les racines
  // (« encadr » → encadré/encadrement, « expuls » → expulser/expulsion) captent
  // leurs suffixes. Les acronymes courts (apl, caf, hlm, sci, irl, ptz) gardent
  // leurs propres bornes internes pour ne pas matcher au milieu d'un mot.
  /\b(preavis|conge|bail|baux|caution|depot de garantie|garant|encadr|quittance|etat des lieux|vetuste|notaire|compromis|retractation|carrez|boutin|syndic|copropriete|\bapl\b|\bcaf\b|visale|maprimerenov|renov|\baides?\b|passoire|classe [fg]\b|expuls|treve|colocation|sous.location|honoraires|decence|decent|resiliation|indemnite|dalo|\bhlm\b|preemption|servitude|indivision|succession|\bsci\b|pinel|deficit foncier|\birl\b|logement (meuble|vide|nu|decent|insalubre)|plus.value|permis de construire|declaration prealable|\bptz\b|litige|conciliation|zone tendue|emprunt|capacite d.emprunt|frais de notaire|credit immobilier|augment|hausse|revis|loyer.{0,20}(correct|abusif|trop|plafond|maximum|legal)|puis.je|ai.?je le droit|dois.je|le droit de|peut.il m|obligation|comment (resilier|contester|obtenir|declarer|calculer|financer|reviser|augmenter))/;

const estJuridique = (q) => JURIDIQUE_RE.test(sansAccents(q));

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

// Suggestions de l'accueil : une par capacité, pour que l'utilisateur découvre
// les trois cerveaux — données de commune, calcul, et droit du logement.
const SUGGESTED_QUESTIONS = [
  "Prix au m² à Aubervilliers ?",
  "Combien puis-je emprunter avec 2 500 € ?",
  "Le loyer est-il encadré à Aubervilliers ?",
  "Comparer Vincennes et Montreuil",
  "Meilleures communes pour investir en Essonne ?",
  "Quel préavis pour quitter mon logement en zone tendue ?",
];

// Suggestions contextuelles par intent, pour rebondir après une réponse.
const CONTEXTUAL_SUGGESTIONS = {
  rendement:        ["Et en Seine-et-Marne ?", "Rendement en 92 ?", "Communes avec loyer > 15 €/m² ?"],
  top_investissement: ["Et pour une famille ?", "Score DPE de ces communes ?", "Budget 250 000 € ?"],
  multi_criteria:   ["Comparer les 2 premières", "Prévisions prix de Palaiseau ?", "DPE de ces communes ?"],
  commune_detail:   ["Et le DPE ?", "Et la sécurité ?", "Combien puis-je emprunter ici ?"],
  comparaison:      ["Quelle commune a les meilleures écoles ?", "Et pour investir lequel choisir ?"],
  budget_achat:     ["Et en 77 ?", "Meilleur rendement dans ce budget ?", "Communes similaires ?"],
  // Après une réponse juridique ou un calcul (outils emprunt/loyer), on propose
  // d'autres questions de droit et de calcul plutôt que des données de commune.
  juridique:        ["Combien puis-je emprunter avec 3 000 € ?", "Comment récupérer mon dépôt de garantie ?", "Suis-je éligible au PTZ ?"],
  default:          ["Prix à Montreuil ?", "Combien puis-je emprunter avec 3 000 € ?", "Quel préavis en zone tendue ?"],
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
        {/* Accusé de fiabilité : distinguer un calcul déterministe / une source
            juridique d'une simple réponse générée renforce la confiance. */}
        {!isUser && !msg.streaming && msg.sourceTypes?.length > 0 && (
          <div className="mt-2 pt-1.5 text-[11px]" style={{ color: C.textMuted, borderTop: `1px solid ${C.border}` }}>
            {msg.sourceTypes.includes("outil")
              ? "🧮 Calcul HomePedia — valeurs officielles, pas une estimation générée"
              : msg.sourceTypes.includes("legal")
              ? "📖 Droit du logement — vérifiez sur service-public.fr"
              : null}
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

  // Réveil du RAG à l'ouverture du chat. Le modèle 1,5 B se charge au démarrage
  // du conteneur (~1 min) ; le déclencher pendant que l'utilisateur lit et tape
  // évite qu'une première question juridique n'attende ce chargement. Une seule
  // fois par montage, fire-and-forget.
  // On réveille les DEUX cerveaux : le RAG (juridique) ET le chatbot SQL
  // (données). Les deux s'éteignent après inactivité pour rester gratuits ; sans
  // ce ping, la première question après une pause tombait sur un cold start
  // (~5-10 s) et pouvait échouer — c'est l'erreur « une erreur est survenue ».
  const warmed = useRef(false);
  useEffect(() => {
    if (open && !warmed.current) {
      warmed.current = true;
      fetch(`${RAG_API}/api/v1/rag/health`).catch(() => {});
      fetch(`${CHAT_API}/health`).catch(() => {});
    }
  }, [open]);

  // Tâche 1 — calcul des suggestions à afficher
  const isEmpty = messages.length <= 1;
  const lastIntent = !isEmpty
    ? messages.slice().reverse().find(m => m.role === "assistant" && m.intent)?.intent
    : null;
  const contextualSuggestions = lastIntent
    ? (CONTEXTUAL_SUGGESTIONS[lastIntent] || CONTEXTUAL_SUGGESTIONS.default)
    : null;

  // Met à jour le dernier message assistant en cours de streaming.
  const majDernier = (patch) =>
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (!last || last.role !== "assistant") return prev;
      copy[copy.length - 1] = typeof patch === "function" ? patch(last) : { ...last, ...patch };
      return copy;
    });

  // Flux du chatbot SQL : « data: {intent,data} » puis « data: {chunk} ».
  async function streamSQL(q, history, ctrl) {
    const appel = () =>
      fetch(`${CHAT_API}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history }),
        signal: ctrl.signal,
      });

    // Le chatbot SQL peut être en cold start (~5-10 s). On patiente et on
    // réessaie une fois plutôt que d'échouer, comme pour le RAG.
    let res = await appel();
    if (!res.ok) {
      majDernier({ content: "Un instant, je me réveille…" });
      await new Promise((r) => setTimeout(r, 3500));
      res = await appel();
      majDernier({ content: "" });
    }
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
        const line = part.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") break;
        try {
          const ev = JSON.parse(payload);
          if (ev.intent !== undefined) {
            majDernier((last) => ({ ...last, data: ev.data || [], intent: ev.intent }));
          } else if (ev.replace !== undefined) {
            majDernier({ content: ev.replace });
          } else if (ev.chunk !== undefined) {
            majDernier((last) => ({ ...last, content: (last.content || "") + ev.chunk }));
          }
        } catch { /* payload malformé ignoré */ }
      }
    }
  }

  // Flux du RAG : « event: sources|token|done ». Pas de cartes (data reste vide),
  // la réponse s'affiche en prose. On marque le message pour l'accusé de source.
  async function streamRAG(q, history, ctrl) {
    majDernier({ intent: "juridique", data: [] });

    // Le service RAG peut être en train de démarrer (cold start ~1 min). Plutôt
    // qu'une erreur, on patiente et on réessaie une fois, en le disant.
    const appel = () =>
      fetch(`${RAG_API}/api/v1/rag/query/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history }),
        signal: ctrl.signal,
      });

    let res = await appel();
    if (!res.ok) {
      majDernier({ content: "L'assistant juridique se réveille, un instant…" });
      await new Promise((r) => setTimeout(r, 4000));
      res = await appel();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      majDernier({ content: "" }); // effacer le message d'attente avant les tokens
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let evName = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        for (const line of part.split("\n")) {
          if (line.startsWith("event:")) {
            evName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const payload = line.slice(5).trim();
            try {
              const ev = JSON.parse(payload);
              if (evName === "token" && ev.text) {
                majDernier((last) => ({ ...last, content: (last.content || "") + ev.text }));
              } else if (evName === "sources" && Array.isArray(ev.sources)) {
                // Types de sources renvoyés, pour l'accusé de fiabilité (outil / droit).
                const types = [...new Set(ev.sources.map((s) => s.type).filter(Boolean))];
                majDernier((last) => ({ ...last, sourceTypes: types }));
              }
            } catch { /* payload malformé ignoré */ }
          }
        }
      }
    }
  }

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

    // Observabilité : on note quel cerveau a répondu et en combien de temps.
    // Fire-and-forget en fin d'échange — un log raté ne gêne jamais l'utilisateur.
    const route = estJuridique(q) ? "rag" : "sql";
    const t0 = Date.now();
    let ok = true;

    try {
      const history = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content || "" }));

      // Aiguillage : juridique/conseil → RAG 1,5 B ; donnée commune → SQL.
      if (route === "rag") {
        await streamRAG(q, history, ctrl);
      } else {
        await streamSQL(q, history, ctrl);
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        ok = false;
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: "Désolé, une erreur est survenue. Veuillez réessayer.", streaming: false };
          return copy;
        });
      }
    } finally {
      fetch(`${RAG_API}/api/v1/chat/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, route, latency_ms: Date.now() - t0, ok }),
      }).catch(() => {});
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
