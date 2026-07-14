package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// GetTiles — GET /api/v1/tiles/:z/:x/:y
// Retourne des tuiles vectorielles MapLibre (MVT / application/x-protobuf).
// Les géométries viennent de communes.geom (PostGIS EPSG:4326).
// On joint communes_agregat pour exposer prix_m2, scores et rendement dans les propriétés.
func GetTiles(c *gin.Context) {
	z, errZ := strconv.Atoi(c.Param("z"))
	x, errX := strconv.Atoi(c.Param("x"))
	yRaw := strings.TrimSuffix(c.Param("y"), ".mvt")
	y, errY := strconv.Atoi(yRaw)

	if errZ != nil || errX != nil || errY != nil || z < 0 || z > 20 {
		c.Status(http.StatusBadRequest)
		return
	}

	ctx := c.Request.Context()
	var mvt []byte

	err := db.Pool.QueryRow(ctx, `
		SELECT COALESCE(ST_AsMVT(tile, 'communes', 4096, 'geom'), ''::bytea)
		FROM (
			SELECT
				c.code_insee,
				c.nom,
				TRIM(c.departement)                               AS dept,
				ROUND(ca.prix_median_m2::numeric, 0)::int         AS prix_m2,
				ROUND(ca.score_investissement::numeric, 1)::float AS score_inv,
				ROUND(ca.score_qualite_vie::numeric, 1)::float    AS score_qv,
				ROUND(ca.rendement_locatif_brut::numeric, 2)::float AS rendement,
				ST_AsMVTGeom(
					ST_Transform(c.geom, 3857),
					ST_TileEnvelope($1, $2, $3),
					4096, 64, true
				) AS geom
			FROM communes c
			LEFT JOIN communes_agregat ca ON ca.code_commune = c.code_insee
			WHERE c.geom IS NOT NULL
			  AND ST_Intersects(
					c.geom,
					ST_Transform(ST_TileEnvelope($1, $2, $3), 4326)
			  )
		) AS tile
		WHERE geom IS NOT NULL
	`, z, x, y).Scan(&mvt)

	if err != nil || len(mvt) == 0 {
		c.Status(http.StatusNoContent)
		return
	}

	c.Header("Cache-Control", "public, max-age=3600")
	c.Data(http.StatusOK, "application/x-protobuf", mvt)
}
