package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
	"homepedia/backend/internal/models"
)

// ListCommunes handles GET /api/v1/communes
// Query params:
//   - departement (string) — filter by department code
//   - q (string)           — search by name (ILIKE)
//   - limit  (int, default 50, max 200)
//   - offset (int, default 0)
func ListCommunes(c *gin.Context) {
	limit := queryInt(c, "limit", 50, 200)
	offset := queryInt(c, "offset", 0, -1)
	dept := c.Query("departement")
	q := c.Query("q")

	query := `
		SELECT id, code_insee, code_postal, nom, departement, region, population
		FROM communes
		WHERE ($1 = '' OR departement = $1)
		  AND ($2 = '' OR nom ILIKE '%' || $2 || '%')
		ORDER BY nom
		LIMIT $3 OFFSET $4`

	rows, err := db.Pool.Query(c.Request.Context(), query, dept, q, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database error"})
		return
	}
	defer rows.Close()

	var communes []models.Commune
	for rows.Next() {
		var com models.Commune
		if err := rows.Scan(
			&com.ID, &com.CodeInsee, &com.CodePostal,
			&com.Nom, &com.Departement, &com.Region, &com.Population,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "scan error"})
			return
		}
		communes = append(communes, com)
	}
	if communes == nil {
		communes = []models.Commune{}
	}

	c.JSON(http.StatusOK, gin.H{"data": communes, "count": len(communes)})
}

// GetCommune handles GET /api/v1/communes/:code
func GetCommune(c *gin.Context) {
	code := c.Param("code")

	var com models.Commune
	err := db.Pool.QueryRow(c.Request.Context(),
		`SELECT id, code_insee, code_postal, nom, departement, region, population
		 FROM communes WHERE code_insee = $1`, code,
	).Scan(&com.ID, &com.CodeInsee, &com.CodePostal, &com.Nom,
		&com.Departement, &com.Region, &com.Population)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "commune not found"})
		return
	}

	c.JSON(http.StatusOK, com)
}

// queryInt reads a query param as int, clamped to [0, max] (max=-1 means no upper bound).
func queryInt(c *gin.Context, key string, def, max int) int {
	s := c.Query(key)
	if s == "" {
		return def
	}
	v, err := strconv.Atoi(s)
	if err != nil || v < 0 {
		return def
	}
	if max > 0 && v > max {
		return max
	}
	return v
}
