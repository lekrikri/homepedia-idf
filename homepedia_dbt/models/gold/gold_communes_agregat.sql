-- ══════════════════════════════════════════════════════════════════════════════
-- GOLD : communes_agregat — table finale consommée par l'API Go et le frontend
--
-- Agrège par commune :
--   - Métriques immobilières (prix médian/moyen, nb transactions, surface moyenne)
--   - Métriques DPE (score moyen, % bon DPE, consommation énergie)
--   - Métriques démographiques INSEE (population)
--
-- Cette table remplace le notebook PySpark Databricks par du SQL pur.
-- Résultat : 1 ligne par commune, ~1 300 lignes, rechargée complètement chaque run.
-- ══════════════════════════════════════════════════════════════════════════════

{{
  config(
    materialized='table',
    partition_by={
      "field": "updated_at",
      "data_type": "timestamp",
      "granularity": "day"
    }
  )
}}

WITH transactions_par_commune AS (
    -- Agrégation des transactions par commune
    SELECT
        code_commune,
        COUNT(*)                                          AS nb_transactions,
        PERCENTILE_CONT(prix_m2, 0.5) OVER (
            PARTITION BY code_commune
        )                                                 AS prix_median_m2,
        AVG(prix_m2)                                      AS prix_moyen_m2,
        AVG(surface_reelle_bati)                          AS surface_moyenne,
        PERCENTILE_CONT(valeur_fonciere, 0.5) OVER (
            PARTITION BY code_commune
        )                                                 AS prix_median_transaction
    FROM {{ ref('silver_transactions') }}
    WHERE
        prix_m2 IS NOT NULL
        AND annee >= 2020
    GROUP BY code_commune
),

-- Déduplique les percentiles (PERCENTILE_CONT est une window function)
transactions_agg AS (
    SELECT DISTINCT
        code_commune,
        MAX(nb_transactions) OVER (PARTITION BY code_commune)         AS nb_transactions,
        MAX(prix_median_m2) OVER (PARTITION BY code_commune)          AS prix_median_m2,
        MAX(prix_moyen_m2) OVER (PARTITION BY code_commune)           AS prix_moyen_m2,
        MAX(surface_moyenne) OVER (PARTITION BY code_commune)         AS surface_moyenne,
        MAX(prix_median_transaction) OVER (PARTITION BY code_commune) AS prix_median_transaction
    FROM transactions_par_commune
),

dpe_par_commune AS (
    -- Agrégation DPE par commune
    SELECT
        code_commune,
        COUNT(*)                        AS nb_dpe,
        ROUND(AVG(score_dpe), 2)        AS score_dpe_moyen,
        ROUND(AVG(conso_energie), 2)    AS conso_energie_moyenne,
        ROUND(AVG(emission_ges), 2)     AS emission_ges_moyenne,
        ROUND(
            100.0 * SUM(est_bon_dpe) / COUNT(*),
            1
        )                               AS pct_dpe_bon
    FROM {{ ref('silver_dpe') }}
    WHERE annee_dpe >= 2018
    GROUP BY code_commune
),

final AS (
    SELECT
        t.code_commune,
        t.nb_transactions,
        ROUND(t.prix_median_m2, 0)                      AS prix_median_m2,
        ROUND(t.prix_moyen_m2, 0)                       AS prix_moyen_m2,
        ROUND(t.surface_moyenne, 1)                     AS surface_moyenne,
        ROUND(t.prix_median_transaction, 0)             AS prix_median_transaction,
        d.nb_dpe,
        d.score_dpe_moyen,
        d.conso_energie_moyenne,
        d.emission_ges_moyenne,
        d.pct_dpe_bon,
        CURRENT_TIMESTAMP()                             AS updated_at

    FROM transactions_agg t
    LEFT JOIN dpe_par_commune d ON t.code_commune = d.code_commune
    WHERE t.nb_transactions >= 5   -- ignorer les communes avec trop peu de données
)

SELECT * FROM final
