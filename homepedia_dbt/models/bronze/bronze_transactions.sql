-- ══════════════════════════════════════════════════════════════════════════════
-- BRONZE : transactions DVF brutes
-- Source : fichiers Parquet chargés depuis GCS (gs://homepedia-datalake/bronze/dvf/)
--
-- Rôle du bronze : ingérer les données telles quelles, SANS transformation.
-- Colonnes disponibles = celles gardées lors de l'ingestion Python (COLONNES_UTILES).
-- ══════════════════════════════════════════════════════════════════════════════

SELECT
    id_mutation,
    date_mutation,
    nature_mutation,
    valeur_fonciere,
    code_commune,
    nom_commune,
    code_departement,
    code_postal,
    type_local,
    surface_reelle_bati,
    nombre_pieces_principales,
    surface_terrain,
    longitude,
    latitude,
    annee,
    -- Métadonnées d'ingestion
    CURRENT_TIMESTAMP() AS _ingested_at,
    'dvf_parquet_gcs' AS _source

FROM {{ source('bronze_raw', 'dvf_transactions') }}
