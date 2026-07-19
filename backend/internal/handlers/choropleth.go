package handlers

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// GetChoropleth — GET /api/v1/choropleth?score=investissement|dpe|securite|qualite_vie|global
// Retourne un GeoJSON FeatureCollection de points (centroïdes communes) colorés par score.
func GetChoropleth(c *gin.Context) {
	score := c.Query("score")
	ctx := c.Request.Context()

	// Whitelist des colonnes — aucune injection possible
	colMap := map[string]string{
		"investissement": "score_investissement",
		"dpe":            "score_dpe_moyen",
		"securite":       "score_securite",
		"qualite_vie":    "score_qualite_vie",
		"global":         "score_global",
		"rendement":      "rendement_locatif_brut",
	}
	col, ok := colMap[score]
	if !ok {
		col = "score_global"
	}

	rows, err := db.Pool.Query(ctx, fmt.Sprintf(`
		SELECT centroid_lon, centroid_lat, city, code_commune,
		       COALESCE(%s, 0)::float AS val,
		       COALESCE(prix_median_m2, 0)::float AS prix_m2,
		       TRIM(code_departement) AS dept
		FROM communes_agregat
		WHERE centroid_lon IS NOT NULL AND centroid_lat IS NOT NULL
		ORDER BY code_commune
	`, col))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	type Feature struct {
		Type     string                 `json:"type"`
		Geometry map[string]interface{} `json:"geometry"`
		Props    map[string]interface{} `json:"properties"`
	}

	features := []Feature{}
	for rows.Next() {
		var lon, lat, val, prix float64
		var city, code, dept string
		if err := rows.Scan(&lon, &lat, &city, &code, &val, &prix, &dept); err != nil {
			continue
		}
		features = append(features, Feature{
			Type: "Feature",
			Geometry: map[string]interface{}{
				"type":        "Point",
				"coordinates": []float64{lon, lat},
			},
			Props: map[string]interface{}{
				"city":    city,
				"code":    code,
				"dept":    dept,
				"val":     val,
				"prix_m2": prix,
			},
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"type":     "FeatureCollection",
		"features": features,
	})
}
