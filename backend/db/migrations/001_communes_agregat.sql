-- =============================================================================
-- Migration 001 — Table communes_agregat
-- Source : gold/communes_agregat/ (Azure ADLS Gen2 via Databricks)
-- Alimentée par le notebook databricks/export_gold_to_postgres.py
-- =============================================================================

CREATE TABLE IF NOT EXISTS communes_agregat (
    -- Identifiant
    code_commune          CHAR(5)          PRIMARY KEY REFERENCES communes(code_insee),
    city                  VARCHAR(200)     NOT NULL,
    code_departement      CHAR(3)          NOT NULL,
    centroid_lon          DOUBLE PRECISION,
    centroid_lat          DOUBLE PRECISION,
    surface_km2           DOUBLE PRECISION,

    -- INSEE
    population_totale     BIGINT,
    population_municipale BIGINT,
    densite_pop_km2       DOUBLE PRECISION,

    -- DVF (transactions immobilières)
    prix_median_m2        DOUBLE PRECISION,
    prix_moyen_m2         DOUBLE PRECISION,
    nb_transactions       BIGINT,
    surface_moyenne       DOUBLE PRECISION,
    prix_median_transaction DOUBLE PRECISION,

    -- DPE (performance énergétique)
    score_dpe_moyen       DOUBLE PRECISION,   -- 1 (A) à 7 (G)
    conso_energie_moyenne DOUBLE PRECISION,   -- kWh/m²/an
    emission_ges_moyenne  DOUBLE PRECISION,   -- kgCO2/m²/an
    nb_dpe                BIGINT,
    pct_dpe_bon           DOUBLE PRECISION,   -- % biens classés A ou B

    -- OSM (points d'intérêt)
    nb_poi_total          BIGINT,
    nb_transport          BIGINT,
    nb_education          BIGINT,
    nb_sante              BIGINT,
    nb_commerce           BIGINT,
    nb_restauration       BIGINT,
    nb_parcs              BIGINT,
    nb_services           BIGINT,
    nb_bio_bobo           BIGINT,             -- signal gentrification

    -- Métadonnées
    updated_at            TIMESTAMPTZ        NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS communes_agregat_dept_idx ON communes_agregat (code_departement);
CREATE INDEX IF NOT EXISTS communes_agregat_prix_idx ON communes_agregat (prix_median_m2);
