package handlers

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
	"homepedia/backend/internal/models"
)

// ListTransactions handles GET /api/v1/transactions
// Query params:
//   - commune      (string) — code INSEE commune (ex: "92012")
//   - departement  (string) — code département (ex: "92")
//   - type_local   (string) — Appartement | Maison | Local industriel…
//   - annee        (int)    — année de mutation (2019-2024)
//   - dpe          (string) — classe énergie A-G
//   - prix_min     (int)    — prix minimum en €
//   - prix_max     (int)    — prix maximum en €
//   - surface_min  (int)    — surface minimum en m²
//   - surface_max  (int)    — surface maximum en m²
//   - pieces       (int)    — nombre de pièces
//   - sort_by      (string) — date_mutation | valeur_fonciere | prix_m2 | surface_reelle_bati
//   - sort_order   (string) — asc | desc (default: desc)
//   - limit        (int, default 50, max 5000)
//   - offset       (int, default 0)
func ListTransactions(c *gin.Context) {
	limit  := queryInt(c, "limit", 50, 5000)
	offset := queryInt(c, "offset", 0, -1)

	// Filtres
	commune    := c.Query("commune")
	dept       := c.Query("departement")
	typeLocal  := c.Query("type_local")
	annee      := c.Query("annee")
	dpe        := c.Query("dpe")
	prixMin    := c.Query("prix_min")
	prixMax    := c.Query("prix_max")
	surfaceMin := c.Query("surface_min")
	surfaceMax := c.Query("surface_max")
	pieces     := c.Query("pieces")

	// Tri
	sortBy    := c.DefaultQuery("sort_by", "date_mutation")
	sortOrder := strings.ToUpper(c.DefaultQuery("sort_order", "DESC"))
	if sortOrder != "ASC" {
		sortOrder = "DESC"
	}
	allowedSorts := map[string]string{
		"date_mutation":     "date_mutation",
		"valeur_fonciere":   "valeur_fonciere",
		"prix_m2":           "(valeur_fonciere / NULLIF(surface_reelle_bati, 0))",
		"surface_reelle_bati": "surface_reelle_bati",
	}
	sortCol, ok := allowedSorts[sortBy]
	if !ok {
		sortCol = "date_mutation"
	}

	// Construction dynamique des WHERE clauses
	args := []interface{}{}
	conditions := []string{}
	argIdx := 1

	addCond := func(cond string, val interface{}) {
		conditions = append(conditions, fmt.Sprintf(cond, argIdx))
		args = append(args, val)
		argIdx++
	}

	if commune != "" {
		addCond("code_commune = $%d", commune)
	}
	if dept != "" {
		addCond("LEFT(code_commune, 2) = $%d", dept)
	}
	if typeLocal != "" {
		addCond("type_local ILIKE $%d", typeLocal)
	}
	if annee != "" {
		addCond("EXTRACT(YEAR FROM date_mutation)::text = $%d", annee)
	}
	if dpe != "" {
		addCond("classe_energie = $%d", strings.ToUpper(dpe))
	}
	if prixMin != "" {
		addCond("valeur_fonciere >= $%d", prixMin)
	}
	if prixMax != "" {
		addCond("valeur_fonciere <= $%d", prixMax)
	}
	if surfaceMin != "" {
		addCond("surface_reelle_bati >= $%d", surfaceMin)
	}
	if surfaceMax != "" {
		addCond("surface_reelle_bati <= $%d", surfaceMax)
	}
	if pieces != "" {
		addCond("nombre_pieces = $%d", pieces)
	}

	where := "WHERE 1=1"
	if len(conditions) > 0 {
		where += " AND " + strings.Join(conditions, " AND ")
	}

	// COUNT total (pour pagination)
	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM transactions %s`, where)
	var total int64
	if err := db.Pool.QueryRow(c.Request.Context(), countQuery, args...).Scan(&total); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "count error: " + err.Error()})
		return
	}

	// Données paginées
	dataQuery := fmt.Sprintf(`
		SELECT id, TO_CHAR(date_mutation, 'YYYY-MM-DD'), nature_mutation, valeur_fonciere,
		       adresse_numero, adresse_voie, code_postal, commune, code_commune,
		       type_local, surface_reelle_bati, nombre_pieces,
		       longitude, latitude, classe_energie, source_annee
		FROM transactions
		%s
		ORDER BY %s %s NULLS LAST
		LIMIT $%d OFFSET $%d`,
		where, sortCol, sortOrder, argIdx, argIdx+1,
	)
	args = append(args, limit, offset)

	rows, err := db.Pool.Query(c.Request.Context(), dataQuery, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database error: " + err.Error()})
		return
	}
	defer rows.Close()

	var txs []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(
			&t.ID, &t.DateMutation, &t.NatureMutation, &t.ValeurFonciere,
			&t.AdresseNumero, &t.Adresse, &t.CodePostal, &t.Commune, &t.CodeCommune,
			&t.TypeLocal, &t.SurfaceReelleBati, &t.NombrePieces,
			&t.Longitude, &t.Latitude, &t.ClasseEnergie, &t.SourceAnnee,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "scan error"})
			return
		}
		txs = append(txs, t)
	}
	if txs == nil {
		txs = []models.Transaction{}
	}

	c.JSON(http.StatusOK, gin.H{
		"data":   txs,
		"count":  len(txs),
		"total":  total,
		"offset": offset,
		"limit":  limit,
	})
}

// GetTransaction handles GET /api/v1/transactions/:id
func GetTransaction(c *gin.Context) {
	id := c.Param("id")

	var t models.Transaction
	err := db.Pool.QueryRow(c.Request.Context(),
		`SELECT id, TO_CHAR(date_mutation, 'YYYY-MM-DD'), nature_mutation, valeur_fonciere,
		        adresse_numero, adresse_voie, code_postal, commune, code_commune,
		        type_local, surface_reelle_bati, nombre_pieces,
		        longitude, latitude, classe_energie, source_annee
		 FROM transactions WHERE id = $1`, id,
	).Scan(
		&t.ID, &t.DateMutation, &t.NatureMutation, &t.ValeurFonciere,
		&t.AdresseNumero, &t.Adresse, &t.CodePostal, &t.Commune, &t.CodeCommune,
		&t.TypeLocal, &t.SurfaceReelleBati, &t.NombrePieces,
		&t.Longitude, &t.Latitude, &t.ClasseEnergie, &t.SourceAnnee,
	)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
		return
	}

	c.JSON(http.StatusOK, t)
}
