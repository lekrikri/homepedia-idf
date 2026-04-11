-- Test qualité : vérifier que la gold contient au moins 900 communes
-- Si moins de 900 communes → problème dans le pipeline (données manquantes, filtre trop agressif)
-- L'IDF compte ~1300 communes, on attend au minimum 900 après filtrage (nb_transactions >= 5)
--
-- Ce test ÉCHOUE si la gold est trop petite → alerte email → investigation manuelle

SELECT
    COUNT(*) AS nb_communes,
    'ERREUR : gold trop petite, attendu >= 900' AS message
FROM {{ ref('gold_communes_agregat') }}
HAVING COUNT(*) < 900
