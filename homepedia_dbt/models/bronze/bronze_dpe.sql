-- ══════════════════════════════════════════════════════════════════════════════
-- BRONZE : diagnostics de performance énergétique (DPE) bruts
-- Source : fichiers Parquet ADEME depuis GCS (gs://homepedia-datalake/bronze/dpe/)
-- ══════════════════════════════════════════════════════════════════════════════

SELECT
    numero_dpe,
    date_etablissement_dpe,
    date_visite_diagnostiqueur,
    version_dpe,
    methode_dpe,
    code_postal_ban,
    numero_rue_ban,
    nom_rue_ban,
    code_insee_ban,
    classe_energie,
    etiquette_ges,
    conso_energie,
    emission_ges,
    surface_habitable_logement,
    annee_construction,
    type_batiment,
    code_departement,
    CURRENT_TIMESTAMP() AS _ingested_at

FROM {{ source('bronze_raw', 'dpe_ademe') }}
