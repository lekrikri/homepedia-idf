package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// GetVillesJumelles — GET /api/v1/communes/:code/jumelles
// Retourne les 5 communes les plus proches (qualité de vie similaire)
// avec un prix au m² inférieur d'au moins 8% — "similaire mais moins chère".
func GetVillesJumelles(c *gin.Context) {
	code := c.Param("code")
	ctx := c.Request.Context()

	var exists bool
	err := db.Pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM communes_agregat WHERE code_commune = $1)
	`, code).Scan(&exists)
	if err != nil || !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "commune not found"})
		return
	}

	type JumelleRow struct {
		City               string  `json:"city"`
		CodeCommune        string  `json:"code_commune"`
		CodeDepartement    string  `json:"code_departement"`
		PrixMedianM2       float64 `json:"prix_median_m2"`
		RendementLocatif   float64 `json:"rendement_locatif_brut"`
		ScoreQualiteVie    float64 `json:"score_qualite_vie"`
		ScoreInvestissement float64 `json:"score_investissement"`
		PrixDeltaPct       float64 `json:"prix_delta_pct"`
		Distance           float64 `json:"distance"`
	}

	rows, err := db.Pool.Query(ctx, `
		SELECT
		  city, code_commune, TRIM(code_departement) AS dept,
		  prix_median_m2,
		  COALESCE(rendement_locatif_brut, 0),
		  COALESCE(score_qualite_vie, 50),
		  COALESCE(score_investissement, 50),
		  ROUND(((prix_median_m2 - ref.ref_prix) / NULLIF(ref.ref_prix, 0) * 100)::numeric, 1)::float AS prix_delta_pct,
		  ROUND(SQRT(
		    POWER(COALESCE(score_qualite_vie,50)/100.0   - ref.sqv, 2) +
		    POWER(COALESCE(score_investissement,50)/100.0 - ref.si,  2) +
		    POWER(COALESCE(score_securite,50)/100.0       - ref.ss,  2) +
		    POWER((COALESCE(ips_moyen,100)-60)/100.0      - ref.ips, 2) +
		    POWER(COALESCE(score_dpe_moyen,50)/100.0      - ref.dpe, 2)
		  )::numeric, 3)::float AS distance
		FROM communes_agregat,
		  (SELECT
		    prix_median_m2                                     AS ref_prix,
		    COALESCE(score_qualite_vie,50)/100.0               AS sqv,
		    COALESCE(score_investissement,50)/100.0            AS si,
		    COALESCE(score_securite,50)/100.0                  AS ss,
		    (COALESCE(ips_moyen,100)-60)/100.0                 AS ips,
		    COALESCE(score_dpe_moyen,50)/100.0                 AS dpe
		   FROM communes_agregat WHERE code_commune = $1
		  ) ref
		WHERE code_commune != $1
		  AND prix_median_m2 IS NOT NULL
		  AND prix_median_m2 < ref.ref_prix * 0.92
		  AND score_qualite_vie IS NOT NULL
		ORDER BY distance ASC
		LIMIT 6
	`, code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	result := []JumelleRow{}
	for rows.Next() {
		var r JumelleRow
		if err := rows.Scan(
			&r.City, &r.CodeCommune, &r.CodeDepartement,
			&r.PrixMedianM2, &r.RendementLocatif, &r.ScoreQualiteVie, &r.ScoreInvestissement,
			&r.PrixDeltaPct, &r.Distance,
		); err == nil {
			result = append(result, r)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"jumelles": result,
		"commune":  code,
	})
}
