-- ═══════════════════════════════════════════════════════════════════════════════
-- HomePedia IDF — Migration 006 : Accessibilité + Risques + Score Global
--
-- Ajoute à communes_agregat :
--   pct_fibre           → % logements éligibles fibre (FTTH)
--   nb_arrets_tc        → nombre d'arrêts TC dans la commune
--   distance_paris_km   → distance vol d'oiseau au centre de Paris
--   risque_inondation   → présence PPRi (0=aucun → 3=fort)
--   risque_argile       → aléa argile BRGM (0=nul → 3=fort)
--   score_accessibilite → score 0-100 (TC + fibre + proximité Paris)
--   score_risques       → score 0-100 (100=sans risque)
--   score_global        → score composite global 0-100
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.communes_agregat
    ADD COLUMN IF NOT EXISTS pct_fibre              DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS nb_arrets_tc           INTEGER,
    ADD COLUMN IF NOT EXISTS distance_paris_km      DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS risque_inondation      SMALLINT,
    ADD COLUMN IF NOT EXISTS risque_argile          SMALLINT,
    ADD COLUMN IF NOT EXISTS score_accessibilite    DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS score_risques          DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS score_global           DOUBLE PRECISION;

COMMENT ON COLUMN public.communes_agregat.pct_fibre           IS '% logements éligibles fibre FTTH — source ARCEP';
COMMENT ON COLUMN public.communes_agregat.nb_arrets_tc        IS 'Nombre d''arrêts TC (bus/métro/RER/tram) — source IDFM GTFS';
COMMENT ON COLUMN public.communes_agregat.distance_paris_km   IS 'Distance vol d''oiseau au centre de Paris (Notre-Dame) en km';
COMMENT ON COLUMN public.communes_agregat.risque_inondation   IS 'Risque inondation PPRi : 0=aucun, 1=faible, 2=moyen, 3=fort — GASPAR';
COMMENT ON COLUMN public.communes_agregat.risque_argile       IS 'Aléa retrait-gonflement argile : 0=nul, 1=faible, 2=moyen, 3=fort — BRGM';
COMMENT ON COLUMN public.communes_agregat.score_accessibilite IS 'Score accessibilité 0-100 — TC 40% + fibre 20% + proximité Paris 40%';
COMMENT ON COLUMN public.communes_agregat.score_risques       IS 'Score risques 0-100 (100=sans risque) — inondation 50% + argile 50%';
COMMENT ON COLUMN public.communes_agregat.score_global        IS 'Score global HomePedia 0-100 — synthèse de tous les scores';

CREATE INDEX IF NOT EXISTS idx_agregat_fibre
    ON public.communes_agregat (pct_fibre DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_agregat_accessibilite
    ON public.communes_agregat (score_accessibilite DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_agregat_score_global
    ON public.communes_agregat (score_global DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_agregat_distance_paris
    ON public.communes_agregat (distance_paris_km ASC NULLS LAST);

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'communes_agregat'
  AND column_name IN (
      'pct_fibre', 'nb_arrets_tc', 'distance_paris_km',
      'risque_inondation', 'risque_argile',
      'score_accessibilite', 'score_risques', 'score_global'
  )
ORDER BY column_name;
