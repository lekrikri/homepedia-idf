package handlers

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
)

// ChatMessage représente un message de l'historique (user ou assistant).
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// RAGRequest représente une question posée au chatbot RAG.
type RAGRequest struct {
	Question    string        `json:"question" binding:"required"`
	Departement *string       `json:"departement,omitempty"`
	TopK        *int          `json:"top_k,omitempty"`
	History     []ChatMessage `json:"history,omitempty"`
}

func ragServiceURL() string {
	url := os.Getenv("RAG_SERVICE_URL")
	if url == "" {
		url = "http://localhost:8002"
	}
	return url
}

// RAGQuery handles POST /api/v1/rag/query
// Proxyfie la requête vers le service RAG Python (réponse JSON complète).
func RAGQuery(c *gin.Context) {
	var req RAGRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	body, _ := json.Marshal(req)
	client := &http.Client{Timeout: 180 * time.Second}

	resp, err := client.Post(
		ragServiceURL()+"/rag/query",
		"application/json",
		bytes.NewBuffer(body),
	)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "RAG service indisponible"})
		return
	}
	defer resp.Body.Close()

	c.Status(resp.StatusCode)
	_, _ = io.Copy(c.Writer, resp.Body)
}

// RAGQueryStream handles POST /api/v1/rag/query/stream
// Proxyfie le streaming SSE du service RAG Python vers le client.
// Les tokens sont relayés au fur et à mesure, sans buffering.
func RAGQueryStream(c *gin.Context) {
	var req RAGRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	body, _ := json.Marshal(req)

	// Client sans timeout : le stream peut durer longtemps
	client := &http.Client{Timeout: 0}

	httpReq, err := http.NewRequestWithContext(
		c.Request.Context(),
		http.MethodPost,
		ragServiceURL()+"/rag/query/stream",
		bytes.NewBuffer(body),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := client.Do(httpReq)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "RAG service indisponible"})
		return
	}
	defer resp.Body.Close()

	// Headers SSE
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(resp.StatusCode)

	// Flusher pour envoyer chaque chunk immédiatement au client
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming non supporté"})
		return
	}

	// Lecture ligne par ligne et forward vers le client
	buf := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := c.Writer.Write(buf[:n]); werr != nil {
				return
			}
			flusher.Flush()
		}
		if err != nil {
			if err == io.EOF {
				return
			}
			return
		}
	}
}
