package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// GetDemographie — GET /api/v1/communes/:code/demographie
// Retourne les données démographiques disponibles dans communes_agregat.
// Colonnes présentes : population_totale, population_municipale, densite_pop_km2
// Colonnes non encore ingérées : taux_emploi, age_median, part_proprietaires
// (à enrichir via fichier INSEE RP — Recensement de la Population)
func GetDemographie(c *gin.Context) {
	code := c.Param("code")
	ctx := c.Request.Context()

	type Demo struct {
		PopulationTotale     *int64   `json:"population_totale"`
		PopulationMunicipale *int64   `json:"population_municipale"`
		DensitePopKm2        *float64 `json:"densite_pop_km2"`
	}

	var d Demo
	err := db.Pool.QueryRow(ctx, `
		SELECT
			population_totale,
			population_municipale,
			densite_pop_km2
		FROM communes_agregat
		WHERE code_commune = $1
	`, code).Scan(&d.PopulationTotale, &d.PopulationMunicipale, &d.DensitePopKm2)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "commune non trouvée"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": d})
}
