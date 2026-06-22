-- ═══════════════════════════════════════════════════════════════════════════════
-- HomePedia IDF — Migration 005 : Nouveaux indicateurs SSMSI + IPS + ENEDIS
--
-- Ajoute à communes_agregat :
--
--   [SSMSI Délinquance]
--   taux_cambriolages    → cambriolages pour 1 000 logements (par dpt)
--   taux_vols_violence   → coups et blessures pour 1 000 habitants
--   score_securite       → score 0-100 (100 = très sûr)
--
--   [IPS Éducation — DEPP/MEN]
--   ips_moyen            → IPS moyen des écoles de la commune
--   ips_median           → IPS médian (robuste aux outliers)
--   nb_ecoles            → nombre d'établissements scolaires
--   pct_ecoles_favorisees → % établissements IPS > 110
--
--   [ENEDIS/GRDF — agenceORE]
--   conso_elec_mwh           → conso élec résidentielle totale (MWh/an)
--   conso_gaz_mwh            → conso gaz résidentielle totale (MWh/an)
--   conso_elec_par_logement  → MWh/logement/an (proxy isolation)
--   conso_gaz_par_logement   → MWh/logement/an
--
--   [Scores composites]
--   score_qualite_vie    → score 0-100 (IPS + DPE + équipements + énergie)
--   score_investissement → score 0-100 (liquidité + IPS + DPE + rendement)
--   score_stabilite      → score 0-100 (DPE + énergie + GES)
--
-- Sources :
--   data.gouv.fr/datasets/53699576a3a729239d20471d  (SSMSI)
--   data.gouv.fr/datasets/634fefba689b52c6ef7bf3db  (IPS)
--   opendata.agenceore.fr                           (ENEDIS/GRDF)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Sécurité / Délinquance ────────────────────────────────────────────────

ALTER TABLE public.communes_agregat
    ADD COLUMN IF NOT EXISTS taux_cambriolages   DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS taux_vols_violence  DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS score_securite      DOUBLE PRECISION;

COMMENT ON COLUMN public.communes_agregat.taux_cambriolages  IS 'Cambriolages pour 1 000 logements — source SSMSI, mapped par département';
COMMENT ON COLUMN public.communes_agregat.taux_vols_violence IS 'Coups et blessures volontaires pour 1 000 habitants — source SSMSI';
COMMENT ON COLUMN public.communes_agregat.score_securite     IS 'Score sécurité 0-100 (100=très sûr) — 60% cambrio + 40% CBV, bornes nationales';

-- ── 2. IPS Éducation ─────────────────────────────────────────────────────────

ALTER TABLE public.communes_agregat
    ADD COLUMN IF NOT EXISTS ips_moyen              DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS ips_median             DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS nb_ecoles              INTEGER,
    ADD COLUMN IF NOT EXISTS pct_ecoles_favorisees  DOUBLE PRECISION;

COMMENT ON COLUMN public.communes_agregat.ips_moyen              IS 'IPS moyen (50-180) — Indice Position Sociale DEPP/MEN 2022';
COMMENT ON COLUMN public.communes_agregat.ips_median             IS 'IPS médian — robuste aux établissements atypiques';
COMMENT ON COLUMN public.communes_agregat.nb_ecoles              IS 'Nombre d'établissements scolaires (écoles + collèges)';
COMMENT ON COLUMN public.communes_agregat.pct_ecoles_favorisees  IS '% établissements avec IPS > 110 (seuil "milieu favorisé")';

-- ── 3. Énergie ENEDIS/GRDF ───────────────────────────────────────────────────

ALTER TABLE public.communes_agregat
    ADD COLUMN IF NOT EXISTS conso_elec_mwh            DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS conso_gaz_mwh             DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS conso_elec_par_logement   DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS conso_gaz_par_logement    DOUBLE PRECISION;

COMMENT ON COLUMN public.communes_agregat.conso_elec_mwh           IS 'Conso élec résidentielle totale MWh/an — ENEDIS via agenceORE';
COMMENT ON COLUMN public.communes_agregat.conso_gaz_mwh            IS 'Conso gaz résidentielle totale MWh/an — GRDF via agenceORE';
COMMENT ON COLUMN public.communes_agregat.conso_elec_par_logement  IS 'Conso élec MWh/logement/an — proxy qualité isolation';
COMMENT ON COLUMN public.communes_agregat.conso_gaz_par_logement   IS 'Conso gaz MWh/logement/an';

-- ── 4. Scores composites ──────────────────────────────────────────────────────

ALTER TABLE public.communes_agregat
    ADD COLUMN IF NOT EXISTS score_qualite_vie    DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS score_investissement DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS score_stabilite      DOUBLE PRECISION;

COMMENT ON COLUMN public.communes_agregat.score_qualite_vie    IS 'Score qualité de vie 0-100 — IPS 30%+DPE 20%+POI 20%+énergie 15%+écoles 15%';
COMMENT ON COLUMN public.communes_agregat.score_investissement IS 'Score investissement 0-100 — liquidité 25%+IPS 25%+DPE 20%+prix 15%+bobo 15%';
COMMENT ON COLUMN public.communes_agregat.score_stabilite      IS 'Score stabilité 0-100 — DPE 30%+énergie 25%+GES 25%+%bonDPE 20%';

-- ── 5. Index pour les tris frontend ──────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_agregat_securite
    ON public.communes_agregat (score_securite DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_agregat_ips
    ON public.communes_agregat (ips_moyen DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_agregat_score_qualite
    ON public.communes_agregat (score_qualite_vie DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_agregat_score_invest
    ON public.communes_agregat (score_investissement DESC NULLS LAST);

-- ── 6. Vérification du schéma ────────────────────────────────────────────────

SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'communes_agregat'
  AND column_name IN (
      'taux_cambriolages', 'taux_vols_violence', 'score_securite',
      'ips_moyen', 'ips_median', 'nb_ecoles', 'pct_ecoles_favorisees',
      'conso_elec_mwh', 'conso_gaz_mwh',
      'conso_elec_par_logement', 'conso_gaz_par_logement',
      'score_qualite_vie', 'score_investissement', 'score_stabilite'
  )
ORDER BY column_name;
