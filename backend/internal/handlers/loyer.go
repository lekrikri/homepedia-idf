package handlers

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/cache"
	"homepedia/backend/internal/db"
)

// Intercommunalités appliquant l'encadrement des loyers en Île-de-France.
// Le dispositif y plafonne le loyer à un montant de référence majoré fixé par
// arrêté préfectoral ; un dépassement est récupérable par le locataire.
// La liste des communes concernées est stable, les plafonds eux ne sont pas
// encore ingérés — on signale donc l'applicabilité sans prétendre au contrôle.
var communesEncadrement = map[string]string{
	// Paris
	"75056": "Paris",
	// Plaine Commune (Seine-Saint-Denis)
	"93001": "Plaine Commune", "93027": "Plaine Commune", "93039": "Plaine Commune",
	"93059": "Plaine Commune", "93066": "Plaine Commune", "93070": "Plaine Commune",
	"93072": "Plaine Commune", "93079": "Plaine Commune",
	// Est Ensemble (Seine-Saint-Denis)
	"93006": "Est Ensemble", "93008": "Est Ensemble", "93010": "Est Ensemble",
	"93013": "Est Ensemble", "93031": "Est Ensemble", "93045": "Est Ensemble",
	"93048": "Est Ensemble", "93049": "Est Ensemble", "93055": "Est Ensemble",
}

type LoyerResponse struct {
	CodeCommune   string   `json:"code_commune"`
	Ville         string   `json:"ville"`
	SurfaceM2     float64  `json:"surface_m2,omitempty"`
	LoyerMedianM2 float64  `json:"loyer_median_m2"`
	LoyerEstime   *int     `json:"loyer_estime,omitempty"`
	LoyerBas      *int     `json:"loyer_bas,omitempty"`
	LoyerHaut     *int     `json:"loyer_haut,omitempty"`

	LoyerDemande   int      `json:"loyer_demande,omitempty"`
	LoyerM2Demande *float64 `json:"loyer_m2_demande,omitempty"`
	EcartPct       *float64 `json:"ecart_pct,omitempty"`
	Verdict        string   `json:"verdict,omitempty"`

	Encadrement     bool   `json:"encadrement_applicable"`
	ZoneEncadrement string `json:"zone_encadrement,omitempty"`
	NoteEncadrement string `json:"note_encadrement,omitempty"`

	RendementBrut *float64 `json:"rendement_locatif_brut,omitempty"`
	PrixMedianM2  *float64 `json:"prix_median_m2,omitempty"`
	EffortAchat   *string  `json:"comparaison_achat,omitempty"`
}

// GetLoyer handles GET /api/v1/loyer
//
// Pendant locatif de l'estimation : situe un loyer demandé par rapport au loyer
// médian de la commune, et signale l'encadrement des loyers là où il s'applique.
//
// Params : commune (code INSEE, requis), surface, loyer (montant mensuel CC ou HC)
func GetLoyer(c *gin.Context) {
	codeCommune := strings.TrimSpace(c.Query("commune"))
	if codeCommune == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "paramètre 'commune' requis (code INSEE)"})
		return
	}
	surface, _ := strconv.ParseFloat(c.Query("surface"), 64)
	loyerDemande, _ := strconv.Atoi(c.Query("loyer"))

	cacheKey := "loyer_" + codeCommune
	var resp LoyerResponse
	if data, ok := cache.Global.Get(cacheKey); ok {
		if err := json.Unmarshal(data, &resp); err == nil {
			c.Header("X-Cache", "HIT")
			enrichirLoyer(&resp, surface, loyerDemande)
			c.JSON(http.StatusOK, resp)
			return
		}
	}

	var ville string
	var loyerM2 *float64
	var rendement, prixM2 *float64
	err := db.Pool.QueryRow(c.Request.Context(), `
		SELECT city, loyer_median_m2, rendement_locatif_brut, prix_median_m2
		FROM communes_agregat WHERE code_commune = $1
	`, codeCommune).Scan(&ville, &loyerM2, &rendement, &prixM2)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "commune inconnue"})
		return
	}
	if loyerM2 == nil || *loyerM2 <= 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "aucune donnée de loyer pour cette commune"})
		return
	}

	resp = LoyerResponse{
		CodeCommune:   codeCommune,
		Ville:         ville,
		LoyerMedianM2: *loyerM2,
		RendementBrut: rendement,
		PrixMedianM2:  prixM2,
	}

	if zone, ok := communesEncadrement[codeCommune]; ok {
		resp.Encadrement = true
		resp.ZoneEncadrement = zone
		resp.NoteEncadrement = "Cette commune applique l'encadrement des loyers (" + zone +
			"). Le bail doit mentionner le loyer de référence majoré fixé par arrêté préfectoral. " +
			"Un loyer qui le dépasse, hors complément de loyer justifié et explicitement mentionné, " +
			"est contestable : le trop-perçu peut être récupéré, au besoin via la commission " +
			"départementale de conciliation."
	}

	if data, err := json.Marshal(resp); err == nil {
		cache.Global.Set(cacheKey, data, time.Hour)
	}

	enrichirLoyer(&resp, surface, loyerDemande)
	c.JSON(http.StatusOK, resp)
}

func enrichirLoyer(resp *LoyerResponse, surface float64, loyerDemande int) {
	if surface > 0 {
		resp.SurfaceM2 = surface
		estime := int(resp.LoyerMedianM2 * surface)
		// Fourchette indicative : le loyer médian communal ne distingue ni le
		// type de bien ni l'état, d'où une marge volontairement large.
		bas := int(float64(estime) * 0.85)
		haut := int(float64(estime) * 1.15)
		resp.LoyerEstime, resp.LoyerBas, resp.LoyerHaut = &estime, &bas, &haut
	}

	if loyerDemande > 0 && surface > 0 {
		resp.LoyerDemande = loyerDemande
		m2 := math.Round((float64(loyerDemande)/surface)*100) / 100
		resp.LoyerM2Demande = &m2
		ecart := math.Round(((m2-resp.LoyerMedianM2)/resp.LoyerMedianM2)*1000) / 10
		resp.EcartPct = &ecart

		switch {
		case ecart <= -15:
			resp.Verdict = "Loyer nettement inférieur au marché local. Vérifiez l'état du logement, " +
				"son DPE et le montant des charges avant de vous réjouir."
		case ecart <= -5:
			resp.Verdict = "Loyer inférieur au marché local."
		case ecart < 10:
			resp.Verdict = "Loyer cohérent avec le marché local."
		case ecart < 25:
			resp.Verdict = "Loyer supérieur au marché local. Demandez ce qui le justifie : " +
				"surface exacte, prestations, DPE."
		default:
			resp.Verdict = "Loyer nettement supérieur au marché local."
		}
		if resp.Encadrement && ecart >= 10 {
			resp.Verdict += " Cette commune étant en zone d'encadrement, exigez le loyer de " +
				"référence majoré : le dépassement pourrait être illégal."
		}
	}

	// Un loyer se compare aussi à une mensualité de crédit : c'est l'arbitrage
	// que fait tout locataire qui envisage d'acheter.
	if resp.PrixMedianM2 != nil && surface > 0 && *resp.PrixMedianM2 > 0 {
		prixBien := *resp.PrixMedianM2 * surface
		loyerRef := float64(loyerDemande)
		if loyerRef <= 0 {
			loyerRef = resp.LoyerMedianM2 * surface
		}
		// Mensualité indicative : 20 ans à 3,5 %, apport couvrant les frais.
		mensualite := mensualiteCredit(prixBien, 3.5, 20)
		txt := fmt.Sprintf(
			"Acheter un bien équivalent (%s à %s/m²) représenterait environ %s par mois "+
				"sur 20 ans à 3,5 %%, contre %s de loyer.",
			formatEur(prixBien), formatEur(*resp.PrixMedianM2),
			formatEur(mensualite), formatEur(loyerRef))
		resp.EffortAchat = &txt
	}
}

// mensualiteCredit calcule une mensualité hors assurance par la formule
// d'amortissement classique.
func mensualiteCredit(capital, tauxAnnuelPct float64, dureeAns int) float64 {
	if capital <= 0 || dureeAns <= 0 {
		return 0
	}
	n := float64(dureeAns * 12)
	i := tauxAnnuelPct / 100 / 12
	if i == 0 {
		return capital / n
	}
	return capital * i / (1 - math.Pow(1+i, -n))
}

func formatEur(v float64) string {
	return strconv.FormatInt(int64(math.Round(v)), 10) + " €"
}
