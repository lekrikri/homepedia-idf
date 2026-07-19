package handlers

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"homepedia/backend/internal/db"
)

const maxUploadSize = 10 << 20 // 10 MB

var allowedMimeTypes = map[string]bool{
	"application/pdf": true,
	"image/jpeg":      true,
	"image/png":       true,
	"image/webp":      true,
}

var categoriesProprio = map[string]bool{
	// Contrats
	"bail": true, "avenant_bail": true,
	// États des lieux
	"etat_lieux_entree": true, "etat_lieux_sortie": true, "inventaire": true,
	// Loyers
	"avis_echeance": true, "quittance_archivee": true,
	// Plans & descriptif
	"plan_appartement": true,
	// Diagnostics obligatoires
	"diagnostic_dpe": true, "diagnostic_plomb": true, "diagnostic_amiante": true,
	"diagnostic_electricite": true, "diagnostic_gaz": true, "diagnostic_etat_risques": true,
	// Assurances & copropriété
	"assurance_pno": true, "reglement_copropriete": true,
	// Divers
	"notice_information": true, "taxe_fonciere": true, "autre": true,
}

var categoriesLocataire = map[string]bool{
	// Identité
	"piece_identite": true,
	// Revenus
	"fiche_de_paie": true, "avis_imposition": true, "contrat_travail": true,
	// Assurance & domicile
	"attestation_assurance": true, "justificatif_domicile": true,
	// Bancaire
	"rib": true,
	// Garant
	"garant_piece_identite": true, "garant_revenus": true,
	// Divers
	"autre": true,
}

type docMeta struct {
	ID                  string  `json:"id"`
	Categorie           string  `json:"categorie"`
	NomFichier          string  `json:"nom_fichier"`
	TailleOctets        *int64  `json:"taille_octets"`
	MimeType            *string `json:"mime_type"`
	VisibleParLocataire bool    `json:"visible_par_locataire"`
	UploadedBy          string  `json:"uploaded_by"` // "proprio" | "locataire"
	CreatedAt           string  `json:"created_at"`
}

func parseUpload(c *gin.Context) ([]byte, string, string, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxUploadSize)
	if err := c.Request.ParseMultipartForm(maxUploadSize); err != nil {
		return nil, "", "", fmt.Errorf("fichier trop volumineux (max 10 Mo)")
	}
	file, header, err := c.Request.FormFile("fichier")
	if err != nil {
		return nil, "", "", fmt.Errorf("fichier manquant")
	}
	defer file.Close()

	buf := make([]byte, 512)
	n, _ := file.Read(buf)
	mimeType := http.DetectContentType(buf[:n])
	if !allowedMimeTypes[mimeType] {
		return nil, "", "", fmt.Errorf("type non autorisé (PDF, JPEG, PNG uniquement)")
	}
	if _, err := file.Seek(0, 0); err != nil {
		return nil, "", "", fmt.Errorf("erreur lecture fichier")
	}
	contenu, err := io.ReadAll(file)
	if err != nil {
		return nil, "", "", fmt.Errorf("erreur lecture fichier")
	}
	return contenu, filepath.Base(header.Filename), mimeType, nil
}

// POST /api/v1/gestion/biens/:id/documents
func UploadDocument(c *gin.Context) {
	userID := c.GetString("user_id")
	bienID := c.Param("id")

	var cnt int
	if err := db.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM gestion_biens WHERE id=$1 AND user_id=$2`, bienID, userID).Scan(&cnt); err != nil || cnt == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "accès refusé"})
		return
	}

	contenu, nomFichier, mimeType, err := parseUpload(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	categorie := c.PostForm("categorie")
	if !categoriesProprio[categorie] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "catégorie invalide"})
		return
	}
	visibleParLocataire := c.PostForm("visible_par_locataire") != "false"

	var locataireID *string
	_ = db.Pool.QueryRow(context.Background(),
		`SELECT id FROM gestion_locataires WHERE bien_id=$1 AND actif=true LIMIT 1`, bienID).Scan(&locataireID)

	var docID string
	if err := db.Pool.QueryRow(context.Background(), `
		INSERT INTO documents (bien_id, locataire_id, uploaded_by_user_id, visible_par_locataire, categorie, nom_fichier, taille_octets, mime_type, contenu)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
	`, bienID, locataireID, userID, visibleParLocataire, categorie,
		nomFichier, int64(len(contenu)), mimeType, contenu,
	).Scan(&docID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"id": docID, "nom_fichier": nomFichier,
		"categorie": categorie, "mime_type": mimeType, "taille": len(contenu),
	})
}

// GET /api/v1/gestion/biens/:id/documents
func ListDocuments(c *gin.Context) {
	userID := c.GetString("user_id")
	bienID := c.Param("id")

	var cnt int
	if err := db.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM gestion_biens WHERE id=$1 AND user_id=$2`, bienID, userID).Scan(&cnt); err != nil || cnt == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "accès refusé"})
		return
	}

	rows, err := db.Pool.Query(context.Background(), `
		SELECT d.id, d.categorie, d.nom_fichier, d.taille_octets, d.mime_type, d.visible_par_locataire,
		       CASE WHEN d.uploaded_by_user_id = $2 THEN 'proprio' ELSE 'locataire' END,
		       d.created_at::text
		FROM documents d WHERE d.bien_id=$1 ORDER BY d.created_at DESC
	`, bienID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	docs := []docMeta{}
	for rows.Next() {
		var d docMeta
		if err := rows.Scan(&d.ID, &d.Categorie, &d.NomFichier, &d.TailleOctets, &d.MimeType,
			&d.VisibleParLocataire, &d.UploadedBy, &d.CreatedAt); err == nil {
			docs = append(docs, d)
		}
	}
	c.JSON(http.StatusOK, docs)
}

// GET /api/v1/documents/:id/download
func DownloadDocument(c *gin.Context) {
	userID := c.GetString("user_id")
	docID := c.Param("id")

	var contenu []byte
	var mimeType, nomFichier, bienUserID string
	var locataireUserID *string
	var visibleParLocataire bool

	err := db.Pool.QueryRow(context.Background(), `
		SELECT d.contenu, COALESCE(d.mime_type,'application/octet-stream'), d.nom_fichier,
		       d.visible_par_locataire, b.user_id, l.locataire_user_id
		FROM documents d
		JOIN gestion_biens b ON b.id = d.bien_id
		LEFT JOIN gestion_locataires l ON l.id = d.locataire_id
		WHERE d.id=$1
	`, docID).Scan(&contenu, &mimeType, &nomFichier, &visibleParLocataire, &bienUserID, &locataireUserID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "document introuvable"})
		return
	}

	isProprio := userID == bienUserID
	isUploader := false
	var uploaderID *string
	_ = db.Pool.QueryRow(context.Background(),
		`SELECT uploaded_by_user_id FROM documents WHERE id=$1`, docID).Scan(&uploaderID)
	if uploaderID != nil && userID == *uploaderID {
		isUploader = true
	}
	isLocataire := locataireUserID != nil && userID == *locataireUserID && visibleParLocataire

	if !isProprio && !isLocataire && !isUploader {
		c.JSON(http.StatusForbidden, gin.H{"error": "accès refusé"})
		return
	}

	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, nomFichier))
	c.Header("Content-Type", mimeType)
	c.Data(http.StatusOK, mimeType, contenu)
}

// DELETE /api/v1/gestion/documents/:id
func DeleteDocument(c *gin.Context) {
	userID := c.GetString("user_id")
	docID := c.Param("id")

	result, err := db.Pool.Exec(context.Background(), `
		DELETE FROM documents
		WHERE id=$1 AND bien_id IN (SELECT id FROM gestion_biens WHERE user_id=$2)
	`, docID, userID)
	if err != nil || result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "document introuvable ou accès refusé"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// POST /api/v1/mon-logement/documents/upload
func UploadDocumentLocataire(c *gin.Context) {
	userID := c.GetString("user_id")

	var bienID, locataireID string
	if err := db.Pool.QueryRow(context.Background(), `
		SELECT l.bien_id, l.id FROM gestion_locataires l
		WHERE l.locataire_user_id=$1 AND l.actif=true LIMIT 1
	`, userID).Scan(&bienID, &locataireID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "aucun logement associé"})
		return
	}

	contenu, nomFichier, mimeType, err := parseUpload(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	categorie := c.PostForm("categorie")
	if !categoriesLocataire[categorie] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "catégorie invalide"})
		return
	}

	var docID string
	if err := db.Pool.QueryRow(context.Background(), `
		INSERT INTO documents (bien_id, locataire_id, uploaded_by_user_id, visible_par_locataire, categorie, nom_fichier, taille_octets, mime_type, contenu)
		VALUES ($1,$2,$3,false,$4,$5,$6,$7,$8) RETURNING id
	`, bienID, locataireID, userID, categorie,
		nomFichier, int64(len(contenu)), mimeType, contenu,
	).Scan(&docID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": docID, "nom_fichier": nomFichier, "categorie": categorie})
}

// GET /api/v1/mon-logement/documents
func ListDocumentsLocataire(c *gin.Context) {
	userID := c.GetString("user_id")

	rows, err := db.Pool.Query(context.Background(), `
		SELECT d.id, d.categorie, d.nom_fichier, d.taille_octets, d.mime_type,
		       d.visible_par_locataire,
		       CASE WHEN d.uploaded_by_user_id = $1 THEN 'locataire' ELSE 'proprio' END,
		       d.created_at::text
		FROM documents d
		JOIN gestion_locataires l ON l.id = d.locataire_id
		WHERE l.locataire_user_id = $1 AND l.actif = true
		  AND (d.visible_par_locataire = true OR d.uploaded_by_user_id = $1)
		ORDER BY d.created_at DESC
	`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	docs := []docMeta{}
	for rows.Next() {
		var d docMeta
		if err := rows.Scan(&d.ID, &d.Categorie, &d.NomFichier, &d.TailleOctets, &d.MimeType,
			&d.VisibleParLocataire, &d.UploadedBy, &d.CreatedAt); err == nil {
			docs = append(docs, d)
		}
	}
	c.JSON(http.StatusOK, docs)
}
