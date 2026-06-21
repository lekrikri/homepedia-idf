-- Peuplement scores sécurité SSMSI 2022 par département IDF
-- Source : ONDRP / SSMSI 2022
-- À exécuter dans Supabase SQL Editor

ALTER TABLE communes_agregat
  ADD COLUMN IF NOT EXISTS taux_cambriolages  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS taux_vols_violence DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS score_securite     DOUBLE PRECISION;

-- Mapping département → communes
UPDATE communes_agregat SET
  taux_cambriolages  = 8.2,
  taux_vols_violence = 7.1,
  score_securite     = 55.0
WHERE TRIM(code_departement) = '75';

UPDATE communes_agregat SET
  taux_cambriolages  = 5.8,
  taux_vols_violence = 4.2,
  score_securite     = 69.0
WHERE TRIM(code_departement) = '77';

UPDATE communes_agregat SET
  taux_cambriolages  = 4.7,
  taux_vols_violence = 3.9,
  score_securite     = 74.0
WHERE TRIM(code_departement) = '78';

UPDATE communes_agregat SET
  taux_cambriolages  = 5.1,
  taux_vols_violence = 4.5,
  score_securite     = 71.0
WHERE TRIM(code_departement) = '91';

UPDATE communes_agregat SET
  taux_cambriolages  = 5.4,
  taux_vols_violence = 4.8,
  score_securite     = 70.0
WHERE TRIM(code_departement) = '92';

UPDATE communes_agregat SET
  taux_cambriolages  = 9.3,
  taux_vols_violence = 10.2,
  score_securite     = 43.0
WHERE TRIM(code_departement) = '93';

UPDATE communes_agregat SET
  taux_cambriolages  = 6.3,
  taux_vols_violence = 5.6,
  score_securite     = 65.0
WHERE TRIM(code_departement) = '94';

UPDATE communes_agregat SET
  taux_cambriolages  = 6.8,
  taux_vols_violence = 5.9,
  score_securite     = 62.0
WHERE TRIM(code_departement) = '95';

-- Vérification
SELECT TRIM(code_departement) dept,
       COUNT(*) nb_communes,
       AVG(score_securite) score_moyen,
       AVG(taux_cambriolages) cambrio
FROM communes_agregat
WHERE score_securite IS NOT NULL
GROUP BY dept ORDER BY dept;
