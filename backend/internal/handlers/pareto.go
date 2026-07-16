package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// GetParetoFront — GET /api/v1/pareto
// Retourne les données rendement vs risque pour 1264 communes IDF.
// Le calcul du front de Pareto est effectué côté client.
func GetParetoFront(c *gin.Context) {
	ctx := c.Request.Context()

	type CommunePoint struct {
		CodeCommune         string  `json:"code"`
		City                string  `json:"city"`
		CodeDepartement     string  `json:"dept"`
		RendementLocatif    float64 `json:"rendement"`
		ScoreRisques        float64 `json:"risque"`
		PrixMedianM2        float64 `json:"prix_m2"`
		ScoreInvestissement float64 `json:"score_invest"`
		ScoreQualiteVie     float64 `json:"score_qv"`
	}

	rows, err := db.Pool.Query(ctx, `
		SELECT
		  code_commune,
		  city,
		  TRIM(code_departement),
		  COALESCE(rendement_locatif_brut, 0),
		  COALESCE(score_risques, 50),
		  COALESCE(prix_median_m2, 0),
		  COALESCE(score_investissement, 50),
		  COALESCE(score_qualite_vie, 50)
		FROM communes_agregat
		WHERE rendement_locatif_brut IS NOT NULL
		  AND score_risques IS NOT NULL
		  AND prix_median_m2 IS NOT NULL
		  AND prix_median_m2 > 0
		ORDER BY rendement_locatif_brut DESC
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	points := []CommunePoint{}
	for rows.Next() {
		var p CommunePoint
		if err := rows.Scan(
			&p.CodeCommune, &p.City, &p.CodeDepartement,
			&p.RendementLocatif, &p.ScoreRisques, &p.PrixMedianM2,
			&p.ScoreInvestissement, &p.ScoreQualiteVie,
		); err != nil {
			continue
		}
		points = append(points, p)
	}

	c.JSON(http.StatusOK, gin.H{
		"points": points,
		"count":  len(points),
	})
}
