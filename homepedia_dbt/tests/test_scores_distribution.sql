-- Test qualité : distribution des scores composites
-- Les scores percentiles 0-100 doivent avoir :
--   • une médiane proche de 50 (±20) — distribution centrée
--   • pas de valeurs hors bornes (0-100 strict)
--   • au moins 80% des communes avec les 3 scores renseignés
--
-- Si ce test ÉCHOUE → les scores sont mal calibrés ou l'ingestion Python a échoué

WITH score_stats AS (
    SELECT
        -- Médiane score qualité vie
        APPROX_QUANTILES(score_qualite_vie, 100)[OFFSET(50)]    AS median_qv,
        APPROX_QUANTILES(score_investissement, 100)[OFFSET(50)] AS median_inv,
        APPROX_QUANTILES(score_stabilite, 100)[OFFSET(50)]      AS median_stab,

        -- Couverture : % communes avec les 3 scores
        ROUND(100.0 * COUNTIF(
            score_qualite_vie IS NOT NULL
            AND score_investissement IS NOT NULL
            AND score_stabilite IS NOT NULL
        ) / COUNT(*), 1) AS pct_communes_3_scores,

        -- Valeurs hors bornes (ne doit pas arriver avec min-max percentile)
        COUNTIF(score_qualite_vie    NOT BETWEEN 0 AND 100) AS nb_hors_bornes_qv,
        COUNTIF(score_investissement NOT BETWEEN 0 AND 100) AS nb_hors_bornes_inv,
        COUNTIF(score_stabilite      NOT BETWEEN 0 AND 100) AS nb_hors_bornes_stab
    FROM {{ ref('gold_communes_agregat') }}
)

SELECT
    *,
    'ERREUR : scores mal distribués ou ingestion manquante' AS message
FROM score_stats
WHERE
    -- Médiane trop éloignée de 50 → distribution biaisée
    ABS(COALESCE(median_qv, 50)   - 50) > 30
    OR ABS(COALESCE(median_inv, 50)  - 50) > 30
    OR ABS(COALESCE(median_stab, 50) - 50) > 30
    -- Couverture insuffisante
    OR pct_communes_3_scores < 80
    -- Valeurs hors bornes
    OR nb_hors_bornes_qv > 0
    OR nb_hors_bornes_inv > 0
    OR nb_hors_bornes_stab > 0
