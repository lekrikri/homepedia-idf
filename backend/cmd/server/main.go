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
		{
			auth.POST("/register", handlers.Register)
			auth.POST("/login", handlers.Login)
			auth.GET("/me", middleware.Auth(), handlers.Me)
		}

		// Communes
		v1.GET("/communes", handlers.ListCommunes)
		v1.GET("/communes/list", handlers.GetCommunesList)       // Endpoint léger : 12 champs, cache 2h (MapView/Dashboard/Comparer)
		v1.GET("/communes/gold", handlers.GetCommunesGold)       // Gold calculé à la volée depuis transactions
		v1.GET("/communes/agregat", handlers.GetCommunesAgregat) // Gold importé depuis Databricks (population, POI OSM, DPE enrichi)
		v1.GET("/communes/:code", handlers.GetCommune)
		v1.GET("/communes/:code/gold", handlers.GetCommuneGold)
		v1.GET("/communes/:code/agregat", handlers.GetCommuneAgregat)

		// Transactions (public read — heavy queries handled by Databricks gold layer)
		v1.GET("/transactions", handlers.ListTransactions)
		v1.GET("/transactions/:id", handlers.GetTransaction)

		// Stats agrégées
		v1.GET("/stats", handlers.GetStats)

		// Pipeline monitoring
		v1.GET("/pipeline/runs", handlers.ListPipelineRuns)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
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
