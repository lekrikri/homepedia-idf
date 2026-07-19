-- Migration 009 : Espace locataire + gestion documentaire
--
-- Rend reproductible le schéma appliqué manuellement en prod :
--   1. Table documents (pièces du bail, diagnostics, justificatifs locataire)
--   2. Colonne locataire_user_id (lie un locataire à son compte utilisateur)
--   3. Correctif FK bien_id : SET NULL -> CASCADE

-- 1. Lien locataire <-> compte utilisateur (créé par POST /gestion/locataires/:id/inviter)
ALTER TABLE gestion_locataires
ADD COLUMN IF NOT EXISTS locataire_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gestion_locataires_user
    ON gestion_locataires(locataire_user_id);

-- 2. Documents locatifs — contenu stocké en bytea (volumes faibles, pas de bucket externe)
CREATE TABLE IF NOT EXISTS documents (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bien_id               UUID REFERENCES gestion_biens(id) ON DELETE CASCADE,
    locataire_id          UUID REFERENCES gestion_locataires(id) ON DELETE SET NULL,
    uploaded_by_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    visible_par_locataire BOOLEAN DEFAULT TRUE,
    categorie             VARCHAR(50) NOT NULL,
    nom_fichier           VARCHAR(255) NOT NULL,
    taille_octets         BIGINT,
    mime_type             VARCHAR(100),
    contenu               BYTEA NOT NULL,
    created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_bien_id ON documents(bien_id);
CREATE INDEX IF NOT EXISTS idx_documents_locataire_id ON documents(locataire_id);

-- 3. Correctif : la FK d'origine (004) était ON DELETE SET NULL. Supprimer un bien
-- laissait le locataire en base avec bien_id NULL et actif=true — invisible dans l'UI
-- (qui liste les locataires via leurs biens) donc impossible à supprimer ensuite.
-- CASCADE aligne le comportement sur gestion_paiements.
ALTER TABLE gestion_locataires
    DROP CONSTRAINT IF EXISTS gestion_locataires_bien_id_fkey;

ALTER TABLE gestion_locataires
    ADD CONSTRAINT gestion_locataires_bien_id_fkey
    FOREIGN KEY (bien_id) REFERENCES gestion_biens(id) ON DELETE CASCADE;

-- Nettoyage des orphelins laissés par l'ancienne contrainte
DELETE FROM gestion_locataires WHERE bien_id IS NULL;
