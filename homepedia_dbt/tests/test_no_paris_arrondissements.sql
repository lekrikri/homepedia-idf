-- Test qualité : vérifier que Paris est consolidé en 75056
-- Les arrondissements (75101-75120) ne doivent PAS apparaître dans la gold
-- (ils sont normalisés en 75056 au niveau silver)
--
-- Ce test ÉCHOUE si des arrondissements traînent dans la gold → alerte immédiate

SELECT code_commune
FROM {{ ref('gold_communes_agregat') }}
WHERE
    code_commune LIKE '751%'
    AND code_commune != '75056'
