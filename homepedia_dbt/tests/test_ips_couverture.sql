-- Test qualité : couverture IPS — au moins 60% des communes IDF doivent avoir des données IPS
-- L'IPS couvre ~1 010 communes IDF. Si < 60% ont ips_moyen renseigné → problème d'ingestion
-- Severity WARN (pas ERROR) car enrichissement externe, pas produit par DBT

SELECT
    COUNT(*)                                                    AS total_communes,
    COUNTIF(ips_moyen IS NOT NULL)                             AS communes_avec_ips,
    ROUND(100.0 * COUNTIF(ips_moyen IS NOT NULL) / COUNT(*), 1) AS pct_couverture_ips,
    'WARN : couverture IPS < 60%, vérifier ingestion/ips/download_gcs.py' AS message
FROM {{ ref('gold_communes_agregat') }}
HAVING ROUND(100.0 * COUNTIF(ips_moyen IS NOT NULL) / COUNT(*), 1) < 60
