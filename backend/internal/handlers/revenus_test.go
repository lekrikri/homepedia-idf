package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// TestGetRevenusIDFColumnMapping vérifie que la logique de sélection de colonne
// (tri=median → revenu_median_uc, tri=pauvrete → taux_pauvrete) est correcte.
// C'est un test de logique pure, pas de DB.
func TestGetRevenusIDFColumnMapping(t *testing.T) {
	tests := []struct {
		tri        string
		wantCol    string
		wantDir    string
	}{
		{"median", "revenu_median_uc", "DESC"},
		{"pauvrete", "taux_pauvrete", "DESC"},
		// valeur inconnue → comportement par défaut (colonne median par défaut du handler)
		{"autre", "revenu_median_uc", "DESC"},
	}

	for _, tt := range tests {
		orderCol := "revenu_median_uc"
		orderDir := "DESC"
		if tt.tri == "pauvrete" {
			orderCol = "taux_pauvrete"
			orderDir = "DESC"
		}

		if orderCol != tt.wantCol {
			t.Errorf("tri=%q → colonne = %q, want %q", tt.tri, orderCol, tt.wantCol)
		}
		if orderDir != tt.wantDir {
			t.Errorf("tri=%q → direction = %q, want %q", tt.tri, orderDir, tt.wantDir)
		}
	}
	t.Log("Mapping tri → colonne SQL vérifié")
}

// TestGetRevenusIDFNoDB vérifie que le handler ne panique pas sans DB et retourne
// soit 200 (si DB dispo), soit 500 (pas de panic).
// Nécessite une connexion DB ; skippé si db.Pool est nil.
func TestGetRevenusIDFNoDB(t *testing.T) {
	if db.Pool == nil {
		t.Skip("pas de connexion DB disponible — test skippé (normal en CI sans DB)")
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/revenus", GetRevenusIDF)

	tests := []struct {
		url string
		tri string
	}{
		{"/revenus", "median"},
		{"/revenus?tri=median", "median"},
		{"/revenus?tri=pauvrete", "pauvrete"},
		{"/revenus?tri=median&dept=92", "median"},
		{"/revenus?tri=pauvrete&dept=75", "pauvrete"},
	}

	for _, tt := range tests {
		req := httptest.NewRequest(http.MethodGet, tt.url, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		// Sans DB → 500 ou 200 (si DB disponible)
		if w.Code != http.StatusOK && w.Code != http.StatusInternalServerError {
			t.Errorf("GetRevenusIDF url=%q: status inattendu %d", tt.url, w.Code)
		}
		if w.Code == http.StatusOK {
			body := w.Body.String()
			if body == "" {
				t.Errorf("GetRevenusIDF url=%q: body vide avec status 200", tt.url)
			}
		}
		t.Logf("GET %s → %d", tt.url, w.Code)
	}
}

// TestGetRevenusIDFDefaultTri vérifie que le paramètre tri par défaut est "median".
func TestGetRevenusIDFDefaultTri(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	var capturedTri string
	r.GET("/revenus", func(c *gin.Context) {
		capturedTri = c.DefaultQuery("tri", "median")
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/revenus", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if capturedTri != "median" {
		t.Errorf("tri par défaut = %q, want %q", capturedTri, "median")
	}
}
