-- Migration 008 — Table audit_logs (RGPD #29)
-- Enregistre les actions sensibles (auth, RAG) pour la traçabilité.
-- Purge automatique à 30 jours via pg_cron (si disponible) ou Cloud Scheduler.

CREATE TABLE IF NOT EXISTS audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     TEXT,           -- NULL si requête non authentifiée
    ip          TEXT NOT NULL,
    method      TEXT NOT NULL,
    path        TEXT NOT NULL,
    status      INT  NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pour les purges et recherches par date/user
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at);
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx    ON audit_logs (user_id) WHERE user_id IS NOT NULL;

-- Politique de rétention : purger les entrées > 30 jours
-- À exécuter via pg_cron (Supabase Dashboard > Extensions > pg_cron) :
-- SELECT cron.schedule('purge-audit-logs', '0 3 * * *',
--   $$DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '30 days'$$);

-- RLS : seul le rôle service_role peut lire audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_service_only ON audit_logs
    FOR ALL TO service_role USING (true);
