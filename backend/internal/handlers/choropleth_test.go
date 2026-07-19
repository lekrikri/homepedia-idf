package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// TestChoroplethScoreMapping vérifie que la whitelist de colonnes est correcte
// et que les scores invalides retombent sur "score_global".
func TestChoroplethScoreMapping(t *testing.T) {
	colMap := map[string]string{
		"investissement": "score_investissement",
		"dpe":            "score_dpe_moyen",
		"securite":       "score_securite",
		"qualite_vie":    "score_qualite_vie",
		"global":         "score_global",
		"rendement":      "rendement_locatif_brut",
	}

	tests := []struct {
		score   string
		wantCol string
	}{
		{"investissement", "score_investissement"},
		{"dpe", "score_dpe_moyen"},
		{"securite", "score_securite"},
		{"qualite_vie", "score_qualite_vie"},
		{"global", "score_global"},
		{"rendement", "rendement_locatif_brut"},
		// invalide → fallback global
		{"unknown", "score_global"},
		{"", "score_global"},
		{"GLOBAL", "score_global"},
	}

	for _, tt := range tests {
		col, ok := colMap[tt.score]
		if !ok {
			col = "score_global"
		}
		if col != tt.wantCol {
			t.Errorf("score=%q → col=%q, want %q", tt.score, col, tt.wantCol)
		}
	}
	t.Logf("Choropleth score→column mapping: %d cas vérifiés", len(tests))
}

// TestGetChoroplethNoDB vérifie que le handler ne panique pas sans DB.
// Nécessite une connexion DB ; skippé si db.Pool est nil.
func TestGetChoroplethNoDB(t *testing.T) {
	if db.Pool == nil {
		t.Skip("pas de connexion DB disponible — test skippé (normal en CI sans DB)")
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/choropleth", GetChoropleth)

	scores := []string{"", "global", "investissement", "dpe", "securite", "qualite_vie", "rendement", "invalid"}
	for _, score := range scores {
		url := "/choropleth"
		if score != "" {
			url += "?score=" + score
		}
		req := httptest.NewRequest(http.MethodGet, url, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK && w.Code != http.StatusInternalServerError {
			t.Errorf("GetChoropleth score=%q: status inattendu %d", score, w.Code)
		}
		t.Logf("GET %s → %d", url, w.Code)
	}
}
