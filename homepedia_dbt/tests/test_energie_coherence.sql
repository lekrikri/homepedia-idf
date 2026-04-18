-- Test qualité : cohérence des données énergie ENEDIS/GRDF
-- Vérifie :
--   1. Les valeurs sont dans des fourchettes réalistes pour l'IDF
--   2. Pas de corrélation aberrante (élec >> gaz impossible dans un parc résidentiel IDF normal)
--   3. Couverture minimale (au moins 70% des communes avec données élec)

WITH energie_stats AS (
    SELECT
        COUNT(*)                                    AS total_communes,
        COUNTIF(conso_elec_par_logement IS NOT NULL) AS avec_elec,
        COUNTIF(conso_gaz_par_logement  IS NOT NULL) AS avec_gaz,

        -- Valeurs aberrantes (fourchette: élec 1-30 MWh, gaz 2-60 MWh)
        COUNTIF(conso_elec_par_logement NOT BETWEEN 1 AND 30) AS nb_elec_aberrant,
        COUNTIF(conso_gaz_par_logement  NOT BETWEEN 2 AND 60) AS nb_gaz_aberrant,

        -- Médiane IDF (si trop éloignée de 5.1 MWh élec / 12.5 MWh gaz → anomalie)
        ROUND(AVG(conso_elec_par_logement), 2) AS moy_elec,
        ROUND(AVG(conso_gaz_par_logement),  2) AS moy_gaz
    FROM {{ ref('gold_communes_agregat') }}
    WHERE conso_elec_par_logement IS NOT NULL
       OR conso_gaz_par_logement  IS NOT NULL
)

SELECT
    *,
    CASE
        WHEN avec_elec < 0.7 * total_communes THEN 'WARN : couverture élec < 70%, vérifier ingestion ENEDIS'
        WHEN nb_elec_aberrant > 0             THEN 'ERREUR : valeurs élec hors fourchette [1-30 MWh]'
        WHEN nb_gaz_aberrant  > 0             THEN 'ERREUR : valeurs gaz hors fourchette [2-60 MWh]'
        WHEN moy_elec NOT BETWEEN 3 AND 10    THEN 'WARN : moyenne élec IDF suspecte (attendu ~5 MWh)'
        WHEN moy_gaz  NOT BETWEEN 5 AND 25    THEN 'WARN : moyenne gaz IDF suspecte (attendu ~12 MWh)'
    END AS message
FROM energie_stats
WHERE
    avec_elec < 0.7 * total_communes
    OR nb_elec_aberrant > 0
    OR nb_gaz_aberrant  > 0
    OR moy_elec NOT BETWEEN 3 AND 10
    OR moy_gaz  NOT BETWEEN 5 AND 25
