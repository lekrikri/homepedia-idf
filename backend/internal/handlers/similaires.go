package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// GetCommunesSimilaires — GET /api/v1/communes/:code/similaires
// Retourne les 5 communes les plus proches par distance euclidienne
// sur 5 features normalisées : prix, score investissement, qualité de vie, sécurité, IPS.
func GetCommunesSimilaires(c *gin.Context) {
	code := c.Param("code")
	ctx := c.Request.Context()

	// Vérifier que la commune de référence existe
	var exists bool
	err := db.Pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM communes_agregat WHERE code_commune = $1)
	`, code).Scan(&exists)
	if err != nil || !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "commune not found"})
		return
	}

	type SimilaireRow struct {
		City               string  `json:"city"`
		CodeCommune        string  `json:"code_commune"`
		CodeDepartement    string  `json:"code_departement"`
		PrixMedianM2       float64 `json:"prix_median_m2"`
		ScoreInvestissement float64 `json:"score_investissement"`
		ScoreQualiteVie    float64 `json:"score_qualite_vie"`
		ScoreStabilite     float64 `json:"score_stabilite"`
		Distance           float64 `json:"distance"`
	}

	rows, err := db.Pool.Query(ctx, `
		SELECT
		  city, code_commune, TRIM(code_departement) AS dept,
		  prix_median_m2, score_investissement, score_qualite_vie, score_stabilite,
		  ROUND(SQRT(
		    POWER(COALESCE(prix_median_m2,0)/15000.0 - ref.p, 2) +
		    POWER(COALESCE(score_investissement,50)/100.0 - ref.si, 2) +
		    POWER(COALESCE(score_qualite_vie,50)/100.0 - ref.sqv, 2) +
		    POWER(COALESCE(score_securite,50)/100.0 - ref.ss, 2) +
		    POWER((COALESCE(ips_moyen,100)-60)/100.0 - ref.ips, 2)
		  )::numeric, 3)::float AS distance
		FROM communes_agregat,
		  (SELECT
		    COALESCE(prix_median_m2,0)/15000.0 AS p,
		    COALESCE(score_investissement,50)/100.0 AS si,
		    COALESCE(score_qualite_vie,50)/100.0 AS sqv,
		    COALESCE(score_securite,50)/100.0 AS ss,
		    (COALESCE(ips_moyen,100)-60)/100.0 AS ips
		   FROM communes_agregat WHERE code_commune = $1
		  ) ref
		WHERE code_commune != $1
		  AND prix_median_m2 IS NOT NULL
		  AND score_investissement IS NOT NULL
		ORDER BY distance ASC
		LIMIT 5
	`, code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	result := []SimilaireRow{}
	for rows.Next() {
		var r SimilaireRow
		if err := rows.Scan(
			&r.City, &r.CodeCommune, &r.CodeDepartement,
			&r.PrixMedianM2, &r.ScoreInvestissement, &r.ScoreQualiteVie, &r.ScoreStabilite,
			&r.Distance,
		); err == nil {
			result = append(result, r)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"similaires": result,
		"commune":    code,
	})
}
