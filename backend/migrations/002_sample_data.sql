-- ═══════════════════════════════════════════════════════════════════════════════
-- HomePedia IDF — Données de démonstration (15 communes réelles IDF)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Communes (référentiel) ─────────────────────────────────────────────────
INSERT INTO communes (code_insee, code_postal, nom, departement, region, population) VALUES
('75056', '75001', 'Paris',                      '75', 'Île-de-France', 2161000),
('92012', '92100', 'Boulogne-Billancourt',        '92', 'Île-de-France',  120000),
('92051', '92300', 'Levallois-Perret',            '92', 'Île-de-France',   67000),
('92026', '92110', 'Clichy',                      '92', 'Île-de-France',   62000),
('92048', '92130', 'Issy-les-Moulineaux',         '92', 'Île-de-France',   69000),
('92040', '92250', 'La Garenne-Colombes',         '92', 'Île-de-France',   30000),
('92002', '92600', 'Asnières-sur-Seine',          '92', 'Île-de-France',   88000),
('93066', '93200', 'Saint-Denis',                 '93', 'Île-de-France',  113000),
('93008', '93300', 'Aubervilliers',               '93', 'Île-de-France',   84000),
('94028', '94000', 'Créteil',                     '94', 'Île-de-France',   92000),
('94037', '94200', 'Ivry-sur-Seine',              '94', 'Île-de-France',   62000),
('78646', '78000', 'Versailles',                  '78', 'Île-de-France',   86000),
('91228', '91000', 'Évry-Courcouronnes',          '91', 'Île-de-France',   64000),
('77288', '77100', 'Meaux',                       '77', 'Île-de-France',   55000),
('95500', '95000', 'Cergy',                       '95', 'Île-de-France',   67000)
ON CONFLICT (code_insee) DO NOTHING;

-- ── 2. communes_agregat (Gold — métriques complètes) ──────────────────────────
INSERT INTO communes_agregat (
    code_commune, city, code_departement,
    centroid_lon, centroid_lat, surface_km2,
    population_totale, population_municipale, densite_pop_km2,
    prix_median_m2, prix_moyen_m2, nb_transactions, surface_moyenne, prix_median_transaction,
    score_dpe_moyen, conso_energie_moyenne, emission_ges_moyenne, nb_dpe, pct_dpe_bon,
    nb_poi_total, nb_transport, nb_education, nb_sante, nb_commerce, nb_restauration, nb_parcs, nb_services, nb_bio_bobo,
    conso_elec_par_logement, conso_gaz_par_logement,
    ips_moyen, pct_ecoles_favorisees, nb_ecoles,
    score_qualite_vie, score_investissement, score_stabilite,
    taux_cambriolages, taux_vols_violence, score_securite
) VALUES
-- Paris 75
('75056','Paris','75', 2.3488,48.8566,105.4,
 2161000,2161000,20533,
 10250,10890,18420,52.3,540000,
 3.2,185.0,38.0,148000,0.182,
 12400,1820,980,640,3200,2100,420,1240,380,
 4.1,8.2,
 108.5,68.2,1240,
 8.1,7.2,7.8,
 3.8,28.4,58.0),

-- Boulogne-Billancourt 92
('92012','Boulogne-Billancourt','92', 2.2408,48.8359,6.2,
 120000,120000,19355,
 8650,9120,4820,58.7,490000,
 3.4,192.0,40.0,38400,0.161,
 3800,420,280,180,940,680,120,380,92,
 4.3,9.1,
 118.2,72.4,124,
 7.9,7.8,7.5,
 2.9,18.2,65.0),

-- Levallois-Perret 92
('92051','Levallois-Perret','92', 2.2874,48.8936,2.4,
 67000,67000,27917,
 9100,9640,2940,54.1,498000,
 3.3,188.0,39.0,22000,0.174,
 2800,380,210,140,760,520,68,290,74,
 4.2,8.9,
 114.8,70.1,84,
 8.0,7.9,7.6,
 3.1,19.8,63.0),

-- Clichy 92
('92026','Clichy','92', 2.3014,48.9040,4.8,
 62000,62000,12917,
 6400,6820,2180,52.8,340000,
 3.8,210.0,44.0,18200,0.138,
 2100,290,165,98,580,390,58,210,38,
 4.8,10.2,
 98.4,52.1,88,
 6.8,8.4,6.2,
 4.2,24.8,52.0),

-- Issy-les-Moulineaux 92
('92048','Issy-les-Moulineaux','92', 2.2700,48.8200,7.1,
 69000,69000,9718,
 8200,8740,2640,60.2,488000,
 3.5,195.0,41.0,24800,0.158,
 2900,340,198,142,720,510,88,268,62,
 4.3,9.4,
 110.2,64.8,96,
 7.8,7.6,7.4,
 2.8,17.4,66.0),

-- La Garenne-Colombes 92
('92040','La Garenne-Colombes','92', 2.2414,48.9064,3.8,
 30000,30000,7895,
 8100,8580,1120,64.8,524000,
 3.2,182.0,37.0,9800,0.188,
 980,128,82,54,248,162,32,96,22,
 4.0,8.6,
 116.4,73.2,38,
 8.2,8.1,7.9,
 2.4,14.8,70.0),

-- Asnières-sur-Seine 92
('92002','Asnières-sur-Seine','92', 2.2830,48.9145,5.0,
 88000,88000,17600,
 6900,7320,3280,56.4,380000,
 3.7,205.0,43.0,29400,0.142,
 2600,320,190,124,640,440,72,240,44,
 4.6,9.8,
 102.8,58.4,102,
 7.2,7.8,6.8,
 3.6,21.2,57.0),

-- Saint-Denis 93
('93066','Saint-Denis','93', 2.3575,48.9363,12.4,
 113000,113000,9113,
 3520,3810,3240,48.2,174000,
 4.2,228.0,48.0,24800,0.108,
 2800,380,248,142,620,420,84,238,28,
 5.4,12.4,
 78.4,38.2,180,
 5.4,9.2,5.0,
 8.2,42.8,36.0),

-- Aubervilliers 93
('93008','Aubervilliers','93', 2.3831,48.9151,5.9,
 84000,84000,14237,
 3180,3420,1980,44.8,148000,
 4.4,234.0,50.0,16800,0.098,
 1940,248,182,98,420,284,54,168,14,
 5.8,13.2,
 74.2,34.8,142,
 4.8,9.4,4.6,
 9.4,48.2,32.0),

-- Créteil 94
('94028','Créteil','94', 2.4563,48.7902,11.8,
 92000,92000,7797,
 4200,4480,2840,58.4,244000,
 3.9,214.0,45.0,28400,0.128,
 2400,314,218,148,560,380,96,214,32,
 4.9,11.2,
 92.4,48.2,128,
 6.2,7.8,5.8,
 5.8,31.4,48.0),

-- Ivry-sur-Seine 94
('94037','Ivry-sur-Seine','94', 2.3875,48.8125,6.1,
 62000,62000,10164,
 5500,5840,2120,52.4,286000,
 3.8,210.0,44.0,18200,0.138,
 1980,264,172,98,480,318,68,188,38,
 4.7,10.8,
 95.8,50.4,96,
 6.4,8.2,6.0,
 5.2,28.8,50.0),

-- Versailles 78
('78646','Versailles','78', 2.1297,48.8014,26.2,
 86000,86000,3282,
 6500,6840,3420,72.8,472000,
 3.1,178.0,36.0,28400,0.198,
 2800,348,242,162,680,468,124,258,56,
 3.8,8.2,
 124.8,78.4,188,
 8.4,6.8,8.2,
 2.2,13.4,72.0),

-- Évry-Courcouronnes 91
('91228','Évry-Courcouronnes','91', 2.4452,48.6278,14.2,
 64000,64000,4507,
 2800,3020,1840,56.8,158000,
 4.1,220.0,46.0,16800,0.118,
 1840,238,198,118,380,248,82,174,18,
 5.2,12.0,
 82.4,40.8,124,
 5.6,7.8,5.4,
 6.8,36.8,42.0),

-- Meaux 77
('77288','Meaux','77', 2.8778,48.9600,14.8,
 55000,55000,3716,
 2200,2380,1240,64.2,140000,
 4.0,218.0,46.0,12800,0.122,
 1480,188,162,92,320,214,68,142,14,
 5.0,11.4,
 86.2,42.4,102,
 5.8,7.6,5.6,
 5.4,30.2,46.0),

-- Cergy 95
('95500','Cergy','95', 2.0637,49.0402,16.4,
 67000,67000,4085,
 2900,3120,1560,58.6,168000,
 4.0,216.0,45.0,18400,0.124,
 1980,258,198,112,420,278,88,184,18,
 5.0,11.6,
 84.8,41.6,114,
 5.8,7.8,5.6,
 5.6,30.8,46.0)

ON CONFLICT (code_commune) DO UPDATE SET
    prix_median_m2 = EXCLUDED.prix_median_m2,
    score_investissement = EXCLUDED.score_investissement,
    updated_at = NOW();

-- ── 3. Transactions (échantillon réaliste DVF 2022-2024) ──────────────────────
INSERT INTO transactions (date_mutation, nature_mutation, valeur_fonciere, adresse, code_postal, commune, code_commune, type_local, surface_reelle_bati, nombre_pieces, longitude, latitude, classe_energie, source_annee) VALUES

-- Paris
('2024-03-15','Vente',485000,'12 rue de Rivoli','75001','Paris','75056','Appartement',48.0,2,2.3512,48.8566,'D',2024),
('2024-02-08','Vente',920000,'45 av des Champs-Élysées','75008','Paris','75056','Appartement',82.0,3,2.3078,48.8698,'C',2024),
('2023-11-22','Vente',1250000,'8 rue du Faubourg Saint-Honoré','75008','Paris','75056','Appartement',108.0,4,2.3144,48.8698,'B',2023),
('2023-09-14','Vente',320000,'34 rue de Belleville','75020','Paris','75056','Appartement',32.0,1,2.3847,48.8696,'E',2023),
('2024-01-28','Vente',680000,'22 bd du Montparnasse','75015','Paris','75056','Appartement',64.0,3,2.3185,48.8416,'C',2024),
('2023-07-11','Vente',540000,'18 rue Oberkampf','75011','Paris','75056','Appartement',52.0,2,2.3673,48.8651,'D',2023),
('2024-04-02','Vente',1680000,'5 rue de Passy','75016','Paris','75056','Appartement',148.0,5,2.2778,48.8568,'B',2024),
('2023-12-19','Vente',290000,'67 rue de la Roquette','75011','Paris','75056','Appartement',28.5,1,2.3750,48.8534,'F',2023),

-- Boulogne-Billancourt
('2024-03-20','Vente',545000,'14 av du Général Leclerc','92100','Boulogne-Billancourt','92012','Appartement',62.0,3,2.2380,48.8348,'C',2024),
('2023-10-08','Vente',820000,'3 rue de Silly','92100','Boulogne-Billancourt','92012','Appartement',92.0,4,2.2438,48.8438,'B',2023),
('2024-01-15','Vente',398000,'28 bd Jean Jaurès','92100','Boulogne-Billancourt','92012','Appartement',44.0,2,2.2498,48.8344,'D',2024),
('2023-08-24','Vente',1120000,'7 rue Thiers','92100','Boulogne-Billancourt','92012','Maison',134.0,5,2.2342,48.8368,'B',2023),

-- Levallois-Perret
('2024-02-14','Vente',492000,'22 rue Victor Hugo','92300','Levallois-Perret','92051','Appartement',54.0,2,2.2897,48.8951,'C',2024),
('2023-11-05','Vente',745000,'8 rue Anatole France','92300','Levallois-Perret','92051','Appartement',82.0,3,2.2872,48.8920,'B',2023),
('2024-04-18','Vente',318000,'45 rue de Villiers','92300','Levallois-Perret','92051','Appartement',34.0,1,2.2944,48.8948,'D',2024),

-- Saint-Denis
('2024-01-22','Vente',168000,'34 rue du Dr Schweitzer','93200','Saint-Denis','93066','Appartement',48.0,2,2.3542,48.9318,'E',2024),
('2023-09-12','Vente',245000,'12 av du Président Wilson','93200','Saint-Denis','93066','Appartement',68.0,3,2.3598,48.9374,'D',2023),
('2024-03-08','Vente',142000,'67 bd de la Libération','93200','Saint-Denis','93066','Appartement',40.0,2,2.3621,48.9394,'F',2024),
('2023-12-14','Vente',320000,'5 rue Gabriel Péri','93200','Saint-Denis','93066','Appartement',88.0,4,2.3562,48.9348,'D',2023),

-- Versailles
('2024-02-28','Vente',488000,'14 rue de la Paroisse','78000','Versailles','78646','Appartement',72.0,3,2.1312,48.8040,'C',2024),
('2023-10-19','Vente',780000,'3 av de Paris','78000','Versailles','78646','Maison',124.0,5,2.1282,48.8054,'B',2023),
('2024-01-08','Vente',345000,'28 rue Carnot','78000','Versailles','78646','Appartement',52.0,2,2.1348,48.8018,'C',2024),

-- Clichy
('2024-03-12','Vente',310000,'18 bd Victor Hugo','92110','Clichy','92026','Appartement',48.0,2,2.3042,48.9044,'D',2024),
('2023-11-28','Vente',445000,'7 rue Martre','92110','Clichy','92026','Appartement',68.0,3,2.2984,48.9018,'C',2023),
('2024-04-05','Vente',198000,'52 av de la République','92110','Clichy','92026','Appartement',32.0,1,2.3012,48.9068,'E',2024),

-- Créteil
('2024-02-20','Vente',218000,'14 av de Verdun','94000','Créteil','94028','Appartement',52.0,2,2.4548,48.7918,'D',2024),
('2023-10-14','Vente',312000,'8 rue Pasteur','94000','Créteil','94028','Appartement',74.0,3,2.4582,48.7948,'C',2023),
('2024-01-25','Vente',168000,'34 bd du 8 Mai 1945','94000','Créteil','94028','Appartement',40.0,2,2.4512,48.7894,'E',2024),

-- Issy-les-Moulineaux
('2024-03-18','Vente',492000,'22 rue du Gouverneur Général Eboué','92130','Issy-les-Moulineaux','92048','Appartement',60.0,2,2.2728,48.8228,'C',2024),
('2023-09-22','Vente',734000,'5 av de la République','92130','Issy-les-Moulineaux','92048','Appartement',86.0,4,2.2698,48.8198,'B',2023),

-- Asnières-sur-Seine
('2024-02-10','Vente',345000,'18 bd Voltaire','92600','Asnières-sur-Seine','92002','Appartement',50.0,2,2.2848,48.9168,'D',2024),
('2023-11-18','Vente',512000,'3 rue des Bourguignons','92600','Asnières-sur-Seine','92002','Appartement',72.0,3,2.2814,48.9144,'C',2023),
('2024-04-12','Vente',228000,'45 av d''Argenteuil','92600','Asnières-sur-Seine','92002','Appartement',34.0,1,2.2868,48.9184,'E',2024),

-- Ivry-sur-Seine
('2024-01-18','Vente',275000,'12 av Georges Gosnat','94200','Ivry-sur-Seine','94037','Appartement',50.0,2,2.3894,48.8118,'D',2024),
('2023-10-05','Vente',418000','8 rue Marat','94200','Ivry-sur-Seine','94037','Appartement',72.0,3,2.3874,48.8148,'C',2023),

-- Aubervilliers
('2024-03-05','Vente',158000','34 rue Edouard Vaillant','93300','Aubervilliers','93008','Appartement',50.0,2,2.3818,48.9148,'E',2024),
('2023-12-08','Vente',224000','7 av de la République','93300','Aubervilliers','93008','Appartement',68.0,3,2.3848,48.9168,'D',2023),

-- Meaux
('2024-02-22','Vente',148000','22 rue Saint-Nicolas','77100','Meaux','77288','Appartement',68.0,3,2.8812,48.9618,'D',2024),
('2023-09-18','Vente',198000','5 bd Jean Rose','77100','Meaux','77288','Maison',92.0,4,2.8748,48.9584,'C',2023),

-- La Garenne-Colombes
('2024-03-28','Vente',515000','18 rue de la République','92250','La Garenne-Colombes','92040','Appartement',62.0,3,2.2428,48.9074,'C',2024),
('2023-11-12','Vente',724000','3 av de Verdun','92250','La Garenne-Colombes','92040','Maison',108.0,5,2.2398,48.9048,'B',2023),

-- Cergy
('2024-01-30','Vente',168000','14 bd de l''Oise','95000','Cergy','95500','Appartement',58.0,3,2.0648,49.0418,'D',2024),
('2023-10-24','Vente',228000','8 rue des Cannes','95000','Cergy','95500','Appartement',78.0,4,2.0618,49.0388,'C',2023),

-- Évry
('2024-02-15','Vente',138000','22 av du Général de Gaulle','91000','Évry-Courcouronnes','91228','Appartement',50.0,2,2.4468,48.6298,'E',2024),
('2023-09-28','Vente',194000','7 cours Blaise Pascal','91000','Évry-Courcouronnes','91228','Appartement',70.0,3,2.4428,48.6268,'D',2023);

-- ── 4. Pipeline run (démo de l'historique) ───────────────────────────────────
INSERT INTO pipeline_runs (
    job_name, execution_id, started_at, finished_at,
    annee, status, duration_s,
    nb_communes_exported, nb_transactions_exported,
    steps_duration
) VALUES
(
    'homepedia-pipeline',
    'run-demo-2024-001',
    NOW() - INTERVAL '2 days',
    NOW() - INTERVAL '2 days' + INTERVAL '8 minutes 24 seconds',
    2024,
    'success',
    504,
    15,
    48,
    '{"gold": 42, "transactions": 320, "enrichments": 98, "scores": 44}'::jsonb
),
(
    'homepedia-pipeline',
    'run-demo-2023-001',
    NOW() - INTERVAL '30 days',
    NOW() - INTERVAL '30 days' + INTERVAL '11 minutes 12 seconds',
    2023,
    'success',
    672,
    12,
    38,
    '{"gold": 58, "transactions": 412, "enrichments": 124, "scores": 78}'::jsonb
);

-- ── Vérification finale ───────────────────────────────────────────────────────
SELECT
    (SELECT COUNT(*) FROM communes)          AS nb_communes,
    (SELECT COUNT(*) FROM transactions)      AS nb_transactions,
    (SELECT COUNT(*) FROM communes_agregat)  AS nb_agregat,
    (SELECT COUNT(*) FROM users)             AS nb_users,
    (SELECT COUNT(*) FROM pipeline_runs)     AS nb_runs;
