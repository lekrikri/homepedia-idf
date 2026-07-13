package middleware

import (
	"time"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// Audit enregistre les requêtes sensibles dans la table audit_logs (RGPD).
// Routes ciblées : auth, rag/query, tout ce qui porte un JWT.
// La table est purgée automatiquement via pg_cron (cf. migration SQL).
func Audit() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		// Ne loguer que les requêtes authentifiées ou sensibles (RAG, auth)
		path := c.FullPath()
		if path == "" {
			return
		}
		sensitive := false
		for _, p := range []string{"/api/v1/auth/", "/api/v1/rag/"} {
			if len(path) >= len(p) && path[:len(p)] == p {
				sensitive = true
				break
			}
		}
		if !sensitive {
			return
		}

		userID := c.GetString("user_id") // injecté par Auth() middleware si JWT valide
		ip := c.ClientIP()
		method := c.Request.Method
		status := c.Writer.Status()

		ctx := c.Request.Context()
		if db.Pool == nil {
			return
		}
		_, _ = db.Pool.Exec(ctx, `
			INSERT INTO audit_logs (user_id, ip, method, path, status, created_at)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, nullStr(userID), ip, method, path, status, time.Now().UTC())
	}
}

func nullStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
