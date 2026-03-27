# Notebook Databricks — GTFS/PRIM Bronze → Silver
> **Pour : Ludo**
> **Source :** `bronze/gtfs/` (3 fichiers Parquet uploadés le 27/03/2026)
> **Objectif :** Nettoyer et enrichir les données transport pour les rendre joignables par commune

---

## Contexte

Les données transport IDF ont été récupérées via l'**API PRIM Navitia** (Île-de-France Mobilités).
Elles sont maintenant disponibles dans Azure bronze :

```
bronze/gtfs/
  ├── stops.parquet             # 15 370 arrêts (métro, RER, bus, tram...)
  ├── lines.parquet             # 2 010 lignes de transport
  └── accessibility_scores.parquet  # score transport par zone ~500m
```

---

## Ce que tu dois produire en Silver

```
silver/gtfs/
  ├── transport_stops/          # arrêts nettoyés + code_commune rattaché
  └── transport_lines/          # lignes nettoyées
```

---

## Notebook — Étape par étape

### 0. Setup Spark + lecture bronze

```python
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, round as spark_round, udf, lit
from pyspark.sql.types import StringType

spark = SparkSession.builder.appName("gtfs-silver").getOrCreate()

BRONZE = "abfss://bronze@homepediadatalake.dfs.core.windows.net"
SILVER = "abfss://silver@homepediadatalake.dfs.core.windows.net"

df_stops = spark.read.parquet(f"{BRONZE}/gtfs/stops.parquet")
df_lines  = spark.read.parquet(f"{BRONZE}/gtfs/lines.parquet")

df_stops.printSchema()
df_lines.printSchema()
```

---

### 1. Nettoyage des arrêts (`stops`)

**Schéma bronze reçu :**
```
stop_id         string   # ex: "IDFM:monomodal:StopPlace:43246"
stop_name       string   # ex: "Châtelet"
stop_lat        double
stop_lon        double
transport_type  string   # "metro" | "rer" | "tram" | "bus" | "train"
transport_score int      # 1-5 (metro/rer=5, tram=4, bus=2)
lignes          string   # ex: "IDFM:C01742,IDFM:C01743" (séparés par virgule)
```

**Transformations à faire :**

```python
# 1. Supprimer les arrêts sans coordonnées valides
df_stops = df_stops.filter(
    (col("stop_lat").isNotNull()) & (col("stop_lon").isNotNull()) &
    (col("stop_lat") != 0.0) & (col("stop_lon") != 0.0)
)

# 2. Filtrer sur l'IDF (bbox approximative)
df_stops = df_stops.filter(
    (col("stop_lat").between(48.12, 49.24)) &
    (col("stop_lon").between(1.44, 3.56))
)

# 3. Normaliser le type de transport en majuscules
from pyspark.sql.functions import upper
df_stops = df_stops.withColumn("transport_type", upper(col("transport_type")))
# Résultat : "METRO" | "RER" | "TRAM" | "BUS" | "TRAIN"

# 4. Arrondir les coordonnées à 6 décimales
df_stops = df_stops.withColumn("stop_lat", spark_round(col("stop_lat"), 6)) \
                   .withColumn("stop_lon", spark_round(col("stop_lon"), 6))

# Vérification
print(f"Arrêts conservés : {df_stops.count()}")
df_stops.groupBy("transport_type").count().orderBy("count", ascending=False).show()
```

---

### 2. Jointure spatiale arrêts → code_commune via H3

> Même approche H3 que pour le DVF (résolution 9, ~175m).

```python
# pip install h3 (dans le cluster Databricks : ajouter h3 aux libraries)
import h3
from pyspark.sql.functions import udf
from pyspark.sql.types import StringType

# UDF H3 : (lat, lon) → h3_index résolution 9
@udf(StringType())
def latlng_to_h3(lat, lon):
    if lat is None or lon is None:
        return None
    return h3.geo_to_h3(float(lat), float(lon), 9)

# Lire les communes silver (déjà faites par Ludo) pour récupérer leur H3
df_communes = spark.read.parquet(f"{SILVER}/communes_idf/")
# Colonnes attendues : code_commune, nom, h3_index (résolution 9)

# Calculer H3 pour chaque arrêt
df_stops = df_stops.withColumn("h3_index", latlng_to_h3(col("stop_lat"), col("stop_lon")))

# Jointure arrêts ↔ communes via H3
df_stops_silver = df_stops.join(
    df_communes.select("h3_index", "code_commune", "nom_commune"),
    on="h3_index",
    how="left"
)

# Stats jointure
total = df_stops_silver.count()
matched = df_stops_silver.filter(col("code_commune").isNotNull()).count()
print(f"Arrêts avec commune : {matched}/{total} ({100*matched//total}%)")
```

---

### 3. Nettoyage des lignes (`lines`)

**Schéma bronze reçu :**
```
line_id         string   # ex: "IDFM:C01742"
line_name       string   # ex: "Ligne 1"
line_code       string   # ex: "1" | "A" | "RER B"
transport_type  string   # ex: "metro" | "rapidtransit" | "bus"
color           string   # ex: "F2A400" (hex sans #)
network         string   # ex: "RATP" | "SNCF" | "OPTILE"
```

**Transformations :**

```python
from pyspark.sql.functions import when, regexp_replace

# 1. Normaliser transport_type
df_lines = df_lines.withColumn("transport_type",
    when(col("transport_type").contains("rapid"), "RER")
    .when(col("transport_type") == "metro", "METRO")
    .when(col("transport_type") == "tramway", "TRAM")
    .when(col("transport_type").contains("train"), "TRAIN")
    .otherwise("BUS")
)

# 2. Nettoyer la couleur (s'assurer qu'elle est bien hex 6 chars)
df_lines = df_lines.withColumn("color",
    regexp_replace(col("color"), "[^A-Fa-f0-9]", "")
)
# Si vide → couleur par défaut selon transport_type
from pyspark.sql.functions import when as w
DEFAULT_COLORS = {"METRO": "003189", "RER": "8B0000", "TRAM": "6E9931", "BUS": "5271b4", "TRAIN": "8B0000"}
for ttype, hex_color in DEFAULT_COLORS.items():
    df_lines = df_lines.withColumn("color",
        w((col("color") == "") & (col("transport_type") == ttype), lit(hex_color))
        .otherwise(col("color"))
    )

# 3. Supprimer doublons sur line_id
df_lines = df_lines.dropDuplicates(["line_id"])

print(f"Lignes conservées : {df_lines.count()}")
df_lines.groupBy("transport_type").count().show()
```

---

### 4. Écriture en Silver

```python
# Arrêts silver
(df_stops_silver
    .select("stop_id", "stop_name", "stop_lat", "stop_lon",
            "transport_type", "transport_score", "lignes",
            "code_commune", "nom_commune", "h3_index")
    .write
    .format("parquet")
    .mode("overwrite")
    .save(f"{SILVER}/gtfs/transport_stops/")
)

# Lignes silver
(df_lines
    .select("line_id", "line_name", "line_code",
            "transport_type", "color", "network")
    .write
    .format("parquet")
    .mode("overwrite")
    .save(f"{SILVER}/gtfs/transport_lines/")
)

print("✅ Silver GTFS écrit avec succès")
```

---

### 5. Vérifications finales

```python
# Vérif arrêts silver
df_check = spark.read.parquet(f"{SILVER}/gtfs/transport_stops/")
print("=== transport_stops ===")
print(f"Total : {df_check.count()}")
df_check.groupBy("transport_type").count().orderBy("count", ascending=False).show()
df_check.filter(col("code_commune").isNotNull()).groupBy("code_commune") \
        .count().orderBy("count", ascending=False).show(10)

# Vérif lignes silver
df_check_lines = spark.read.parquet(f"{SILVER}/gtfs/transport_lines/")
print("=== transport_lines ===")
print(f"Total : {df_check_lines.count()}")
df_check_lines.groupBy("transport_type").count().show()

# Quelques exemples
df_check.filter(col("transport_type") == "METRO").show(5)
df_check.filter(col("transport_type") == "RER").show(5)
```

---

## Résultat attendu en Silver

| Table | Nb lignes attendu | Colonnes clés |
|-------|-------------------|---------------|
| `transport_stops` | ~14 000 (filtrés IDF) | stop_id, stop_name, lat, lon, transport_type, code_commune |
| `transport_lines` | ~2 000 | line_id, line_code, transport_type, color, network |

---

## ⚠️ Points d'attention

1. **H3 disponible dans le cluster ?**
   → Vérifie que `h3` est installé : *Cluster → Libraries → Install New → PyPI → h3*

2. **communes_idf en silver** doit déjà exister avec une colonne `h3_index`
   → Si elle n'existe pas encore, tu peux calculer les H3 communes depuis les lat/lon des centroïdes

3. **code_commune Paris** : les arrêts parisiens peuvent avoir le code du district (75001→75020) ou 75056 (Paris global) selon la source — à harmoniser si besoin avec le référentiel communes

---

## Une fois terminé, ping Christophe 🙂

Il branchera l'import PostgreSQL + l'endpoint API + la couche transport sur la carte !
