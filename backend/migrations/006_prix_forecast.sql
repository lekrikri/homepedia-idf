-- Migration 006 — Prophet price forecast table
-- Coller dans : Supabase → SQL Editor → Run

CREATE TABLE IF NOT EXISTS prix_forecast (
    code_commune  VARCHAR(6)    NOT NULL,
    annee         SMALLINT      NOT NULL,
    prix_m2_pred  NUMERIC(10,2) NOT NULL,
    prix_m2_lower NUMERIC(10,2),
    prix_m2_upper NUMERIC(10,2),
    is_forecast   BOOLEAN       NOT NULL DEFAULT false,
    generated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (code_commune, annee)
);

CREATE INDEX IF NOT EXISTS idx_forecast_commune ON prix_forecast(code_commune);
CREATE INDEX IF NOT EXISTS idx_forecast_annee   ON prix_forecast(annee);
