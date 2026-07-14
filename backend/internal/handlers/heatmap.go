package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// GetHeatmapIDF — GET /api/v1/heatmap
// Retourne les centroïdes communes + prix médian/m² pour heatmap MapLibre.
// Filtre les communes sans coordonnées ou sans prix.
func GetHeatmapIDF(c *gin.Context) {
	ctx := c.Request.Context()

	type Point struct {
		Lon         float64 `json:"lon"`
		Lat         float64 `json:"lat"`
		PrixM2      float64 `json:"prix_m2"`
		City        string  `json:"city"`
		CodeCommune string  `json:"code"`
	}

	rows, err := db.Pool.Query(ctx, `
		SELECT centroid_lon, centroid_lat, prix_median_m2, city, code_commune
		FROM communes_agregat
		WHERE centroid_lon IS NOT NULL
		  AND centroid_lat IS NOT NULL
		  AND prix_median_m2 IS NOT NULL
		  AND prix_median_m2 > 0
		ORDER BY code_commune
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	// Construire directement un GeoJSON FeatureCollection
	features := []map[string]interface{}{}
	for rows.Next() {
		var p Point
		if err := rows.Scan(&p.Lon, &p.Lat, &p.PrixM2, &p.City, &p.CodeCommune); err != nil {
			continue
		}
		features = append(features, map[string]interface{}{
			"type": "Feature",
			"geometry": map[string]interface{}{
				"type":        "Point",
				"coordinates": []float64{p.Lon, p.Lat},
			},
			"properties": map[string]interface{}{
				"prix_m2": p.PrixM2,
				"city":    p.City,
				"code":    p.CodeCommune,
			},
		})
	}

	c.JSON(http.StatusOK, map[string]interface{}{
		"type":     "FeatureCollection",
		"features": features,
	})
}
