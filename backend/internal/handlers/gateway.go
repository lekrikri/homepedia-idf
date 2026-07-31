package handlers

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// Gateway de conversation : un unique endpoint /api/v1/chat qui décide côté
// serveur quel cerveau répond (données de commune via le chatbot SQL, ou droit
// du logement via le RAG), proxifie son flux et le NORMALISE en un seul format
// SSE (meta / token / done). Le frontend n'a plus à connaître les deux services
// ni leurs formats — il consomme un flux unique.
//
// Le routage vivait auparavant dans le navigateur (regex JavaScript) : le
// déplacer ici le rend testable, journalisable et modifiable sans redéployer le
// frontend.

// juridiqueRE reconnaît une question de droit du logement / conseil (portée
// depuis le classifieur frontend). Un mot-clé juridique bascule vers le RAG ;
// sinon la question va au chatbot SQL et ses cartes. Les termes retenus
// n'apparaissent pas dans une demande de donnée commune.
var juridiqueRE = regexp.MustCompile(`(?i)\b(preavis|conge|bail|baux|caution|depot de garantie|garant|encadr|quittance|etat des lieux|vetuste|notaire|compromis|retractation|carrez|boutin|syndic|copropriete|\bapl\b|\bcaf\b|visale|maprimerenov|renov|\baides?\b|passoire|classe [fg]\b|expuls|treve|colocation|sous.location|honoraires|decence|decent|resiliation|indemnite|dalo|\bhlm\b|preemption|servitude|indivision|succession|\bsci\b|pinel|deficit foncier|\birl\b|logement (meuble|vide|nu|decent|insalubre)|plus.value|permis de construire|declaration prealable|\bptz\b|litige|conciliation|zone tendue|emprunt|capacite d.emprunt|frais de notaire|credit immobilier|augment|hausse|revis|loyer.{0,20}(correct|abusif|trop|plafond|maxim|\bmax\b|legal)|puis.je|ai.?je le droit|dois.je|le droit de|peut.il m|obligation|comment (resilier|contester|obtenir|declarer|calculer|financer|reviser|augmenter))`)

var accentsRemplacement = strings.NewReplacer(
	"à", "a", "â", "a", "ä", "a", "é", "e", "è", "e", "ê", "e", "ë", "e",
	"î", "i", "ï", "i", "ô", "o", "ö", "o", "ù", "u", "û", "u", "ü", "u", "ç", "c",
	"À", "a", "É", "e", "È", "e", "Ê", "e",
)

func estJuridique(question string) bool {
	return juridiqueRE.MatchString(accentsRemplacement.Replace(strings.ToLower(question)))
}

func chatServiceURL() string {
	if u := os.Getenv("CHAT_SERVICE_URL"); u != "" {
		return u
	}
	return "http://localhost:5001"
}

type GatewayRequest struct {
	Question string        `json:"question"`
	History  []ChatMessage `json:"history"`
}

// ChatGateway handles POST /api/v1/chat
func ChatGateway(c *gin.Context) {
	var req GatewayRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Question) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "question requise"})
		return
	}

	route := "sql"
	if estJuridique(req.Question) {
		route = "rag"
	}

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming non supporté"})
		return
	}

	t0 := time.Now()
	var upstreamOk bool
	if route == "rag" {
		upstreamOk = proxyRAGNormalise(c, req, flusher)
	} else {
		upstreamOk = proxySQLNormalise(c, req, flusher)
	}

	logGateway(req.Question, route, int(time.Since(t0).Milliseconds()), upstreamOk)
}

// emitSSE écrit un évènement normalisé (meta / token / done) vers le client.
func emitSSE(c *gin.Context, flusher http.Flusher, event string, payload any) {
	data, _ := json.Marshal(payload)
	c.Writer.Write([]byte("event: " + event + "\ndata: "))
	c.Writer.Write(data)
	c.Writer.Write([]byte("\n\n"))
	flusher.Flush()
}

// proxyRAGNormalise relaie le RAG (event: sources|token|done) en normalisant.
func proxyRAGNormalise(c *gin.Context, req GatewayRequest, flusher http.Flusher) bool {
	body, _ := json.Marshal(map[string]any{"question": req.Question, "history": req.History})
	resp, err := postStream(c.Request.Context(), ragServiceURL()+"/rag/query/stream", body)
	if err != nil {
		emitSSE(c, flusher, "error", gin.H{"error": "assistant juridique indisponible"})
		return false
	}
	defer resp.Body.Close()

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var evName string
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "event:") {
			evName = strings.TrimSpace(line[6:])
		} else if strings.HasPrefix(line, "data:") {
			raw := strings.TrimSpace(line[5:])
			switch evName {
			case "sources":
				var d struct {
					Sources []struct {
						Type string `json:"type"`
					} `json:"sources"`
				}
				if json.Unmarshal([]byte(raw), &d) == nil {
					types := map[string]bool{}
					var uniq []string
					for _, s := range d.Sources {
						if s.Type != "" && !types[s.Type] {
							types[s.Type] = true
							uniq = append(uniq, s.Type)
						}
					}
					emitSSE(c, flusher, "meta", gin.H{"route": "rag", "sourceTypes": uniq})
				}
			case "token":
				var d struct {
					Text string `json:"text"`
				}
				if json.Unmarshal([]byte(raw), &d) == nil && d.Text != "" {
					emitSSE(c, flusher, "token", gin.H{"text": d.Text})
				}
			case "done":
				emitSSE(c, flusher, "done", gin.H{})
			}
		}
	}
	return true
}

// proxySQLNormalise relaie le chatbot SQL (data: {intent,data} puis {chunk}).
func proxySQLNormalise(c *gin.Context, req GatewayRequest, flusher http.Flusher) bool {
	body, _ := json.Marshal(map[string]any{"question": req.Question, "history": req.History})
	resp, err := postStream(c.Request.Context(), chatServiceURL()+"/chat/stream", body)
	if err != nil {
		emitSSE(c, flusher, "error", gin.H{"error": "assistant données indisponible"})
		return false
	}
	defer resp.Body.Close()

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		raw := strings.TrimSpace(line[5:])
		if raw == "[DONE]" {
			emitSSE(c, flusher, "done", gin.H{})
			continue
		}
		var ev map[string]json.RawMessage
		if json.Unmarshal([]byte(raw), &ev) != nil {
			continue
		}
		if _, hasIntent := ev["intent"]; hasIntent {
			var meta struct {
				Intent string        `json:"intent"`
				Data   []any         `json:"data"`
			}
			json.Unmarshal([]byte(raw), &meta)
			emitSSE(c, flusher, "meta", gin.H{"route": "sql", "intent": meta.Intent, "data": meta.Data})
		} else if chunk, ok := ev["chunk"]; ok {
			var text string
			json.Unmarshal(chunk, &text)
			emitSSE(c, flusher, "token", gin.H{"text": text})
		} else if replace, ok := ev["replace"]; ok {
			var text string
			json.Unmarshal(replace, &text)
			emitSSE(c, flusher, "replace", gin.H{"text": text})
		}
	}
	return true
}

// postStream ouvre un POST en streaming vers un service amont (sans timeout : le
// flux peut durer ; le contexte de la requête cliente pilote l'annulation).
func postStream(ctx context.Context, url string, body []byte) (*http.Response, error) {
	client := &http.Client{Timeout: 0}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewBuffer(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	return client.Do(httpReq)
}

// logGateway journalise l'échange (observabilité), sans jamais gêner la réponse.
func logGateway(question, route string, latencyMs int, ok bool) {
	if len(question) > 500 {
		question = question[:500]
	}
	_, _ = db.Pool.Exec(context.Background(),
		`INSERT INTO chat_logs (question, route, latency_ms, ok) VALUES ($1, $2, $3, $4)`,
		question, route, latencyMs, ok)
}
