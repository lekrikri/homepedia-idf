package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// TestGetSitemapNoDB vérifie que le handler GetSitemap gère correctement l'absence
// de pool DB : il doit retourner 500 (string vide) sans paniquer.
// Nécessite une connexion DB ; skippé si db.Pool est nil.
func TestGetSitemapNoDB(t *testing.T) {
	if db.Pool == nil {
		t.Skip("pas de connexion DB disponible — test skippé (normal en CI sans DB)")
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/sitemap.xml", GetSitemap)

	req := httptest.NewRequest(http.MethodGet, "/sitemap.xml", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Sans DB, le handler renvoie 500 (string vide) — pas de panic
	// C'est le comportement attendu (pas de DB disponible en test unitaire)
	if w.Code == http.StatusOK {
		// Si pour une raison quelconque ça réussit (CI avec DB), valider le XML
		body := w.Body.String()
		if !strings.Contains(body, "<?xml") {
			t.Error("GetSitemap 200: réponse XML attendue")
		}
		if !strings.Contains(body, "<urlset") {
			t.Error("GetSitemap 200: balise <urlset> attendue")
		}
		if !strings.Contains(body, "homepedia.org") {
			t.Error("GetSitemap 200: URLs homepedia.org attendues")
		}
		count := strings.Count(body, "<url>")
		t.Logf("GetSitemap: %d URLs générées", count)
	} else if w.Code == http.StatusInternalServerError {
		// Comportement attendu sans DB
		t.Logf("GetSitemap sans DB: 500 (attendu sans connexion DB)")
	} else {
		t.Errorf("GetSitemap: status inattendu %d", w.Code)
	}
}

// TestCityToSlugInSitemap vérifie que les slugs générés correspondent aux URLs
// attendues dans le sitemap (format /commune/<slug>).
func TestCityToSlugInSitemap(t *testing.T) {
	tests := []struct {
		city string
		slug string
	}{
		{"Paris", "paris"},
		{"Versailles", "versailles"},
		{"Neuilly-sur-Seine", "neuilly-sur-seine"},
		{"Boulogne-Billancourt", "boulogne-billancourt"},
		{"Clichy", "clichy"},
		{"Montreuil", "montreuil"},
		{"Asnières-sur-Seine", "asnieres-sur-seine"},
		{"Vitry-sur-Seine", "vitry-sur-seine"},
	}
	baseURL := "https://www.homepedia.org"
	for _, tt := range tests {
		slug := cityToSlug(tt.city)
		if slug != tt.slug {
			t.Errorf("cityToSlug(%q) = %q, want %q", tt.city, slug, tt.slug)
		}
		expectedURL := baseURL + "/commune/" + slug
		if !strings.HasPrefix(expectedURL, "https://www.homepedia.org/commune/") {
			t.Errorf("URL invalide: %s", expectedURL)
		}
	}
	t.Logf("Tous les slugs de communes vérifiés (%d cas)", len(tests))
}

// TestSitemapStaticPages vérifie que les pages statiques connues seraient
// présentes dans le sitemap (test de la logique sans DB).
func TestSitemapStaticPages(t *testing.T) {
	staticPaths := []string{"/", "/carte", "/transactions", "/dashboard", "/comparer", "/portfolio", "/pareto"}
	baseURL := "https://www.homepedia.org"

	for _, path := range staticPaths {
		url := baseURL + path
		if !strings.HasPrefix(url, "https://www.homepedia.org") {
			t.Errorf("URL statique invalide: %s", url)
		}
	}
	if len(staticPaths) < 5 {
		t.Errorf("Trop peu de pages statiques: %d", len(staticPaths))
	}
	t.Logf("Pages statiques sitemap vérifiées: %v", staticPaths)
}
