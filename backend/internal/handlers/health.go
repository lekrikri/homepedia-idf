package handlers

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// ServiceStatus holds the reachability status for a dependency.
type ServiceStatus struct {
	Status  string `json:"status"`
	Host    string `json:"host,omitempty"`
	Latency string `json:"latency_ms,omitempty"`
}

// HealthResponse is the shape of the /api/v1/health response body.
type HealthResponse struct {
	Status   string                   `json:"status"`
	Services map[string]ServiceStatus `json:"services"`
}

// HealthCheck handles GET /api/v1/health.
// Performs a real ping to PostgreSQL; other services are reported as "configured".
func HealthCheck(c *gin.Context) {
	pgStatus := pingPostgres()

	services := map[string]ServiceStatus{
		"postgres":  pgStatus,
		"redis":     {Status: "configured", Host: hostFromEnv("REDIS_HOST", "REDIS_PORT", "6379")},
		"chromadb":  {Status: "configured", Host: hostFromEnv("CHROMADB_HOST", "CHROMADB_PORT", "8000")},
		"mongodb":   {Status: mongoStatus()},
	}

	overall := "ok"
	if pgStatus.Status != "ok" {
		overall = "degraded"
	}

	c.JSON(http.StatusOK, HealthResponse{
		Status:   overall,
		Services: services,
	})
}

func pingPostgres() ServiceStatus {
	host := hostFromEnv("POSTGRES_HOST", "POSTGRES_PORT", "5432")
	if db.Pool == nil {
		return ServiceStatus{Status: "not connected", Host: host}
	}
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := db.Pool.Ping(ctx); err != nil {
		return ServiceStatus{Status: "unreachable", Host: host}
	}
	latency := time.Since(start).Milliseconds()
	return ServiceStatus{
		Status:  "ok",
		Host:    host,
		Latency: fmt.Sprintf("%d", latency),
	}
}

func mongoStatus() string {
	if os.Getenv("MONGODB_URI") == "" {
		return "not configured"
	}
	return "configured"
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
