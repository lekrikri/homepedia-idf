-- ══════════════════════════════════════════════════════════════════════════════
-- BRONZE : diagnostics de performance énergétique (DPE) bruts
-- Source : fichiers Parquet ADEME depuis GCS (gs://homepedia-datalake/bronze/dpe/)
-- Colonnes = celles générées par ingestion/ademe_dpe/download_gcs.py
-- ══════════════════════════════════════════════════════════════════════════════

SELECT
    id_dpe,
    date_dpe,
    code_commune,
    nom_commune,
    code_postal,
    code_departement,
    etiquette_dpe,
    etiquette_ges,
    conso_energie_kwh_m2,
    emission_ges_kg_m2,
    surface_m2,
    type_batiment,
    periode_construction,
    longitude,
    latitude,
    score_dpe,
    est_bon_dpe,
    annee_dpe,
    CURRENT_TIMESTAMP() AS _ingested_at

FROM {{ source('bronze_raw', 'dpe_ademe') }}
