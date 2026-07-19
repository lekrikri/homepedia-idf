package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// ── costingAllowed whitelist ───────────────────────────────────────────────────

func TestCostingAllowed(t *testing.T) {
	tests := []struct {
		mode    string
		allowed bool
	}{
		{"pedestrian", true},
		{"auto", true},
		{"bicycle", true},
		// modes invalides
		{"boat", false},
		{"", false},
		{"PEDESTRIAN", false},
		{"car", false},
		{"transit", false},
	}
	for _, tt := range tests {
		got := costingAllowed[tt.mode]
		if got != tt.allowed {
			t.Errorf("costingAllowed[%q] = %v, want %v", tt.mode, got, tt.allowed)
		}
	}
}

// ── profilesAllowed whitelist (ORS) ──────────────────────────────────────────

func TestProfilesAllowed(t *testing.T) {
	tests := []struct {
		profile string
		allowed bool
	}{
		{"driving-car", true},
		{"foot-walking", true},
		{"cycling-regular", true},
		{"boat", false},
		{"", false},
		{"auto", false},
	}
	for _, tt := range tests {
		got := profilesAllowed[tt.profile]
		if got != tt.allowed {
			t.Errorf("profilesAllowed[%q] = %v, want %v", tt.profile, got, tt.allowed)
		}
	}
}

// ── GetIsochroneTransit — paramètres invalides ────────────────────────────────
// Ces tests appellent Valhalla (externe) puis le fallback haversine (DB).
// Skippés si db.Pool est nil pour éviter la panic nil-pointer sur pgxpool.

func TestGetIsochroneTransitInvalidCoords(t *testing.T) {
	if db.Pool == nil {
		t.Skip("pas de connexion DB disponible (fallback haversine) — test skippé")
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/isochrone/transit", GetIsochroneTransit)

	// Coordonnées invalides (non parsables) → ParseFloat retourne 0,0 (Paris)
	// Le handler ne doit pas crasher avec 500 ; soit 200 (haversine/valhalla) soit autre
	req := httptest.NewRequest(http.MethodGet, "/isochrone/transit?minutes=30&lon=abc&lat=xyz", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code == http.StatusInternalServerError {
		t.Errorf("GetIsochroneTransit a crashé (500) sur des coordonnées invalides")
	}
	t.Logf("Status avec coordonnées invalides: %d", w.Code)
}

func TestGetIsochroneTransitDefaultParams(t *testing.T) {
	if db.Pool == nil {
		t.Skip("pas de connexion DB disponible (fallback haversine) — test skippé")
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/isochrone/transit", GetIsochroneTransit)

	// Sans paramètres → valeurs par défaut (lon=2.3488 lat=48.8566 minutes=30 mode=pedestrian)
	req := httptest.NewRequest(http.MethodGet, "/isochrone/transit", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code == http.StatusInternalServerError {
		t.Errorf("GetIsochroneTransit a crashé (500) sans paramètres")
	}
	t.Logf("Status sans paramètres: %d", w.Code)
}

func TestGetIsochroneTransitBadMinutes(t *testing.T) {
	if db.Pool == nil {
		t.Skip("pas de connexion DB disponible (fallback haversine) — test skippé")
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/isochrone/transit", GetIsochroneTransit)

	// minutes=9999 → clampé à 30 par le handler
	req := httptest.NewRequest(http.MethodGet,
		"/isochrone/transit?minutes=9999&lon=2.3488&lat=48.8566", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code == http.StatusInternalServerError {
		t.Errorf("GetIsochroneTransit a crashé (500) avec minutes=9999")
	}
}

// ── GetIsochrone — sans clé ORS ───────────────────────────────────────────────
// Ces tests n'utilisent pas la DB (ORS_API_KEY absent → retour immédiat).

func TestGetIsochroneNoAPIKey(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// S'assurer qu'aucune clé n'est définie
	t.Setenv("ORS_API_KEY", "")

	r := gin.New()
	r.GET("/isochrone", GetIsochrone)

	req := httptest.NewRequest(http.MethodGet, "/isochrone?lat=48.85&lon=2.35&minutes=30", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Sans clé ORS → 200 avec fallback:true
	if w.Code != http.StatusOK {
		t.Errorf("GetIsochrone sans clé ORS: status = %d, want 200", w.Code)
	}
	body := w.Body.String()
	if body == "" {
		t.Error("GetIsochrone sans clé ORS: body vide")
	}
	t.Logf("GetIsochrone fallback body: %s", body)
}

func TestGetIsochroneMissingCoords(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("ORS_API_KEY", "fake-key-for-test")

	r := gin.New()
	r.GET("/isochrone", GetIsochrone)

	// Coordonnées manquantes → 400
	req := httptest.NewRequest(http.MethodGet, "/isochrone?minutes=30", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("GetIsochrone sans coords: status = %d, want 400", w.Code)
	}
}
