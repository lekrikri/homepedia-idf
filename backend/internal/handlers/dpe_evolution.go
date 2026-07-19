package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// GetDpeEvolution — GET /api/v1/communes/:code/dpe-evolution
// Distribution des classes énergie (DPE) par année (2019-2024)
// Colonne en base : classe_energie (character A-G)
func GetDpeEvolution(c *gin.Context) {
	code := c.Param("code")
	ctx := c.Request.Context()

	rows, err := db.Pool.Query(ctx, `
		SELECT
			EXTRACT(YEAR FROM date_mutation)::int AS annee,
			classe_energie,
			COUNT(*) AS nb
		FROM transactions
		WHERE code_commune = $1
		  AND classe_energie IS NOT NULL
		  AND classe_energie IN ('A', 'B', 'C', 'D', 'E', 'F', 'G')
		  AND EXTRACT(YEAR FROM date_mutation) BETWEEN 2019 AND 2024
		GROUP BY 1, 2
		ORDER BY 1, 2
	`, code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	// Structure : { annee: { A: 5, B: 12, ... } }
	type YearData map[string]int
	byYear := map[int]YearData{}
	for rows.Next() {
		var annee int
		var classe string
		var nb int
		if err := rows.Scan(&annee, &classe, &nb); err != nil {
			continue
		}
		if byYear[annee] == nil {
			byYear[annee] = YearData{}
		}
		byYear[annee][classe] = nb
	}

	// Convertir en liste ordonnée
	type YearRow struct {
		Annee int      `json:"annee"`
		Data  YearData `json:"data"`
	}
	var result []YearRow
	for year := 2019; year <= 2024; year++ {
		if d, ok := byYear[year]; ok {
			result = append(result, YearRow{Annee: year, Data: d})
		}
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}
