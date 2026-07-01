package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
	"homepedia/backend/internal/models"
)

// GetCommunesGold handles GET /api/v1/communes/gold
// Retourne toutes les communes IDF avec leurs métriques agrégées (Gold layer).
// Query params:
//   - departement (string) — filtre par département
//   - limit  (int, default 200, max 1300)
//   - offset (int, default 0)
func GetCommunesGold(c *gin.Context) {
	limit := queryInt(c, "limit", 200, 1300)
	offset := queryInt(c, "offset", 0, -1)
	dept := c.Query("departement")

	rows, err := db.Pool.Query(c.Request.Context(), `
		SELECT
			ca.code_commune                          AS code_insee,
			ca.city                                  AS nom,
			TRIM(ca.code_departement)                AS departement,
			ca.population_totale::int                AS population,
			COALESCE(ca.nb_transactions, 0)::int     AS nb_transactions,
			ca.prix_median_m2                        AS prix_m2_median,
			ca.prix_moyen_m2                         AS prix_m2_moyen,
			ca.score_dpe_moyen,
			NULL::text                               AS dpe_dominant,
			NULL::float8                             AS pct_appartements,
			ca.surface_moyenne
		FROM communes_agregat ca
		WHERE ($1 = '' OR TRIM(ca.code_departement) = $1)
		ORDER BY ca.nb_transactions DESC NULLS LAST
		LIMIT $2 OFFSET $3
	`, dept, limit, offset)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database error"})
		return
	}
	defer rows.Close()

	var communes []models.CommuneGold
	for rows.Next() {
		var cg models.CommuneGold
		if err := rows.Scan(
			&cg.CodeInsee, &cg.Nom, &cg.Departement, &cg.Population,
			&cg.NbTransactions, &cg.PrixM2Median, &cg.PrixM2Moyen,
			&cg.ScoreDPEMoyen, &cg.DPEDominant, &cg.PctAppartements,
			&cg.SurfaceMoyenne,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "scan error"})
			return
		}
		communes = append(communes, cg)
	}
	if communes == nil {
		communes = []models.CommuneGold{}
	}

	c.JSON(http.StatusOK, gin.H{
		"data":  communes,
		"count": len(communes),
	})
}

// GetCommuneGold handles GET /api/v1/communes/:code/gold
// Retourne les métriques Gold détaillées d'une commune.
func GetCommuneGold(c *gin.Context) {
	code := c.Param("code")

	var cg models.CommuneGold
	err := db.Pool.QueryRow(c.Request.Context(), `
		SELECT
			ca.code_commune                          AS code_insee,
			ca.city                                  AS nom,
			TRIM(ca.code_departement)                AS departement,
			ca.population_totale::int                AS population,
			COALESCE(ca.nb_transactions, 0)::int     AS nb_transactions,
			ca.prix_median_m2                        AS prix_m2_median,
			ca.prix_moyen_m2                         AS prix_m2_moyen,
			ca.score_dpe_moyen,
			NULL::text                               AS dpe_dominant,
			NULL::float8                             AS pct_appartements,
			ca.surface_moyenne
		FROM communes_agregat ca
		WHERE ca.code_commune = $1
	`, code).Scan(
		&cg.CodeInsee, &cg.Nom, &cg.Departement, &cg.Population,
		&cg.NbTransactions, &cg.PrixM2Median, &cg.PrixM2Moyen,
		&cg.ScoreDPEMoyen, &cg.DPEDominant, &cg.PctAppartements,
		&cg.SurfaceMoyenne,
	)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "commune not found"})
		return
	}

	c.JSON(http.StatusOK, cg)
}
