-- Migration 004 : Gestion locative pour propriétaires bailleurs

CREATE TABLE IF NOT EXISTS gestion_biens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    adresse         TEXT NOT NULL,
    code_postal     VARCHAR(5),
    ville           VARCHAR(100),
    code_insee      VARCHAR(10),
    type_bien       VARCHAR(20) NOT NULL DEFAULT 'appartement',
    surface_m2      NUMERIC(8,2),
    nb_pieces       INTEGER,
    etage           INTEGER,
    loyer_nu        NUMERIC(10,2),
    charges         NUMERIC(10,2) DEFAULT 0,
    depot_garantie  NUMERIC(10,2),
    date_acquisition DATE,
    prix_acquisition NUMERIC(12,2),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gestion_locataires (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL,
    bien_id                 UUID REFERENCES gestion_biens(id) ON DELETE SET NULL,
    prenom                  VARCHAR(100) NOT NULL,
    nom                     VARCHAR(100) NOT NULL,
    email                   VARCHAR(255),
    telephone               VARCHAR(20),
    date_entree             DATE,
    date_fin_bail           DATE,
    type_bail               VARCHAR(20) DEFAULT 'vide',
    loyer_mensuel           NUMERIC(10,2),
    charges_mensuelles      NUMERIC(10,2) DEFAULT 0,
    depot_garantie          NUMERIC(10,2),
    depot_garantie_restitue BOOLEAN DEFAULT FALSE,
    actif                   BOOLEAN DEFAULT TRUE,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gestion_paiements (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bien_id          UUID NOT NULL REFERENCES gestion_biens(id) ON DELETE CASCADE,
    locataire_id     UUID NOT NULL REFERENCES gestion_locataires(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL,
    mois             INTEGER NOT NULL CHECK (mois BETWEEN 1 AND 12),
    annee            INTEGER NOT NULL,
    montant_loyer    NUMERIC(10,2) NOT NULL,
    montant_charges  NUMERIC(10,2) DEFAULT 0,
    date_paiement    DATE,
    statut           VARCHAR(20) DEFAULT 'en_attente',
    montant_recu     NUMERIC(10,2),
    note             TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(locataire_id, mois, annee)
);

CREATE INDEX IF NOT EXISTS idx_gestion_biens_user     ON gestion_biens(user_id);
CREATE INDEX IF NOT EXISTS idx_gestion_locataires_bien ON gestion_locataires(bien_id);
CREATE INDEX IF NOT EXISTS idx_gestion_paiements_bien  ON gestion_paiements(bien_id);
CREATE INDEX IF NOT EXISTS idx_gestion_paiements_statut ON gestion_paiements(statut);
