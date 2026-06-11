package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"homepedia/backend/internal/db"
)

// PipelineRun représente une exécution du pipeline d'ingestion.
type PipelineRun struct {
	ID                    int        `json:"id"`
	JobName               string     `json:"job_name"`
	ExecutionID           *string    `json:"execution_id,omitempty"`
	StartedAt             time.Time  `json:"started_at"`
	FinishedAt            *time.Time `json:"finished_at,omitempty"`
	Annee                 *int       `json:"annee,omitempty"`
	Status                string     `json:"status"`
	DurationS             *int       `json:"duration_s,omitempty"`
	NbCommunesExported    *int       `json:"nb_communes_exported,omitempty"`
	NbTransactionsExported *int      `json:"nb_transactions_exported,omitempty"`
	StepsDuration         *string    `json:"steps_duration,omitempty"`
	ErrorMessage          *string    `json:"error_message,omitempty"`
}

// ListPipelineRuns handles GET /api/v1/pipeline/runs
// Retourne l'historique des exécutions du pipeline triées par date décroissante.
func ListPipelineRuns(c *gin.Context) {
	rows, err := db.Pool.Query(c.Request.Context(), `
		SELECT
			id, job_name, execution_id, started_at, finished_at,
			annee, status, duration_s,
			nb_communes_exported, nb_transactions_exported,
			steps_duration::text, error_message
		FROM pipeline_runs
		ORDER BY started_at DESC
		LIMIT 50
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	runs := []PipelineRun{}
	for rows.Next() {
		var r PipelineRun
		if err := rows.Scan(
			&r.ID, &r.JobName, &r.ExecutionID, &r.StartedAt, &r.FinishedAt,
			&r.Annee, &r.Status, &r.DurationS,
			&r.NbCommunesExported, &r.NbTransactionsExported,
			&r.StepsDuration, &r.ErrorMessage,
		); err != nil {
			continue
		}
		runs = append(runs, r)
	}

	c.JSON(http.StatusOK, gin.H{
		"count": len(runs),
		"data":  runs,
	})
}
