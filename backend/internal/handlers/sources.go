package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

type SourceDonnees struct {
	Cle        string  `json:"cle"`
	Libelle    string  `json:"libelle"`
	Organisme  string  `json:"organisme"`
	Millesime  *string `json:"millesime,omitempty"`
	ReleveLe   *string `json:"releve_le,omitempty"`
	Couverture *string `json:"couverture,omitempty"`
	Limite     *string `json:"limite,omitempty"`
}

// GetSources handles GET /api/v1/sources
//
// Traçabilité des données affichées : origine, millésime, couverture et surtout
// limites. Ce dernier champ est le plus utile — il dit ce que la donnée ne
// permet pas de conclure.
//
// Une lacune non exposée est une lacune qui ne sera jamais comblée : l'absence
// de coordonnées géographiques avant 2023 est restée invisible deux ans, jusqu'à
// ce qu'un chantier d'analyse par quartier vienne s'y heurter.
func GetSources(c *gin.Context) {
	rows, err := db.Pool.Query(c.Request.Context(), `
		SELECT cle, libelle, organisme, millesime,
		       TO_CHAR(releve_le, 'YYYY-MM-DD'), couverture, limite
		FROM sources_donnees
		ORDER BY ordre, libelle
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	sources := []SourceDonnees{}
	for rows.Next() {
		var s SourceDonnees
		if err := rows.Scan(&s.Cle, &s.Libelle, &s.Organisme, &s.Millesime,
			&s.ReleveLe, &s.Couverture, &s.Limite); err == nil {
			sources = append(sources, s)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"sources": sources,
		"nombre":  len(sources),
	})
}
