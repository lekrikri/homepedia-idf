package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// GetStats handles GET /api/v1/stats
// Returns aggregate statistics over all transactions.
func GetStats(c *gin.Context) {
	ctx := c.Request.Context()

	// 1. Global KPIs
	var totalVolume float64
	var nbTransactions int
	var avgPrixM2 float64
	_ = db.Pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(valeur_fonciere), 0),
			COUNT(*),
			COALESCE(AVG(valeur_fonciere / NULLIF(surface_reelle_bati, 0)), 0)
		FROM transactions
		WHERE valeur_fonciere IS NOT NULL
	`).Scan(&totalVolume, &nbTransactions, &avgPrixM2)

	// 2. Price evolution by year
	type YearPoint struct {
		Year  int     `json:"year"`
		PrixM2 float64 `json:"prix_m2"`
		Count int     `json:"count"`
	}
	rows, err := db.Pool.Query(ctx, `
		SELECT
			EXTRACT(YEAR FROM date_mutation)::int AS yr,
			ROUND(AVG(valeur_fonciere / NULLIF(surface_reelle_bati, 0))::numeric, 0)::float,
			COUNT(*)
		FROM transactions
		WHERE valeur_fonciere IS NOT NULL AND surface_reelle_bati IS NOT NULL AND surface_reelle_bati > 0
		GROUP BY yr
		ORDER BY yr
	`)
	evolution := []YearPoint{}
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var p YearPoint
			if rows.Scan(&p.Year, &p.PrixM2, &p.Count) == nil {
				evolution = append(evolution, p)
			}
		}
	}

	// 3. Volume by type_local
	type TypeVolume struct {
		TypeLocal string  `json:"type_local"`
		Volume    float64 `json:"volume"`
		Count     int     `json:"count"`
	}
	rows2, err := db.Pool.Query(ctx, `
		SELECT
			COALESCE(type_local, 'Autre'),
			COALESCE(SUM(valeur_fonciere), 0),
			COUNT(*)
		FROM transactions
		WHERE valeur_fonciere IS NOT NULL
		GROUP BY type_local
		ORDER BY SUM(valeur_fonciere) DESC
		LIMIT 6
	`)
	byType := []TypeVolume{}
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var t TypeVolume
			if rows2.Scan(&t.TypeLocal, &t.Volume, &t.Count) == nil {
				byType = append(byType, t)
			}
		}
	}

	// 4. DPE distribution
	type DPECount struct {
		Classe string `json:"classe"`
		Count  int    `json:"count"`
	}
	rows3, err := db.Pool.Query(ctx, `
		SELECT classe_energie, COUNT(*)
		FROM transactions
		WHERE classe_energie IS NOT NULL
		GROUP BY classe_energie
		ORDER BY classe_energie
	`)
	dpe := []DPECount{}
	if err == nil {
		defer rows3.Close()
		for rows3.Next() {
			var d DPECount
			if rows3.Scan(&d.Classe, &d.Count) == nil {
				dpe = append(dpe, d)
			}
		}
	}

	// 5. Top communes by transaction count
	type TopCommune struct {
		Commune   string  `json:"commune"`
		NbTx      int     `json:"nb_transactions"`
		PrixM2Med float64 `json:"prix_m2_median"`
	}
	rows4, err := db.Pool.Query(ctx, `
		SELECT
			commune,
			COUNT(*) as nb,
			ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY valeur_fonciere / NULLIF(surface_reelle_bati, 0))::numeric, 0)::float
		FROM transactions
		WHERE commune IS NOT NULL AND valeur_fonciere IS NOT NULL AND surface_reelle_bati > 0
		GROUP BY commune
		ORDER BY nb DESC
		LIMIT 5
	`)
	topCommunes := []TopCommune{}
	if err == nil {
		defer rows4.Close()
		for rows4.Next() {
			var t TopCommune
			if rows4.Scan(&t.Commune, &t.NbTx, &t.PrixM2Med) == nil {
				topCommunes = append(topCommunes, t)
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"total_volume":    totalVolume,
		"nb_transactions": nbTransactions,
		"avg_prix_m2":     avgPrixM2,
		"evolution":       evolution,
		"by_type":         byType,
		"dpe":             dpe,
		"top_communes":    topCommunes,
	})
}
