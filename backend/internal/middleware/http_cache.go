package middleware

import (
	"fmt"

	"github.com/gin-gonic/gin"
)

// HTTPCache ajoute les headers Cache-Control pour déléguer le cache au navigateur/CDN.
// maxAge  : durée fraîche en secondes (navigateur sert sans réseau).
// stale   : durée pendant laquelle une réponse expirée peut être servie
//
//	pendant qu'une revalidation se fait en arrière-plan (stale-while-revalidate).
func HTTPCache(maxAge, stale int) gin.HandlerFunc {
	value := fmt.Sprintf("public, max-age=%d, stale-while-revalidate=%d", maxAge, stale)
	return func(c *gin.Context) {
		c.Header("Cache-Control", value)
		c.Next()
	}
}
