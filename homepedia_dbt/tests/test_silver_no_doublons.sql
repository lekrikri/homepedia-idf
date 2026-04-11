-- Test qualité : vérifier qu'il n'y a pas de doublons dans silver_transactions
-- Un doublon = même transaction_id apparaissant 2+ fois
-- Cause possible : bug dans le merge incremental ou dans la déduplication bronze
--
-- Ce test ÉCHOUE s'il retourne des lignes → le pipeline s'arrête + email alerting

SELECT
    transaction_id,
    COUNT(*) AS nb_occurrences
FROM {{ ref('silver_transactions') }}
GROUP BY transaction_id
HAVING COUNT(*) > 1
