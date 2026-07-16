package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/spec"
)

// GetOpenAPISpec — GET /openapi.json
// Retourne la spec OpenAPI 3.0.3 de l'API HomePedia.
func GetOpenAPISpec(c *gin.Context) {
	c.Data(http.StatusOK, "application/json; charset=utf-8", spec.OpenAPI)
}
