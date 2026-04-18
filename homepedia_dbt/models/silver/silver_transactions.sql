-- ══════════════════════════════════════════════════════════════════════════════
-- SILVER : transactions DVF nettoyées
--
-- Transformations appliquées :
--   1. Déduplication sur id_mutation + type_local
--   2. Filtrage des prix aberrants (< 500 €/m² ou > 50 000 €/m²)
--   3. Filtrage géographique (coordonnées dans l'IDF uniquement)
--   4. Normalisation du code commune (Paris : 751xx → 75056)
--   5. Calcul du prix au m² et de la catégorie de bien
--   6. Suppression des lignes sans surface ni prix
-- ══════════════════════════════════════════════════════════════════════════════

{{
  config(
    materialized='incremental',
    unique_key='transaction_id',
    incremental_strategy='merge',
    partition_by={
      "field": "date_mutation",
      "data_type": "date",
      "granularity": "month"
    },
    cluster_by=["code_commune", "type_local"]
  )
}}

WITH deduplicated AS (
    -- Étape 1 : Dédupliquer — une transaction peut apparaître plusieurs fois
    -- dans DVF (1 ligne par lot). On garde la 1ère occurrence par mutation+type.
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY id_mutation, COALESCE(type_local, 'INCONNU')
            ORDER BY date_mutation
        ) AS rn
    FROM {{ ref('bronze_transactions') }}
    WHERE id_mutation IS NOT NULL
),

filtered AS (
    -- Étape 2 : Filtrer les données aberrantes
    SELECT *
    FROM deduplicated
    WHERE
        rn = 1
        -- Prix cohérent
        AND valeur_fonciere > 0
        -- Surface cohérente (si renseignée)
        AND (surface_reelle_bati IS NULL OR surface_reelle_bati > 0)
        -- Prix au m² dans une fourchette réaliste pour l'IDF
        AND (
            surface_reelle_bati IS NULL
            OR surface_reelle_bati = 0
            OR (
                valeur_fonciere / surface_reelle_bati BETWEEN 500 AND 50000
            )
        )
        -- Coordonnées GPS dans l'IDF (ou NULL acceptable)
        AND (
            longitude IS NULL
            OR (longitude BETWEEN 1.4 AND 3.6 AND latitude BETWEEN 47.9 AND 49.3)
        )
),

normalized AS (
    -- Étape 3 : Normalisation
    SELECT
        -- Identifiant unique stable
        {{ dbt_utils.generate_surrogate_key(['id_mutation', "COALESCE(type_local, 'INCONNU')"]) }} AS transaction_id,

        id_mutation,
        CAST(date_mutation AS DATE) AS date_mutation,
        EXTRACT(YEAR FROM CAST(date_mutation AS DATE)) AS annee,
        EXTRACT(MONTH FROM CAST(date_mutation AS DATE)) AS mois,

        -- Normalisation commune Paris : 75101-75120 → 75056
        CASE
            WHEN CAST(code_commune AS STRING) LIKE '751%'
             AND code_commune != '75056'
            THEN '75056'
            ELSE CAST(code_commune AS STRING)
        END AS code_commune,

        nom_commune,
        code_departement,
        code_postal,

        -- Localisation
        longitude,
        latitude,

        -- Prix
        CAST(valeur_fonciere AS FLOAT64) AS valeur_fonciere,

        -- Surface
        CAST(surface_reelle_bati AS FLOAT64) AS surface_reelle_bati,
        CAST(surface_terrain AS FLOAT64) AS surface_terrain,

        -- Prix au m² calculé
        CASE
            WHEN surface_reelle_bati > 0
            THEN ROUND(valeur_fonciere / surface_reelle_bati, 2)
            ELSE NULL
        END AS prix_m2,

        -- Caractéristiques du bien
        type_local,
        nature_mutation,
        CAST(nombre_pieces_principales AS INT64) AS nb_pieces,

        -- Catégorie simplifiée (pour les filtres frontend)
        CASE
            WHEN type_local IN ('Appartement') THEN 'appartement'
            WHEN type_local IN ('Maison') THEN 'maison'
            WHEN type_local IN ('Local industriel. commercial ou assimilé') THEN 'commercial'
            ELSE 'autre'
        END AS categorie,

        _ingested_at

    FROM filtered
),

{% if is_incremental() %}
-- En mode incrémental : on ne traite que les nouvelles mutations
final AS (
    SELECT n.*
    FROM normalized n
    WHERE n.transaction_id NOT IN (
        SELECT transaction_id FROM {{ this }}
    )
)
{% else %}
-- Premier run : toutes les transactions
final AS (SELECT * FROM normalized)
{% endif %}

SELECT * FROM final
