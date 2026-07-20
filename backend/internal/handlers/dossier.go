package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/cache"
	"homepedia/backend/internal/db"
)

// Nombre minimal de ventes pour qu'une commune entre dans la sélection : en
// dessous, les percentiles sautent d'une commune à l'autre sans signification.
const minVentesDossier = 40

type CommuneDossier struct {
	CodeCommune string `json:"code_commune"`
	Ville       string `json:"ville"`
	Departement string `json:"departement"`

	NbVentes  int `json:"nb_ventes"`
	PrixM2P25 int `json:"prix_m2_p25"`
	PrixM2Med int `json:"prix_m2_median"`
	PrixM2P75 int `json:"prix_m2_p75"`

	BudgetAuP25 int `json:"budget_au_p25"`
	BudgetMedian int `json:"budget_median"`

	PctDpeBon    *float64 `json:"pct_dpe_bon,omitempty"`
	ScoreSecu    *int     `json:"score_securite,omitempty"`
	ScoreAcces   *int     `json:"score_accessibilite,omitempty"`
	ScoreVie     *int     `json:"score_qualite_vie,omitempty"`
	LoyerM2      *float64 `json:"loyer_median_m2,omitempty"`
	TauxTF       *float64 `json:"taux_tf_global,omitempty"`
	TaxeFonciere *int     `json:"taxe_fonciere_estimee,omitempty"`

	Accessible bool   `json:"accessible_au_p25"`
	Remarque   string `json:"remarque,omitempty"`
}

type DossierResponse struct {
	Budget      int              `json:"budget"`
	Surface     float64          `json:"surface"`
	Pieces      int              `json:"pieces"`
	TypeLocal   string           `json:"type_local"`
	Critere     string           `json:"critere"`
	Departements []string        `json:"departements"`
	NbCommunes  int              `json:"nb_communes"`
	Communes    []CommuneDossier `json:"communes"`
	Synthese    string           `json:"synthese,omitempty"`
}

// Les valeurs sont des fragments SQL : elles ne viennent jamais de l'utilisateur,
// seule la clé est comparée à la requête. Le tri secondaire par prix départage
// les communes à score égal.
//
// Le classement énergétique ne retient que les communes disposant d'au moins
// trente diagnostics. En dessous, la proportion est du bruit : Épiais-lès-Louvres
// affichait « 66,7 % de logements bien classés » sur trois diagnostics, et
// arrivait donc en tête d'un critère censé désigner les communes où l'on évite
// d'acheter une passoire thermique.
var criteresValides = map[string]string{
	"prix":       "v.p25 ASC",
	"dpe":        "CASE WHEN ca.nb_dpe >= 30 THEN ca.pct_dpe_bon END DESC NULLS LAST, v.p25 ASC",
	"transports": "ca.score_accessibilite DESC NULLS LAST, v.p25 ASC",
	"cadre_vie":  "ca.score_qualite_vie DESC NULLS LAST, v.p25 ASC",
	"securite":   "ca.score_securite_commune DESC NULLS LAST, v.p25 ASC",
}

// GetDossier handles GET /api/v1/dossier
//
// Construit une short-list de communes pour une recherche : là où l'estimation
// répond "ce bien est-il au bon prix ?", le dossier répond "où chercher ?".
//
// Params : budget, surface, pieces, type_local, departements (csv), critere
func GetDossier(c *gin.Context) {
	budget, _ := strconv.Atoi(c.Query("budget"))
	surface, _ := strconv.ParseFloat(c.DefaultQuery("surface", "40"), 64)
	pieces, _ := strconv.Atoi(c.DefaultQuery("pieces", "2"))
	typeLocal := c.DefaultQuery("type_local", "Appartement")
	critere := strings.ToLower(c.DefaultQuery("critere", "prix"))

	tri, ok := criteresValides[critere]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "critère inconnu",
			"attendu": []string{"prix", "dpe", "transports", "cadre_vie", "securite"},
		})
		return
	}
	if surface <= 0 {
		surface = 40
	}

	var deps []string
	if raw := strings.TrimSpace(c.Query("departements")); raw != "" {
		for _, d := range strings.Split(raw, ",") {
			if d = strings.TrimSpace(d); d != "" {
				deps = append(deps, d)
			}
		}
	}

	cacheKey := fmt.Sprintf("dossier_%s_%d_%s_%s", typeLocal, pieces, critere, strings.Join(deps, "-"))
	var communes []CommuneDossier
	if data, ok := cache.Global.Get(cacheKey); ok {
		_ = json.Unmarshal(data, &communes)
	}

	if communes == nil {
		var err error
		communes, err = communesDossier(c, typeLocal, pieces, deps, tri)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if data, err := json.Marshal(communes); err == nil {
			cache.Global.Set(cacheKey, data, time.Hour)
		}
	}

	// Le budget dépend de l'utilisateur, pas de la commune : il s'applique après
	// le cache, comme pour l'estimation.
	sortie := make([]CommuneDossier, 0, len(communes))
	for _, cm := range communes {
		cm.BudgetAuP25 = int(float64(cm.PrixM2P25) * surface)
		cm.BudgetMedian = int(float64(cm.PrixM2Med) * surface)
		cm.Accessible = budget <= 0 || cm.BudgetAuP25 <= budget

		if cm.PctDpeBon != nil && *cm.PctDpeBon <= 0.02 {
			cm.Remarque = "Parc énergétique très dégradé : moins de 2 % de logements classés A, B ou C."
		}
		if budget > 0 && !cm.Accessible {
			continue
		}
		sortie = append(sortie, cm)
	}

	resp := DossierResponse{
		Budget: budget, Surface: surface, Pieces: pieces, TypeLocal: typeLocal,
		Critere: critere, Departements: deps,
		NbCommunes: len(sortie), Communes: sortie,
	}
	resp.Synthese = synthese(sortie, budget, surface, critere)

	c.JSON(http.StatusOK, resp)
}

func communesDossier(c *gin.Context, typeLocal string, pieces int, deps []string, tri string) ([]CommuneDossier, error) {
	filtreDept := ""
	args := []any{typeLocal, pieces, minVentesDossier}
	if len(deps) > 0 {
		filtreDept = "AND TRIM(ca.code_departement) = ANY($4)"
		args = append(args, deps)
	}

	sql := fmt.Sprintf(`
		WITH ventes AS (
			SELECT code_commune,
			       COUNT(*) AS nb,
			       PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY valeur_fonciere / NULLIF(surface_reelle_bati, 0))::int AS p25,
			       PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY valeur_fonciere / NULLIF(surface_reelle_bati, 0))::int AS med,
			       PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY valeur_fonciere / NULLIF(surface_reelle_bati, 0))::int AS p75
			FROM transactions
			WHERE type_local ILIKE $1 AND nombre_pieces = $2
			  AND valeur_fonciere > 0 AND surface_reelle_bati > 0
			  AND valeur_fonciere / NULLIF(surface_reelle_bati, 0) BETWEEN %f AND %f
			GROUP BY code_commune
			HAVING COUNT(*) >= $3
		)
		SELECT ca.code_commune, ca.city, TRIM(ca.code_departement),
		       v.nb, v.p25, v.med, v.p75,
		       CASE WHEN ca.nb_dpe >= 30 THEN ca.pct_dpe_bon END,
		       COALESCE(ca.score_securite_commune, ca.score_securite::int),
		       ca.score_accessibilite::int,
		       ca.score_qualite_vie::int, ca.loyer_median_m2,
		       ca.taux_tf_global,
		       CASE WHEN ca.tf_estimation_fiable THEN ca.taxe_fonciere_estimee END
		FROM ventes v
		JOIN communes_agregat ca ON ca.code_commune = v.code_commune
		WHERE 1 = 1 %s
		ORDER BY %s
		LIMIT 40
	`, prixM2Min, prixM2Max, filtreDept, tri)

	rows, err := db.Pool.Query(c.Request.Context(), sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []CommuneDossier{}
	for rows.Next() {
		var cm CommuneDossier
		if err := rows.Scan(&cm.CodeCommune, &cm.Ville, &cm.Departement,
			&cm.NbVentes, &cm.PrixM2P25, &cm.PrixM2Med, &cm.PrixM2P75,
			&cm.PctDpeBon, &cm.ScoreSecu, &cm.ScoreAcces, &cm.ScoreVie, &cm.LoyerM2,
			&cm.TauxTF, &cm.TaxeFonciere); err == nil {
			out = append(out, cm)
		}
	}
	return out, rows.Err()
}

func synthese(communes []CommuneDossier, budget int, surface float64, critere string) string {
	if len(communes) == 0 {
		if budget > 0 {
			return "Aucune commune ne propose ce type de bien sous votre budget au premier " +
				"quartile. Élargissez les départements, réduisez la surface, ou augmentez le budget."
		}
		return "Aucune commune ne réunit assez de ventes comparables pour une estimation fiable."
	}

	premiere := communes[0]
	libelle := map[string]string{
		"prix":       "le prix",
		"dpe":        "la qualité du parc énergétique",
		"transports": "la desserte en transports",
		"cadre_vie":  "le cadre de vie",
		"securite":   "la sécurité",
	}[critere]

	s := fmt.Sprintf(
		"%d communes correspondent à votre recherche. Classées selon %s, %s arrive en tête : "+
			"un bien de %.0f m² au premier quartile y représente %s.",
		len(communes), libelle, premiere.Ville, surface,
		formatEur(float64(premiere.BudgetAuP25)))

	if budget > 0 {
		s += fmt.Sprintf(" Toutes celles affichées sont accessibles sous %s au premier quartile ; "+
			"au prix médian, il faut compter davantage.", formatEur(float64(budget)))
	}
	return s
}
