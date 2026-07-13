package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/cache"
	"homepedia/backend/internal/db"
)

// GetPOI handles GET /api/v1/poi/:code
// Retourne les POI pré-ingérés (transport, sécurité, restaurants, écoles, parcs, commerces).
// Cache L1 : RAM Go (TTL 1h) — 0 requête DB au warm hit, résiste aux cold starts via L2
// Cache L2 : Supabase JSONB — persistant, data fraîchie 1x/mois par ingest_poi.py
// Si commune absente : retourne des listes vides (jamais 404 côté client)
func GetPOI(c *gin.Context) {
	code := c.Param("code")
	cacheKey := "poi:" + code

	// L1 — RAM Go (chaud après le 1er hit, survit 1h)
	if data, ok := cache.Global.Get(cacheKey); ok {
		c.Data(http.StatusOK, "application/json; charset=utf-8", data)
		return
	}

	// L2 — Supabase JSONB
	var rawJSON []byte
	var updatedAt time.Time
	err := db.Pool.QueryRow(
		c.Request.Context(),
		"SELECT data, updated_at FROM poi_communes WHERE code_commune = $1",
		code,
	).Scan(&rawJSON, &updatedAt)

	if err != nil {
		// Commune pas encore ingérée → listes vides (0 marqueurs côté carte)
		c.JSON(http.StatusOK, gin.H{
			"transports":  []any{},
			"security":    []any{},
			"restaurants": []any{},
			"schools":     []any{},
			"parks":       []any{},
			"shops":       []any{},
		})
		return
	}

	// ETag basé sur updated_at — permet au navigateur de faire un 304 Not Modified
	etag := `"poi-` + updatedAt.Format("20060102150405") + `"`
	if c.GetHeader("If-None-Match") == etag {
		c.Status(http.StatusNotModified)
		return
	}
	c.Header("ETag", etag)

	// Stocker en L1 pour les prochains hits
	cache.Global.Set(cacheKey, rawJSON, time.Hour)
	c.Data(http.StatusOK, "application/json; charset=utf-8", rawJSON)
}
