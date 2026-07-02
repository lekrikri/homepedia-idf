package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/cache"
	"homepedia/backend/internal/db"
)

const statsCacheKey = "stats_v2"
const statsCacheTTL = time.Hour

// GetStats handles GET /api/v1/stats
// Returns aggregate statistics. Heavy queries (PERCENTILE_CONT, JOINs) are
// replaced by reads on communes_agregat (pre-computed) to avoid Cloud Run timeouts.
// Results are cached 1h in-process to absorb cold start latency.
func GetStats(c *gin.Context) {
	if data, ok := cache.Global.Get(statsCacheKey); ok {
		c.Header("X-Cache", "HIT")
		c.Data(http.StatusOK, "application/json; charset=utf-8", data)
		return
	}

	ctx := c.Request.Context()

	// 1. Global KPIs — depuis communes_agregat (pré-calculé, O(1264))
	var nbTransactions int
	var avgPrixM2 float64
	_ = db.Pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(nb_transactions), 0)::bigint,
			COALESCE(ROUND(AVG(prix_median_m2)::numeric, 0), 0)::float
		FROM communes_agregat
		WHERE prix_median_m2 IS NOT NULL
	`).Scan(&nbTransactions, &avgPrixM2)

	// Total volume — approximé depuis communes_agregat (prix_median * surface * nb_tx)
	// Evite un SUM global sur 1.9M lignes sans index sur valeur_fonciere.
	var totalVolume float64
	_ = db.Pool.QueryRow(ctx, `
		SELECT COALESCE(
			SUM(prix_median_m2 * surface_moyenne * nb_transactions),
			0
		)
		FROM communes_agregat
		WHERE prix_median_m2 IS NOT NULL
		  AND surface_moyenne IS NOT NULL
		  AND nb_transactions IS NOT NULL
	`).Scan(&totalVolume)

	// 2. Évolution prix par année — AVG simple (pas PERCENTILE_CONT)
	type YearPoint struct {
		Year   int     `json:"year"`
		PrixM2 float64 `json:"prix_m2"`
		Count  int     `json:"count"`
	}
	// Utilise date_part() pour profiter de l'index transactions_year_idx
	rows, err := db.Pool.Query(ctx, `
		SELECT
			date_part('year', date_mutation)::int AS yr,
			ROUND(AVG(valeur_fonciere / NULLIF(surface_reelle_bati, 0))::numeric, 0)::float,
			COUNT(*)
		FROM transactions
		WHERE valeur_fonciere IS NOT NULL
		  AND surface_reelle_bati > 5
		  AND valeur_fonciere / surface_reelle_bati BETWEEN 500 AND 50000
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

	// 3. Volume par type_local — COUNT + SUM sans PERCENTILE_CONT
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

	// 4. Distribution DPE — estimée depuis communes_agregat (score_dpe_moyen 1→A … 7→G)
	// transactions.classe_energie est vide ; on pondère nb_dpe par classe estimée par commune.
	type DPECount struct {
		Classe string `json:"classe"`
		Count  int    `json:"count"`
	}
	rows3, err := db.Pool.Query(ctx, `
		SELECT
			CASE
				WHEN score_dpe_moyen < 1.5 THEN 'A'
				WHEN score_dpe_moyen < 2.5 THEN 'B'
				WHEN score_dpe_moyen < 3.5 THEN 'C'
				WHEN score_dpe_moyen < 4.5 THEN 'D'
				WHEN score_dpe_moyen < 5.5 THEN 'E'
				WHEN score_dpe_moyen < 6.5 THEN 'F'
				ELSE 'G'
			END AS classe,
			COALESCE(SUM(nb_dpe), 0)::int AS count
		FROM communes_agregat
		WHERE score_dpe_moyen IS NOT NULL
		  AND nb_dpe IS NOT NULL
		GROUP BY 1
		ORDER BY 1
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

	// 5. Top communes — depuis communes_agregat (pré-calculé, instantané)
	type TopCommune struct {
		Commune   string  `json:"commune"`
		NbTx      int     `json:"nb_transactions"`
		PrixM2Med float64 `json:"prix_m2_median"`
	}
	rows4, err := db.Pool.Query(ctx, `
		SELECT
			city,
			COALESCE(nb_transactions, 0)::int,
			COALESCE(prix_median_m2, 0)::float
		FROM communes_agregat
		WHERE prix_median_m2 IS NOT NULL
		ORDER BY nb_transactions DESC NULLS LAST
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

	// 6. Stats par département — depuis communes_agregat (pré-calculé, instantané)
	type DeptStat struct {
		Dept       string  `json:"dept"`
		NbTx       int     `json:"nb_transactions"`
		PrixMedian float64 `json:"prix_median_m2"`
		PrixMoyen  float64 `json:"prix_moyen_m2"`
	}
	rows5, err := db.Pool.Query(ctx, `
		SELECT
			TRIM(code_departement),
			COALESCE(SUM(nb_transactions), 0)::int,
			COALESCE(ROUND(AVG(prix_median_m2)::numeric, 0), 0)::float,
			COALESCE(ROUND(AVG(prix_moyen_m2)::numeric, 0), 0)::float
		FROM communes_agregat
		WHERE prix_median_m2 IS NOT NULL
		GROUP BY TRIM(code_departement)
		ORDER BY AVG(prix_median_m2) DESC
	`)
	byDept := []DeptStat{}
	if err == nil {
		defer rows5.Close()
		for rows5.Next() {
			var d DeptStat
			if rows5.Scan(&d.Dept, &d.NbTx, &d.PrixMedian, &d.PrixMoyen) == nil {
				byDept = append(byDept, d)
			}
		}
	}

	resp := gin.H{
		"total_volume":    totalVolume,
		"nb_transactions": nbTransactions,
		"avg_prix_m2":     avgPrixM2,
		"evolution":       evolution,
		"by_type":         byType,
		"dpe":             dpe,
		"top_communes":    topCommunes,
		"by_dept":         byDept,
	}
	if data, err := json.Marshal(resp); err == nil {
		cache.Global.Set(statsCacheKey, data, statsCacheTTL)
		c.Header("X-Cache", "MISS")
		c.Data(http.StatusOK, "application/json; charset=utf-8", data)
	} else {
		c.JSON(http.StatusOK, resp)
	}
}
