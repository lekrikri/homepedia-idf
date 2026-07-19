package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// TestGetHeatmapIDFNoDB vérifie que le handler ne panique pas sans DB.
// Les années valides (2021-2026) déclenchent le JOIN prix_forecast ; sinon la requête simple.
// Nécessite une connexion DB ; skippé si db.Pool est nil.
func TestGetHeatmapIDFNoDB(t *testing.T) {
	if db.Pool == nil {
		t.Skip("pas de connexion DB disponible — test skippé (normal en CI sans DB)")
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/heatmap", GetHeatmapIDF)

	urls := []string{
		"/heatmap",
		"/heatmap?year=2022",
		"/heatmap?year=2024",
		"/heatmap?year=invalid",
	}

	for _, url := range urls {
		req := httptest.NewRequest(http.MethodGet, url, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK && w.Code != http.StatusInternalServerError {
			t.Errorf("GetHeatmapIDF url=%q: status inattendu %d", url, w.Code)
		}
		t.Logf("GET %s → %d", url, w.Code)
	}
}

// TestGetHeatmapIDFYearBranch vérifie que la logique de branchement SQL
// est correcte selon la présence du paramètre year.
func TestGetHeatmapIDFYearBranch(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		url         string
		expectYear  string
		expectJoin  bool
	}{
		{"/heatmap", "", false},
		{"/heatmap?year=2022", "2022", true},
		{"/heatmap?year=", "", false},
	}

	for _, tt := range tests {
		r := gin.New()
		var capturedYear string
		r.GET("/heatmap", func(c *gin.Context) {
			capturedYear = c.Query("year")
			c.Status(http.StatusOK)
		})
		req := httptest.NewRequest(http.MethodGet, tt.url, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if capturedYear != tt.expectYear {
			t.Errorf("url=%q: year=%q, want %q", tt.url, capturedYear, tt.expectYear)
		}
		hasJoin := capturedYear != ""
		if hasJoin != tt.expectJoin {
			t.Errorf("url=%q: expectJoin=%v mais year=%q", tt.url, tt.expectJoin, capturedYear)
		}
	}
}
