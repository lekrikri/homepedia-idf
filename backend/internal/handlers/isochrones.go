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

	"homepedia/backend/internal/db"
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

// costingAllowed restreint les profils Valhalla acceptés.
var costingAllowed = map[string]bool{
	"pedestrian": true,
	"auto":       true,
	"bicycle":    true,
}

// GetIsochroneTransit — GET /api/v1/isochrone/transit?minutes=30&lon=2.3488&lat=48.8566&mode=pedestrian
// Isochrone via Valhalla OSM (instance publique, sans clé).
// Fallback haversine SQL si Valhalla indisponible.
func GetIsochroneTransit(c *gin.Context) {
	minutesStr := c.DefaultQuery("minutes", "30")
	lonStr := c.DefaultQuery("lon", "2.3488")
	latStr := c.DefaultQuery("lat", "48.8566")
	mode := c.DefaultQuery("mode", "pedestrian")

	minutes, _ := strconv.Atoi(minutesStr)
	if minutes <= 0 || minutes > 120 {
		minutes = 30
	}
	lon, _ := strconv.ParseFloat(lonStr, 64)
	lat, _ := strconv.ParseFloat(latStr, 64)
	if !costingAllowed[mode] {
		mode = "pedestrian"
	}

	// Valhalla public OSM instance — aucune clé requise
	payload := map[string]interface{}{
		"locations": []map[string]float64{{"lat": lat, "lon": lon}},
		"costing":   mode,
		"contours":  []map[string]int{{"time": minutes}},
		"polygons":  true,
		"denoise":   0.5,
		"generalize": 150,
	}
	bodyBytes, _ := json.Marshal(payload)

	reqCtx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost,
		"https://valhalla.openstreetmap.de/isochrone", bytes.NewReader(bodyBytes))
	if err != nil {
		getIsochroneHaversine(c, lat, lon, minutes)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		getIsochroneHaversine(c, lat, lon, minutes)
		return
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		getIsochroneHaversine(c, lat, lon, minutes)
		return
	}

	// Valhalla retourne un GeoJSON FeatureCollection directement
	c.Header("Content-Type", "application/json; charset=utf-8")
	_, _ = fmt.Fprintf(c.Writer, `{"source":"valhalla","minutes":%d,"mode":%q,"geojson":%s}`,
		minutes, mode, respBytes)
}

// getIsochroneHaversine — fallback haversine : communes dans un rayon estimé (0.7 km/min).
func getIsochroneHaversine(c *gin.Context, lat, lon float64, minutes int) {
	ctx := c.Request.Context()
	rayonKm := float64(minutes) * 0.7

	rows, err := db.Pool.Query(ctx, `
		SELECT city, TRIM(code_departement) AS dept,
		       ROUND(prix_median_m2::numeric, 0)           AS prix_m2,
		       ROUND(score_qualite_vie::numeric, 1)         AS qualite_vie,
		       ROUND(rendement_locatif_brut::numeric, 2)    AS rendement_pct,
		       centroid_lon, centroid_lat,
		       ROUND((2 * 6371 * ASIN(SQRT(
		           POWER(SIN(RADIANS((centroid_lat - $1)/2)), 2) +
		           COS(RADIANS($1)) * COS(RADIANS(centroid_lat)) *
		           POWER(SIN(RADIANS((centroid_lon - $2)/2)), 2)
		       )))::numeric, 1)::float AS distance_km
		FROM communes_agregat
		WHERE centroid_lon IS NOT NULL AND centroid_lat IS NOT NULL
		  AND prix_median_m2 IS NOT NULL
		  AND 2 * 6371 * ASIN(SQRT(
		      POWER(SIN(RADIANS((centroid_lat - $1)/2)), 2) +
		      COS(RADIANS($1)) * COS(RADIANS(centroid_lat)) *
		      POWER(SIN(RADIANS((centroid_lon - $2)/2)), 2)
		  )) <= $3
		ORDER BY score_qualite_vie DESC NULLS LAST
		LIMIT 12
	`, lat, lon, rayonKm)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	type Row struct {
		City       string  `json:"city"`
		Dept       string  `json:"dept"`
		PrixM2     float64 `json:"prix_m2"`
		QualiteVie float64 `json:"qualite_vie"`
		Rendement  float64 `json:"rendement_pct"`
		Lon        float64 `json:"lon"`
		Lat        float64 `json:"lat"`
		DistanceKm float64 `json:"distance_km"`
	}
	var data []Row
	for rows.Next() {
		var r Row
		if err := rows.Scan(&r.City, &r.Dept, &r.PrixM2, &r.QualiteVie, &r.Rendement, &r.Lon, &r.Lat, &r.DistanceKm); err != nil {
			continue
		}
		data = append(data, r)
	}

	c.JSON(http.StatusOK, gin.H{"source": "haversine", "minutes": minutes, "data": data})
}
