-- ══════════════════════════════════════════════════════════════════════════════
-- GOLD : communes_serie_temporelle
-- Une ligne par (commune × année) — alimentera le modèle ML de prédiction
-- et le RAG pour répondre aux questions d'évolution dans le temps.
--
-- Ex : "Les prix de Montreuil ont-ils augmenté depuis 2021 ?"
--      "Quelle commune a la plus forte croissance sur 3 ans ?"
-- ══════════════════════════════════════════════════════════════════════════════

{{
  config(
    materialized='table',
    cluster_by=["code_commune", "annee"]
  )
}}

WITH par_annee AS (
    SELECT
        code_commune,
        annee,
        COUNT(*)                                            AS nb_transactions,
        APPROX_QUANTILES(prix_m2, 100)[OFFSET(50)]         AS prix_median_m2,
        AVG(prix_m2)                                        AS prix_moyen_m2,
        AVG(surface_reelle_bati)                            AS surface_moyenne,
        APPROX_QUANTILES(valeur_fonciere, 100)[OFFSET(50)] AS prix_median_transaction,
        COUNTIF(type_local = 'Appartement') * 100.0 / COUNT(*) AS pct_appartements,
        COUNTIF(type_local = 'Maison') * 100.0 / COUNT(*)      AS pct_maisons
    FROM {{ ref('silver_transactions') }}
    WHERE prix_m2 IS NOT NULL
    GROUP BY code_commune, annee
),

-- Calcul de la croissance année sur année (pour ML features + RAG)
avec_croissance AS (
    SELECT
        code_commune,
        annee,
        nb_transactions,
        ROUND(prix_median_m2, 0)            AS prix_median_m2,
        ROUND(prix_moyen_m2, 0)             AS prix_moyen_m2,
        ROUND(surface_moyenne, 1)           AS surface_moyenne,
        ROUND(prix_median_transaction, 0)   AS prix_median_transaction,
        ROUND(pct_appartements, 1)          AS pct_appartements,
        ROUND(pct_maisons, 1)               AS pct_maisons,

        -- Croissance vs année précédente (feature ML clé)
        ROUND(
            100.0 * (prix_median_m2 - LAG(prix_median_m2) OVER (
                PARTITION BY code_commune ORDER BY annee
            )) / NULLIF(LAG(prix_median_m2) OVER (
                PARTITION BY code_commune ORDER BY annee
            ), 0),
            2
        ) AS croissance_prix_pct,

        -- Volume de transactions vs année précédente
        ROUND(
            100.0 * (nb_transactions - LAG(nb_transactions) OVER (
                PARTITION BY code_commune ORDER BY annee
            )) / NULLIF(LAG(nb_transactions) OVER (
                PARTITION BY code_commune ORDER BY annee
            ), 0),
            2
        ) AS croissance_volume_pct,

        CURRENT_TIMESTAMP() AS updated_at

    FROM par_annee
    WHERE nb_transactions >= 3  -- ignorer les années avec trop peu de data
)

SELECT * FROM avec_croissance
