package handlers

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// Observabilité du chatbot : une ligne par question posée, avec le cerveau qui a
// répondu et la latence perçue côté client. Le frontend l'appelle en
// fire-and-forget après chaque réponse — on vole sinon à l'aveugle, incapables
// de savoir ce que les utilisateurs demandent ni ce qui échoue.
//
// L'écriture est volontairement tolérante : un log raté ne doit jamais gêner
// l'utilisateur. Les entrées de plus de 30 jours sont purgées (voir
// purge_chat_logs), pour ne pas peser sur le plafond gratuit de la base.

type ChatLogRequest struct {
	Question  string `json:"question"`
	Route     string `json:"route"`     // "sql" | "rag"
	Intent    string `json:"intent"`    // optionnel
	LatencyMs int    `json:"latency_ms"`
	Ok        *bool  `json:"ok"`
}

// PostChatLog handles POST /api/v1/chat/log
func PostChatLog(c *gin.Context) {
	var req ChatLogRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Question == "" {
		c.Status(http.StatusNoContent) // on n'ennuie pas le client pour un log
		return
	}

	// Bornes défensives : c'est un endpoint public, on limite ce qu'on stocke.
	if len(req.Question) > 500 {
		req.Question = req.Question[:500]
	}
	if req.Route != "sql" && req.Route != "rag" {
		req.Route = "inconnu"
	}
	ok := true
	if req.Ok != nil {
		ok = *req.Ok
	}
	var intent any
	if req.Intent != "" {
		intent = req.Intent
	}

	_, _ = db.Pool.Exec(context.Background(), `
		INSERT INTO chat_logs (question, route, intent, latency_ms, ok)
		VALUES ($1, $2, $3, $4, $5)
	`, req.Question, req.Route, intent, req.LatencyMs, ok)

	c.Status(http.StatusNoContent)
}
