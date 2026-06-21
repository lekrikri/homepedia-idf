-- ═══════════════════════════════════════════════════════════════════════════════
-- HomePedia IDF — Row Level Security (RLS) policies
-- À coller dans : Supabase → SQL Editor → Run
--
-- Stratégie :
--   - Données open data DVF/OSM → lecture anonyme autorisée (pas d'écriture)
--   - Données utilisateurs → chaque user voit ses propres données
--   - Pipeline → lecture admin uniquement
--   - Backend Go accède via connexion directe (service_role) → non bloqué par RLS
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Tables de données géographiques open data ──────────────────────────────
-- communes, iris, batiments : données INSEE / OSM — open data, lecture publique OK

ALTER TABLE public.communes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iris           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batiments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores_iris    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communes_agregat ENABLE ROW LEVEL SECURITY;

-- Lecture anonyme sur toutes les données publiques
CREATE POLICY "anon_read_communes"        ON public.communes        FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_read_iris"            ON public.iris            FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_read_batiments"       ON public.batiments       FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_read_scores_iris"     ON public.scores_iris     FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_read_communes_agregat" ON public.communes_agregat FOR SELECT TO anon, authenticated USING (true);

-- ── 2. Transactions DVF (données open data, lecture publique) ─────────────────
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_transactions" ON public.transactions FOR SELECT TO anon, authenticated USING (true);

-- ── 3. Table users — chaque user lit/modifie uniquement son profil ────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Lecture : son propre profil OU admin
CREATE POLICY "users_read_own" ON public.users
  FOR SELECT TO authenticated
  USING (
    email = current_setting('request.jwt.claims', true)::jsonb->>'email'
    OR (current_setting('request.jwt.claims', true)::jsonb->>'role') = 'admin'
  );

-- Mise à jour : uniquement son propre profil
CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE TO authenticated
  USING (email = current_setting('request.jwt.claims', true)::jsonb->>'email');

-- Insertion : service_role uniquement (inscription via backend Go)
CREATE POLICY "users_insert_service" ON public.users
  FOR INSERT TO service_role WITH CHECK (true);

-- ── 4. Favoris — chaque user gère les siens ───────────────────────────────────
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "favorites_read_own" ON public.favorites
  FOR SELECT TO authenticated
  USING (
    user_id = (
      SELECT id FROM public.users
      WHERE email = current_setting('request.jwt.claims', true)::jsonb->>'email'
    )
  );

CREATE POLICY "favorites_insert_own" ON public.favorites
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (
      SELECT id FROM public.users
      WHERE email = current_setting('request.jwt.claims', true)::jsonb->>'email'
    )
  );

CREATE POLICY "favorites_delete_own" ON public.favorites
  FOR DELETE TO authenticated
  USING (
    user_id = (
      SELECT id FROM public.users
      WHERE email = current_setting('request.jwt.claims', true)::jsonb->>'email'
    )
  );

-- ── 5. Pipeline runs — lecture admin uniquement ───────────────────────────────
ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipeline_runs_admin_read" ON public.pipeline_runs
  FOR SELECT TO authenticated
  USING ((current_setting('request.jwt.claims', true)::jsonb->>'role') = 'admin');

CREATE POLICY "pipeline_runs_service_all" ON public.pipeline_runs
  FOR ALL TO service_role USING (true);

-- ── 6. spatial_ref_sys (table système PostGIS) ───────────────────────────────
-- Lecture publique nécessaire pour que PostGIS fonctionne via l'API REST
ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_spatial_ref_sys" ON public.spatial_ref_sys FOR SELECT TO anon, authenticated USING (true);

-- ── Vérification ──────────────────────────────────────────────────────────────
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
