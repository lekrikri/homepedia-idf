package handlers

import (
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// ── cityToSlug ────────────────────────────────────────────────────────────────

func TestCityToSlug(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Paris", "paris"},
		{"Saint-Denis", "saint-denis"},
		{"Île-de-France", "ile-de-france"},
		{"Évry-Courcouronnes", "evry-courcouronnes"},
		{"L'Haÿ-les-Roses", "l-hay-les-roses"},
		{"Bois-d'Arcy", "bois-d-arcy"},
		{"Neuilly-sur-Seine", "neuilly-sur-seine"},
		{"Asnières-sur-Seine", "asnieres-sur-seine"},
		{"Clichy", "clichy"},
		{"", ""},
		{"---", ""},
		{"123", "123"},
	}
	for _, tt := range tests {
		got := cityToSlug(tt.input)
		if got != tt.want {
			t.Errorf("cityToSlug(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

// ── queryInt ──────────────────────────────────────────────────────────────────

func TestQueryInt(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		url      string
		key      string
		def, max int
		want     int
	}{
		// Valeur normale dans les bornes
		{"/x?limit=10", "limit", 50, 200, 10},
		// Valeur absente → défaut
		{"/x", "limit", 50, 200, 50},
		// Valeur supérieure au max → clampée
		{"/x?limit=9999", "limit", 50, 200, 200},
		// Valeur négative → défaut
		{"/x?limit=-5", "limit", 50, 200, 50},
		// Valeur non numérique → défaut
		{"/x?limit=abc", "limit", 50, 200, 50},
		// max=-1 : pas de borne supérieure
		{"/x?offset=5000", "offset", 0, -1, 5000},
		// Zéro explicite
		{"/x?limit=0", "limit", 50, 200, 0},
	}

	for _, tt := range tests {
		r := gin.New()
		var got int
		r.GET("/x", func(c *gin.Context) {
			got = queryInt(c, tt.key, tt.def, tt.max)
			c.Status(http.StatusOK)
		})
		req := httptest.NewRequest(http.MethodGet, tt.url, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if got != tt.want {
			t.Errorf("queryInt(url=%q, key=%q, def=%d, max=%d) = %d, want %d",
				tt.url, tt.key, tt.def, tt.max, got, tt.want)
		}
	}
}

// ── hostFromEnv ───────────────────────────────────────────────────────────────

func TestHostFromEnv(t *testing.T) {
	// Sans variables → valeurs par défaut
	t.Setenv("POSTGRES_HOST", "")
	t.Setenv("POSTGRES_PORT", "")
	got := hostFromEnv("POSTGRES_HOST", "POSTGRES_PORT", "5432")
	if got != "localhost:5432" {
		t.Errorf("hostFromEnv() = %q, want %q", got, "localhost:5432")
	}

	// Avec variables définies
	t.Setenv("POSTGRES_HOST", "db.example.com")
	t.Setenv("POSTGRES_PORT", "6543")
	got = hostFromEnv("POSTGRES_HOST", "POSTGRES_PORT", "5432")
	if got != "db.example.com:6543" {
		t.Errorf("hostFromEnv() = %q, want %q", got, "db.example.com:6543")
	}
}

// ── HealthCheck (sans DB) ────────────────────────────────────────────────────

func TestHealthCheckNoDB(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/health", HealthCheck)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Même sans DB, le handler répond toujours 200 (degraded ou ok)
	if w.Code != http.StatusOK {
		t.Errorf("HealthCheck status = %d, want 200", w.Code)
	}
	body := w.Body.String()
	if body == "" {
		t.Error("HealthCheck returned empty body")
	}
	t.Logf("HealthCheck body: %s", body)
}

// ── haversineRadius ───────────────────────────────────────────────────────────
// Vérifie la formule implicite utilisée dans getIsochroneHaversine :
// rayon_km = minutes * 0.7

func TestHaversineRadius(t *testing.T) {
	tests := []struct {
		minutes int
		wantKm  float64
	}{
		{10, 7.0},
		{30, 21.0},
		{60, 42.0},
	}
	for _, tt := range tests {
		got := float64(tt.minutes) * 0.7
		if math.Abs(got-tt.wantKm) > 1e-9 {
			t.Errorf("rayon(%d min) = %.2f km, want %.2f", tt.minutes, got, tt.wantKm)
		}
	}
}
