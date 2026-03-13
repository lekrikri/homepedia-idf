-- =============================================================================
-- HomePedia — PostgreSQL / PostGIS schema
-- =============================================================================
-- Conventions :
--   • snake_case pour tous les identifiants
--   • BIGSERIAL pour les PK techniques (sauf tables à clé naturelle)
--   • geometry(Geometry, 4326) — WGS-84 (lat/lon)
--   • GIST index sur chaque colonne géographique
-- =============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 1. COMMUNES  (référentiel géographique, alimenté par ingestion OSM/INSEE)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS communes (
    id            BIGSERIAL PRIMARY KEY,
    code_insee    CHAR(5)      NOT NULL UNIQUE,   -- ex: "75056", "69123"
    code_postal   VARCHAR(10),
    nom           VARCHAR(200) NOT NULL,
    departement   CHAR(3)      NOT NULL,          -- "75", "69", "2A" …
    region        VARCHAR(100),
    population    INTEGER,
    geom          geometry(MultiPolygon, 4326),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS communes_geom_idx  ON communes USING GIST (geom);
CREATE INDEX IF NOT EXISTS communes_dept_idx  ON communes (departement);

-- ---------------------------------------------------------------------------
-- 2. IRIS  (maille infra-communale INSEE — ~2 200 habitants)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iris (
    id              BIGSERIAL PRIMARY KEY,
    code_iris       CHAR(9)     NOT NULL UNIQUE,  -- 5 (commune) + 4 (iris)
    commune_insee   CHAR(5)     NOT NULL REFERENCES communes(code_insee),
    nom             VARCHAR(200),
    type_iris       CHAR(1),                      -- H habitat, A activité, D divers, Z commune entière
    population      INTEGER,
    geom            geometry(MultiPolygon, 4326),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS iris_geom_idx         ON iris USING GIST (geom);
CREATE INDEX IF NOT EXISTS iris_commune_idx      ON iris (commune_insee);

-- ---------------------------------------------------------------------------
-- 3. TRANSACTIONS  (DVF — Demandes de Valeurs Foncières 2019-2024)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
    id                  BIGSERIAL    PRIMARY KEY,
    id_mutation         VARCHAR(50)  NOT NULL,     -- identifiant DVF brut
    date_mutation       DATE         NOT NULL,
    nature_mutation     VARCHAR(50),               -- Vente, Vente en l'état futur, Échange …
    valeur_fonciere     NUMERIC(14,2),             -- € — peut être NULL si non publié
    adresse_numero      VARCHAR(10),
    adresse_voie        VARCHAR(200),
    code_postal         VARCHAR(10),
    commune             VARCHAR(200),
    code_commune        CHAR(5)      REFERENCES communes(code_insee),
    code_iris           CHAR(9)      REFERENCES iris(code_iris),
    -- Parcelle
    section             VARCHAR(5),
    numero_plan         VARCHAR(10),
    surface_terrain     NUMERIC(12,2),             -- m²
    -- Bien vendu
    type_local          VARCHAR(50),               -- Appartement, Maison, Local industriel …
    surface_reelle_bati NUMERIC(10,2),             -- m²
    nombre_pieces       SMALLINT,
    -- Géolocalisation (centroïde DVF ou géocodé)
    longitude           DOUBLE PRECISION,
    latitude            DOUBLE PRECISION,
    geom                geometry(Point, 4326),
    -- Métadonnées ingestion
    source_annee        SMALLINT     NOT NULL,     -- 2019 … 2024
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    UNIQUE(id_mutation, date_mutation, type_local)
);

CREATE INDEX IF NOT EXISTS transactions_geom_idx        ON transactions USING GIST (geom);
CREATE INDEX IF NOT EXISTS transactions_commune_idx     ON transactions (code_commune);
CREATE INDEX IF NOT EXISTS transactions_date_idx        ON transactions (date_mutation DESC);
CREATE INDEX IF NOT EXISTS transactions_type_idx        ON transactions (type_local);
CREATE INDEX IF NOT EXISTS transactions_iris_idx        ON transactions (code_iris);

-- ---------------------------------------------------------------------------
-- 4. BATIMENTS  (DPE — Diagnostics de Performance Énergétique)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS batiments (
    id                  BIGSERIAL    PRIMARY KEY,
    numero_dpe          VARCHAR(30)  NOT NULL UNIQUE,  -- identifiant ADEME
    date_etablissement  DATE,
    type_batiment       VARCHAR(100),                  -- maison, appartement, immeuble
    annee_construction  SMALLINT,
    surface_habitable   NUMERIC(10,2),                 -- m²
    -- Performance
    classe_energie      CHAR(1),                       -- A B C D E F G
    conso_energie       NUMERIC(10,2),                 -- kWh/m²/an
    classe_ges          CHAR(1),                       -- A → G (gaz à effet de serre)
    emission_ges        NUMERIC(10,2),                 -- kgCO2/m²/an
    -- Localisation
    adresse             VARCHAR(300),
    code_postal         VARCHAR(10),
    commune             VARCHAR(200),
    code_commune        CHAR(5)      REFERENCES communes(code_insee),
    longitude           DOUBLE PRECISION,
    latitude            DOUBLE PRECISION,
    geom                geometry(Point, 4326),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS batiments_geom_idx       ON batiments USING GIST (geom);
CREATE INDEX IF NOT EXISTS batiments_commune_idx    ON batiments (code_commune);
CREATE INDEX IF NOT EXISTS batiments_classe_idx     ON batiments (classe_energie);

-- ---------------------------------------------------------------------------
-- 5. SCORES_IRIS  (agrégats calculés par zone — alimentés par Databricks)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scores_iris (
    code_iris           CHAR(9)      PRIMARY KEY REFERENCES iris(code_iris),
    -- Prix immobilier
    prix_m2_median      NUMERIC(10,2),
    prix_m2_p25         NUMERIC(10,2),
    prix_m2_p75         NUMERIC(10,2),
    nb_transactions     INTEGER,
    date_calcul         DATE,
    -- Performance énergétique
    part_classe_ab      NUMERIC(5,2),  -- % biens en classe A ou B
    part_classe_fg      NUMERIC(5,2),  -- % biens en classe F ou G (passoires)
    conso_energie_med   NUMERIC(10,2),
    -- Score composite (0-100) — calculé Databricks
    score_global        NUMERIC(5,2),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 6. USERS  (authentification)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name     VARCHAR(200),
    role          VARCHAR(20)  NOT NULL DEFAULT 'user',  -- user | admin
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 7. FAVORITES  (biens sauvegardés par un utilisateur)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS favorites (
    id             BIGSERIAL    PRIMARY KEY,
    user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transaction_id BIGINT       NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    note           TEXT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE(user_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS favorites_user_idx ON favorites (user_id);

-- ---------------------------------------------------------------------------
-- Fonction utilitaire : updated_at automatique
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
