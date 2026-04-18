-- ══════════════════════════════════════════════════════════════════════════════
-- SILVER : DPE nettoyés
-- Transformations : déduplication, filtrage, normalisation commune Paris
-- ══════════════════════════════════════════════════════════════════════════════

{{
  config(
    materialized='incremental',
    unique_key='id_dpe',
    incremental_strategy='merge'
  )
}}

WITH cleaned AS (
    SELECT
        id_dpe,
        CAST(date_dpe AS DATE)                              AS date_dpe,
        annee_dpe,

        -- Normalisation commune Paris (même logique que silver_transactions)
        CASE
            WHEN CAST(code_commune AS STRING) LIKE '751%'
             AND code_commune != '75056'
            THEN '75056'
            ELSE CAST(code_commune AS STRING)
        END AS code_commune,

        nom_commune,
        code_postal,
        code_departement,
        etiquette_dpe,
        etiquette_ges,

        CAST(conso_energie_kwh_m2 AS FLOAT64)               AS conso_energie,
        CAST(emission_ges_kg_m2   AS FLOAT64)               AS emission_ges,
        CAST(surface_m2           AS FLOAT64)               AS surface,
        type_batiment,
        periode_construction,
        CAST(score_dpe   AS INT64)                          AS score_dpe,
        CAST(est_bon_dpe AS INT64)                          AS est_bon_dpe,

        _ingested_at

    FROM {{ ref('bronze_dpe') }}
    WHERE
        id_dpe IS NOT NULL
        AND etiquette_dpe IN ('A', 'B', 'C', 'D', 'E', 'F', 'G')
        AND conso_energie_kwh_m2 IS NOT NULL
        AND conso_energie_kwh_m2 > 0
        -- DPE récents seulement (avant 2013 = méthode obsolète)
        AND annee_dpe >= 2013
)

{% if is_incremental() %}
SELECT c.*
FROM cleaned c
WHERE c.id_dpe NOT IN (SELECT id_dpe FROM {{ this }})
{% else %}
SELECT * FROM cleaned
{% endif %}
