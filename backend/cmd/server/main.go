package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"

	"homepedia/backend/internal/db"
	"homepedia/backend/internal/handlers"
	"homepedia/backend/internal/middleware"
)

func main() {
	// Load .env if present (dev convenience; in prod env vars are injected)
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, reading environment variables from system")
	}

	// Gin mode
	if os.Getenv("GIN_MODE") != "" {
		gin.SetMode(os.Getenv("GIN_MODE"))
	}

	// Connect to PostgreSQL (non-fatal : le serveur démarre même si la DB est lente)
	ctx := context.Background()
	if err := db.Connect(ctx); err != nil {
		log.Printf("WARNING: database connection failed at startup: %v", err)
		log.Println("Server will start anyway — DB requests will fail until connection is restored")
	} else {
		log.Println("Connected to PostgreSQL")
	}
	defer db.Close()

	// gin.Default() already includes Logger + Recovery middleware
	r := gin.Default()

	// CORS — allow any origin in dev
	r.Use(corsMiddleware())

	// Gzip compression for all JSON/text responses
	r.Use(middleware.Gzip())

	// ── API v1 ───────────────────────────────────────────────────────────────
	v1 := r.Group("/api/v1")
	{
		// Public
		v1.GET("/health", handlers.HealthCheck)

		// Auth
		auth := v1.Group("/auth")
		auth.Use(middleware.Audit())
		{
			auth.POST("/register", handlers.Register)
			auth.POST("/login", handlers.Login)
			auth.GET("/me", middleware.Auth(), handlers.Me)
		}

		// Communes — données quasi-statiques : cache navigateur 24h
		v1.GET("/communes", middleware.HTTPCache(86400, 604800), handlers.ListCommunes)
		v1.GET("/communes/list", middleware.HTTPCache(86400, 604800), handlers.GetCommunesList)
		v1.GET("/communes/gold", handlers.GetCommunesGold)
		v1.GET("/communes/agregat", middleware.HTTPCache(3600, 86400), handlers.GetCommunesAgregat)
		v1.GET("/communes/:code", middleware.HTTPCache(3600, 86400), handlers.GetCommune)
		v1.GET("/communes/:code/gold", handlers.GetCommuneGold)
		v1.GET("/communes/:code/agregat", middleware.HTTPCache(3600, 86400), handlers.GetCommuneAgregat)
		v1.GET("/communes/:code/insights", middleware.HTTPCache(3600, 86400), handlers.GetCommuneInsights)
		v1.GET("/communes/:code/prix-historique", middleware.HTTPCache(3600, 86400), handlers.GetCommunePrixHistorique)
		v1.GET("/communes/:code/prix-par-type", middleware.HTTPCache(3600, 86400), handlers.GetPrixParType)
		v1.GET("/communes/:code/prix-par-pieces", middleware.HTTPCache(3600, 86400), handlers.GetPrixParPieces)
		v1.GET("/communes/:code/dpe-evolution", middleware.HTTPCache(3600, 86400), handlers.GetDpeEvolution)
		v1.GET("/communes/:code/demographie", middleware.HTTPCache(3600, 86400), handlers.GetDemographie)
		v1.GET("/communes/:code/forecast", middleware.HTTPCache(3600, 86400), handlers.GetCommuneForecast)

		// POI pré-ingérés (ingest_poi.py) — cache 24h navigateur + ETag + L1 RAM Go
		v1.GET("/poi/:code", middleware.HTTPCache(86400, 604800), handlers.GetPOI)

		// Transactions (public read — heavy queries handled by Databricks gold layer)
		v1.GET("/transactions", handlers.ListTransactions)
		v1.GET("/transactions/export", handlers.ExportTransactionsCSV)
		v1.GET("/transactions/:id", handlers.GetTransaction)

		// Stats agrégées
		v1.GET("/stats", middleware.HTTPCache(1800, 86400), handlers.GetStats)
		v1.GET("/estimation", middleware.HTTPCache(1800, 86400), handlers.GetEstimation)
		v1.GET("/loyer", middleware.HTTPCache(1800, 86400), handlers.GetLoyer)
		v1.GET("/dossier", middleware.HTTPCache(1800, 86400), handlers.GetDossier)

		// Pipeline monitoring
		v1.GET("/pipeline/runs", handlers.ListPipelineRuns)

		// Chatbot RAG (proxy vers le service Python FastAPI sur le port 8002)
		rag := v1.Group("/rag")
		rag.Use(middleware.Audit())
		{
			rag.POST("/query", handlers.RAGQuery)
			rag.POST("/query/stream", handlers.RAGQueryStream)
		}

		// Communes similaires (distance euclidienne sur 5 features normalisées)
		v1.GET("/communes/:code/similaires", middleware.HTTPCache(1800, 86400), handlers.GetCommunesSimilaires)
		// Villes jumelles — similaires mais moins chères (−8% mini)
		v1.GET("/communes/:code/jumelles", middleware.HTTPCache(1800, 86400), handlers.GetVillesJumelles)

		// Isochrones (proxy ORS) + transport en commun Navitia (fallback haversine)
		v1.GET("/isochrone", handlers.GetIsochrone)
		v1.GET("/isochrone/transit", handlers.GetIsochroneTransit)
		v1.GET("/isochrone/rer", middleware.HTTPCache(1800, 3600), handlers.GetIsochroneRER)
		// Heatmap IDF — centroïdes communes + prix médian (cache 30min / 24h)
		// Supporte ?year=2021..2026 pour timeline animée
		v1.GET("/heatmap", middleware.HTTPCache(1800, 86400), handlers.GetHeatmapIDF)
		v1.GET("/choropleth", middleware.HTTPCache(1800, 86400), handlers.GetChoropleth)

		// Pareto Front — rendement vs risque pour scatter plot multicritère
		v1.GET("/pareto", middleware.HTTPCache(3600, 86400), handlers.GetParetoFront)

		// Revenus Filosofi INSEE — top communes par revenu médian / taux pauvreté
		v1.GET("/revenus", middleware.HTTPCache(3600, 86400), handlers.GetRevenusIDF)

		// Tuiles vectorielles MVT (PostGIS ST_AsMVT) — cache 1h navigateur
		v1.GET("/tiles/:z/:x/:y", middleware.HTTPCache(3600, 86400), handlers.GetTiles)

		// ── Gestion locative (propriétaires bailleurs) ────────────────────────
		gestion := v1.Group("/gestion")
		gestion.Use(middleware.Auth())
		{
			gestion.GET("/dashboard", handlers.GetGestionDashboard)
			gestion.GET("/biens", handlers.GetGestionBiens)
			gestion.POST("/biens", handlers.CreateGestionBien)
			gestion.PUT("/biens/:id", handlers.UpdateGestionBien)
			gestion.DELETE("/biens/:id", handlers.DeleteGestionBien)
			gestion.POST("/biens/:id/locataire", handlers.CreateGestionLocataire)
			gestion.PUT("/locataires/:id", handlers.UpdateGestionLocataire)
			gestion.DELETE("/locataires/:id", handlers.DeleteGestionLocataire)
			gestion.POST("/locataires/:id/inviter", handlers.InviterLocataire)
			gestion.DELETE("/paiements/:id", handlers.DeleteGestionPaiement)
			gestion.GET("/biens/:id/paiements", handlers.GetGestionPaiements)
			gestion.POST("/paiements", handlers.CreateGestionPaiement)

			// Documents locatifs (proprio)
			gestion.POST("/biens/:id/documents", handlers.UploadDocument)
			gestion.GET("/biens/:id/documents", handlers.ListDocuments)
			gestion.DELETE("/documents/:id", handlers.DeleteDocument)
		}

		// ── Espace locataire (locataires connectés) ───────────────────────────
		v1.GET("/mon-logement", middleware.Auth(), handlers.GetMonLogement)
		v1.GET("/mon-logement/documents", middleware.Auth(), handlers.ListDocumentsLocataire)
		v1.POST("/mon-logement/documents/upload", middleware.Auth(), handlers.UploadDocumentLocataire)

		// Documents (download accessible proprio + locataire selon droits)
		v1.GET("/documents/:id/download", middleware.Auth(), handlers.DownloadDocument)
	}

	// Sitemap XML — hors groupe /api/v1, indexable par les moteurs
	r.GET("/sitemap.xml", handlers.GetSitemap)

	// Spec OpenAPI publique (hors groupe /api/v1)
	r.GET("/openapi.json", handlers.GetOpenAPISpec)
	r.GET("/docs", func(c *gin.Context) {
		host := "https://" + c.Request.Host
		c.Redirect(http.StatusFound, "https://petstore.swagger.io/?url="+host+"/openapi.json")
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Start server in a goroutine
	go func() {
		log.Printf("HomePedia backend listening on port %s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	// Graceful shutdown on SIGINT / SIGTERM
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutCtx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited cleanly")
}

// corsMiddleware adds permissive CORS headers for local development.
func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin,Content-Type,Authorization")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
