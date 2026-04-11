-- ══════════════════════════════════════════════════════════════════════════════
-- SILVER : DPE nettoyés
-- Transformations : déduplication, score numérique, normalisation commune
-- ══════════════════════════════════════════════════════════════════════════════

{{
  config(
    materialized='incremental',
    unique_key='numero_dpe',
    incremental_strategy='merge'
  )
}}

WITH scored AS (
    SELECT
        numero_dpe,
        CAST(date_etablissement_dpe AS DATE) AS date_dpe,
        EXTRACT(YEAR FROM CAST(date_etablissement_dpe AS DATE)) AS annee_dpe,
        code_insee_ban AS code_commune,
        code_postal_ban AS code_postal,
        code_departement,
        classe_energie,
        etiquette_ges,
        CAST(conso_energie AS FLOAT64) AS conso_energie,
        CAST(emission_ges AS FLOAT64) AS emission_ges,
        CAST(surface_habitable_logement AS FLOAT64) AS surface,
        CAST(annee_construction AS INT64) AS annee_construction,
        type_batiment,

        -- Score numérique A=1 (excellent) → G=7 (très énergivore)
        -- Permet de calculer une moyenne par commune
        CASE classe_energie
            WHEN 'A' THEN 1
            WHEN 'B' THEN 2
            WHEN 'C' THEN 3
            WHEN 'D' THEN 4
            WHEN 'E' THEN 5
            WHEN 'F' THEN 6
            WHEN 'G' THEN 7
            ELSE NULL
        END AS score_dpe,

        -- Indicateur "bon DPE" (A, B ou C) pour le calcul du pourcentage
        CASE WHEN classe_energie IN ('A', 'B', 'C') THEN 1 ELSE 0 END AS est_bon_dpe,

        _ingested_at

    FROM {{ ref('bronze_dpe') }}
    WHERE
        numero_dpe IS NOT NULL
        AND classe_energie IN ('A', 'B', 'C', 'D', 'E', 'F', 'G')
        AND conso_energie IS NOT NULL
        AND conso_energie > 0
)

{% if is_incremental() %}
SELECT s.*
FROM scored s
WHERE s.numero_dpe NOT IN (SELECT numero_dpe FROM {{ this }})
{% else %}
SELECT * FROM scored
{% endif %}
