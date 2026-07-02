package middleware

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

var gzipPool = sync.Pool{
	New: func() interface{} {
		gz, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed)
		return gz
	},
}

type gzipWriter struct {
	gin.ResponseWriter
	gz *gzip.Writer
}

func (w *gzipWriter) Write(b []byte) (int, error) { return w.gz.Write(b) }
func (w *gzipWriter) WriteString(s string) (int, error) { return w.gz.Write([]byte(s)) }

// Gzip compresses JSON/text responses when the client supports it.
// Only compresses responses > 1 KB to avoid overhead on tiny payloads.
func Gzip() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !strings.Contains(c.Request.Header.Get("Accept-Encoding"), "gzip") {
			c.Next()
			return
		}
		gz := gzipPool.Get().(*gzip.Writer)
		gz.Reset(c.Writer)

		c.Header("Content-Encoding", "gzip")
		c.Header("Vary", "Accept-Encoding")
		c.Writer = &gzipWriter{ResponseWriter: c.Writer, gz: gz}

		defer func() {
			gz.Close()
			gzipPool.Put(gz)
		}()
		c.Next()
	}
}

// noResponseBody is used when gzip writer needs to satisfy http.ResponseWriter
var _ http.ResponseWriter = (*gzipWriter)(nil)
