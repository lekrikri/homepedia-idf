-- ═══════════════════════════════════════════════════════════════════════════════
-- HomePedia IDF — Schéma PostgreSQL / Supabase
-- Coller dans : Supabase → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Extensions ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- recherche full-text rapide

-- ── 2. Table communes (référentiel géographique INSEE) ───────────────────────
CREATE TABLE IF NOT EXISTS communes (
    id           BIGSERIAL PRIMARY KEY,
    code_insee   VARCHAR(6)   NOT NULL UNIQUE,
    code_postal  VARCHAR(5),
    nom          VARCHAR(100) NOT NULL,
    departement  VARCHAR(10)  NOT NULL,
    region       VARCHAR(50),
    population   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_communes_code_insee   ON communes(code_insee);
CREATE INDEX IF NOT EXISTS idx_communes_departement  ON communes(departement);
CREATE INDEX IF NOT EXISTS idx_communes_nom_trgm     ON communes USING gin(nom gin_trgm_ops);

-- ── 3. Table transactions (DVF — mutations foncières) ────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
    id                  BIGSERIAL PRIMARY KEY,
    id_mutation         VARCHAR(50),
    date_mutation       DATE         NOT NULL,
    nature_mutation     VARCHAR(50),
    valeur_fonciere     NUMERIC(14,2),
    adresse_numero      VARCHAR(10),
    adresse             VARCHAR(200),
    code_postal         VARCHAR(5),
    commune             VARCHAR(100),
    code_commune        VARCHAR(6),
    type_local          VARCHAR(50),
    surface_reelle_bati NUMERIC(10,2),
    nombre_pieces       SMALLINT,
    longitude           DOUBLE PRECISION,
    latitude            DOUBLE PRECISION,
    classe_energie      CHAR(1),
    source_annee        SMALLINT     NOT NULL DEFAULT 2024
);

CREATE INDEX IF NOT EXISTS idx_tx_code_commune   ON transactions(code_commune);
CREATE INDEX IF NOT EXISTS idx_tx_date_mutation  ON transactions(date_mutation);
CREATE INDEX IF NOT EXISTS idx_tx_type_local     ON transactions(type_local);
CREATE INDEX IF NOT EXISTS idx_tx_coords         ON transactions(longitude, latitude)
    WHERE longitude IS NOT NULL AND latitude IS NOT NULL;

-- ── 4. Table communes_agregat (Gold — une ligne par commune) ─────────────────
CREATE TABLE IF NOT EXISTS communes_agregat (
    code_commune            VARCHAR(6)       PRIMARY KEY,
    city                    VARCHAR(100)     NOT NULL,
    code_departement        VARCHAR(4)       NOT NULL,
    centroid_lon            DOUBLE PRECISION,
    centroid_lat            DOUBLE PRECISION,
    surface_km2             NUMERIC(10,3),

    -- Population
    population_totale       BIGINT,
    population_municipale   BIGINT,
    densite_pop_km2         NUMERIC(10,2),

    -- Prix immobilier
    prix_median_m2          NUMERIC(10,2),
    prix_moyen_m2           NUMERIC(10,2),
    nb_transactions         BIGINT,
    surface_moyenne         NUMERIC(8,2),
    prix_median_transaction NUMERIC(14,2),

    -- DPE / énergie
    score_dpe_moyen         NUMERIC(4,2),
    conso_energie_moyenne   NUMERIC(8,2),
    emission_ges_moyenne    NUMERIC(8,2),
    nb_dpe                  BIGINT,
    pct_dpe_bon             NUMERIC(5,4),

    -- POI OSM
    nb_poi_total            BIGINT,
    nb_transport            BIGINT,
    nb_education            BIGINT,
    nb_sante                BIGINT,
    nb_commerce             BIGINT,
    nb_restauration         BIGINT,
    nb_parcs                BIGINT,
    nb_services             BIGINT,
    nb_bio_bobo             BIGINT,

    -- Énergie ENEDIS/GRDF (MWh/logement/an)
    conso_elec_par_logement NUMERIC(8,3),
    conso_gaz_par_logement  NUMERIC(8,3),

    -- IPS / éducation
    ips_moyen               NUMERIC(6,2),
    pct_ecoles_favorisees   NUMERIC(5,2),
    nb_ecoles               BIGINT,

    -- Scores composites (0-10)
    score_qualite_vie       NUMERIC(5,2),
    score_investissement    NUMERIC(5,2),
    score_stabilite         NUMERIC(5,2),

    -- Sécurité / délinquance
    taux_cambriolages       NUMERIC(8,3),
    taux_vols_violence      NUMERIC(8,3),
    score_securite          NUMERIC(5,2),

    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agregat_dept     ON communes_agregat(code_departement);
CREATE INDEX IF NOT EXISTS idx_agregat_prix     ON communes_agregat(prix_median_m2);
CREATE INDEX IF NOT EXISTS idx_agregat_score_inv ON communes_agregat(score_investissement);

-- ── 5. Table users (authentification JWT) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name     VARCHAR(100),
    role          VARCHAR(20)  NOT NULL DEFAULT 'user',  -- 'user' | 'admin'
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Compte admin par défaut (mot de passe : Homepedia2026!)
-- bcrypt hash de "Homepedia2026!" généré à l'avance
INSERT INTO users (email, password_hash, full_name, role)
VALUES (
    'admin@homepedia.fr',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewFnMTkfzVE7VNJG',
    'Admin HomePedia',
    'admin'
)
ON CONFLICT (email) DO NOTHING;

-- ── 6. Table pipeline_runs (monitoring pipeline) ─────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id                      SERIAL PRIMARY KEY,
    job_name                VARCHAR(100) NOT NULL DEFAULT 'homepedia-pipeline',
    execution_id            VARCHAR(100),
    started_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    finished_at             TIMESTAMPTZ,
    annee                   SMALLINT,
    status                  VARCHAR(20)  NOT NULL DEFAULT 'running', -- running | success | error
    duration_s              INTEGER,
    nb_communes_exported    INTEGER,
    nb_transactions_exported INTEGER,
    steps_duration          JSONB,  -- { "gold": 42, "transactions": 120, ... }
    error_message           TEXT
);

CREATE INDEX IF NOT EXISTS idx_pipeline_started ON pipeline_runs(started_at DESC);

-- ── 7. Vue gold calculée à la volée (utilisée par /communes/gold) ────────────
CREATE OR REPLACE VIEW communes_gold AS
SELECT
    c.code_insee,
    c.nom,
    c.departement,
    c.population,
    COUNT(t.id)                                                         AS nb_transactions,
    PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY t.valeur_fonciere / NULLIF(t.surface_reelle_bati, 0)
    )                                                                   AS prix_m2_median,
    AVG(t.valeur_fonciere / NULLIF(t.surface_reelle_bati, 0))          AS prix_m2_moyen,
    AVG(CASE t.classe_energie
        WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3
        WHEN 'D' THEN 4 WHEN 'E' THEN 5 WHEN 'F' THEN 6
        WHEN 'G' THEN 7 ELSE NULL END)                                  AS score_dpe_moyen,
    MODE() WITHIN GROUP (ORDER BY t.classe_energie)                    AS dpe_dominant,
    AVG(t.surface_reelle_bati)                                         AS surface_moyenne
FROM communes c
LEFT JOIN transactions t
    ON t.code_commune = c.code_insee
    AND t.valeur_fonciere IS NOT NULL
    AND t.surface_reelle_bati > 0
GROUP BY c.code_insee, c.nom, c.departement, c.population;

-- ── Vérification ─────────────────────────────────────────────────────────────
SELECT
    (SELECT COUNT(*) FROM communes)          AS nb_communes,
    (SELECT COUNT(*) FROM transactions)      AS nb_transactions,
    (SELECT COUNT(*) FROM communes_agregat)  AS nb_agregat,
    (SELECT COUNT(*) FROM users)             AS nb_users,
    (SELECT COUNT(*) FROM pipeline_runs)     AS nb_pipeline_runs;
