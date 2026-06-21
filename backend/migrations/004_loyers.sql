-- ═══════════════════════════════════════════════════════════════════════════════
-- HomePedia IDF — Migration 004 : Intégration données loyers CLAMEUR / OLAP
--
-- Ajoute à communes_agregat :
--   loyer_median_m2        → loyer médian observé (€/m²/mois) — source CLAMEUR 2022
--   zone_tendue            → commune en zone tendue IDF (encadrement loyers)
--   rendement_locatif_brut → loyer_annuel / prix_median_m2 * 100 (%)
--
-- Calcul rendement : loyer_median_m2 * 12 / prix_median_m2 * 100
--   Exemple Montreuil : 14.2 * 12 / 3800 * 100 ≈ 4.48% brut
--   Exemple Paris 75  : 27.4 * 12 / 10200 * 100 ≈ 3.22% brut
--
-- Source : CLAMEUR rapport 2022 + OLAP IDF 2022 + gradient géographique
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Ajout des colonnes ─────────────────────────────────────────────────────
ALTER TABLE public.communes_agregat
  ADD COLUMN IF NOT EXISTS loyer_median_m2        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS zone_tendue             BOOLEAN          DEFAULT false,
  ADD COLUMN IF NOT EXISTS rendement_locatif_brut  DOUBLE PRECISION;

-- ── 2. Peuplement par département (données CLAMEUR 2022) ──────────────────────
--
-- Loyers médians observés : CLAMEUR rapport 2022 + OLAP IDF
-- Gradient appliqué : loyer proportionnel à la position de prix dans le département
-- (communes plus chères ↔ plus proches Paris → loyer plus élevé)

-- Paris (75) — OLAP 2022 : ~27.4 €/m²/mois pour appartements toutes tailles
UPDATE public.communes_agregat
SET
  loyer_median_m2 = ROUND(CAST(
    CASE
      WHEN prix_median_m2 IS NOT NULL THEN
        GREATEST(6.0, LEAST(40.0, 27.4 * (0.5 + 0.5 * prix_median_m2 / 10200.0)))
      ELSE 27.4
    END AS NUMERIC), 1),
  zone_tendue = true
WHERE TRIM(code_departement) = '75';

-- Hauts-de-Seine (92) — OLAP 2022 : ~18.5 €/m²/mois
UPDATE public.communes_agregat
SET
  loyer_median_m2 = ROUND(CAST(
    CASE
      WHEN prix_median_m2 IS NOT NULL THEN
        GREATEST(6.0, LEAST(40.0, 18.5 * (0.5 + 0.5 * prix_median_m2 / 7800.0)))
      ELSE 18.5
    END AS NUMERIC), 1),
  zone_tendue = true
WHERE TRIM(code_departement) = '92';

-- Seine-Saint-Denis (93) — CLAMEUR 2022 : ~13.2 €/m²/mois
UPDATE public.communes_agregat
SET
  loyer_median_m2 = ROUND(CAST(
    CASE
      WHEN prix_median_m2 IS NOT NULL THEN
        GREATEST(6.0, LEAST(40.0, 13.2 * (0.5 + 0.5 * prix_median_m2 / 3800.0)))
      ELSE 13.2
    END AS NUMERIC), 1),
  zone_tendue = true
WHERE TRIM(code_departement) = '93';

-- Val-de-Marne (94) — OLAP 2022 : ~15.8 €/m²/mois
UPDATE public.communes_agregat
SET
  loyer_median_m2 = ROUND(CAST(
    CASE
      WHEN prix_median_m2 IS NOT NULL THEN
        GREATEST(6.0, LEAST(40.0, 15.8 * (0.5 + 0.5 * prix_median_m2 / 5500.0)))
      ELSE 15.8
    END AS NUMERIC), 1),
  zone_tendue = true
WHERE TRIM(code_departement) = '94';

-- Seine-et-Marne (77) — CLAMEUR 2022 : ~10.6 €/m²/mois
UPDATE public.communes_agregat
SET
  loyer_median_m2 = ROUND(CAST(
    CASE
      WHEN prix_median_m2 IS NOT NULL THEN
        GREATEST(6.0, LEAST(40.0, 10.6 * (0.5 + 0.5 * prix_median_m2 / 2800.0)))
      ELSE 10.6
    END AS NUMERIC), 1),
  zone_tendue = false
WHERE TRIM(code_departement) = '77';

-- Yvelines (78) — CLAMEUR 2022 : ~13.4 €/m²/mois
UPDATE public.communes_agregat
SET
  loyer_median_m2 = ROUND(CAST(
    CASE
      WHEN prix_median_m2 IS NOT NULL THEN
        GREATEST(6.0, LEAST(40.0, 13.4 * (0.5 + 0.5 * prix_median_m2 / 4500.0)))
      ELSE 13.4
    END AS NUMERIC), 1),
  zone_tendue = true
WHERE TRIM(code_departement) = '78';

-- Essonne (91) — CLAMEUR 2022 : ~12.1 €/m²/mois
UPDATE public.communes_agregat
SET
  loyer_median_m2 = ROUND(CAST(
    CASE
      WHEN prix_median_m2 IS NOT NULL THEN
        GREATEST(6.0, LEAST(40.0, 12.1 * (0.5 + 0.5 * prix_median_m2 / 3200.0)))
      ELSE 12.1
    END AS NUMERIC), 1),
  zone_tendue = true
WHERE TRIM(code_departement) = '91';

-- Val-d'Oise (95) — CLAMEUR 2022 : ~12.8 €/m²/mois
UPDATE public.communes_agregat
SET
  loyer_median_m2 = ROUND(CAST(
    CASE
      WHEN prix_median_m2 IS NOT NULL THEN
        GREATEST(6.0, LEAST(40.0, 12.8 * (0.5 + 0.5 * prix_median_m2 / 3400.0)))
      ELSE 12.8
    END AS NUMERIC), 1),
  zone_tendue = true
WHERE TRIM(code_departement) = '95';

-- ── 3. Calcul du rendement locatif brut ───────────────────────────────────────

UPDATE public.communes_agregat
SET rendement_locatif_brut = ROUND(
  CAST(loyer_median_m2 * 12.0 / NULLIF(prix_median_m2, 0) * 100.0 AS NUMERIC),
  2
)
WHERE loyer_median_m2 IS NOT NULL
  AND prix_median_m2  IS NOT NULL
  AND prix_median_m2  > 0;

-- ── 4. Index pour les requêtes "top communes par rendement" ───────────────────

CREATE INDEX IF NOT EXISTS idx_communes_agregat_rendement
  ON public.communes_agregat (rendement_locatif_brut DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_communes_agregat_zone_tendue
  ON public.communes_agregat (zone_tendue);

-- ── 5. Vérification ──────────────────────────────────────────────────────────

SELECT
  TRIM(code_departement)                                           AS dept,
  COUNT(*)                                                         AS nb_communes,
  ROUND(AVG(loyer_median_m2)::NUMERIC, 1)                         AS loyer_moyen,
  ROUND(AVG(rendement_locatif_brut)::NUMERIC, 2)                  AS rendement_moyen,
  ROUND(MIN(rendement_locatif_brut)::NUMERIC, 2)                  AS rendement_min,
  ROUND(MAX(rendement_locatif_brut)::NUMERIC, 2)                  AS rendement_max
FROM public.communes_agregat
WHERE loyer_median_m2 IS NOT NULL
GROUP BY TRIM(code_departement)
ORDER BY TRIM(code_departement);
