-- ══════════════════════════════════════════════════════════════════════════════
-- GOLD : communes_agregat — table finale consommée par l'API Go et le frontend
--
-- Agrège par commune :
--   - Métriques DVF : prix médian/m², nb transactions, surface moyenne
--   - Métriques DPE : score moyen, % bon DPE, conso énergie (si disponibles)
--
-- APPROX_QUANTILES = médiane compatible GROUP BY dans BigQuery.
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

WITH dvf_agg AS (
    SELECT
        code_commune,
        COUNT(*)                                                        AS nb_transactions,
        APPROX_QUANTILES(prix_m2, 100)[OFFSET(50)]                     AS prix_median_m2,
        AVG(prix_m2)                                                    AS prix_moyen_m2,
        AVG(surface_reelle_bati)                                        AS surface_moyenne,
        APPROX_QUANTILES(valeur_fonciere, 100)[OFFSET(50)]             AS prix_median_transaction
    FROM {{ ref('silver_transactions') }}
    WHERE
        prix_m2 IS NOT NULL
        AND annee >= 2021
    GROUP BY code_commune
),

{% if execute %}
{% set dpe_exists = adapter.get_relation(
    database='homepedia-493013',
    schema='homepedia_dev_silver',
    identifier='silver_dpe'
) %}
{% else %}
{% set dpe_exists = false %}
{% endif %}

{% if dpe_exists %}
dpe_agg AS (
    SELECT
        code_commune,
        COUNT(*)                                    AS nb_dpe,
        ROUND(AVG(score_dpe), 2)                   AS score_dpe_moyen,
        ROUND(AVG(conso_energie), 2)               AS conso_energie_moyenne,
        ROUND(AVG(emission_ges), 2)                AS emission_ges_moyenne,
        ROUND(100.0 * SUM(est_bon_dpe) / COUNT(*), 1) AS pct_dpe_bon
    FROM {{ ref('silver_dpe') }}
    WHERE annee_dpe >= 2018
    GROUP BY code_commune
),
{% endif %}

final AS (
    SELECT
        t.code_commune,
        t.nb_transactions,
        ROUND(t.prix_median_m2, 0)                      AS prix_median_m2,
        ROUND(t.prix_moyen_m2, 0)                       AS prix_moyen_m2,
        ROUND(t.surface_moyenne, 1)                     AS surface_moyenne,
        ROUND(t.prix_median_transaction, 0)             AS prix_median_transaction,
        {% if dpe_exists %}
        d.nb_dpe,
        d.score_dpe_moyen,
        d.conso_energie_moyenne,
        d.emission_ges_moyenne,
        d.pct_dpe_bon,
        {% else %}
        CAST(NULL AS INT64)     AS nb_dpe,
        CAST(NULL AS FLOAT64)   AS score_dpe_moyen,
        CAST(NULL AS FLOAT64)   AS conso_energie_moyenne,
        CAST(NULL AS FLOAT64)   AS emission_ges_moyenne,
        CAST(NULL AS FLOAT64)   AS pct_dpe_bon,
        {% endif %}
        CURRENT_TIMESTAMP()                             AS updated_at

    FROM dvf_agg t
    {% if dpe_exists %}
    LEFT JOIN dpe_agg d ON t.code_commune = d.code_commune
    {% endif %}
    WHERE t.nb_transactions >= 5
)

SELECT * FROM final
