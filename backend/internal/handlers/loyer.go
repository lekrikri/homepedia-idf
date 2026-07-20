package handlers

import (
	"context"
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
// Communes soumises à l'encadrement des loyers, codes INSEE vérifiés en base.
//
// La première version de cette table, saisie de mémoire, comportait trois
// erreurs aux conséquences opposées : Le Bourget et Neuilly-Plaisance y
// figuraient alors qu'elles ne sont soumises à aucun encadrement — un locataire
// aurait cru pouvoir contester un loyer parfaitement légal ; et Pierrefitte,
// Noisy-le-Sec, Romainville et Le Pré-Saint-Gervais en étaient absentes, privant
// leurs locataires d'un droit à récupération. Épinay-sur-Seine était rattachée à
// la mauvaise intercommunalité.
var communesEncadrement = map[string]string{
	"75056": "Paris",

	// Plaine Commune — 9 communes
	"93001": "Plaine Commune", // Aubervilliers
	"93027": "Plaine Commune", // La Courneuve
	"93031": "Plaine Commune", // Épinay-sur-Seine
	"93039": "Plaine Commune", // L'Île-Saint-Denis
	"93059": "Plaine Commune", // Pierrefitte-sur-Seine
	"93066": "Plaine Commune", // Saint-Denis
	"93070": "Plaine Commune", // Saint-Ouen-sur-Seine
	"93072": "Plaine Commune", // Stains
	"93079": "Plaine Commune", // Villetaneuse

	// Est Ensemble — 9 communes
	"93006": "Est Ensemble", // Bagnolet
	"93008": "Est Ensemble", // Bobigny
	"93010": "Est Ensemble", // Bondy
	"93045": "Est Ensemble", // Les Lilas
	"93048": "Est Ensemble", // Montreuil
	"93053": "Est Ensemble", // Noisy-le-Sec
	"93055": "Est Ensemble", // Pantin
	"93061": "Est Ensemble", // Le Pré-Saint-Gervais
	"93063": "Est Ensemble", // Romainville
}

// ControleEncadrement confronte un loyer au plafond légal.
//
// Le plafond dépend du quartier, du nombre de pièces, de l'époque de
// construction et du caractère meublé. Sans ces précisions, on ne peut donner
// qu'une fourchette des plafonds de la commune — d'où le champ Certain, qui
// indique si le contrôle porte sur un plafond unique ou sur cette fourchette.
type ControleEncadrement struct {
	LoyerMajoreMin  float64 `json:"loyer_majore_min"`
	LoyerMajoreMax  float64 `json:"loyer_majore_max"`
	LoyerM2Demande  float64 `json:"loyer_m2_demande"`
	Depassement     bool    `json:"depassement"`
	DepassementMois *int    `json:"depassement_mensuel,omitempty"`
	DepassementAn   *int    `json:"depassement_annuel,omitempty"`
	Certain         bool    `json:"controle_certain"`
	Message         string  `json:"message"`
	Millesime       int     `json:"millesime"`
}

type LoyerResponse struct {
	CodeCommune   string   `json:"code_commune"`
	Ville         string   `json:"ville"`
	SurfaceM2     float64  `json:"surface_m2,omitempty"`
	LoyerMedianM2 float64  `json:"loyer_median_m2"`
	LoyerEstime   *int     `json:"loyer_estime,omitempty"`
	LoyerBas      *int     `json:"loyer_bas,omitempty"`
	LoyerHaut     *int     `json:"loyer_haut,omitempty"`

	LoyerRefAjusteM2 *float64 `json:"loyer_reference_ajuste_m2,omitempty"`

	LoyerDemande   int      `json:"loyer_demande,omitempty"`
	LoyerM2Demande *float64 `json:"loyer_m2_demande,omitempty"`
	EcartPct       *float64 `json:"ecart_pct,omitempty"`
	Verdict        string   `json:"verdict,omitempty"`
	NoteMethode    string   `json:"note_methode,omitempty"`

	Encadrement     bool   `json:"encadrement_applicable"`
	ZoneEncadrement string `json:"zone_encadrement,omitempty"`
	NoteEncadrement string `json:"note_encadrement,omitempty"`
	Controle        *ControleEncadrement `json:"controle_encadrement,omitempty"`

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

	// Tout ce qui dépend du bien (surface, loyer demandé, contrôle du plafond) est
	// calculé après la lecture du cache, dans repondre() : n'est mis en cache que
	// ce qui ne dépend que de la commune.
	cacheKey := "loyer_" + codeCommune
	var resp LoyerResponse
	if data, ok := cache.Global.Get(cacheKey); ok {
		if err := json.Unmarshal(data, &resp); err == nil {
			c.Header("X-Cache", "HIT")
			repondre(c, &resp, codeCommune, surface, loyerDemande)
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

	repondre(c, &resp, codeCommune, surface, loyerDemande)
}

// repondre applique les calculs propres au bien puis renvoie la réponse.
// Appelé depuis les deux chemins, avec et sans cache : les y dupliquer avait
// fait disparaître le contrôle du plafond dès le second appel.
func repondre(c *gin.Context, resp *LoyerResponse, codeCommune string, surface float64, loyerDemande int) {
	pieces, _ := strconv.Atoi(c.Query("pieces"))
	meuble := c.Query("meuble") == "true"
	enrichirLoyer(c.Request.Context(), resp, codeCommune, pieces, meuble, surface, loyerDemande)
	if resp.Encadrement && loyerDemande > 0 && surface > 0 {
		resp.Controle = controlerEncadrement(
			c.Request.Context(), codeCommune, pieces, meuble, surface, loyerDemande)
	}
	c.JSON(http.StatusOK, *resp)
}

// controlerEncadrement compare le loyer au plafond légal du secteur.
//
// Un dépassement se récupère sur trois ans : le chiffrer annuellement rend
// tangible ce qui reste sinon une notion abstraite.
func controlerEncadrement(
	ctx context.Context, codeCommune string, pieces int, meuble bool,
	surface float64, loyerDemande int,
) *ControleEncadrement {
	filtre := ""
	args := []any{codeCommune, meuble}
	if pieces > 0 {
		// Au-delà de 4 pièces, les barèmes s'arrêtent à la dernière tranche.
		if pieces > 4 {
			pieces = 4
		}
		filtre = "AND nb_pieces = $3"
		args = append(args, pieces)
	}

	var mini, maxi float64
	var nb, millesime int
	err := db.Pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT MIN(loyer_reference_majore), MAX(loyer_reference_majore),
		       COUNT(*), MAX(annee)
		FROM encadrement_loyers
		WHERE code_commune = $1 AND meuble = $2 %s
		  AND annee = (SELECT MAX(annee) FROM encadrement_loyers WHERE code_commune = $1)
	`, filtre), args...).Scan(&mini, &maxi, &nb, &millesime)
	if err != nil || nb == 0 {
		return nil
	}

	loyerM2 := float64(loyerDemande) / surface
	ctrl := &ControleEncadrement{
		LoyerMajoreMin: mini,
		LoyerMajoreMax: maxi,
		LoyerM2Demande: math.Round(loyerM2*100) / 100,
		Certain:        mini == maxi,
		Millesime:      millesime,
	}

	switch {
	case loyerM2 > maxi:
		// Au-dessus du plafond le plus élevé de la commune : le dépassement est
		// acquis quel que soit le quartier exact.
		ctrl.Depassement = true
		ctrl.Certain = true
		mensuel := int(math.Round((loyerM2 - maxi) * surface))
		annuel := mensuel * 12
		ctrl.DepassementMois, ctrl.DepassementAn = &mensuel, &annuel
		ctrl.Message = fmt.Sprintf(
			"Ce loyer dépasse le loyer de référence majoré le plus élevé de la commune "+
				"(%.1f €/m²), quel que soit le quartier. Le dépassement représente %d € par mois, "+
				"soit %d € par an, récupérables sur trois ans. Demandez au bailleur le loyer de "+
				"référence inscrit au bail, puis saisissez la commission départementale de "+
				"conciliation en cas de refus.",
			maxi, mensuel, annuel)
	case loyerM2 > mini:
		ctrl.Message = fmt.Sprintf(
			"Les plafonds de la commune vont de %.1f à %.1f €/m² selon le quartier et l'époque "+
				"de construction. À %.1f €/m², ce loyer dépasse les plafonds les plus bas : "+
				"exigez le loyer de référence exact, il doit figurer dans le bail.",
			mini, maxi, loyerM2)
	default:
		ctrl.Message = fmt.Sprintf(
			"Ce loyer respecte les plafonds de la commune, dont le plus bas s'établit à %.1f €/m².",
			mini)
	}
	return ctrl
}

// referenceOfficielle renvoie le loyer de référence de l'arrêté préfectoral pour
// la commune et le nombre de pièces, moyenné sur les quartiers et les époques de
// construction.
//
// Ce n'est pas le plafond — celui-ci dépend du quartier exact et figure au bail —
// mais le point de comparaison honnête pour situer un loyer, là où l'estimation
// dérivée des prix de vente se révélait basse de 12 à 24 %.
func referenceOfficielle(ctx context.Context, codeCommune string, pieces int, meuble bool) (float64, bool) {
	if pieces > 4 {
		pieces = 4 // les barèmes s'arrêtent à « 4 pièces et plus »
	}
	filtre, args := "", []any{codeCommune, meuble}
	if pieces > 0 {
		filtre = "AND nb_pieces = $3"
		args = append(args, pieces)
	}

	var moyenne float64
	var nb int
	err := db.Pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT COALESCE(AVG(loyer_reference), 0), COUNT(*)
		FROM encadrement_loyers
		WHERE code_commune = $1 AND meuble = $2 %s
		  AND annee = (SELECT MAX(annee) FROM encadrement_loyers WHERE code_commune = $1)
	`, filtre), args...).Scan(&moyenne, &nb)
	if err != nil || nb == 0 || moyenne <= 0 {
		return 0, false
	}
	return moyenne, true
}

// coefficientSurface corrige le biais de taille.
//
// Le loyer de référence est une moyenne toutes surfaces confondues. Or les
// petits logements se louent nettement plus cher au mètre carré : les pièces
// incompressibles (cuisine, salle de bains) y pèsent proportionnellement plus.
// Comparer un studio à une moyenne incluant des quatre-pièces conduit à le
// déclarer surévalué à tort.
func coefficientSurface(surface float64) float64 {
	switch {
	case surface <= 0:
		return 1.0
	case surface < 25:
		return 1.35
	case surface < 40:
		return 1.22
	case surface < 60:
		return 1.10
	case surface < 80:
		return 1.0
	case surface < 100:
		return 0.94
	default:
		return 0.90
	}
}

func enrichirLoyer(ctx context.Context, resp *LoyerResponse, codeCommune string,
	pieces int, meuble bool, surface float64, loyerDemande int) {
	if surface > 0 {
		resp.SurfaceM2 = surface
		coef := coefficientSurface(surface)
		refM2 := resp.LoyerMedianM2 * coef
		resp.LoyerRefAjusteM2 = &refM2

		estime := int(refM2 * surface)
		// Fourchette large et assumée : la référence est estimée à partir d'une
		// moyenne départementale, elle ne distingue ni l'étage, ni l'état, ni le
		// caractère meublé.
		bas := int(float64(estime) * 0.82)
		haut := int(float64(estime) * 1.18)
		resp.LoyerEstime, resp.LoyerBas, resp.LoyerHaut = &estime, &bas, &haut
	}

	if loyerDemande > 0 && surface > 0 {
		resp.LoyerDemande = loyerDemande
		m2 := math.Round((float64(loyerDemande)/surface)*100) / 100
		resp.LoyerM2Demande = &m2
		// La référence officielle, quand elle existe, l'emporte sur notre
		// estimation. Confrontée aux barèmes préfectoraux là où les deux sont
		// disponibles, l'estimation dérivée des prix de vente s'est révélée
		// basse de 12 à 24 % dans les communes populaires (−24 % à Villetaneuse,
		// −21 % à Épinay et La Courneuve, −12 % à Aubervilliers), juste à Paris
		// et Saint-Ouen. Un locataire s'y voyait annoncer un loyer « supérieur
		// au marché » alors qu'il était légal, et sous le plafond.
		//
		// Les barèmes étant déjà ventilés par nombre de pièces, l'ajustement de
		// surface ne s'applique qu'à notre estimation, qui mélange les tailles.
		ref := resp.LoyerMedianM2 * coefficientSurface(surface)
		refOfficielle, dispo := referenceOfficielle(ctx, codeCommune, pieces, meuble)
		if dispo {
			ref = refOfficielle
		}
		ecart := math.Round(((m2-ref)/ref)*1000) / 10
		resp.EcartPct = &ecart

		// Les seuils sont larges à dessein : la référence est estimée à partir
		// d'une moyenne départementale de 2022, pas observée à la commune. Un
		// verdict tranché sur une donnée approchée induit l'utilisateur en erreur.
		switch {
		case ecart <= -20:
			resp.Verdict = "Loyer sensiblement inférieur à l'estimation de marché. Vérifiez " +
				"l'état du logement, son DPE et le montant des charges avant de vous réjouir."
		case ecart <= -10:
			resp.Verdict = "Loyer plutôt inférieur à l'estimation de marché."
		case ecart < 15:
			resp.Verdict = "Loyer cohérent avec l'estimation de marché, compte tenu de " +
				"l'imprécision de la référence."
		case ecart < 35:
			resp.Verdict = "Loyer plutôt supérieur à l'estimation de marché. L'écart peut " +
				"s'expliquer par l'étage, l'état ou les prestations — demandez ce qui le justifie."
		default:
			resp.Verdict = "Loyer très supérieur à l'estimation de marché."
		}
		if resp.Encadrement && ecart >= 15 {
			resp.Verdict += " Cette commune appliquant l'encadrement, réclamez le loyer de " +
				"référence majoré inscrit au bail : c'est lui qui fait foi, pas cette estimation."
		}
		if dispo {
			resp.NoteMethode = "Comparaison établie sur le loyer de référence de l'arrêté " +
				"préfectoral, pour ce nombre de pièces — et non sur une estimation. Il s'entend " +
				"hors charges : comparez avec votre loyer principal, pas avec le total appelé. " +
				"Le plafond applicable dépend du quartier exact et de l'année de construction ; " +
				"il figure obligatoirement dans votre bail."
		} else {
			resp.NoteMethode = "Référence estimée à partir d'une moyenne départementale 2022, " +
				"ajustée à la surface. Elle s'entend hors charges : comparez avec votre loyer " +
				"principal, pas avec le total appelé. Là où les barèmes préfectoraux existent, " +
				"cette estimation s'est révélée basse de 12 à 24 % : un loyer un peu au-dessus " +
				"n'a donc rien d'anormal. Seul le loyer de référence préfectoral est opposable."
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
