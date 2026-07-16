package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// ExportTransactionsCSV — GET /api/v1/transactions/export
// Exporte les transactions filtrées au format CSV (max 10 000 lignes).
// Accepte les mêmes query params que ListTransactions.
func ExportTransactionsCSV(c *gin.Context) {
	ctx := c.Request.Context()

	commune   := c.Query("commune")
	dept      := c.Query("departement")
	typeLocal := c.Query("type_local")
	annee     := c.Query("annee")
	dpe       := c.Query("dpe")
	prixMin   := c.Query("prix_min")
	prixMax   := c.Query("prix_max")

	args := []interface{}{}
	conditions := []string{}
	idx := 1

	add := func(cond string, val interface{}) {
		conditions = append(conditions, fmt.Sprintf(cond, idx))
		args = append(args, val)
		idx++
	}
	if commune   != "" { add("code_commune = $%d", commune) }
	if dept      != "" { add("LEFT(code_commune, 2) = $%d", dept) }
	if typeLocal != "" { add("type_local ILIKE $%d", typeLocal) }
	if annee     != "" { add("EXTRACT(YEAR FROM date_mutation)::int = $%d", annee) }
	if dpe       != "" { add("classe_energie = $%d", strings.ToUpper(dpe)) }
	if prixMin   != "" { add("valeur_fonciere >= $%d", prixMin) }
	if prixMax   != "" { add("valeur_fonciere <= $%d", prixMax) }

	where := "WHERE valeur_fonciere IS NOT NULL AND surface_reelle_bati > 0"
	if len(conditions) > 0 {
		where += " AND " + strings.Join(conditions, " AND ")
	}

	args = append(args, 10000)
	query := fmt.Sprintf(`
		SELECT
		  TO_CHAR(date_mutation, 'YYYY-MM-DD') AS date,
		  nature_mutation,
		  commune,
		  code_commune,
		  TRIM(LEFT(code_commune,2)) AS departement,
		  type_local,
		  ROUND(valeur_fonciere::numeric, 0) AS prix_total_eur,
		  ROUND(surface_reelle_bati::numeric, 1) AS surface_m2,
		  ROUND((valeur_fonciere / NULLIF(surface_reelle_bati,0))::numeric, 0) AS prix_m2,
		  nombre_pieces,
		  COALESCE(classe_energie, '') AS dpe,
		  COALESCE(adresse_numero||' ', '')||COALESCE(adresse_voie, '') AS adresse,
		  code_postal
		FROM transactions
		%s
		ORDER BY date_mutation DESC
		LIMIT $%d
	`, where, idx)

	rows, err := db.Pool.Query(ctx, query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	filename := fmt.Sprintf("homepedia_transactions_%s.csv", time.Now().Format("20060102"))
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	c.Header("Cache-Control", "no-cache")

	w := c.Writer
	// BOM UTF-8 pour Excel
	w.Write([]byte("\xEF\xBB\xBF"))
	// En-tête CSV
	fmt.Fprintln(w, "date,nature,commune,code_commune,departement,type,prix_total_eur,surface_m2,prix_m2,pieces,dpe,adresse,code_postal")

	count := 0
	for rows.Next() {
		var date, nature, commune2, code, dept2, typeL, dpe2, adresse, cp string
		var prixTotal, surface, prixM2 float64
		var pieces int
		if err := rows.Scan(&date, &nature, &commune2, &code, &dept2, &typeL,
			&prixTotal, &surface, &prixM2, &pieces, &dpe2, &adresse, &cp); err != nil {
			continue
		}
		adresse = strings.ReplaceAll(adresse, `"`, `""`)
		commune2 = strings.ReplaceAll(commune2, `"`, `""`)
		fmt.Fprintf(w, "%s,%s,\"%s\",%s,%s,%s,%.0f,%.1f,%.0f,%d,%s,\"%s\",%s\n",
			date, nature, commune2, code, dept2, typeL,
			prixTotal, surface, prixM2, pieces, dpe2, adresse, cp)
		count++
	}

	// Flush explicite si gin bufferise
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	_ = count
}
