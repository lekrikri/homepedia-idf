package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// GetHeatmapIDF — GET /api/v1/heatmap[?year=2022]
// Retourne les centroïdes communes + prix/m² pour heatmap MapLibre.
// Si ?year= est fourni (2021-2026), utilise prix_forecast pour cette année.
func GetHeatmapIDF(c *gin.Context) {
	ctx := c.Request.Context()
	year := c.Query("year")

	var sqlQuery string
	var args []interface{}

	if year != "" {
		sqlQuery = `
			SELECT ca.centroid_lon, ca.centroid_lat,
			       pf.prix_m2_pred::float8, ca.city, ca.code_commune,
			       pf.is_forecast
			FROM communes_agregat ca
			JOIN prix_forecast pf
			  ON pf.code_commune = ca.code_commune AND pf.annee = $1::smallint
			WHERE ca.centroid_lon IS NOT NULL
			  AND ca.centroid_lat IS NOT NULL
			  AND pf.prix_m2_pred IS NOT NULL
			  AND pf.prix_m2_pred > 0
			ORDER BY ca.code_commune
		`
		args = []interface{}{year}
	} else {
		sqlQuery = `
			SELECT centroid_lon, centroid_lat, prix_median_m2::float8, city, code_commune,
			       false::boolean
			FROM communes_agregat
			WHERE centroid_lon IS NOT NULL
			  AND centroid_lat IS NOT NULL
			  AND prix_median_m2 IS NOT NULL
			  AND prix_median_m2 > 0
			ORDER BY code_commune
		`
		args = []interface{}{}
	}

	rows, err := db.Pool.Query(ctx, sqlQuery, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	features := []map[string]interface{}{}
	for rows.Next() {
		var lon, lat, prix float64
		var city, code string
		var isForecast bool
		if err := rows.Scan(&lon, &lat, &prix, &city, &code, &isForecast); err != nil {
			continue
		}
		props := map[string]interface{}{
			"prix_m2":     prix,
			"city":        city,
			"code":        code,
			"is_forecast": isForecast,
		}
		features = append(features, map[string]interface{}{
			"type": "Feature",
			"geometry": map[string]interface{}{
				"type":        "Point",
				"coordinates": []float64{lon, lat},
			},
			"properties": props,
		})
	}

	c.JSON(http.StatusOK, map[string]interface{}{
		"type":     "FeatureCollection",
		"features": features,
		"year":     year,
	})
}
