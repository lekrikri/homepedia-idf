package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// GetPrixParPieces — GET /api/v1/communes/:code/prix-par-pieces
// Retourne le prix médian au m² par nombre de pièces (T1, T2, T3, T4+)
func GetPrixParPieces(c *gin.Context) {
	code := c.Param("code")
	ctx := c.Request.Context()

	rows, err := db.Pool.Query(ctx, `
		SELECT
			CASE
				WHEN nombre_pieces = 1 THEN 'T1'
				WHEN nombre_pieces = 2 THEN 'T2'
				WHEN nombre_pieces = 3 THEN 'T3'
				WHEN nombre_pieces >= 4 THEN 'T4+'
				ELSE 'Autre'
			END AS type_pieces,
			ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY valeur_fonciere / NULLIF(surface_reelle_bati, 0))::numeric, 0)::int AS prix_median_m2,
			COUNT(*) AS nb_transactions
		FROM transactions
		WHERE code_commune = $1
		  AND surface_reelle_bati > 10
		  AND valeur_fonciere > 0
		  AND nombre_pieces BETWEEN 1 AND 10
		  AND type_local IN ('Appartement', 'Maison')
		  AND EXTRACT(YEAR FROM date_mutation) >= 2019
		GROUP BY 1
		ORDER BY
			CASE
				WHEN nombre_pieces = 1 THEN 1
				WHEN nombre_pieces = 2 THEN 2
				WHEN nombre_pieces = 3 THEN 3
				WHEN nombre_pieces >= 4 THEN 4
				ELSE 5
			END
	`, code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	type Row struct {
		TypePieces string `json:"type"`
		PrixMedian int    `json:"prix_median_m2"`
		NbTrans    int    `json:"nb_transactions"`
	}
	var data []Row
	for rows.Next() {
		var r Row
		if err := rows.Scan(&r.TypePieces, &r.PrixMedian, &r.NbTrans); err != nil {
			continue
		}
		data = append(data, r)
	}

	c.JSON(http.StatusOK, gin.H{"data": data})
}
