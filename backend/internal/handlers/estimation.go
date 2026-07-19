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

// Frais d'acquisition dans l'ancien : droits de mutation, émoluments du notaire,
// débours et contribution de sécurité immobilière. ~7-8 % du prix de vente.
const tauxFraisNotaireAncien = 0.075

// Bornes de plausibilité : écarte les cessions atypiques (démembrement, vente
// entre proches, lots multiples) qui écrasent les percentiles.
const (
	prixM2Min = 500.0
	prixM2Max = 30000.0
)

type Percentiles struct {
	P10    int `json:"p10"`
	P25    int `json:"p25"`
	Median int `json:"median"`
	P75    int `json:"p75"`
	P90    int `json:"p90"`
}

type PointTendance struct {
	Annee    int `json:"annee"`
	MedianM2 int `json:"median_m2"`
	NbVentes int `json:"nb_ventes"`
}

type Positionnement struct {
	PrixDemande      int     `json:"prix_demande"`
	PrixM2Demande    int     `json:"prix_m2_demande"`
	PercentileEstime int     `json:"percentile_estime"`
	EcartMedianPct   float64 `json:"ecart_median_pct"`
	Verdict          string  `json:"verdict"`
	MargeNegoBasse   int     `json:"marge_nego_basse"`
	MargeNegoHaute   int     `json:"marge_nego_haute"`
}

type CoutAcquisition struct {
	PrixBien         int `json:"prix_bien"`
	FraisNotaire     int `json:"frais_notaire"`
	TotalAcquisition int `json:"total_acquisition"`
}

// CoutDetention : ce que le logement coûte une fois acheté. Absent jusqu'ici de
// l'application, alors que l'écart de taxe foncière entre communes voisines
// dépasse souvent l'écart de prix d'achat sur la durée de détention.
type CoutDetention struct {
	TauxTfGlobal   *float64 `json:"taux_tf_global,omitempty"`
	TaxeFonciere   *int     `json:"taxe_fonciere_estimee,omitempty"`
	EstimationSure bool     `json:"estimation_fiable"`
	Note           string   `json:"note,omitempty"`
}

type PointPrevision struct {
	Annee int `json:"annee"`
	Pred  int `json:"prix_m2_pred"`
	Bas   int `json:"prix_m2_bas"`
	Haut  int `json:"prix_m2_haut"`
}

type Risques struct {
	Inondation  *int `json:"risque_inondation,omitempty"`
	Argile      *int `json:"risque_argile,omitempty"`
	ScoreGlobal *int `json:"score_risques,omitempty"`
	Commentaire string `json:"commentaire,omitempty"`
}

// Copropriete décrit la santé du parc collectif de la commune. Un acheteur
// engage sa signature au-delà de son lot : charges, travaux votés et revente
// dépendent de l'état de la copropriété.
type Copropriete struct {
	Nombre          *int     `json:"nombre,omitempty"`
	TailleMoyenne   *float64 `json:"taille_moyenne_lots,omitempty"`
	PctAidee        *float64 `json:"pct_aidee,omitempty"`
	PctAvant1949    *float64 `json:"pct_avant_1949,omitempty"`
	PeriodeDominante *string `json:"periode_dominante,omitempty"`
	Fiable          bool     `json:"statistiques_fiables"`
	Note            string   `json:"note,omitempty"`
}

type EstimationResponse struct {
	CodeCommune   string           `json:"code_commune"`
	Ville         string           `json:"ville"`
	TypeLocal     string           `json:"type_local"`
	Pieces        int              `json:"pieces,omitempty"`
	SurfaceM2     float64          `json:"surface_m2,omitempty"`
	NbComparables int              `json:"nb_comparables"`
	NiveauCompar  string           `json:"niveau_comparables"`
	PrixM2        Percentiles      `json:"prix_m2"`
	PrixEstime    *Percentiles     `json:"prix_estime,omitempty"`
	Tendance      []PointTendance  `json:"tendance"`
	EvolutionPct  *float64         `json:"evolution_pct,omitempty"`
	Prevision     []PointPrevision `json:"prevision,omitempty"`
	Risques       *Risques         `json:"risques,omitempty"`
	Position      *Positionnement  `json:"positionnement,omitempty"`
	Cout          *CoutAcquisition `json:"cout_acquisition,omitempty"`
	Detention     *CoutDetention   `json:"cout_detention,omitempty"`
	ScoreSecurite *int             `json:"score_securite,omitempty"`
	Copro         *Copropriete     `json:"copropriete,omitempty"`
	Avertissement string           `json:"avertissement,omitempty"`
}

// GetEstimation handles GET /api/v1/estimation
//
// Positionne un bien dans la distribution réelle des ventes DVF comparables.
// La médiane seule ne suffit pas à négocier : c'est l'écart p25-p75 qui indique
// la marge de manœuvre, souvent plus large que l'écart entre deux communes.
//
// Params : commune (code INSEE, requis), pieces, surface, type_local, prix_demande
func GetEstimation(c *gin.Context) {
	codeCommune := strings.TrimSpace(c.Query("commune"))
	if codeCommune == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "paramètre 'commune' requis (code INSEE)"})
		return
	}

	typeLocal := c.DefaultQuery("type_local", "Appartement")
	pieces, _ := strconv.Atoi(c.Query("pieces"))
	surface, _ := strconv.ParseFloat(c.Query("surface"), 64)
	prixDemande, _ := strconv.Atoi(c.Query("prix_demande"))

	cacheKey := fmt.Sprintf("estim_%s_%s_%d", codeCommune, typeLocal, pieces)
	var resp EstimationResponse
	if data, ok := cache.Global.Get(cacheKey); ok {
		if err := json.Unmarshal(data, &resp); err == nil {
			c.Header("X-Cache", "HIT")
			enrichir(&resp, surface, prixDemande)
			c.JSON(http.StatusOK, resp)
			return
		}
	}

	ctx := c.Request.Context()

	var ville string
	if err := db.Pool.QueryRow(ctx,
		`SELECT city FROM communes_agregat WHERE code_commune = $1`, codeCommune).Scan(&ville); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "commune inconnue"})
		return
	}

	// Trois niveaux de repli : on privilégie des comparables précis, mais un
	// échantillon trop mince donne des percentiles instables. Le niveau retenu
	// est renvoyé pour que l'utilisateur sache sur quoi repose l'estimation.
	niveaux := []struct {
		nom    string
		clause string
		args   []any
	}{
		{"commune + type + pièces", `code_commune = $1 AND type_local ILIKE $2 AND nombre_pieces = $3`, []any{codeCommune, typeLocal, pieces}},
		{"commune + type", `code_commune = $1 AND type_local ILIKE $2`, []any{codeCommune, typeLocal}},
		{"département + type + pièces", `LEFT(code_commune, 2) = LEFT($1, 2) AND type_local ILIKE $2 AND nombre_pieces = $3`, []any{codeCommune, typeLocal, pieces}},
	}
	if pieces <= 0 {
		niveaux = niveaux[1:2] // sans nombre de pièces, seul le niveau commune+type a du sens
	}

	const seuilFiable = 30

	for _, n := range niveaux {
		p, nb, err := percentiles(ctx, n.clause, n.args)
		if err != nil || nb == 0 {
			continue
		}
		resp = EstimationResponse{
			CodeCommune: codeCommune, Ville: ville, TypeLocal: typeLocal,
			Pieces: pieces, NbComparables: nb, NiveauCompar: n.nom, PrixM2: p,
		}
		if nb >= seuilFiable {
			break
		}
		resp.Avertissement = fmt.Sprintf(
			"Estimation basée sur seulement %d ventes comparables : à interpréter avec prudence.", nb)
	}

	if resp.NbComparables == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "aucune vente comparable trouvée"})
		return
	}

	resp.Tendance, resp.EvolutionPct = tendance(ctx, codeCommune, typeLocal, pieces)
	resp.Prevision = prevision(ctx, codeCommune)
	resp.Risques = risquesNaturels(ctx, codeCommune)
	resp.Detention, resp.ScoreSecurite = coutDetention(ctx, codeCommune)
	resp.Copro = copropriete(ctx, codeCommune)

	if data, err := json.Marshal(resp); err == nil {
		cache.Global.Set(cacheKey, data, time.Hour)
	}

	enrichir(&resp, surface, prixDemande)
	c.JSON(http.StatusOK, resp)
}

func percentiles(ctx context.Context, clause string, args []any) (Percentiles, int, error) {
	var p Percentiles
	var nb int
	sql := fmt.Sprintf(`
		WITH comparables AS (
			SELECT valeur_fonciere / NULLIF(surface_reelle_bati, 0) AS prix_m2
			FROM transactions
			WHERE %s
			  AND valeur_fonciere > 0 AND surface_reelle_bati > 0
			  AND valeur_fonciere / NULLIF(surface_reelle_bati, 0) BETWEEN %f AND %f
		)
		SELECT
			COUNT(*),
			COALESCE(PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY prix_m2), 0)::int,
			COALESCE(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY prix_m2), 0)::int,
			COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY prix_m2), 0)::int,
			COALESCE(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY prix_m2), 0)::int,
			COALESCE(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY prix_m2), 0)::int
		FROM comparables
	`, clause, prixM2Min, prixM2Max)

	err := db.Pool.QueryRow(ctx, sql, args...).Scan(&nb, &p.P10, &p.P25, &p.Median, &p.P75, &p.P90)
	return p, nb, err
}

func tendance(ctx context.Context, codeCommune, typeLocal string, pieces int) ([]PointTendance, *float64) {
	clause := `code_commune = $1 AND type_local ILIKE $2`
	args := []any{codeCommune, typeLocal}
	if pieces > 0 {
		clause += ` AND nombre_pieces = $3`
		args = append(args, pieces)
	}

	sql := fmt.Sprintf(`
		SELECT source_annee,
		       PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY valeur_fonciere / NULLIF(surface_reelle_bati, 0))::int,
		       COUNT(*)
		FROM transactions
		WHERE %s
		  AND valeur_fonciere > 0 AND surface_reelle_bati > 0
		  AND valeur_fonciere / NULLIF(surface_reelle_bati, 0) BETWEEN %f AND %f
		GROUP BY source_annee
		HAVING COUNT(*) >= 5
		ORDER BY source_annee
	`, clause, prixM2Min, prixM2Max)

	rows, err := db.Pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, nil
	}
	defer rows.Close()

	points := []PointTendance{}
	for rows.Next() {
		var p PointTendance
		if err := rows.Scan(&p.Annee, &p.MedianM2, &p.NbVentes); err == nil {
			points = append(points, p)
		}
	}

	var evolution *float64
	if len(points) >= 2 {
		premier, dernier := points[0].MedianM2, points[len(points)-1].MedianM2
		if premier > 0 {
			e := math.Round((float64(dernier-premier)/float64(premier))*1000) / 10
			evolution = &e
		}
	}
	return points, evolution
}

// prevision retourne les années projetées de prix_forecast (modèle Prophet).
// Seules les lignes is_forecast sont lues : sur l'historique, les bornes de
// l'intervalle valent NaN et ne sont pas exploitables.
func prevision(ctx context.Context, codeCommune string) []PointPrevision {
	rows, err := db.Pool.Query(ctx, `
		SELECT annee, prix_m2_pred::int, prix_m2_lower::int, prix_m2_upper::int
		FROM prix_forecast
		WHERE code_commune = $1 AND is_forecast = true
		  AND prix_m2_lower IS NOT NULL AND prix_m2_upper IS NOT NULL
		ORDER BY annee
	`, codeCommune)
	if err != nil {
		return nil
	}
	defer rows.Close()

	points := []PointPrevision{}
	for rows.Next() {
		var p PointPrevision
		if err := rows.Scan(&p.Annee, &p.Pred, &p.Bas, &p.Haut); err == nil {
			points = append(points, p)
		}
	}
	if len(points) == 0 {
		return nil
	}
	return points
}

// risquesNaturels expose les aléas connus de la commune. Un acheteur les découvre
// souvent au compromis via l'état des risques, alors qu'ils pèsent sur
// l'assurance, la valeur de revente et parfois la structure du bâtiment.
func risquesNaturels(ctx context.Context, codeCommune string) *Risques {
	var r Risques
	err := db.Pool.QueryRow(ctx, `
		SELECT risque_inondation::int, risque_argile::int, score_risques::int
		FROM communes_agregat WHERE code_commune = $1
	`, codeCommune).Scan(&r.Inondation, &r.Argile, &r.ScoreGlobal)
	if err != nil {
		return nil
	}
	if r.Inondation == nil && r.Argile == nil && r.ScoreGlobal == nil {
		return nil
	}

	// Les deux indicateurs sont binaires dans la base : inondation vaut 0 ou 2,
	// argile 0 ou 1. score_risques va de 50 (le plus exposé) à 100 (aucun aléa).
	var alertes []string
	if r.Inondation != nil && *r.Inondation > 0 {
		alertes = append(alertes, "commune exposée au risque d'inondation")
	}
	if r.Argile != nil && *r.Argile > 0 {
		alertes = append(alertes, "retrait-gonflement des argiles (fissures possibles)")
	}
	if len(alertes) > 0 {
		r.Commentaire = "Vérifiez l'état des risques annexé au compromis : " +
			strings.Join(alertes, ", ") + "."
	}
	return &r
}

// coutDetention lit la fiscalité locale et le score de sécurité communal.
//
// Le score renvoyé est celui calculé à la commune (SSMSI) et non la valeur
// départementale historique, qui attribuait la même note aux 507 communes de
// Seine-et-Marne.
func coutDetention(ctx context.Context, codeCommune string) (*CoutDetention, *int) {
	var taux *float64
	var montant, secu *int
	var fiable *bool

	err := db.Pool.QueryRow(ctx, `
		SELECT taux_tf_global, taxe_fonciere_estimee, tf_estimation_fiable,
		       COALESCE(score_securite_commune, score_securite::int)
		FROM communes_agregat WHERE code_commune = $1
	`, codeCommune).Scan(&taux, &montant, &fiable, &secu)
	if err != nil {
		return nil, nil
	}
	if taux == nil && montant == nil {
		return nil, secu
	}

	d := &CoutDetention{TauxTfGlobal: taux, EstimationSure: fiable != nil && *fiable}
	if d.EstimationSure {
		d.TaxeFonciere = montant
		d.Note = "Estimation pour un local moyen de la commune ; le montant réel dépend " +
			"de la valeur locative cadastrale du bien. Demandez l'avis de taxe foncière au vendeur."
	} else {
		// Dans les communes à forte présence d'entrepôts ou de bureaux, la base
		// moyenne par local ne représente plus un logement : le taux reste
		// exploitable, pas le montant.
		d.Note = "Le taux est fiable, mais le montant n'est pas estimable ici : la base " +
			"moyenne de la commune est dominée par des locaux professionnels."
	}
	return d, secu
}

// copropriete lit l'état du parc collectif de la commune.
//
// Le taux de copropriétés aidées est le signal le plus lisible : il recense
// celles bénéficiant d'un dispositif public de redressement. Il n'est renvoyé
// qu'au-delà de vingt copropriétés — en dessous, une seule en difficulté sur
// trois afficherait 33 %.
func copropriete(ctx context.Context, codeCommune string) *Copropriete {
	var c Copropriete
	var fiable *bool
	err := db.Pool.QueryRow(ctx, `
		SELECT nb_coproprietes, taille_copro_moyenne, pct_copro_aidee,
		       pct_copro_avant_1949, periode_construction_dominante, copro_stats_fiables
		FROM communes_agregat WHERE code_commune = $1
	`, codeCommune).Scan(&c.Nombre, &c.TailleMoyenne, &c.PctAidee,
		&c.PctAvant1949, &c.PeriodeDominante, &fiable)
	if err != nil || c.Nombre == nil {
		return nil
	}

	c.Fiable = fiable != nil && *fiable
	if !c.Fiable {
		c.PctAidee = nil
		c.Note = "Trop peu de copropriétés recensées pour que les proportions aient un sens."
		return &c
	}

	switch {
	case c.PctAidee != nil && *c.PctAidee >= 10:
		c.Note = "Part élevée de copropriétés sous dispositif public de redressement. " +
			"Exigez les trois derniers procès-verbaux d'assemblée générale et le taux " +
			"d'impayés avant toute offre."
	case c.PctAidee != nil && *c.PctAidee >= 5:
		c.Note = "Part notable de copropriétés aidées dans la commune : vérifiez la santé " +
			"financière de l'immeuble visé."
	default:
		c.Note = "Parc en copropriété globalement sain à l'échelle de la commune ; " +
			"cela ne dispense pas d'examiner l'immeuble visé."
	}
	if c.PctAvant1949 != nil && *c.PctAvant1949 >= 45 {
		c.Note += " Près de la moitié du parc date d'avant 1949 : gros travaux et " +
			"rénovation énergétique sont à anticiper."
	}
	return &c
}

// enrichir calcule les éléments dépendant du bien visé (hors cache commune).
func enrichir(resp *EstimationResponse, surface float64, prixDemande int) {
	if surface > 0 {
		resp.SurfaceM2 = surface
		resp.PrixEstime = &Percentiles{
			P10:    int(float64(resp.PrixM2.P10) * surface),
			P25:    int(float64(resp.PrixM2.P25) * surface),
			Median: int(float64(resp.PrixM2.Median) * surface),
			P75:    int(float64(resp.PrixM2.P75) * surface),
			P90:    int(float64(resp.PrixM2.P90) * surface),
		}
	}

	if prixDemande > 0 {
		cout := CoutAcquisition{
			PrixBien:     prixDemande,
			FraisNotaire: int(float64(prixDemande) * tauxFraisNotaireAncien),
		}
		cout.TotalAcquisition = cout.PrixBien + cout.FraisNotaire
		resp.Cout = &cout

		if surface > 0 && resp.PrixM2.Median > 0 {
			prixM2 := float64(prixDemande) / surface
			pos := &Positionnement{
				PrixDemande:      prixDemande,
				PrixM2Demande:    int(prixM2),
				PercentileEstime: estimerPercentile(prixM2, resp.PrixM2),
				EcartMedianPct: math.Round(
					((prixM2-float64(resp.PrixM2.Median))/float64(resp.PrixM2.Median))*1000) / 10,
			}
			pos.Verdict = verdict(pos.PercentileEstime)
			// Cible de négociation : ramener le bien entre la médiane et le p25.
			if prixM2 > float64(resp.PrixM2.Median) {
				pos.MargeNegoBasse = prixDemande - int(float64(resp.PrixM2.Median)*surface)
				pos.MargeNegoHaute = prixDemande - int(float64(resp.PrixM2.P25)*surface)
			}
			resp.Position = pos
		}
	}
}

// estimerPercentile interpole linéairement la position d'un prix dans la
// distribution connue par ses 5 points.
func estimerPercentile(prixM2 float64, p Percentiles) int {
	paliers := []struct {
		valeur float64
		pct    float64
	}{
		{float64(p.P10), 10}, {float64(p.P25), 25}, {float64(p.Median), 50},
		{float64(p.P75), 75}, {float64(p.P90), 90},
	}
	if prixM2 <= paliers[0].valeur {
		return 5
	}
	if prixM2 >= paliers[len(paliers)-1].valeur {
		return 95
	}
	for i := 0; i < len(paliers)-1; i++ {
		bas, haut := paliers[i], paliers[i+1]
		if prixM2 <= haut.valeur && haut.valeur > bas.valeur {
			ratio := (prixM2 - bas.valeur) / (haut.valeur - bas.valeur)
			return int(math.Round(bas.pct + ratio*(haut.pct-bas.pct)))
		}
	}
	return 50
}

func verdict(percentile int) string {
	switch {
	case percentile <= 25:
		return "Prix attractif : sous le quart le moins cher des ventes comparables."
	case percentile <= 45:
		return "Prix inférieur au marché local."
	case percentile <= 60:
		return "Prix conforme au marché local."
	case percentile <= 80:
		return "Prix au-dessus du marché : une négociation est justifiée."
	default:
		return "Prix nettement au-dessus du marché : négociation fortement recommandée."
	}
}
