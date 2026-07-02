package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/cache"
	"homepedia/backend/internal/db"
)

// CommuneListItem contient uniquement les champs nécessaires pour les listes UI
// (sidebar, autocomplete, top-communes, dashboard). ~12 champs au lieu de 40+.
// Les alias JSON (nom, code_insee, prix_m2_median) sont volontairement identiques
// à ceux de /communes/gold pour ne pas avoir à adapter MapView et Dashboard.
type CommuneListItem struct {
	CodeInsee          string   `json:"code_insee"`
	Nom                string   `json:"nom"`
	Departement        string   `json:"departement"`
	CentroidLon        *float64 `json:"centroid_lon,omitempty"`
	CentroidLat        *float64 `json:"centroid_lat,omitempty"`
	PrixM2Median       *float64 `json:"prix_m2_median,omitempty"`
	NbTransactions     *int64   `json:"nb_transactions,omitempty"`
	ScoreQualiteVie    *float64 `json:"score_qualite_vie,omitempty"`
	ScoreInvestissement *float64 `json:"score_investissement,omitempty"`
	ScoreStabilite     *float64 `json:"score_stabilite,omitempty"`
	ScoreAccessibilite *float64 `json:"score_accessibilite,omitempty"`
	ScoreGlobal        *float64 `json:"score_global,omitempty"`
}

const communesListCacheKey = "communes_list_v1"
const communesListCacheTTL = 2 * time.Hour

// GetCommunesList handles GET /api/v1/communes/list
// Endpoint léger : 12 colonnes au lieu de 40+, mise en cache 2h.
// Utilisé par MapView, Dashboard et Comparer pour l'autocomplete et les listes.
func GetCommunesList(c *gin.Context) {
	if data, ok := cache.Global.Get(communesListCacheKey); ok {
		c.Header("X-Cache", "HIT")
		c.Header("Content-Type", "application/json; charset=utf-8")
		c.Data(http.StatusOK, "application/json; charset=utf-8", data)
		return
	}

	rows, err := db.Pool.Query(c.Request.Context(), `
		SELECT
			code_commune            AS code_insee,
			city                    AS nom,
			TRIM(code_departement)  AS departement,
			centroid_lon,
			centroid_lat,
			prix_median_m2          AS prix_m2_median,
			nb_transactions,
			score_qualite_vie,
			score_investissement,
			score_stabilite,
			score_accessibilite,
			score_global
		FROM communes_agregat
		ORDER BY nb_transactions DESC NULLS LAST
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database error"})
		return
	}
	defer rows.Close()

	items := []CommuneListItem{}
	for rows.Next() {
		var item CommuneListItem
		if err := rows.Scan(
			&item.CodeInsee, &item.Nom, &item.Departement,
			&item.CentroidLon, &item.CentroidLat,
			&item.PrixM2Median, &item.NbTransactions,
			&item.ScoreQualiteVie, &item.ScoreInvestissement,
			&item.ScoreStabilite, &item.ScoreAccessibilite, &item.ScoreGlobal,
		); err != nil {
			continue
		}
		items = append(items, item)
	}

	resp := gin.H{"data": items, "count": len(items)}
	data, _ := json.Marshal(resp)

	cache.Global.Set(communesListCacheKey, data, communesListCacheTTL)

	c.Header("X-Cache", "MISS")
	c.Data(http.StatusOK, "application/json; charset=utf-8", data)
}
