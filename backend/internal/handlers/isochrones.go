package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// profilesAllowed liste les profils ORS acceptés.
var profilesAllowed = map[string]bool{
	"driving-car":      true,
	"foot-walking":     true,
	"cycling-regular":  true,
}

// GetIsochrone — GET /api/v1/isochrone?lat=48.85&lon=2.35&minutes=30&profile=driving-car
// Proxy transparent vers l'API ORS (OpenRouteService).
func GetIsochrone(c *gin.Context) {
	apiKey := os.Getenv("ORS_API_KEY")
	if apiKey == "" {
		c.JSON(http.StatusOK, gin.H{
			"error":    "ORS_API_KEY not configured",
			"fallback": true,
		})
		return
	}

	// --- Paramètres ---
	latStr := c.Query("lat")
	lonStr := c.Query("lon")
	minutesStr := c.DefaultQuery("minutes", "30")
	profile := c.DefaultQuery("profile", "driving-car")

	lat, errLat := strconv.ParseFloat(latStr, 64)
	lon, errLon := strconv.ParseFloat(lonStr, 64)
	if errLat != nil || errLon != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "lat et lon sont requis et doivent être des nombres"})
		return
	}

	minutes, err := strconv.Atoi(minutesStr)
	if err != nil || minutes < 5 || minutes > 60 {
		minutes = 30
	}

	if !profilesAllowed[profile] {
		profile = "driving-car"
	}

	// --- Body POST vers ORS ---
	body := map[string]interface{}{
		"locations":  [][]float64{{lon, lat}},
		"range":      []int{minutes * 60},
		"range_type": "time",
	}
	bodyBytes, _ := json.Marshal(body)

	// --- Requête HTTP vers ORS ---
	orsURL := fmt.Sprintf("https://api.openrouteservice.org/v2/isochrones/%s", profile)

	reqCtx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, orsURL, bytes.NewReader(bodyBytes))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"error": "ORS API error", "fallback": true})
		return
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"error": "ORS API error", "fallback": true})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusOK, gin.H{"error": "ORS API error", "fallback": true})
		return
	}

	// --- Proxy transparent du GeoJSON ---
	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"error": "ORS API error", "fallback": true})
		return
	}

	c.Data(http.StatusOK, "application/json; charset=utf-8", respBytes)
}
