# Databricks notebook source
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  HomePedia — Data Quality Framework (Great Expectations + Deequ)           ║
# ║                                                                              ║
# ║  Valide la qualité des données à chaque couche :                            ║
# ║    Bronze DVF  → schéma, nulls critiques, dates valides                     ║
# ║    Silver DVF  → prix/m² cohérents, doublons, jointures IRIS                ║
# ║    Gold        → couverture scores, communes uniques, loyers                 ║
# ║                                                                              ║
# ║  En cas d'échec critique : raise Exception → pipeline stoppé               ║
# ║  En cas d'avertissement  : log dans Gold/_dq_reports/                       ║
# ║                                                                              ║
# ║  Usage : appeler ce notebook depuis le pipeline principal via %run           ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# COMMAND ----------

# %pip install great_expectations==0.18.19

# COMMAND ----------

# %run ../utils/init.py

# COMMAND ----------

from pyspark.sql import functions as F
from pyspark.sql.types import StructType
from datetime import datetime
import json

# Répertoire de rapport JSON persisté dans Gold ADLS
DQ_REPORT_PATH = f"{GOLD}/_dq_reports/"

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

class DQResult:
    def __init__(self):
        self.checks = []
        self.n_error = 0
        self.n_warn  = 0

    def add(self, layer, name, passed, value, threshold, severity="ERROR"):
        status = "OK" if passed else severity
        if status == "ERROR": self.n_error += 1
        if status == "WARN":  self.n_warn  += 1
        self.checks.append({
            "layer": layer, "check": name, "status": status,
            "value": value, "threshold": threshold,
        })
        icon = "✅" if passed else ("⚠️ " if severity == "WARN" else "❌")
        print(f"  {icon}  [{layer}] {name} — {value} (seuil: {threshold})")

    def save(self):
        report = {
            "run_at": datetime.utcnow().isoformat(),
            "n_error": self.n_error,
            "n_warn": self.n_warn,
            "checks": self.checks,
        }
        path = f"{DQ_REPORT_PATH}{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
        spark.createDataFrame([report]).write.mode("overwrite").json(path)
        print(f"\n💾 Rapport sauvegardé : {path}")

    def raise_if_errors(self):
        if self.n_error > 0:
            raise Exception(
                f"🚨 Data Quality FAILED — {self.n_error} erreur(s) critique(s) détectée(s). "
                f"Pipeline arrêté. Consultez {DQ_REPORT_PATH}"
            )

dq = DQResult()

# COMMAND ----------

# ── Couche Bronze — DVF ───────────────────────────────────────────────────────
print("\n── Bronze DVF ───────────────────────────────────────────────────────")

df_bronze_dvf = spark.read.format("delta").load(f"{BRONZE}/dvf_transactions/")
n_bronze = df_bronze_dvf.count()

# Volume minimum (IDF 2019-2024 : ~2M transactions DVF)
dq.add("Bronze/DVF", "Volume ≥ 500 000 lignes",
       n_bronze >= 500_000, f"{n_bronze:,}", "≥ 500 000")

# Champs obligatoires non nuls
mandatory = ["code_commune", "valeur_fonciere", "date_mutation"]
for col in mandatory:
    pct_null = df_bronze_dvf.filter(F.col(col).isNull()).count() / n_bronze * 100
    dq.add("Bronze/DVF", f"NULL {col} < 1%",
           pct_null < 1, f"{pct_null:.2f}%", "< 1%")

# Dates dans la fenêtre temporelle attendue (2019-2024)
bad_dates = df_bronze_dvf.filter(
    ~F.col("date_mutation").between("2019-01-01", "2024-12-31")
).count()
dq.add("Bronze/DVF", "Dates 2019–2024",
       bad_dates == 0, f"{bad_dates} hors fenêtre", "0", severity="WARN")

# Types locaux valides
types_attendus = {"Appartement", "Maison", "Local industriel. commercial ou assimilé",
                  "Dépendance", "Local"}
types_bronze   = {r["type_local"] for r in
                  df_bronze_dvf.select("type_local").distinct().collect()
                  if r["type_local"] is not None}
types_inconnus = types_bronze - types_attendus
dq.add("Bronze/DVF", "Types locaux connus",
       len(types_inconnus) == 0,
       f"{types_inconnus}" if types_inconnus else "OK",
       "ensemble attendu", severity="WARN")

# COMMAND ----------

# ── Couche Silver — DVF ───────────────────────────────────────────────────────
print("\n── Silver DVF ───────────────────────────────────────────────────────")

df_silver_dvf = spark.read.format("delta").load(f"{SILVER}/dvf_transactions/")
n_silver = df_silver_dvf.count()

# Volume : Silver doit être ≥ 60% du Bronze (filtre Appart/Maison + coords)
ratio_bronze_silver = n_silver / n_bronze if n_bronze > 0 else 0
dq.add("Silver/DVF", "Ratio Silver/Bronze ≥ 60%",
       ratio_bronze_silver >= 0.6,
       f"{ratio_bronze_silver:.0%}", "≥ 60%", severity="WARN")

# Prix/m² cohérents
stats = df_silver_dvf.select(
    F.count("*").alias("n"),
    F.count(F.when(F.col("prix_m2").isNull(), 1)).alias("n_null_prix"),
    F.count(F.when(~F.col("prix_m2").between(500, 50_000), 1)).alias("n_hors_range"),
    F.expr("percentile_approx(prix_m2, 0.5)").alias("median_prix_m2"),
).first()

dq.add("Silver/DVF", "NULL prix_m2 < 5%",
       stats["n_null_prix"] / n_silver < 0.05,
       f"{stats['n_null_prix'] / n_silver:.1%}", "< 5%")

dq.add("Silver/DVF", "Prix/m² hors [500–50000] < 0.5%",
       stats["n_hors_range"] / n_silver < 0.005,
       f"{stats['n_hors_range'] / n_silver:.2%}", "< 0.5%", severity="WARN")

median_m2 = float(stats["median_prix_m2"]) if stats["median_prix_m2"] else 0
dq.add("Silver/DVF", "Médiane prix/m² IDF ∈ [3 000–12 000 €]",
       3_000 <= median_m2 <= 12_000,
       f"{median_m2:.0f} €/m²", "[3 000, 12 000]")

# Doublons : même (code_commune, date_mutation, valeur_fonciere)
n_total = df_silver_dvf.count()
n_distinct = df_silver_dvf.select(
    "code_commune", "date_mutation", "valeur_fonciere"
).distinct().count()
n_doublons = n_total - n_distinct
dq.add("Silver/DVF", "Doublons (commune+date+valeur) < 0.1%",
       n_doublons / n_total < 0.001,
       f"{n_doublons} ({n_doublons/n_total:.3%})", "< 0.1%", severity="WARN")

# Couverture géographique IDF (77+78+91+92+93+94+95 + Paris 75)
depts_idf  = {"75", "77", "78", "91", "92", "93", "94", "95"}
depts_found = {r["code_departement"] for r in
               df_silver_dvf.select("code_departement").distinct().collect()
               if r["code_departement"] is not None}
manquants = depts_idf - depts_found
dq.add("Silver/DVF", "Tous les 8 départements IDF présents",
       len(manquants) == 0,
       f"Manquants: {manquants}" if manquants else "8/8 départements", "0 manquant")

# COMMAND ----------

# ── Couche Silver — DPE ───────────────────────────────────────────────────────
print("\n── Silver DPE ───────────────────────────────────────────────────────")

df_silver_dpe = spark.read.format("delta").load(f"{SILVER}/dpe/")
n_dpe = df_silver_dpe.count()

dq.add("Silver/DPE", "Volume ≥ 100 000 DPE IDF",
       n_dpe >= 100_000, f"{n_dpe:,}", "≥ 100 000")

# Étiquette DPE valide (A à G)
dpe_invalides = df_silver_dpe.filter(
    ~F.col("etiquette_dpe").isin("A", "B", "C", "D", "E", "F", "G")
).count()
dq.add("Silver/DPE", "Étiquettes DPE valides (A–G)",
       dpe_invalides == 0, f"{dpe_invalides} étiquettes invalides", "0")

# Consommation énergie > 0
neg_conso = df_silver_dpe.filter(
    F.col("conso_energie").isNotNull() & (F.col("conso_energie") <= 0)
).count()
dq.add("Silver/DPE", "Consommation énergie > 0",
       neg_conso == 0, f"{neg_conso} valeurs ≤ 0", "0", severity="WARN")

# COMMAND ----------

# ── Couche Silver — INSEE ─────────────────────────────────────────────────────
print("\n── Silver INSEE ─────────────────────────────────────────────────────")

df_insee = spark.read.format("delta").load(f"{SILVER}/insee/")
n_insee = df_insee.count()

dq.add("Silver/INSEE", "Volume ≥ 900 communes IDF",
       n_insee >= 900, f"{n_insee:,}", "≥ 900")

# IPS dans bornes [50, 200]
if "ips_moyen" in df_insee.columns:
    bad_ips = df_insee.filter(
        F.col("ips_moyen").isNotNull() & ~F.col("ips_moyen").between(50, 200)
    ).count()
    dq.add("Silver/INSEE", "IPS ∈ [50, 200]",
           bad_ips == 0, f"{bad_ips} valeurs hors bornes", "0", severity="WARN")

# COMMAND ----------

# ── Couche Gold — communes_agregat ────────────────────────────────────────────
print("\n── Gold communes_agregat ─────────────────────────────────────────────")

df_gold = spark.read.format("delta").load(f"{GOLD}/communes_agregat/")
n_gold = df_gold.count()

# Volume
dq.add("Gold", "Volume ≥ 900 communes",
       n_gold >= 900, f"{n_gold:,}", "≥ 900")

# Unicité code_commune
n_uniq = df_gold.select("code_commune").distinct().count()
dq.add("Gold", "code_commune unique",
       n_uniq == n_gold,
       f"{n_gold - n_uniq} doublons", "0 doublons")

# Couverture des 3 scores composites
for score in ["score_qualite_vie", "score_investissement", "score_stabilite"]:
    if score in df_gold.columns:
        pct = df_gold.filter(F.col(score).isNotNull()).count() / n_gold * 100
        dq.add("Gold", f"Couverture {score} ≥ 80%",
               pct >= 80, f"{pct:.1f}%", "≥ 80%")
        # Bornes [0, 100]
        bad = df_gold.filter(
            F.col(score).isNotNull() & ~F.col(score).between(0, 100)
        ).count()
        dq.add("Gold", f"{score} ∈ [0, 100]",
               bad == 0, f"{bad} hors bornes", "0")

# Loyers : si la colonne existe, vérifier la couverture
if "loyer_median_m2" in df_gold.columns:
    pct_loyer = df_gold.filter(
        F.col("loyer_median_m2").isNotNull()
    ).count() / n_gold * 100
    dq.add("Gold", "Couverture loyer_median_m2 ≥ 60%",
           pct_loyer >= 60, f"{pct_loyer:.1f}%", "≥ 60%", severity="WARN")

    # Rendement locatif brut cohérent (2% à 12%)
    if "rendement_locatif_brut" in df_gold.columns:
        bad_rend = df_gold.filter(
            F.col("rendement_locatif_brut").isNotNull() &
            ~F.col("rendement_locatif_brut").between(1, 15)
        ).count()
        dq.add("Gold", "Rendement locatif brut ∈ [1%, 15%]",
               bad_rend == 0, f"{bad_rend} hors bornes", "0", severity="WARN")

# COMMAND ----------

# ── Rapport final ─────────────────────────────────────────────────────────────
print(f"""
╔══════════════════════════════════════════════════════╗
║  📊 Data Quality Report — HomePedia                  ║
║                                                      ║
║  Total checks : {len(dq.checks):<5}                           ║
║  ✅ OK         : {sum(1 for c in dq.checks if c['status']=='OK'):<5}                           ║
║  ⚠️  WARN       : {dq.n_warn:<5}                           ║
║  ❌ ERROR      : {dq.n_error:<5}                           ║
╚══════════════════════════════════════════════════════╝
""")

dq.save()
dq.raise_if_errors()

print("✅ Data Quality OK — pipeline peut continuer.")
