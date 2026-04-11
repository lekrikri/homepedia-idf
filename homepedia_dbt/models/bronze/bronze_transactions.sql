-- ══════════════════════════════════════════════════════════════════════════════
-- BRONZE : transactions DVF brutes
-- Source : fichiers Parquet chargés depuis GCS (gs://homepedia-datalake/bronze/dvf/)
--
-- Rôle du bronze : ingérer les données telles quelles, SANS transformation.
-- On garde tous les champs, même les NULL, même les doublons.
-- Le nettoyage se fait au niveau silver.
-- ══════════════════════════════════════════════════════════════════════════════

SELECT
    id_mutation,
    date_mutation,
    nature_mutation,
    valeur_fonciere,
    adresse_numero,
    adresse_suffixe,
    adresse_nom_voie,
    adresse_code_voie,
    code_postal,
    code_commune,
    nom_commune,
    code_departement,
    ancien_code_commune,
    ancien_nom_commune,
    id_parcelle,
    ancien_id_parcelle,
    numero_volume,
    lot1_numero,
    lot1_surface_carrez,
    lot2_numero,
    lot2_surface_carrez,
    lot3_numero,
    lot3_surface_carrez,
    nombre_lots,
    code_type_local,
    type_local,
    surface_reelle_bati,
    nombre_pieces_principales,
    code_nature_culture,
    nature_culture,
    code_nature_culture_speciale,
    nature_culture_speciale,
    surface_terrain,
    longitude,
    latitude,
    -- Métadonnées d'ingestion
    CURRENT_TIMESTAMP() AS _ingested_at,
    '{{ var("source_file", "dvf_parquet") }}' AS _source

FROM {{ source('bronze_raw', 'dvf_transactions') }}
