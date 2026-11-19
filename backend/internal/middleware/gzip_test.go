package middleware

import (
	"bufio"
	"compress/gzip"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// Un événement SSE flushé doit atteindre le client compressé avant la fin du handler.
func TestGzipFlushStreamsBeforeEnd(t *testing.T) {
	gin.SetMode(gin.TestMode)
	release := make(chan struct{})
	r := gin.New()
	r.Use(Gzip())
	r.GET("/stream", func(c *gin.Context) {
		c.Writer.Write([]byte("event: token\ndata: premier\n\n"))
		c.Writer.(http.Flusher).Flush()
		<-release // le handler n'a pas fini tant que le client n'a pas lu le premier événement
		c.Writer.Write([]byte("event: done\ndata: {}\n\n"))
	})
	srv := httptest.NewServer(r)
	defer srv.Close()
	defer close(release)

	req, _ := http.NewRequest("GET", srv.URL+"/stream", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.Header.Get("Content-Encoding") != "gzip" {
		t.Fatalf("Content-Encoding = %q, attendu gzip", resp.Header.Get("Content-Encoding"))
	}

	got := make(chan string, 1)
	go func() {
		gz, err := gzip.NewReader(resp.Body)
		if err != nil {
			got <- "erreur: " + err.Error()
			return
		}
		line, _ := bufio.NewReader(gz).ReadString('\n')
		got <- line
	}()

	select {
	case line := <-got:
		if !strings.HasPrefix(line, "event: token") {
			t.Fatalf("première ligne = %q", line)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("le premier événement n'est pas arrivé avant la fin du handler : le flux est bufferisé")
	}
}
