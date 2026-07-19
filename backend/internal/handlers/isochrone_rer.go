package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// GetIsochroneRER — GET /api/v1/isochrone/rer?minutes=30
// Isochrone transport réel IDF : gares RER/Transilien accessibles en < minutes
// depuis Paris (Châtelet), puis communes dans un rayon de marche (~80m/min).
// Retourne les communes + la gare la plus proche et la ligne correspondante.
func GetIsochroneRER(c *gin.Context) {
	minutesStr := c.DefaultQuery("minutes", "30")
	minutes, _ := strconv.Atoi(minutesStr)
	if minutes < 5 || minutes > 120 {
		minutes = 30
	}

	ctx := c.Request.Context()

	// Vitesse de marche : 80 m/min = 1.33 km/15min
	// Rayon de marche = (budget - temps_trajet) * 0.08 km/min
	rows, err := db.Pool.Query(ctx, `
		WITH stations_accessibles AS (
			SELECT
				rs.code_sncf,
				rs.nom            AS gare,
				rs.lat            AS gare_lat,
				rs.lon            AS gare_lon,
				rs.lignes,
				rs.temps_paris_min,
				($1 - rs.temps_paris_min) * 0.08 AS rayon_marche_km
			FROM rer_stations rs
			WHERE rs.temps_paris_min IS NOT NULL
			  AND rs.temps_paris_min < $1
		),
		communes_accessibles AS (
			SELECT DISTINCT ON (ca.code_commune)
				ca.city,
				ca.code_commune,
				TRIM(ca.code_departement)          AS dept,
				ROUND(ca.prix_median_m2::numeric, 0)::int        AS prix_m2,
				ROUND(ca.score_qualite_vie::numeric, 1)::float   AS qualite_vie,
				ROUND(ca.rendement_locatif_brut::numeric, 2)::float AS rendement_pct,
				ca.centroid_lat,
				ca.centroid_lon,
				sa.gare,
				sa.lignes,
				sa.temps_paris_min,
				ROUND((2 * 6371 * ASIN(SQRT(
					POWER(SIN(RADIANS((ca.centroid_lat - sa.gare_lat)/2)), 2) +
					COS(RADIANS(sa.gare_lat)) * COS(RADIANS(ca.centroid_lat)) *
					POWER(SIN(RADIANS((ca.centroid_lon - sa.gare_lon)/2)), 2)
				)))::numeric, 2)::float AS dist_gare_km
			FROM stations_accessibles sa
			JOIN communes_agregat ca
			  ON ca.centroid_lat IS NOT NULL
			 AND ca.centroid_lon IS NOT NULL
			 AND ca.prix_median_m2 IS NOT NULL
			 AND 2 * 6371 * ASIN(SQRT(
				POWER(SIN(RADIANS((ca.centroid_lat - sa.gare_lat)/2)), 2) +
				COS(RADIANS(sa.gare_lat)) * COS(RADIANS(ca.centroid_lat)) *
				POWER(SIN(RADIANS((ca.centroid_lon - sa.gare_lon)/2)), 2)
			)) <= sa.rayon_marche_km
			ORDER BY ca.code_commune, sa.temps_paris_min ASC
		)
		SELECT city, code_commune, dept, prix_m2, qualite_vie, rendement_pct,
		       centroid_lat, centroid_lon, gare, lignes, temps_paris_min, dist_gare_km
		FROM communes_accessibles
		ORDER BY qualite_vie DESC NULLS LAST
		LIMIT 20
	`, minutes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	type Row struct {
		City       string  `json:"city"`
		Code       string  `json:"code_commune"`
		Dept       string  `json:"dept"`
		PrixM2     int     `json:"prix_m2"`
		QualiteVie float64 `json:"qualite_vie"`
		Rendement  float64 `json:"rendement_pct"`
		Lat        float64 `json:"lat"`
		Lon        float64 `json:"lon"`
		Gare       string  `json:"gare"`
		Lignes     string  `json:"lignes"`
		TempsParis int     `json:"temps_paris_min"`
		DistGareKm float64 `json:"dist_gare_km"`
	}

	var data []Row
	for rows.Next() {
		var r Row
		if err := rows.Scan(
			&r.City, &r.Code, &r.Dept, &r.PrixM2, &r.QualiteVie, &r.Rendement,
			&r.Lat, &r.Lon, &r.Gare, &r.Lignes, &r.TempsParis, &r.DistGareKm,
		); err != nil {
			continue
		}
		data = append(data, r)
	}

	c.JSON(http.StatusOK, gin.H{
		"source":  "rer_stations",
		"minutes": minutes,
		"data":    data,
	})
}
