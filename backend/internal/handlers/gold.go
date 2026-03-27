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
			c.code_insee,
			c.nom,
			c.departement,
			c.population,
			COUNT(t.id)                                                          AS nb_transactions,
			ROUND(
				PERCENTILE_CONT(0.5) WITHIN GROUP (
					ORDER BY t.valeur_fonciere / NULLIF(t.surface_reelle_bati, 0)
				)::numeric, 0
			)::float                                                             AS prix_m2_median,
			ROUND(AVG(t.valeur_fonciere / NULLIF(t.surface_reelle_bati, 0))::numeric, 0)::float
			                                                                     AS prix_m2_moyen,
			ROUND(AVG(CASE t.classe_energie
				WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3
				WHEN 'D' THEN 4 WHEN 'E' THEN 5 WHEN 'F' THEN 6
				WHEN 'G' THEN 7 ELSE NULL END)::numeric, 1)::float              AS score_dpe_moyen,
			MODE() WITHIN GROUP (ORDER BY t.classe_energie)                     AS dpe_dominant,
			ROUND(COUNT(CASE WHEN t.type_local = 'Appartement' THEN 1 END) * 100.0
				/ NULLIF(COUNT(t.id), 0), 1)::float                             AS pct_appartements,
			ROUND(AVG(t.surface_reelle_bati)::numeric, 1)::float                AS surface_moyenne
		FROM communes c
		LEFT JOIN transactions t
			ON t.code_commune = c.code_insee
			AND t.valeur_fonciere IS NOT NULL
			AND t.surface_reelle_bati > 0
		WHERE ($1 = '' OR c.departement = $1)
		GROUP BY c.code_insee, c.nom, c.departement, c.population
		ORDER BY nb_transactions DESC
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
			c.code_insee,
			c.nom,
			c.departement,
			c.population,
			COUNT(t.id)                                                          AS nb_transactions,
			ROUND(
				PERCENTILE_CONT(0.5) WITHIN GROUP (
					ORDER BY t.valeur_fonciere / NULLIF(t.surface_reelle_bati, 0)
				)::numeric, 0
			)::float                                                             AS prix_m2_median,
			ROUND(AVG(t.valeur_fonciere / NULLIF(t.surface_reelle_bati, 0))::numeric, 0)::float
			                                                                     AS prix_m2_moyen,
			ROUND(AVG(CASE t.classe_energie
				WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3
				WHEN 'D' THEN 4 WHEN 'E' THEN 5 WHEN 'F' THEN 6
				WHEN 'G' THEN 7 ELSE NULL END)::numeric, 1)::float              AS score_dpe_moyen,
			MODE() WITHIN GROUP (ORDER BY t.classe_energie)                     AS dpe_dominant,
			ROUND(COUNT(CASE WHEN t.type_local = 'Appartement' THEN 1 END) * 100.0
				/ NULLIF(COUNT(t.id), 0), 1)::float                             AS pct_appartements,
			ROUND(AVG(t.surface_reelle_bati)::numeric, 1)::float                AS surface_moyenne
		FROM communes c
		LEFT JOIN transactions t
			ON t.code_commune = c.code_insee
			AND t.valeur_fonciere IS NOT NULL
			AND t.surface_reelle_bati > 0
		WHERE c.code_insee = $1
		GROUP BY c.code_insee, c.nom, c.departement, c.population
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
