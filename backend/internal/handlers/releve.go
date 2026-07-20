package handlers

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// Relevé de compte locatif.
//
// Le tableau des paiements répond « ce mois est-il réglé ? ». Il ne répond pas à
// la question que se posent en réalité les deux parties : « où en est-on ? ».
// Un locataire qui a payé onze mois sur douze et un locataire à jour ayant réglé
// un mois d'avance y apparaissent de la même façon.
//
// Le relevé reprend donc la forme d'un compte : chaque échéance appelée est
// portée au débit, chaque règlement au crédit, et le solde court d'une ligne à
// l'autre. C'est la présentation qu'utilisent les gestionnaires professionnels,
// et elle a l'avantage de rendre une erreur de saisie visible — un solde qui
// dérive signale un mois oublié bien mieux qu'une case restée grise.

type EcritureReleve struct {
	Date     string  `json:"date"`
	Libelle  string  `json:"libelle"`
	Debit    float64 `json:"debit,omitempty"`
	Credit   float64 `json:"credit,omitempty"`
	Solde    float64 `json:"solde"`
	Mois     int     `json:"mois"`
	EnAttente bool   `json:"en_attente,omitempty"`
}

type ReleveResponse struct {
	Annee        int              `json:"annee"`
	Ecritures    []EcritureReleve `json:"ecritures"`
	TotalAppele  float64          `json:"total_appele"`
	TotalRegle   float64          `json:"total_regle"`
	Solde        float64          `json:"solde"`
	Commentaire  string           `json:"commentaire"`
}

var moisLong = [...]string{
	"janvier", "février", "mars", "avril", "mai", "juin",
	"juillet", "août", "septembre", "octobre", "novembre", "décembre",
}

// dernierJour évite d'écrire « du 1er au 31 février ».
func dernierJour(mois, annee int) int {
	return time.Date(annee, time.Month(mois)+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// anneeDemandee borne l'année à une plage plausible.
func anneeDemandee(c *gin.Context) int {
	annee, err := strconv.Atoi(c.DefaultQuery("annee", strconv.Itoa(time.Now().Year())))
	if err != nil || annee < 2000 || annee > 2100 {
		return time.Now().Year()
	}
	return annee
}

// GetGestionReleve handles GET /api/v1/gestion/biens/:id/releve?annee=2026
//
// Vue bailleur : le relevé d'un de ses biens, filtré sur sa propriété.
func GetGestionReleve(c *gin.Context) {
	construireReleve(c, `
		SELECT p.mois,
		       COALESCE(p.montant_loyer, 0), COALESCE(p.montant_charges, 0),
		       COALESCE(p.montant_recu, 0),
		       COALESCE(TO_CHAR(p.date_paiement, 'YYYY-MM-DD'), ''),
		       COALESCE(p.statut, '')
		FROM gestion_paiements p
		WHERE p.bien_id = $1 AND p.user_id = $2 AND p.annee = $3
		ORDER BY p.mois
	`, c.Param("id"), c.GetString("user_id"))
}

// GetReleveLocataire handles GET /api/v1/mon-logement/releve?annee=2026
//
// Vue locataire : le même relevé, mais atteint par le compte locataire plutôt
// que par la propriété du bien. Un locataire a le droit de savoir où en est son
// compte sans avoir à le demander — c'est même la première chose qu'il vient
// vérifier, et la lui refuser oblige à un échange que la donnée rend inutile.
//
// Les deux vues partagent le même calcul : un solde qui différerait selon qui
// le consulte serait pire que pas de solde du tout.
func GetReleveLocataire(c *gin.Context) {
	construireReleve(c, `
		SELECT p.mois,
		       COALESCE(p.montant_loyer, 0), COALESCE(p.montant_charges, 0),
		       COALESCE(p.montant_recu, 0),
		       COALESCE(TO_CHAR(p.date_paiement, 'YYYY-MM-DD'), ''),
		       COALESCE(p.statut, '')
		FROM gestion_paiements p
		JOIN gestion_locataires l ON l.id = p.locataire_id
		WHERE l.locataire_user_id = $1 AND l.actif = true AND p.annee = $2
		ORDER BY p.mois
	`, c.GetString("user_id"))
}

// construireReleve exécute la requête fournie et compose le relevé. Les
// paramètres de filtrage précèdent l'année, ajoutée en dernier.
func construireReleve(c *gin.Context, requete string, filtres ...any) {
	annee := anneeDemandee(c)
	args := append(append([]any{}, filtres...), annee)

	rows, err := db.Pool.Query(context.Background(), requete, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	resp := ReleveResponse{Annee: annee, Ecritures: []EcritureReleve{}}
	solde := 0.0
	moisEnCours := time.Now().Year() == annee

	for rows.Next() {
		var mois int
		var loyer, charges, recu float64
		var datePaiement, statut string
		if err := rows.Scan(&mois, &loyer, &charges, &recu, &datePaiement, &statut); err != nil {
			continue
		}

		// Débit : l'échéance appelée, portée au premier du mois.
		appele := loyer + charges
		if appele > 0 {
			solde -= appele
			resp.TotalAppele += appele
			resp.Ecritures = append(resp.Ecritures, EcritureReleve{
				Date:  fmt.Sprintf("%04d-%02d-01", annee, mois),
				Libelle: fmt.Sprintf("Appel de loyer — du 1er au %d %s",
					dernierJour(mois, annee), moisLong[mois-1]),
				Debit: appele,
				Solde: solde,
				Mois:  mois,
			})
		}

		// Crédit : le règlement reçu. Un statut « payé » sans montant saisi vaut
		// règlement du montant appelé — c'est la saisie la plus courante, et la
		// refuser afficherait un impayé qui n'existe pas.
		regle := recu
		if regle == 0 && statut == "paye" {
			regle = appele
		}
		if regle > 0 {
			solde += regle
			resp.TotalRegle += regle
			date := datePaiement
			if date == "" {
				date = fmt.Sprintf("%04d-%02d-%02d", annee, mois, dernierJour(mois, annee))
			}
			resp.Ecritures = append(resp.Ecritures, EcritureReleve{
				Date:    date,
				Libelle: fmt.Sprintf("Règlement — %s %d", moisLong[mois-1], annee),
				Credit:  regle,
				Solde:   solde,
				Mois:    mois,
			})
		} else if appele > 0 && (!moisEnCours || mois <= int(time.Now().Month())) {
			// Échéance passée sans règlement : la signaler plutôt que de laisser
			// le lecteur déduire l'impayé d'un solde négatif.
			resp.Ecritures[len(resp.Ecritures)-1].EnAttente = true
		}
	}

	resp.Solde = solde

	switch {
	case len(resp.Ecritures) == 0:
		resp.Commentaire = fmt.Sprintf(
			"Aucune échéance enregistrée pour %d. Le relevé se construit à partir des "+
				"loyers saisis dans le suivi des paiements.", annee)
	case solde >= -0.5 && solde <= 0.5:
		resp.Commentaire = "Compte à jour : tout ce qui a été appelé a été réglé."
	case solde < -0.5:
		resp.Commentaire = fmt.Sprintf(
			"Solde débiteur de %.2f € : ce montant reste dû au titre de %d. "+
				"Vérifiez d'abord qu'aucun règlement n'a simplement été oublié à la saisie.",
			-solde, annee)
	default:
		resp.Commentaire = fmt.Sprintf(
			"Solde créditeur de %.2f € : plus a été réglé qu'appelé, généralement "+
				"une avance ou un dépôt saisi comme un loyer.", solde)
	}

	c.JSON(http.StatusOK, resp)
}
