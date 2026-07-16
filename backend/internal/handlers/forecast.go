package handlers

import (
	"math"
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// GetCommuneForecast — GET /api/v1/communes/:code/forecast
// Retourne l'historique + prévisions Prophet 2025-2026 pour une commune.
func GetCommuneForecast(c *gin.Context) {
	code := c.Param("code")
	ctx := c.Request.Context()

	type ForecastPoint struct {
		Annee      int      `json:"annee"`
		PrixPred   float64  `json:"prix_m2_pred"`
		PrixLower  *float64 `json:"prix_m2_lower"`
		PrixUpper  *float64 `json:"prix_m2_upper"`
		IsForecast bool     `json:"is_forecast"`
	}

	rows, err := db.Pool.Query(ctx, `
		SELECT annee, prix_m2_pred, prix_m2_lower, prix_m2_upper, is_forecast
		FROM prix_forecast
		WHERE code_commune = $1
		ORDER BY annee
	`, code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	result := []ForecastPoint{}
	for rows.Next() {
		var p ForecastPoint
		if err := rows.Scan(&p.Annee, &p.PrixPred, &p.PrixLower, &p.PrixUpper, &p.IsForecast); err == nil {
			result = append(result, p)
		}
	}

	if len(result) == 0 {
		c.JSON(http.StatusOK, gin.H{"data": []ForecastPoint{}, "available": false})
		return
	}

	// CAGR historique (premier point → dernier point historique)
	var hist []ForecastPoint
	for _, p := range result {
		if !p.IsForecast {
			hist = append(hist, p)
		}
	}

	var cagr *float64
	if len(hist) >= 2 {
		first, last := hist[0], hist[len(hist)-1]
		years := float64(last.Annee - first.Annee)
		if first.PrixPred > 0 && years > 0 {
			v := (math.Pow(last.PrixPred/first.PrixPred, 1.0/years) - 1.0) * 100.0
			cagr = &v
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"data":      result,
		"available": true,
		"cagr_pct":  cagr,
	})
}
