package handlers

import (
	"fmt"
	"math"
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// GetCommuneInsights — GET /api/v1/communes/:code/insights
// Compare la commune aux moyennes IDF et génère des phrases d'analyse.
func GetCommuneInsights(c *gin.Context) {
	code := c.Param("code")
	ctx := c.Request.Context()

	// 1. Données commune
	type communeRow struct {
		City           string
		Dept           string
		PrixM2         *float64
		ScoreDPE       *float64
		IPS            *float64
		ScoreInvest    *float64
		ScoreGlobal    *float64
		Rendement      *float64
		ScoreSecurite  *float64
		NbTransactions *int
	}
	var com communeRow
	err := db.Pool.QueryRow(ctx, `
		SELECT city, TRIM(code_departement),
		       prix_median_m2, score_dpe_moyen, ips_moyen,
		       score_investissement, score_global,
		       rendement_locatif_brut, score_securite, nb_transactions
		FROM communes_agregat WHERE code_commune = $1
	`, code).Scan(
		&com.City, &com.Dept,
		&com.PrixM2, &com.ScoreDPE, &com.IPS,
		&com.ScoreInvest, &com.ScoreGlobal,
		&com.Rendement, &com.ScoreSecurite, &com.NbTransactions,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "commune not found"})
		return
	}

	// 2. Moyennes IDF
	type idfAvg struct {
		Prix, DPE, IPS, Invest, Global, Rendement, Securite float64
	}
	var avg idfAvg
	_ = db.Pool.QueryRow(ctx, `
		SELECT
			COALESCE(AVG(prix_median_m2), 0),
			COALESCE(AVG(score_dpe_moyen), 0),
			COALESCE(AVG(ips_moyen), 0),
			COALESCE(AVG(score_investissement), 0),
			COALESCE(AVG(score_global), 0),
			COALESCE(AVG(rendement_locatif_brut), 0),
			COALESCE(AVG(score_securite), 0)
		FROM communes_agregat
		WHERE prix_median_m2 IS NOT NULL
	`).Scan(&avg.Prix, &avg.DPE, &avg.IPS, &avg.Invest, &avg.Global, &avg.Rendement, &avg.Securite)

	// 3. Rang de la commune sur score_global
	var rang, total int
	_ = db.Pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*)+1 FROM communes_agregat WHERE score_global > c.score_global),
			(SELECT COUNT(*) FROM communes_agregat WHERE score_global IS NOT NULL)
		FROM communes_agregat c WHERE code_commune = $1
	`, code).Scan(&rang, &total)

	// 4. Construction des comparaisons
	type Comparison struct {
		Label    string  `json:"label"`
		Value    float64 `json:"value"`
		Average  float64 `json:"average"`
		Delta    float64 `json:"delta"`
		DeltaPct float64 `json:"delta_pct"`
		Unit     string  `json:"unit"`
		Better   bool    `json:"better"`
	}

	comps := []Comparison{}
	addComp := func(label string, val *float64, avgVal float64, unit string, higherIsBetter bool) {
		if val == nil {
			return
		}
		delta := *val - avgVal
		pct := 0.0
		if avgVal != 0 {
			pct = math.Round(delta/avgVal*1000) / 10
		}
		better := (higherIsBetter && delta > 0) || (!higherIsBetter && delta < 0)
		comps = append(comps, Comparison{
			Label:    label,
			Value:    math.Round(*val*10) / 10,
			Average:  math.Round(avgVal*10) / 10,
			Delta:    math.Round(delta*10) / 10,
			DeltaPct: pct,
			Unit:     unit,
			Better:   better,
		})
	}

	addComp("Prix médian/m²", com.PrixM2, avg.Prix, "€/m²", false)
	addComp("Rendement locatif brut", com.Rendement, avg.Rendement, "%", true)
	addComp("Score investissement", com.ScoreInvest, avg.Invest, "/100", true)
	addComp("Score DPE (énergie)", com.ScoreDPE, avg.DPE, "/7", false)
	addComp("Score IPS (social)", com.IPS, avg.IPS, "pts", true)
	addComp("Score sécurité", com.ScoreSecurite, avg.Securite, "/100", true)

	// 5. Phrases d'insight naturelles
	insights := []string{}

	if com.PrixM2 != nil && avg.Prix > 0 {
		pct := (*com.PrixM2 - avg.Prix) / avg.Prix * 100
		if pct > 15 {
			insights = append(insights, fmt.Sprintf("Les prix sont %d%% au-dessus de la moyenne IDF — marché premium.", int(pct)))
		} else if pct < -15 {
			insights = append(insights, fmt.Sprintf("Les prix sont %d%% sous la moyenne IDF — opportunité d'entrée.", int(-pct)))
		} else {
			insights = append(insights, "Les prix sont proches de la moyenne francilienne.")
		}
	}

	if com.Rendement != nil && avg.Rendement > 0 {
		pct := (*com.Rendement - avg.Rendement) / avg.Rendement * 100
		if pct > 20 {
			insights = append(insights, fmt.Sprintf("Rendement locatif %d%% supérieur à la moyenne — attractif pour l'investissement.", int(pct)))
		} else if pct < -20 {
			insights = append(insights, "Rendement locatif sous la moyenne IDF — marché plutôt patrimonial.")
		}
	}

	if com.ScoreDPE != nil && avg.DPE > 0 {
		if *com.ScoreDPE < avg.DPE-0.5 {
			insights = append(insights, "Meilleure performance énergétique que la moyenne régionale.")
		} else if *com.ScoreDPE > avg.DPE+0.5 {
			insights = append(insights, "Parc immobilier énergivore — DPE dégradé vs moyenne IDF.")
		}
	}

	if rang > 0 && total > 0 {
		top := int(float64(rang) / float64(total) * 100)
		if top <= 10 {
			insights = append(insights, fmt.Sprintf("Top %d%% des communes IDF sur le score global.", top))
		} else if top >= 75 {
			insights = append(insights, fmt.Sprintf("Score global dans le dernier quart des communes IDF (%d%%).", top))
		}
	}

	if len(insights) == 0 {
		insights = append(insights, "Commune dans la moyenne des indicateurs franciliens.")
	}

	c.JSON(http.StatusOK, gin.H{
		"city":        com.City,
		"departement": com.Dept,
		"rang":        rang,
		"total":       total,
		"comparisons": comps,
		"insights":    insights,
	})
}

// GetCommunePrixHistorique — GET /api/v1/communes/:code/prix-historique
// Retourne le prix médian/m² par année (DVF 2019–2024) pour la commune.
func GetCommunePrixHistorique(c *gin.Context) {
	code := c.Param("code")
	ctx := c.Request.Context()

	type YearPrice struct {
		Year  int     `json:"year"`
		Prix  float64 `json:"prix_m2"`
		Count int     `json:"count"`
	}

	rows, err := db.Pool.Query(ctx, `
		SELECT
			date_part('year', date_mutation)::int AS yr,
			ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY valeur_fonciere / NULLIF(surface_reelle_bati, 0))::numeric, 0)::float,
			COUNT(*)::int
		FROM transactions
		WHERE code_commune = $1
		  AND valeur_fonciere IS NOT NULL
		  AND surface_reelle_bati > 5
		  AND valeur_fonciere / surface_reelle_bati BETWEEN 500 AND 50000
		  AND type_local IN ('Appartement', 'Maison')
		GROUP BY yr
		ORDER BY yr
	`, code)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	result := []YearPrice{}
	for rows.Next() {
		var p YearPrice
		if rows.Scan(&p.Year, &p.Prix, &p.Count) == nil {
			result = append(result, p)
		}
	}

	if len(result) == 0 {
		c.JSON(http.StatusOK, gin.H{"data": []YearPrice{}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

// GetPrixParType — GET /api/v1/communes/:code/prix-par-type
// Prix médian/m² par année ET par type de bien (Appartement / Maison).
func GetPrixParType(c *gin.Context) {
	code := c.Param("code")
	ctx := c.Request.Context()

	type TypeYear struct {
		Year      int     `json:"year"`
		TypeLocal string  `json:"type"`
		PrixM2    float64 `json:"prix_m2"`
		Count     int     `json:"count"`
	}

	rows, err := db.Pool.Query(ctx, `
		SELECT
			date_part('year', date_mutation)::int AS yr,
			type_local,
			ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY valeur_fonciere / NULLIF(surface_reelle_bati, 0))::numeric, 0)::float,
			COUNT(*)::int
		FROM transactions
		WHERE code_commune = $1
		  AND type_local IN ('Appartement', 'Maison')
		  AND valeur_fonciere IS NOT NULL
		  AND surface_reelle_bati > 5
		  AND valeur_fonciere / surface_reelle_bati BETWEEN 500 AND 50000
		GROUP BY yr, type_local
		ORDER BY yr, type_local
	`, code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	result := []TypeYear{}
	for rows.Next() {
		var p TypeYear
		if rows.Scan(&p.Year, &p.TypeLocal, &p.PrixM2, &p.Count) == nil {
			result = append(result, p)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}
