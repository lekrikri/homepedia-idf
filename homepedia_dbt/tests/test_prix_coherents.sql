-- Test qualité : vérifier que les prix médians sont dans une fourchette réaliste
-- Prix médian IDF attendu : entre 1 000 €/m² (zones rurales) et 20 000 €/m² (Paris centre)
-- Un prix hors fourchette signale une anomalie dans les données source DVF
--
-- Ce test ÉCHOUE si des communes ont des prix aberrants

SELECT
    code_commune,
    prix_median_m2,
    CASE
        WHEN prix_median_m2 < 1000 THEN 'TROP_BAS (< 1000 €/m²)'
        WHEN prix_median_m2 > 20000 THEN 'TROP_HAUT (> 20000 €/m²)'
    END AS anomalie
FROM {{ ref('gold_communes_agregat') }}
WHERE
    prix_median_m2 < 1000
    OR prix_median_m2 > 20000
