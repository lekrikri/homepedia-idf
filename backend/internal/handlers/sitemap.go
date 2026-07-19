package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"unicode"

	"github.com/gin-gonic/gin"
	"golang.org/x/text/unicode/norm"

	"homepedia/backend/internal/db"
)

func cityToSlug(city string) string {
	// Normaliser NFD pour enlever les accents
	t := norm.NFD.String(city)
	var b strings.Builder
	prev := '-'
	for _, r := range t {
		if unicode.Is(unicode.Mn, r) {
			continue // diacritique
		}
		r = unicode.ToLower(r)
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			prev = r
		} else if prev != '-' {
			b.WriteByte('-')
			prev = '-'
		}
	}
	s := b.String()
	return strings.Trim(s, "-")
}

// GetSitemap handles GET /sitemap.xml
// Génère un sitemap XML listant les pages statiques + les 1266 pages communes IDF.
func GetSitemap(c *gin.Context) {
	ctx := c.Request.Context()

	rows, err := db.Pool.Query(ctx, `
		SELECT city FROM communes_agregat
		WHERE city IS NOT NULL
		ORDER BY city
	`)
	if err != nil {
		c.String(http.StatusInternalServerError, "")
		return
	}
	defer rows.Close()

	baseURL := "https://www.homepedia.org"

	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8"?>`)
	sb.WriteString("\n")
	sb.WriteString(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`)
	sb.WriteString("\n")

	// Pages statiques
	for _, path := range []string{"/", "/carte", "/transactions", "/dashboard", "/comparer", "/portfolio", "/pareto"} {
		sb.WriteString(fmt.Sprintf("  <url><loc>%s%s</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>\n", baseURL, path))
	}

	// Pages communes
	for rows.Next() {
		var city string
		if err := rows.Scan(&city); err != nil {
			continue
		}
		slug := cityToSlug(city)
		if slug == "" {
			continue
		}
		sb.WriteString(fmt.Sprintf("  <url><loc>%s/commune/%s</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>\n", baseURL, slug))
	}

	sb.WriteString("</urlset>")

	c.Header("Content-Type", "application/xml; charset=utf-8")
	c.String(http.StatusOK, sb.String())
}
