package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
	"homepedia/backend/internal/models"
)

// ListTransactions handles GET /api/v1/transactions
// Query params:
//   - commune     (string) — code INSEE commune
//   - type_local  (string) — Appartement | Maison | …
//   - annee       (int)    — year of mutation (2019-2024)
//   - limit       (int, default 100, max 500)
//   - offset      (int, default 0)
func ListTransactions(c *gin.Context) {
	limit := queryInt(c, "limit", 100, 500)
	offset := queryInt(c, "offset", 0, -1)
	commune := c.Query("commune")
	typeLocal := c.Query("type_local")
	annee := c.Query("annee")

	query := `
		SELECT id, date_mutation, nature_mutation, valeur_fonciere,
		       adresse_voie, code_postal, commune, code_commune,
		       type_local, surface_reelle_bati, nombre_pieces,
		       longitude, latitude, source_annee
		FROM transactions
		WHERE ($1 = '' OR code_commune = $1)
		  AND ($2 = '' OR type_local ILIKE $2)
		  AND ($3 = '' OR EXTRACT(YEAR FROM date_mutation)::text = $3)
		ORDER BY date_mutation DESC
		LIMIT $4 OFFSET $5`

	rows, err := db.Pool.Query(c.Request.Context(), query,
		commune, typeLocal, annee, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database error"})
		return
	}
	defer rows.Close()

	var txs []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(
			&t.ID, &t.DateMutation, &t.NatureMutation, &t.ValeurFonciere,
			&t.Adresse, &t.CodePostal, &t.Commune, &t.CodeCommune,
			&t.TypeLocal, &t.SurfaceReelleBati, &t.NombrePieces,
			&t.Longitude, &t.Latitude, &t.SourceAnnee,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "scan error"})
			return
		}
		txs = append(txs, t)
	}
	if txs == nil {
		txs = []models.Transaction{}
	}

	c.JSON(http.StatusOK, gin.H{"data": txs, "count": len(txs)})
}

// GetTransaction handles GET /api/v1/transactions/:id
func GetTransaction(c *gin.Context) {
	id := c.Param("id")

	var t models.Transaction
	err := db.Pool.QueryRow(c.Request.Context(),
		`SELECT id, date_mutation, nature_mutation, valeur_fonciere,
		        adresse_voie, code_postal, commune, code_commune,
		        type_local, surface_reelle_bati, nombre_pieces,
		        longitude, latitude, source_annee
		 FROM transactions WHERE id = $1`, id,
	).Scan(
		&t.ID, &t.DateMutation, &t.NatureMutation, &t.ValeurFonciere,
		&t.Adresse, &t.CodePostal, &t.Commune, &t.CodeCommune,
		&t.TypeLocal, &t.SurfaceReelleBati, &t.NombrePieces,
		&t.Longitude, &t.Latitude, &t.SourceAnnee,
	)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
		return
	}

	c.JSON(http.StatusOK, t)
}
