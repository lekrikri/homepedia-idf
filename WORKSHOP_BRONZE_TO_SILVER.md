# Workshop Bronze → Silver — Extraction & Schémas Databricks
> **Participants :** à deux (Ludo + toi) — Chaque personne extrait ses sources assignées
> **Objectif :** Passer les données brutes (Raw) en Bronze nettoyé, puis en Silver joignable
> **Date :** Mars 2026

---

## Architecture cible

```
Raw   (données brutes telles que téléchargées — immuables, partitionnées par source/date)
    ↓  lecture seule, aucune modification
Bronze (données structurées, typées, sans nettoyage métier — partitionné par source/année)
    ↓  nettoyage, filtres, déduplication, calculs dérivés
Silver (tables nettoyées, joignables par code_commune — prêtes pour Gold)
    ↓  agrégations par commune/IRIS
Gold   (métriques finales servies par l'API Go)
```

**Chemins ADLS :** `abfss://<layer>@homepediadatalake.dfs.core.windows.net/<source>/`
- Raw    → `abfss://raw@homepediadatalake.dfs.core.windows.net/`
- Bronze → `abfss://bronze@homepediadatalake.dfs.core.windows.net/`
- Silver → `abfss://silver@homepediadatalake.dfs.core.windows.net/`
- Gold   → `abfss://gold@homepediadatalake.dfs.core.windows.net/`

**Clé de jointure commune :** `code_commune` (INSEE 5 chiffres, ex: `75056` = Paris)

---

## Source 1 — DVF (Demande de Valeur Foncière)

**Responsable :** _(à assigner)_
**Fréquence :** Annuelle (millésimes 2019–2024)
**Format Bronze :** CSV, ~5M lignes/an pour toute la France
**Filtre IDF :** `code_departement IN ('75','77','78','91','92','93','94','95')`

### Colonnes Bronze (fichier DVF brut)

| Colonne brute | Type brut | Description |
|---|---|---|
| `id_mutation` | string | Identifiant unique de la mutation |
| `date_mutation` | string (DD/MM/YYYY) | Date de la transaction |
| `nature_mutation` | string | `Vente`, `Vente en l'état futur d'achèvement`, `Echange`... |
| `valeur_fonciere` | string (virgule décimale) | Prix de vente (€) |
| `adresse_numero` | string | Numéro de voie |
| `adresse_suffixe` | string | B, T, bis... |
| `adresse_nom_voie` | string | Nom de la voie |
| `adresse_code_voie` | string | Code FANTOIR |
| `code_postal` | string | Code postal (5 chiffres) |
| `adresse_commune` | string | Nom de la commune |
| `code_departement` | string | 2-3 chiffres |
| `code_commune` | string | Code INSEE 5 chiffres (**clé de jointure**) |
| `code_insee` | string | Alias `code_commune` selon millésime |
| `section` | string | Section cadastrale |
| `numero_plan` | string | Numéro de plan cadastral |
| `nature_culture` | string | `S` (sols), `T` (terres), `P` (prés)... |
| `surface_reelle_bati` | string | Surface bâtie (m²) |
| `nombre_pieces_principales` | string | Nb pièces principales |
| `code_type_local` | string | `1`=Maison, `2`=Appt, `3`=Dépendance, `4`=Local industriel |
| `type_local` | string | Libellé du type de bien |
| `surface_terrain` | string | Surface du terrain (m²) |
| `longitude` | string | Longitude WGS84 |
| `latitude` | string | Latitude WGS84 |

### Table Silver cible : `silver_dvf_transactions`

```sql
CREATE TABLE silver_dvf_transactions (
    id_mutation         STRING        NOT NULL,
    date_mutation       DATE          NOT NULL,
    annee               INT           NOT NULL,          -- YEAR(date_mutation)
    mois                INT           NOT NULL,          -- MONTH(date_mutation)
    nature_mutation     STRING        NOT NULL,
    prix_total          DOUBLE        NOT NULL,          -- valeur_fonciere nettoyée
    code_commune        STRING        NOT NULL,          -- clé de jointure
    nom_commune         STRING,
    code_departement    STRING        NOT NULL,
    type_local          STRING,                          -- Maison / Appartement / ...
    surface_bati        DOUBLE,                          -- m²
    surface_terrain     DOUBLE,                          -- m²
    nb_pieces           INT,
    prix_m2             DOUBLE,                          -- prix_total / surface_bati
    longitude           DOUBLE,
    latitude            DOUBLE,
    source_annee        INT           NOT NULL           -- millésime DVF
)
USING DELTA
PARTITIONED BY (annee, code_departement);
```

### Transformations Bronze → Silver

```python
from pyspark.sql import functions as F

BRONZE = "abfss://bronze@homepediadatalake.dfs.core.windows.net"
SILVER = "abfss://silver@homepediadatalake.dfs.core.windows.net"

df = spark.read.csv(f"{BRONZE}/dvf/*.csv", header=True, sep="|")

silver = (df
    # Filtre IDF
    .filter(F.col("code_departement").isin(["75","77","78","91","92","93","94","95"]))
    # Filtre ventes uniquement
    .filter(F.col("nature_mutation") == "Vente")
    # Nettoyage prix (virgule → point)
    .withColumn("prix_total", F.regexp_replace("valeur_fonciere", ",", ".").cast("double"))
    # Suppression des prix aberrants (< 1 000€ ou > 50M€)
    .filter(F.col("prix_total").between(1_000, 50_000_000))
    # Date
    .withColumn("date_mutation", F.to_date("date_mutation", "dd/MM/yyyy"))
    .withColumn("annee", F.year("date_mutation"))
    .withColumn("mois", F.month("date_mutation"))
    # Surfaces
    .withColumn("surface_bati", F.regexp_replace("surface_reelle_bati", ",", ".").cast("double"))
    .withColumn("surface_terrain", F.regexp_replace("surface_terrain", ",", ".").cast("double"))
    # Prix au m²
    .withColumn("prix_m2", F.when(F.col("surface_bati") > 0,
                                   F.col("prix_total") / F.col("surface_bati")))
    # Suppression prix/m² aberrants (< 500 ou > 50 000 €/m²)
    .filter(F.col("prix_m2").isNull() | F.col("prix_m2").between(500, 50_000))
    # Coordonnées
    .withColumn("longitude", F.col("longitude").cast("double"))
    .withColumn("latitude", F.col("latitude").cast("double"))
    # Déduplication
    .dropDuplicates(["id_mutation", "code_commune"])
    # Sélection finale
    .select("id_mutation","date_mutation","annee","mois","nature_mutation",
            "prix_total","code_commune","adresse_commune","code_departement",
            "type_local","surface_bati","surface_terrain","nombre_pieces_principales",
            "prix_m2","longitude","latitude")
)

silver.write.format("delta").mode("overwrite").partitionBy("annee","code_departement") \
      .save(f"{SILVER}/dvf_transactions/")
```

---

## Source 2 — INSEE Populations (RP)

**Responsable :** _(à assigner)_
**Fréquence :** Recensement tous les 5 ans (2015, 2020)
**Format Bronze :** CSV
**Disponible dans ADLS :** `abfss://bronze@homepediadatalake.dfs.core.windows.net/insee/populations/`
**Source :** [https://www.insee.fr/fr/statistiques/7632565](https://www.insee.fr/fr/statistiques/7632565) — Fichier `BTX_TD_POP1A_2020.csv`

### Colonnes Bronze (fichier INSEE RP brut)

| Colonne brute | Description |
|---|---|
| `CODGEO` | Code commune INSEE 5 chiffres (**clé de jointure**) |
| `LIBGEO` | Libellé commune |
| `P20_POP` | Population totale 2020 |
| `P20_POP0014` | Population 0–14 ans |
| `P20_POP1529` | Population 15–29 ans |
| `P20_POP3044` | Population 30–44 ans |
| `P20_POP4559` | Population 45–59 ans |
| `P20_POP6074` | Population 60–74 ans |
| `P20_POP75P` | Population 75 ans et + |
| `P20_POPH` | Population hommes |
| `P20_POPF` | Population femmes |
| `P15_POP` | Population totale 2015 (pour calculer évolution) |
| `C20_POP15P_CS1` | Agriculteurs exploitants (CSP) |
| `C20_POP15P_CS2` | Artisans, commerçants |
| `C20_POP15P_CS3` | Cadres, professions intellectuelles |
| `C20_POP15P_CS4` | Professions intermédiaires |
| `C20_POP15P_CS5` | Employés |
| `C20_POP15P_CS6` | Ouvriers |

### Table Silver cible : `silver_insee_populations`

```sql
CREATE TABLE silver_insee_populations (
    code_commune        STRING    NOT NULL,    -- clé de jointure
    nom_commune         STRING,
    population_totale   LONG      NOT NULL,
    pop_0_14            LONG,
    pop_15_29           LONG,
    pop_30_44           LONG,
    pop_45_59           LONG,
    pop_60_74           LONG,
    pop_75_plus         LONG,
    pct_jeunes          DOUBLE,               -- pop_0_29 / total * 100
    pct_seniors         DOUBLE,               -- pop_60+ / total * 100
    pct_cadres          DOUBLE,               -- CS3 / actifs * 100
    evolution_pop_5ans  DOUBLE,               -- (P20 - P15) / P15 * 100
    annee_recensement   INT       NOT NULL     -- 2020
)
USING DELTA;
```

### Transformations Bronze → Silver

```python
BRONZE = "abfss://bronze@homepediadatalake.dfs.core.windows.net"
SILVER = "abfss://silver@homepediadatalake.dfs.core.windows.net"

df = spark.read.csv(f"{BRONZE}/insee/populations/*.csv", header=True, sep=";")

silver = (df
    .withColumnRenamed("CODGEO", "code_commune")
    .withColumnRenamed("LIBGEO", "nom_commune")
    .withColumn("population_totale", F.col("P20_POP").cast("long"))
    .withColumn("pop_0_14",  F.col("P20_POP0014").cast("long"))
    .withColumn("pop_15_29", F.col("P20_POP1529").cast("long"))
    .withColumn("pop_30_44", F.col("P20_POP3044").cast("long"))
    .withColumn("pop_45_59", F.col("P20_POP4559").cast("long"))
    .withColumn("pop_60_74", F.col("P20_POP6074").cast("long"))
    .withColumn("pop_75_plus", F.col("P20_POP75P").cast("long"))
    # Indicateurs dérivés
    .withColumn("pct_jeunes", (F.col("P20_POP0014") + F.col("P20_POP1529")).cast("double") /
                               F.col("P20_POP").cast("double") * 100)
    .withColumn("pct_seniors", (F.col("P20_POP6074") + F.col("P20_POP75P")).cast("double") /
                                F.col("P20_POP").cast("double") * 100)
    .withColumn("pct_cadres", F.col("C20_POP15P_CS3").cast("double") /
                              (F.col("C20_POP15P_CS1").cast("double") +
                               F.col("C20_POP15P_CS3").cast("double") +
                               F.col("C20_POP15P_CS5").cast("double") +
                               F.col("C20_POP15P_CS6").cast("double") + 1) * 100)
    .withColumn("evolution_pop_5ans",
                (F.col("P20_POP").cast("double") - F.col("P15_POP").cast("double")) /
                 F.col("P15_POP").cast("double") * 100)
    .withColumn("annee_recensement", F.lit(2020))
    .filter(F.col("population_totale") > 0)
    .dropDuplicates(["code_commune"])
)

silver.write.format("delta").mode("overwrite").save(f"{SILVER}/insee_populations/")
```

---

## Source 3 — INSEE Revenus (Filosofi)

**Responsable :** _(à assigner)_
**Fréquence :** Annuelle avec 2 ans de retard (dernière dispo : 2021)

> ⚠️ **BLOQUANT — Données non encore dans ADLS Bronze**
> Le dossier `bronze/insee/revenus/` n'existe pas encore dans `homepediadatalake`.
> Seul `bronze/insee/populations/` est présent.
>
> **Action avant le workshop :**
> 1. Télécharger Filosofi depuis [https://www.insee.fr/fr/statistiques/7233950](https://www.insee.fr/fr/statistiques/7233950)
> 2. Uploader via le script `ingestion/insee/download.py` ou manuellement dans Azure Storage Explorer
> 3. Chemin cible : `abfss://bronze@homepediadatalake.dfs.core.windows.net/insee/revenus/cc_filosofi_2021_COM.csv`

**Source :** [https://www.insee.fr/fr/statistiques/7233950](https://www.insee.fr/fr/statistiques/7233950) — Filosofi par commune

### Colonnes Bronze (fichier Filosofi brut)

| Colonne brute | Description |
|---|---|
| `CODGEO` | Code commune INSEE (**clé de jointure**) |
| `LIBGEO` | Libellé commune |
| `NBMENFISC21` | Nombre de ménages fiscaux 2021 |
| `NBPERSMENFISC21` | Nombre de personnes dans ménages fiscaux |
| `MED21` | Médiane du niveau de vie (€/an) |
| `Q121` | 1er quartile niveau de vie |
| `Q321` | 3ème quartile niveau de vie |
| `D121` | 1er décile |
| `D921` | 9ème décile |
| `PAUV21` | Taux de pauvreté (%) |
| `TP6021` | Part des niveaux de vie < 60% médiane nationale |
| `GINI21` | Coefficient de Gini (inégalités) |

### Table Silver cible : `silver_insee_revenus`

```sql
CREATE TABLE silver_insee_revenus (
    code_commune        STRING    NOT NULL,    -- clé de jointure
    nom_commune         STRING,
    nb_menages          LONG,
    revenu_median       DOUBLE    NOT NULL,    -- €/an
    revenu_q1           DOUBLE,               -- 1er quartile
    revenu_q3           DOUBLE,               -- 3ème quartile
    revenu_d1           DOUBLE,               -- 1er décile
    revenu_d9           DOUBLE,               -- 9ème décile
    taux_pauvrete       DOUBLE,               -- %
    gini                DOUBLE,               -- 0 à 1
    ratio_d9_d1         DOUBLE,               -- inégalité D9/D1
    annee               INT       NOT NULL    -- 2021
)
USING DELTA;
```

### Transformations Bronze → Silver

```python
BRONZE = "abfss://bronze@homepediadatalake.dfs.core.windows.net"
SILVER = "abfss://silver@homepediadatalake.dfs.core.windows.net"

# ⚠️ Ce chemin ne sera valide qu'après upload du fichier Filosofi
df = spark.read.csv(f"{BRONZE}/insee/revenus/cc_filosofi_2021_COM.csv", header=True, sep=";")

silver = (df
    .withColumnRenamed("CODGEO", "code_commune")
    .withColumnRenamed("LIBGEO", "nom_commune")
    .withColumn("nb_menages",    F.col("NBMENFISC21").cast("long"))
    .withColumn("revenu_median", F.col("MED21").cast("double"))
    .withColumn("revenu_q1",     F.col("Q121").cast("double"))
    .withColumn("revenu_q3",     F.col("Q321").cast("double"))
    .withColumn("revenu_d1",     F.col("D121").cast("double"))
    .withColumn("revenu_d9",     F.col("D921").cast("double"))
    .withColumn("taux_pauvrete", F.col("PAUV21").cast("double"))
    .withColumn("gini",          F.col("GINI21").cast("double"))
    # Ratio D9/D1 : mesure d'inégalité simple
    .withColumn("ratio_d9_d1",
                F.when(F.col("revenu_d1") > 0,
                       F.col("revenu_d9") / F.col("revenu_d1")))
    .withColumn("annee", F.lit(2021))
    # Suppression communes sans revenu médian (données secrétisées INSEE)
    .filter(F.col("revenu_median").isNotNull() & (F.col("revenu_median") > 0))
    .dropDuplicates(["code_commune"])
)

silver.write.format("delta").mode("overwrite").save(f"{SILVER}/insee_revenus/")
```

---

## Source 4 — ADEME DPE (Diagnostic de Performance Énergétique)

**Responsable :** _(à assigner)_
**Fréquence :** Continue (mis à jour mensuellement)
**Format Bronze :** CSV (1 fichier par type de bien)
**Source :** [https://data.ademe.fr/datasets/dpe-v2-logements-existants](https://data.ademe.fr/datasets/dpe-v2-logements-existants)
**Filtre IDF :** `code_insee_commune_actualise LIKE '75%' OR ... '95%'`

### Colonnes Bronze (fichier DPE brut)

| Colonne brute | Type | Description |
|---|---|---|
| `N°DPE` | string | Identifiant unique DPE |
| `date_etablissement_dpe` | string | Date du DPE |
| `code_insee_commune_actualise` | string | Code commune INSEE (**clé de jointure**) |
| `nom_commune_ban` | string | Nom commune |
| `etiquette_dpe` | string | `A`, `B`, `C`, `D`, `E`, `F`, `G` |
| `etiquette_ges` | string | `A` à `G` (GES) |
| `type_batiment` | string | `maison`, `appartement`, `immeuble` |
| `surface_habitable_logement` | string | Surface (m²) |
| `annee_construction` | string | Année de construction |
| `conso_5_usages_ep_m2` | string | Consommation énergie primaire (kWh/m²/an) |
| `emission_ges_5_usages_ep_m2` | string | Émissions GES (kgCO2/m²/an) |
| `type_energie_principale_chauffage` | string | `Gaz naturel`, `Électricité`, `Fioul`... |
| `periode_construction` | string | Tranche de construction |
| `numero_voie_ban` | string | Numéro voie |
| `nom_rue_ban` | string | Rue |
| `code_postal_ban` | string | Code postal |
| `latitude` | string | Latitude WGS84 |
| `longitude` | string | Longitude WGS84 |

### Table Silver cible : `silver_ademe_dpe`

```sql
CREATE TABLE silver_ademe_dpe (
    id_dpe              STRING    NOT NULL,
    code_commune        STRING    NOT NULL,    -- clé de jointure
    nom_commune         STRING,
    date_dpe            DATE,
    annee_dpe           INT,
    type_batiment       STRING,               -- maison / appartement
    etiquette_dpe       STRING,               -- A-G
    etiquette_ges       STRING,               -- A-G
    score_dpe_num       INT,                  -- A=1, B=2, ..., G=7
    surface_habitable   DOUBLE,               -- m²
    annee_construction  INT,
    conso_ep_m2         DOUBLE,               -- kWh EP/m²/an
    emission_ges_m2     DOUBLE,               -- kgCO2/m²/an
    energie_chauffage   STRING,               -- Gaz / Électricité / Fioul...
    latitude            DOUBLE,
    longitude           DOUBLE
)
USING DELTA
PARTITIONED BY (annee_dpe);
```

### Transformations Bronze → Silver

```python
BRONZE = "abfss://bronze@homepediadatalake.dfs.core.windows.net"
SILVER = "abfss://silver@homepediadatalake.dfs.core.windows.net"

df = spark.read.csv(f"{BRONZE}/ademe/dpe/*.csv", header=True, sep=",")

# Mapping étiquette → score numérique
dpe_map = {"A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "F": 6, "G": 7}
dpe_mapping = F.create_map([F.lit(x) for kv in dpe_map.items() for x in kv])

silver = (df
    .withColumnRenamed("N°DPE", "id_dpe")
    .withColumnRenamed("code_insee_commune_actualise", "code_commune")
    .withColumnRenamed("nom_commune_ban", "nom_commune")
    # Filtre IDF
    .filter(F.substring("code_commune", 1, 2).isin(["75","77","78","91","92","93","94","95"]))
    # Date
    .withColumn("date_dpe", F.to_date("date_etablissement_dpe", "yyyy-MM-dd"))
    .withColumn("annee_dpe", F.year("date_dpe"))
    # Filtre DPE récents uniquement (depuis 2021 = DPE nouvelle méthode)
    .filter(F.col("annee_dpe") >= 2021)
    # Nettoyage étiquettes
    .withColumn("etiquette_dpe", F.trim(F.upper("etiquette_dpe")))
    .withColumn("score_dpe_num", dpe_mapping[F.col("etiquette_dpe")])
    # Surfaces et consommations
    .withColumn("surface_habitable", F.col("surface_habitable_logement").cast("double"))
    .withColumn("conso_ep_m2", F.col("conso_5_usages_ep_m2").cast("double"))
    .withColumn("emission_ges_m2", F.col("emission_ges_5_usages_ep_m2").cast("double"))
    .withColumn("annee_construction", F.col("annee_construction").cast("int"))
    # Coordonnées
    .withColumn("latitude",  F.col("latitude").cast("double"))
    .withColumn("longitude", F.col("longitude").cast("double"))
    # Suppression valeurs aberrantes
    .filter(F.col("surface_habitable").between(9, 2000))
    .filter(F.col("etiquette_dpe").isin(["A","B","C","D","E","F","G"]))
    .dropDuplicates(["id_dpe"])
)

silver.write.format("delta").mode("overwrite").partitionBy("annee_dpe") \
      .save(f"{SILVER}/ademe_dpe/")
```

---

## Source 5 — OSM POI (OpenStreetMap Points of Interest)

**Responsable :** _(à assigner)_
**Fréquence :** Export semestriel (Geofabrik)
**Format Bronze :** GeoJSON ou Parquet (via osmium + ogr2ogr)
**Source :** [https://download.geofabrik.de/europe/france/ile-de-france.html](https://download.geofabrik.de/europe/france/ile-de-france.html)

### Catégories de POI à extraire

| Catégorie | Tags OSM | Valeur pour HomePedia |
|---|---|---|
| **Transport** | `public_transport`, `railway=station/stop`, `amenity=bus_station` | Score accessibilité |
| **Éducation** | `amenity IN (school, college, university, kindergarten)` | Attractivité familles |
| **Santé** | `amenity IN (hospital, clinic, pharmacy, doctors)` | Qualité de vie |
| **Commerce** | `shop=*`, `amenity IN (supermarket, market)` | Dynamisme commercial |
| **Restauration** | `amenity IN (restaurant, cafe, bar, fast_food)` | Signal gentrification |
| **Bio/Bobo** | `shop IN (organic, deli)`, `amenity=cafe` + `name~bio\|vegan` | Signal gentrification |
| **Espaces verts** | `leisure IN (park, garden, nature_reserve)` | Qualité de vie |
| **Culture** | `amenity IN (theatre, cinema, museum, library)` | Score culturel |
| **Sport** | `leisure IN (sports_centre, swimming_pool, fitness_centre)` | Qualité de vie |

### Colonnes Bronze (GeoJSON OSM brut)

| Champ | Type | Description |
|---|---|---|
| `osm_id` | string | Identifiant OSM |
| `osm_type` | string | `node`, `way`, `relation` |
| `name` | string | Nom du POI |
| `amenity` | string | Catégorie principale |
| `shop` | string | Type de commerce |
| `leisure` | string | Type de loisir |
| `public_transport` | string | Type de transport |
| `railway` | string | Type de transport ferroviaire |
| `geometry.coordinates` | array[double] | [longitude, latitude] |
| `addr:postcode` | string | Code postal (si renseigné) |
| `addr:city` | string | Ville (si renseignée) |

### Table Silver cible : `silver_osm_poi`

```sql
CREATE TABLE silver_osm_poi (
    osm_id          STRING    NOT NULL,
    nom             STRING,
    categorie       STRING    NOT NULL,    -- transport/education/sante/commerce/...
    sous_categorie  STRING,               -- detail (ecole, cafe, metro...)
    code_commune    STRING    NOT NULL,   -- clé de jointure (via H3 index)
    nom_commune     STRING,
    h3_index        STRING,               -- index H3 résolution 9 (~175m)
    longitude       DOUBLE    NOT NULL,
    latitude        DOUBLE    NOT NULL,
    is_bio_bobo     BOOLEAN,              -- signal gentrification
    annee_export    INT       NOT NULL    -- millésime OSM
)
USING DELTA
PARTITIONED BY (categorie);
```

### Transformations Bronze → Silver (avec H3 — sans Sedona)

> **Choix H3 vs Apache Sedona :**
> Sedona est une dépendance lourde (cluster configuration, JAR custom) incompatible avec le quota Azure for Students.
> H3 (Uber) s'installe avec un simple `pip install h3` — aucune configuration cluster nécessaire.
> La précision à résolution 9 (~175m) est suffisante pour rattacher un POI à sa commune.

```python
import h3
from pyspark.sql.types import StringType

BRONZE = "abfss://bronze@homepediadatalake.dfs.core.windows.net"
SILVER = "abfss://silver@homepediadatalake.dfs.core.windows.net"

# UDF H3 : coordonnée → index hexagonal résolution 9
@F.udf(StringType())
def to_h3(lat, lon):
    if lat is None or lon is None:
        return None
    return h3.latlng_to_cell(lat, lon, 9)

# Charger les POI bruts
df_poi = spark.read.json(f"{BRONZE}/osm/idf_poi/*.geojson")

# Charger la table de correspondance H3 → commune (pré-calculée depuis silver_referentiel_communes)
df_h3_communes = spark.read.format("delta").load(f"{SILVER}/referentiel_h3_communes/")
# Schéma : h3_index STRING, code_commune STRING, nom_commune STRING

# Catégorisation + H3 index
silver = (df_poi
    .withColumn("longitude", F.col("geometry.coordinates").getItem(0).cast("double"))
    .withColumn("latitude",  F.col("geometry.coordinates").getItem(1).cast("double"))
    .withColumn("h3_index", to_h3(F.col("latitude"), F.col("longitude")))
    .withColumn("categorie", F.when(F.col("amenity").isin(
                                    "school","college","university","kindergarten"), "education")
                              .when(F.col("amenity").isin(
                                    "hospital","clinic","pharmacy","doctors"), "sante")
                              .when(F.col("amenity").isin(
                                    "restaurant","cafe","bar","fast_food"), "restauration")
                              .when(F.col("amenity").isin(
                                    "bus_station","subway_entrance") |
                                    F.col("railway").isin("station","stop"), "transport")
                              .when(F.col("leisure").isin(
                                    "park","garden","nature_reserve"), "espaces_verts")
                              .when(F.col("leisure").isin(
                                    "sports_centre","fitness_centre","swimming_pool"), "sport")
                              .when(F.col("amenity").isin(
                                    "theatre","cinema","museum","library"), "culture")
                              .when(F.col("shop").isNotNull(), "commerce")
                              .otherwise("autre"))
    .filter(F.col("categorie") != "autre")
    # Signal gentrification
    .withColumn("is_bio_bobo",
                F.col("shop").isin("organic","deli") |
                F.lower(F.col("name")).rlike("bio|vegan|végétalien|zéro.déchet"))
    .withColumn("annee_export", F.lit(2024))
    .filter(F.col("longitude").isNotNull() & F.col("latitude").isNotNull())
    .dropDuplicates(["osm_id"])
    # Jointure H3 → commune
    .join(df_h3_communes, "h3_index", "left")
)

silver.write.format("delta").mode("overwrite").partitionBy("categorie") \
      .save(f"{SILVER}/osm_poi/")
```

---

## Table de référence communes (pré-requis partagé)

> ⚠️ **BLOQUANT — À créer EN PREMIER avant toute autre table Silver**
> Le fichier IGN `communes_idf.geojson` n'est **pas encore uploadé** dans ADLS.
>
> **Action avant le workshop :**
> 1. Télécharger IGN Admin Express depuis [https://geoservices.ign.fr/adminexpress](https://geoservices.ign.fr/adminexpress)
> 2. Extraire `COMMUNE_IDF.geojson` (ou filtrer sur les depts 75-95)
> 3. Uploader : `abfss://bronze@homepediadatalake.dfs.core.windows.net/ign/communes_idf.geojson`
> 4. **Puis** générer la table `referentiel_h3_communes` (utilisée par le spatial join OSM)

```sql
-- Table principale
CREATE TABLE silver_referentiel_communes (
    code_commune    STRING    NOT NULL,    -- INSEE 5 chiffres
    nom_commune     STRING    NOT NULL,
    code_dept       STRING    NOT NULL,
    geometry_wkt    STRING,               -- polygone WKT
    centroid_lon    DOUBLE,
    centroid_lat    DOUBLE,
    surface_km2     DOUBLE
)
USING DELTA;

-- Table de correspondance H3 résolution 9 → commune
-- (pré-calculée en couvrant chaque polygone communal avec des hexagones H3)
CREATE TABLE silver_referentiel_h3_communes (
    h3_index        STRING    NOT NULL,   -- index H3 résolution 9
    code_commune    STRING    NOT NULL,
    nom_commune     STRING
)
USING DELTA;
```

```python
# Génération de la correspondance H3 → commune
import h3

BRONZE = "abfss://bronze@homepediadatalake.dfs.core.windows.net"
SILVER = "abfss://silver@homepediadatalake.dfs.core.windows.net"

df_communes = spark.read.json(f"{BRONZE}/ign/communes_idf.geojson")

@F.udf(ArrayType(StringType()))
def polygon_to_h3_cells(geometry_wkt):
    # Convertit un polygone WKT en liste d'index H3 résolution 9
    import h3, shapely.wkt
    geom = shapely.wkt.loads(geometry_wkt)
    geojson = shapely.geometry.mapping(geom)
    return list(h3.polygon_to_cells(h3.H3Shape.from_dict(geojson), 9))

df_h3 = (df_communes
    .withColumn("h3_cells", polygon_to_h3_cells(F.col("geometry_wkt")))
    .withColumn("h3_index", F.explode("h3_cells"))
    .select("h3_index", "code_commune", "nom_commune")
    .dropDuplicates(["h3_index"])
)

df_h3.write.format("delta").mode("overwrite").save(f"{SILVER}/referentiel_h3_communes/")
```

---

## Jointure finale Silver → Gold (aperçu)

```python
SILVER = "abfss://silver@homepediadatalake.dfs.core.windows.net"
GOLD   = "abfss://gold@homepediadatalake.dfs.core.windows.net"

silver_dvf  = spark.read.format("delta").load(f"{SILVER}/dvf_transactions/")
silver_pop  = spark.read.format("delta").load(f"{SILVER}/insee_populations/")
silver_rev  = spark.read.format("delta").load(f"{SILVER}/insee_revenus/")
silver_dpe  = spark.read.format("delta").load(f"{SILVER}/ademe_dpe/")
silver_poi  = spark.read.format("delta").load(f"{SILVER}/osm_poi/")

gold = (
    silver_dvf
        .groupBy("code_commune", "annee", "type_local")
        .agg(
            F.percentile_approx("prix_m2", 0.5).alias("prix_median_m2"),
            F.count("*").alias("nb_transactions"),
            F.avg("prix_m2").alias("prix_moyen_m2")
        )
    .join(silver_pop, "code_commune", "left")
    .join(silver_rev, "code_commune", "left")
    .join(silver_dpe
            .groupBy("code_commune")
            .agg(F.avg("score_dpe_num").alias("score_dpe_moyen"),
                 F.avg("conso_ep_m2").alias("conso_energie_moyenne")),
          "code_commune", "left")
    .join(silver_poi
            .groupBy("code_commune","categorie")
            .agg(F.count("*").alias("nb_poi"))
            .groupBy("code_commune")
            .pivot("categorie")
            .agg(F.first("nb_poi")),
          "code_commune", "left")
)

gold.write.format("delta").mode("overwrite").save(f"{GOLD}/communes_agregat/")
```

---

## Checklist Workshop

| # | Tâche | Personne | Statut |
|---|---|---|---|
| 0a | ⚠️ Upload `communes_idf.geojson` (IGN) dans ADLS bronze/ign/ | Les deux | ⬜ |
| 0b | ⚠️ Upload `cc_filosofi_2021_COM.csv` dans ADLS bronze/insee/revenus/ | Les deux | ⬜ |
| 1 | Créer `silver_referentiel_communes` + `silver_referentiel_h3_communes` | Les deux | ⬜ |
| 2 | Bronze → Silver DVF (IDF, 2019–2024) | | ⬜ |
| 3 | Bronze → Silver INSEE Populations | | ⬜ |
| 4 | Bronze → Silver INSEE Revenus (Filosofi) | | ⬜ |
| 5 | Bronze → Silver ADEME DPE | | ⬜ |
| 6 | Bronze → Silver OSM POI (avec H3) | | ⬜ |
| 7 | Vérifier `code_commune` joinable sur toutes les tables | Les deux | ⬜ |
| 8 | Premier agrégat Gold test (1 commune) | Les deux | ⬜ |

---

> *Document workshop — Mars 2026 — T-DAT-902-PAR_3 Epitech Paris*
> *Corrections suite retours Ludo : Raw/Bronze séparés, H3 remplace Sedona, chemins abfss://, bloquants IGN et Filosofi identifiés*
