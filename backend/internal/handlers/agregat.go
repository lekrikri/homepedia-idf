package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
	"homepedia/backend/internal/models"
)

// GetCommunesAgregat handles GET /api/v1/communes/agregat
// Retourne toutes les communes avec leurs métriques Gold complètes
// (population, prix, DPE, POI OSM) importées depuis Databricks.
// Query params:
//   - departement (string) — filtre par département (ex: "92")
//   - limit  (int, default 200, max 1300)
//   - offset (int, default 0)
func GetCommunesAgregat(c *gin.Context) {
	limit := queryInt(c, "limit", 200, 1300)
	offset := queryInt(c, "offset", 0, -1)
	dept := c.Query("departement")

	rows, err := db.Pool.Query(c.Request.Context(), `
		SELECT
			code_commune, city, TRIM(code_departement) AS code_departement,
			centroid_lon, centroid_lat, surface_km2,
			population_totale, population_municipale, densite_pop_km2,
			prix_median_m2, prix_moyen_m2, nb_transactions, surface_moyenne, prix_median_transaction,
			score_dpe_moyen, conso_energie_moyenne, emission_ges_moyenne, nb_dpe, pct_dpe_bon,
			nb_poi_total, nb_transport, nb_education, nb_sante,
			nb_commerce, nb_restauration, nb_parcs, nb_services, nb_bio_bobo
		FROM communes_agregat
		WHERE ($1 = '' OR TRIM(code_departement) = $1)
		ORDER BY nb_transactions DESC NULLS LAST
		LIMIT $2 OFFSET $3
	`, dept, limit, offset)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database error: " + err.Error()})
		return
	}
	defer rows.Close()

	var items []models.CommuneAgregat
	for rows.Next() {
		var a models.CommuneAgregat
		if err := rows.Scan(
			&a.CodeCommune, &a.City, &a.CodeDepartement,
			&a.CentroidLon, &a.CentroidLat, &a.SurfaceKm2,
			&a.PopulationTotale, &a.PopulationMunicipale, &a.DensitePopKm2,
			&a.PrixMedianM2, &a.PrixMoyenM2, &a.NbTransactions, &a.SurfaceMoyenne, &a.PrixMedianTransaction,
			&a.ScoreDPEMoyen, &a.ConsoEnergieMoyenne, &a.EmissionGESMoyenne, &a.NbDPE, &a.PctDPEBon,
			&a.NbPOITotal, &a.NbTransport, &a.NbEducation, &a.NbSante,
			&a.NbCommerce, &a.NbRestauration, &a.NbParcs, &a.NbServices, &a.NbBioBobo,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "scan error: " + err.Error()})
			return
		}
		items = append(items, a)
	}
	if items == nil {
		items = []models.CommuneAgregat{}
	}

	c.JSON(http.StatusOK, gin.H{"data": items, "count": len(items)})
}

// GetCommuneAgregat handles GET /api/v1/communes/:code/agregat
// Retourne les métriques Gold complètes d'une commune.
func GetCommuneAgregat(c *gin.Context) {
	code := c.Param("code")

	var a models.CommuneAgregat
	err := db.Pool.QueryRow(c.Request.Context(), `
		SELECT
			code_commune, city, TRIM(code_departement) AS code_departement,
			centroid_lon, centroid_lat, surface_km2,
			population_totale, population_municipale, densite_pop_km2,
			prix_median_m2, prix_moyen_m2, nb_transactions, surface_moyenne, prix_median_transaction,
			score_dpe_moyen, conso_energie_moyenne, emission_ges_moyenne, nb_dpe, pct_dpe_bon,
			nb_poi_total, nb_transport, nb_education, nb_sante,
			nb_commerce, nb_restauration, nb_parcs, nb_services, nb_bio_bobo
		FROM communes_agregat
		WHERE code_commune = $1
	`, code).Scan(
		&a.CodeCommune, &a.City, &a.CodeDepartement,
		&a.CentroidLon, &a.CentroidLat, &a.SurfaceKm2,
		&a.PopulationTotale, &a.PopulationMunicipale, &a.DensitePopKm2,
		&a.PrixMedianM2, &a.PrixMoyenM2, &a.NbTransactions, &a.SurfaceMoyenne, &a.PrixMedianTransaction,
		&a.ScoreDPEMoyen, &a.ConsoEnergieMoyenne, &a.EmissionGESMoyenne, &a.NbDPE, &a.PctDPEBon,
		&a.NbPOITotal, &a.NbTransport, &a.NbEducation, &a.NbSante,
		&a.NbCommerce, &a.NbRestauration, &a.NbParcs, &a.NbServices, &a.NbBioBobo,
	)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "commune not found in agregat table"})
		return
	}

	c.JSON(http.StatusOK, a)
}
