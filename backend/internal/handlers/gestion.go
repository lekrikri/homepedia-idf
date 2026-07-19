package handlers

import (
	"context"
	"crypto/rand"
	"math/big"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"homepedia/backend/internal/db"
	"homepedia/backend/internal/models"
)

// ── Biens ────────────────────────────────────────────────────────────────────

// GET /api/v1/gestion/biens
func GetGestionBiens(c *gin.Context) {
	userID := c.GetString("user_id")
	rows, err := db.Pool.Query(context.Background(), `
		SELECT b.id, b.user_id, b.adresse, b.code_postal, b.ville, b.code_insee,
		       b.type_bien, b.surface_m2, b.nb_pieces, b.etage,
		       b.loyer_nu, b.charges, b.depot_garantie,
		       TO_CHAR(b.date_acquisition, 'YYYY-MM-DD'), b.prix_acquisition,
		       TO_CHAR(b.created_at, 'YYYY-MM-DD'),
		       l.id, l.prenom, l.nom, l.email, l.telephone,
		       TO_CHAR(l.date_entree,'YYYY-MM-DD'), l.type_bail,
		       l.loyer_mensuel, l.charges_mensuelles, l.depot_garantie, l.actif
		FROM gestion_biens b
		LEFT JOIN gestion_locataires l ON l.bien_id = b.id AND l.actif = true
		WHERE b.user_id = $1
		ORDER BY b.created_at DESC
	`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var biens []models.GestionBien
	for rows.Next() {
		var b models.GestionBien
		var lID, lPrenom, lNom *string
		var lEmail, lTelephone, lDateEntree, lTypeBail *string
		var lLoyer, lCharges, lDepot *float64
		var lActif *bool

		err := rows.Scan(
			&b.ID, &b.UserID, &b.Adresse, &b.CodePostal, &b.Ville, &b.CodeInsee,
			&b.TypeBien, &b.SurfaceM2, &b.NbPieces, &b.Etage,
			&b.LoyerNu, &b.Charges, &b.DepotGarantie,
			&b.DateAcquisition, &b.PrixAcquisition, &b.CreatedAt,
			&lID, &lPrenom, &lNom, &lEmail, &lTelephone, &lDateEntree, &lTypeBail,
			&lLoyer, &lCharges, &lDepot, &lActif,
		)
		if err != nil {
			continue
		}
		if lID != nil {
			typeBail := "vide"
			if lTypeBail != nil {
				typeBail = *lTypeBail
			}
			b.Locataire = &models.GestionLocataire{
				ID: *lID, Prenom: *lPrenom, Nom: *lNom,
				Email: lEmail, Telephone: lTelephone,
				DateEntree: lDateEntree, TypeBail: typeBail,
				LoyerMensuel: lLoyer, ChargesMensuelles: lCharges, DepotGarantie: lDepot,
				Actif: lActif != nil && *lActif,
			}
		}
		biens = append(biens, b)
	}
	if biens == nil {
		biens = []models.GestionBien{}
	}
	c.JSON(http.StatusOK, biens)
}

// POST /api/v1/gestion/biens
func CreateGestionBien(c *gin.Context) {
	userID := c.GetString("user_id")
	var req models.GestionBien
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var id string
	err := db.Pool.QueryRow(context.Background(), `
		INSERT INTO gestion_biens (user_id, adresse, code_postal, ville, code_insee,
		  type_bien, surface_m2, nb_pieces, etage, loyer_nu, charges, depot_garantie,
		  date_acquisition, prix_acquisition)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		RETURNING id
	`, userID, req.Adresse, req.CodePostal, req.Ville, req.CodeInsee,
		req.TypeBien, req.SurfaceM2, req.NbPieces, req.Etage,
		req.LoyerNu, req.Charges, req.DepotGarantie,
		req.DateAcquisition, req.PrixAcquisition,
	).Scan(&id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

// PUT /api/v1/gestion/biens/:id
func UpdateGestionBien(c *gin.Context) {
	userID := c.GetString("user_id")
	bienID := c.Param("id")
	var req models.GestionBien
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	_, err := db.Pool.Exec(context.Background(), `
		UPDATE gestion_biens SET
		  adresse=$1, code_postal=$2, ville=$3, type_bien=$4, surface_m2=$5,
		  nb_pieces=$6, loyer_nu=$7, charges=$8, depot_garantie=$9, updated_at=NOW()
		WHERE id=$10 AND user_id=$11
	`, req.Adresse, req.CodePostal, req.Ville, req.TypeBien, req.SurfaceM2,
		req.NbPieces, req.LoyerNu, req.Charges, req.DepotGarantie, bienID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// DELETE /api/v1/gestion/biens/:id
func DeleteGestionBien(c *gin.Context) {
	userID := c.GetString("user_id")
	bienID := c.Param("id")
	_, err := db.Pool.Exec(context.Background(),
		`DELETE FROM gestion_biens WHERE id=$1 AND user_id=$2`, bienID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Locataires ───────────────────────────────────────────────────────────────

// POST /api/v1/gestion/biens/:id/locataire
func CreateGestionLocataire(c *gin.Context) {
	userID := c.GetString("user_id")
	bienID := c.Param("id")
	var req models.GestionLocataire
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var id string
	err := db.Pool.QueryRow(context.Background(), `
		INSERT INTO gestion_locataires (user_id, bien_id, prenom, nom, email, telephone,
		  date_entree, date_fin_bail, type_bail, loyer_mensuel, charges_mensuelles, depot_garantie)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		RETURNING id
	`, userID, bienID, req.Prenom, req.Nom, req.Email, req.Telephone,
		req.DateEntree, req.DateFinBail, req.TypeBail,
		req.LoyerMensuel, req.ChargesMensuelles, req.DepotGarantie,
	).Scan(&id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

// PUT /api/v1/gestion/locataires/:id
func UpdateGestionLocataire(c *gin.Context) {
	userID := c.GetString("user_id")
	locID := c.Param("id")
	var req models.GestionLocataire
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	_, err := db.Pool.Exec(context.Background(), `
		UPDATE gestion_locataires SET
		  prenom=$1, nom=$2, email=$3, telephone=$4,
		  loyer_mensuel=$5, charges_mensuelles=$6, actif=$7,
		  date_entree=$8, type_bail=$9, depot_garantie=$10,
		  updated_at=NOW()
		WHERE id=$11 AND user_id=$12
	`, req.Prenom, req.Nom, req.Email, req.Telephone,
		req.LoyerMensuel, req.ChargesMensuelles, req.Actif,
		req.DateEntree, req.TypeBail, req.DepotGarantie, locID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Paiements ────────────────────────────────────────────────────────────────

// GET /api/v1/gestion/biens/:id/paiements?annee=2025
func GetGestionPaiements(c *gin.Context) {
	userID := c.GetString("user_id")
	bienID := c.Param("id")
	annee := c.DefaultQuery("annee", string(rune('0'+time.Now().Year()/1000))+"000")
	if annee == "0000" {
		annee = "2025"
	}

	rows, err := db.Pool.Query(context.Background(), `
		SELECT p.id, p.bien_id, p.locataire_id, p.user_id, p.mois, p.annee,
		       p.montant_loyer, p.montant_charges, TO_CHAR(p.date_paiement,'YYYY-MM-DD'),
		       p.statut, p.montant_recu, p.note, TO_CHAR(p.created_at,'YYYY-MM-DD'),
		       l.prenom, l.nom
		FROM gestion_paiements p
		JOIN gestion_locataires l ON l.id = p.locataire_id
		WHERE p.bien_id=$1 AND p.user_id=$2 AND p.annee=$3::int
		ORDER BY p.annee DESC, p.mois DESC
	`, bienID, userID, annee)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	type PaiementRow struct {
		models.GestionPaiement
		PrenomLocataire string `json:"prenom_locataire"`
		NomLocataire    string `json:"nom_locataire"`
	}
	var paiements []PaiementRow
	for rows.Next() {
		var p PaiementRow
		_ = rows.Scan(
			&p.ID, &p.BienID, &p.LocataireID, &p.UserID, &p.Mois, &p.Annee,
			&p.MontantLoyer, &p.MontantCharges, &p.DatePaiement,
			&p.Statut, &p.MontantRecu, &p.Note, &p.CreatedAt,
			&p.PrenomLocataire, &p.NomLocataire,
		)
		paiements = append(paiements, p)
	}
	if paiements == nil {
		paiements = []PaiementRow{}
	}
	c.JSON(http.StatusOK, paiements)
}

// POST /api/v1/gestion/paiements
func CreateGestionPaiement(c *gin.Context) {
	userID := c.GetString("user_id")
	var req models.GestionPaiement
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var id string
	err := db.Pool.QueryRow(context.Background(), `
		INSERT INTO gestion_paiements
		  (bien_id, locataire_id, user_id, mois, annee, montant_loyer, montant_charges,
		   date_paiement, statut, montant_recu, note)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (locataire_id, mois, annee) DO UPDATE SET
		  statut=EXCLUDED.statut, montant_recu=EXCLUDED.montant_recu,
		  date_paiement=EXCLUDED.date_paiement, note=EXCLUDED.note
		RETURNING id
	`, req.BienID, req.LocataireID, userID, req.Mois, req.Annee,
		req.MontantLoyer, req.MontantCharges, req.DatePaiement,
		req.Statut, req.MontantRecu, req.Note,
	).Scan(&id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

// DELETE /api/v1/gestion/locataires/:id
func DeleteGestionLocataire(c *gin.Context) {
	userID := c.GetString("user_id")
	locID := c.Param("id")
	_, err := db.Pool.Exec(context.Background(),
		`UPDATE gestion_locataires SET actif=false, updated_at=NOW() WHERE id=$1 AND user_id=$2`,
		locID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// DELETE /api/v1/gestion/paiements/:id
func DeleteGestionPaiement(c *gin.Context) {
	userID := c.GetString("user_id")
	paiementID := c.Param("id")
	_, err := db.Pool.Exec(context.Background(),
		`DELETE FROM gestion_paiements WHERE id=$1 AND user_id=$2`, paiementID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Invitation locataire ──────────────────────────────────────────────────────

// POST /api/v1/gestion/locataires/:id/inviter
// Génère toujours un mot de passe temporaire et le retourne au proprio,
// que le compte locataire existe déjà ou non.
func InviterLocataire(c *gin.Context) {
	proprioID := c.GetString("user_id")
	locID := c.Param("id")

	var prenom, nom string
	var email *string
	var locataireUserID *string
	err := db.Pool.QueryRow(context.Background(), `
		SELECT prenom, nom, email, locataire_user_id
		FROM gestion_locataires WHERE id=$1 AND user_id=$2
	`, locID, proprioID).Scan(&prenom, &nom, &email, &locataireUserID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "locataire introuvable"})
		return
	}
	if email == nil || *email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Le locataire n'a pas d'adresse email"})
		return
	}

	// Toujours générer un nouveau mot de passe temporaire
	tmpPass := generateRandomPassword(10)
	hash, err := bcrypt.GenerateFromPassword([]byte(tmpPass), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erreur génération mot de passe"})
		return
	}

	// Cas 1 : compte locataire déjà lié → reset son mot de passe
	if locataireUserID != nil {
		_, _ = db.Pool.Exec(context.Background(),
			`UPDATE users SET password_hash=$1, role='locataire' WHERE id=$2`,
			string(hash), *locataireUserID)
		c.JSON(http.StatusOK, gin.H{
			"email":    *email,
			"password": tmpPass,
			"message":  "Nouveaux identifiants générés pour votre locataire.",
		})
		return
	}

	// Cas 2 : un user avec cet email existe déjà → reset + link
	var existingID string
	errExist := db.Pool.QueryRow(context.Background(),
		`SELECT id FROM users WHERE email=$1`, *email).Scan(&existingID)
	if errExist == nil {
		_, _ = db.Pool.Exec(context.Background(),
			`UPDATE users SET password_hash=$1, role='locataire' WHERE id=$2`,
			string(hash), existingID)
		_, _ = db.Pool.Exec(context.Background(),
			`UPDATE gestion_locataires SET locataire_user_id=$1 WHERE id=$2`, existingID, locID)
		c.JSON(http.StatusOK, gin.H{
			"email":    *email,
			"password": tmpPass,
			"message":  "Compte mis à jour. Communiquez ces nouveaux identifiants à votre locataire.",
		})
		return
	}

	// Cas 3 : nouveau compte
	fullName := prenom + " " + nom
	var newUserID string
	err = db.Pool.QueryRow(context.Background(), `
		INSERT INTO users (email, password_hash, full_name, role)
		VALUES ($1, $2, $3, 'locataire') RETURNING id
	`, *email, string(hash), fullName).Scan(&newUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	_, _ = db.Pool.Exec(context.Background(),
		`UPDATE gestion_locataires SET locataire_user_id=$1 WHERE id=$2`, newUserID, locID)

	c.JSON(http.StatusCreated, gin.H{
		"email":    *email,
		"password": tmpPass,
		"message":  "Compte créé. Communiquez ces identifiants à votre locataire.",
	})
}

func generateRandomPassword(length int) string {
	const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"
	b := make([]byte, length)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		b[i] = chars[n.Int64()]
	}
	return string(b)
}

// ── Espace locataire ─────────────────────────────────────────────────────────

// GET /api/v1/mon-logement
func GetMonLogement(c *gin.Context) {
	locataireUserID := c.GetString("user_id")

	var locID, bienID, prenom, nom, typeBail, adresse, typeBien, proprioEmail string
	var email, telephone, dateEntree, dateFinBail, codePostal, ville *string
	var loyerMensuel, chargesMensuelles, depotGarantie, surfaceM2 *float64
	var nbPieces *int

	err := db.Pool.QueryRow(context.Background(), `
		SELECT l.id, l.bien_id, l.prenom, l.nom, l.email, l.telephone,
		       TO_CHAR(l.date_entree,'YYYY-MM-DD'), TO_CHAR(l.date_fin_bail,'YYYY-MM-DD'),
		       l.type_bail, l.loyer_mensuel, l.charges_mensuelles, l.depot_garantie,
		       b.adresse, b.code_postal, b.ville, b.type_bien, b.surface_m2, b.nb_pieces,
		       u.email
		FROM gestion_locataires l
		JOIN gestion_biens b ON b.id = l.bien_id
		JOIN users u ON u.id = l.user_id
		WHERE l.locataire_user_id=$1 AND l.actif=true
	`, locataireUserID).Scan(
		&locID, &bienID, &prenom, &nom, &email, &telephone,
		&dateEntree, &dateFinBail, &typeBail,
		&loyerMensuel, &chargesMensuelles, &depotGarantie,
		&adresse, &codePostal, &ville, &typeBien, &surfaceM2, &nbPieces,
		&proprioEmail,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "logement non trouvé"})
		return
	}

	type Pmt struct {
		ID             string   `json:"id"`
		Mois           int      `json:"mois"`
		Annee          int      `json:"annee"`
		MontantLoyer   float64  `json:"montant_loyer"`
		MontantCharges float64  `json:"montant_charges"`
		DatePaiement   *string  `json:"date_paiement,omitempty"`
		Statut         string   `json:"statut"`
		MontantRecu    *float64 `json:"montant_recu,omitempty"`
	}
	rows, err := db.Pool.Query(context.Background(), `
		SELECT id, mois, annee, montant_loyer, montant_charges,
		       TO_CHAR(date_paiement,'YYYY-MM-DD'), statut, montant_recu
		FROM gestion_paiements
		WHERE locataire_id=$1
		ORDER BY annee DESC, mois DESC
		LIMIT 24
	`, locID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	var paiements []Pmt
	for rows.Next() {
		var p Pmt
		_ = rows.Scan(&p.ID, &p.Mois, &p.Annee, &p.MontantLoyer, &p.MontantCharges,
			&p.DatePaiement, &p.Statut, &p.MontantRecu)
		paiements = append(paiements, p)
	}
	if paiements == nil {
		paiements = []Pmt{}
	}

	c.JSON(http.StatusOK, gin.H{
		"locataire": gin.H{
			"id": locID, "prenom": prenom, "nom": nom, "email": email,
			"telephone": telephone, "date_entree": dateEntree, "date_fin_bail": dateFinBail,
			"type_bail": typeBail, "loyer_mensuel": loyerMensuel,
			"charges_mensuelles": chargesMensuelles, "depot_garantie": depotGarantie,
		},
		"bien": gin.H{
			"id": bienID, "adresse": adresse, "code_postal": codePostal,
			"ville": ville, "type_bien": typeBien, "surface_m2": surfaceM2, "nb_pieces": nbPieces,
		},
		"proprio_email": proprioEmail,
		"paiements":     paiements,
	})
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

// GET /api/v1/gestion/dashboard
func GetGestionDashboard(c *gin.Context) {
	userID := c.GetString("user_id")

	var nbBiens, nbLocataires int
	var loyerTotal, impayesTotal float64

	_ = db.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM gestion_biens WHERE user_id=$1`, userID).Scan(&nbBiens)

	_ = db.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM gestion_locataires WHERE user_id=$1 AND actif=true`, userID).Scan(&nbLocataires)

	_ = db.Pool.QueryRow(context.Background(),
		`SELECT COALESCE(SUM(loyer_mensuel + COALESCE(charges_mensuelles,0)),0)
		 FROM gestion_locataires WHERE user_id=$1 AND actif=true`, userID).Scan(&loyerTotal)

	_ = db.Pool.QueryRow(context.Background(),
		`SELECT COALESCE(SUM(montant_loyer + montant_charges),0)
		 FROM gestion_paiements
		 WHERE user_id=$1 AND statut='impaye'
		   AND annee >= EXTRACT(YEAR FROM NOW())::int - 1`, userID).Scan(&impayesTotal)

	c.JSON(http.StatusOK, gin.H{
		"nb_biens":       nbBiens,
		"nb_locataires":  nbLocataires,
		"loyer_mensuel":  loyerTotal,
		"impayes_total":  impayesTotal,
	})
}
