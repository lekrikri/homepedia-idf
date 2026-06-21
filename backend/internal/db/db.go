package db

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Ready indique si la DB est connectée et disponible.
var Ready bool

// Pool is the application-wide connection pool.
var Pool *pgxpool.Pool

// Connect initialises the connection pool from environment variables.
// Retries up to 3 times with a 3s delay (Cloud Run cold start / Supabase wakeup).
func Connect(ctx context.Context) error {
	dsn := fmt.Sprintf(
		"host=%s port=%s dbname=%s user=%s password=%s sslmode=%s connect_timeout=10",
		getenv("POSTGRES_HOST", "localhost"),
		getenv("POSTGRES_PORT", "5432"),
		getenv("POSTGRES_DB", "homepedia"),
		getenv("POSTGRES_USER", "homepedia"),
		getenv("POSTGRES_PASSWORD", "homepedia"),
		getenv("POSTGRES_SSLMODE", "require"),
	)

	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return fmt.Errorf("db: parse config: %w", err)
	}

	// MinConns=0 : ne crée pas de connexions au démarrage (évite le crash Cloud Run)
	cfg.MaxConns = 10
	cfg.MinConns = 0
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return fmt.Errorf("db: create pool: %w", err)
	}

	// Retry ping 3× avec 3s entre chaque (Supabase pooler peut être lent au réveil)
	var lastErr error
	for i := 0; i < 3; i++ {
		pingCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		lastErr = pool.Ping(pingCtx)
		cancel()
		if lastErr == nil {
			Pool = pool
			Ready = true
			return nil
		}
		if i < 2 {
			time.Sleep(3 * time.Second)
		}
	}

	// Même si le ping échoue, on garde le pool — les requêtes réessaieront
	Pool = pool
	Ready = false
	return fmt.Errorf("db: ping failed after 3 attempts: %w", lastErr)
}

// Close releases all pool resources.
func Close() {
	if Pool != nil {
		Pool.Close()
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
