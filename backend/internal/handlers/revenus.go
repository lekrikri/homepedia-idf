package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// GetRevenusIDF — GET /api/v1/revenus?tri=median&dept=92
// Retourne le top 20 des communes IDF par revenu médian ou taux de pauvreté.
// Query params:
//   - tri   : "median" (défaut) | "pauvrete"
//   - dept  : code département (ex: "92") — facultatif
func GetRevenusIDF(c *gin.Context) {
	tri := c.DefaultQuery("tri", "median")
	dept := c.Query("dept")
	ctx := c.Request.Context()

	orderCol := "revenu_median_uc"
	orderDir := "DESC"
	if tri == "pauvrete" {
		orderCol = "taux_pauvrete"
		orderDir = "DESC"
	}

	var (
		query string
		args  []interface{}
	)

	baseSelect := `
		SELECT city, TRIM(code_departement) AS dept,
		       revenu_median_uc, taux_pauvrete, revenu_d1, revenu_d9,
		       ROUND(prix_median_m2::numeric, 0)::int          AS prix_m2,
		       ROUND(score_qualite_vie::numeric, 1)::float      AS qualite_vie
		FROM communes_agregat
		WHERE revenu_median_uc IS NOT NULL`

	if dept != "" {
		query = baseSelect + `
		  AND TRIM(code_departement) = $1
		ORDER BY ` + orderCol + ` ` + orderDir + ` NULLS LAST
		LIMIT 20`
		args = []interface{}{dept}
	} else {
		query = baseSelect + `
		ORDER BY ` + orderCol + ` ` + orderDir + ` NULLS LAST
		LIMIT 20`
	}

	rows, err := db.Pool.Query(ctx, query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	type Row struct {
		City        string   `json:"city"`
		Dept        string   `json:"dept"`
		RevenMedian *int64   `json:"revenu_median_uc"`
		TauxPauv    *float64 `json:"taux_pauvrete"`
		D1          *int64   `json:"revenu_d1"`
		D9          *int64   `json:"revenu_d9"`
		PrixM2      *int64   `json:"prix_m2"`
		QualiteVie  *float64 `json:"qualite_vie"`
	}

	var data []Row
	for rows.Next() {
		var r Row
		if err := rows.Scan(
			&r.City, &r.Dept,
			&r.RevenMedian, &r.TauxPauv, &r.D1, &r.D9,
			&r.PrixM2, &r.QualiteVie,
		); err != nil {
			continue
		}
		data = append(data, r)
	}
	if data == nil {
		data = []Row{}
	}

	// Le millésime est renvoyé pour être affiché : les revenus Filosofi
	// accusent plusieurs années de retard, l'utilisateur doit le savoir avant
	// de comparer une commune à sa situation actuelle.
	var millesime *int
	_ = db.Pool.QueryRow(ctx,
		`SELECT MAX(revenus_millesime) FROM communes_agregat`).Scan(&millesime)

	c.JSON(http.StatusOK, gin.H{
		"data":      data,
		"tri":       tri,
		"millesime": millesime,
		"source":    "INSEE Filosofi",
	})
}
