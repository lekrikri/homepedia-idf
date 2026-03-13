package handlers

import (
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

// ServiceStatus holds the reachability status for a dependency.
type ServiceStatus struct {
	Status string `json:"status"`
	Host   string `json:"host,omitempty"`
}

// HealthResponse is the shape of the /api/v1/health response body.
type HealthResponse struct {
	Status   string                   `json:"status"`
	Services map[string]ServiceStatus `json:"services"`
}

// HealthCheck handles GET /api/v1/health.
// It returns a lightweight status payload without actually pinging every
// dependency — deep connectivity checks belong in dedicated readiness probes.
func HealthCheck(c *gin.Context) {
	services := map[string]ServiceStatus{
		"postgres": {
			Status: "configured",
			Host:   hostFromEnv("POSTGRES_HOST", "POSTGRES_PORT", "5432"),
		},
		"redis": {
			Status: "configured",
			Host:   hostFromEnv("REDIS_HOST", "REDIS_PORT", "6379"),
		},
		"chromadb": {
			Status: "configured",
			Host:   hostFromEnv("CHROMADB_HOST", "CHROMADB_PORT", "8000"),
		},
		"mongodb": {
			Status: "configured",
			Host:   mongoHost(),
		},
	}

	c.JSON(http.StatusOK, HealthResponse{
		Status:   "ok",
		Services: services,
	})
}

// mongoHost reads MONGODB_URI from env and returns a sanitized host label (no credentials).
func mongoHost() string {
	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		return "atlas (not configured)"
	}
	return "atlas (configured)"
}

// hostFromEnv builds a "host:port" string from environment variables with fallback defaults.
func hostFromEnv(hostKey, portKey, defaultPort string) string {
	host := os.Getenv(hostKey)
	if host == "" {
		host = "localhost"
	}
	port := os.Getenv(portKey)
	if port == "" {
		port = defaultPort
	}
	return host + ":" + port
}
