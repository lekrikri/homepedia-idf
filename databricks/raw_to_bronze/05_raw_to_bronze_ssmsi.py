# Databricks notebook source
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  HomePedia — Raw → Bronze : SSMSI Délinquance                              ║
# ║                                                                              ║
# ║  Télécharge les statistiques de délinquance (Ministère de l'Intérieur)     ║
# ║  depuis data.gouv.fr et les dépose en Bronze ADLS en format CSV brut.      ║
# ║                                                                              ║
# ║  Source : https://www.data.gouv.fr/fr/datasets/53699576a3a729239d20471d/   ║
# ║  Données : taux infractions par département (cambriolages, CBV)             ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# COMMAND ----------

# %run ../utils/init.py

# COMMAND ----------

import requests
import io
import os
from pyspark.sql import functions as F

BRONZE_SSMSI = f"{BRONZE}/ssmsi/"
DATASET_API  = "https://www.data.gouv.fr/api/1/datasets/53699576a3a729239d20471d/"

# COMMAND ----------

# ── Step 1 : Récupérer la liste des ressources data.gouv.fr ──────────────────

print("📡 Récupération des ressources SSMSI sur data.gouv.fr...")
resp = requests.get(DATASET_API, timeout=30)
resp.raise_for_status()
resources = resp.json().get("resources", [])
print(f"  → {len(resources)} ressources trouvées")

# Prendre les CSV les plus récents (3 max)
csv_resources = sorted(
    [r for r in resources if (r.get("format") or "").lower() == "csv" and r.get("url")],
    key=lambda r: r.get("created_at", ""),
    reverse=True
)[:3]

if not csv_resources:
    # Fallback : prendre tous les fichiers si pas de CSV étiquetés
    csv_resources = sorted(
        [r for r in resources if r.get("url") and
         any(r.get("url", "").lower().endswith(ext) for ext in [".csv", ".xlsx"])],
        key=lambda r: r.get("created_at", ""),
        reverse=True
    )[:3]

print(f"  → {len(csv_resources)} fichier(s) à télécharger")

# COMMAND ----------

# ── Step 2 : Télécharger et écrire en Bronze ADLS ────────────────────────────

uploaded = []
for i, res in enumerate(csv_resources):
    url   = res["url"]
    title = (res.get("title") or f"ssmsi_{i}").replace("/", "_").replace(" ", "_")[:60]
    fmt   = (res.get("format") or "csv").lower()
    fname = f"{title}.{fmt}"

    print(f"  ↓ [{i+1}/{len(csv_resources)}] {title[:50]}...")
    try:
        r = requests.get(url, timeout=180)
        r.raise_for_status()

        # Écrire via dbutils (ADLS mount)
        tmp_path = f"/tmp/ssmsi_{i}.{fmt}"
        with open(tmp_path, "wb") as f:
            f.write(r.content)

        dest = f"{BRONZE_SSMSI}{fname}"
        dbutils.fs.cp(f"file:{tmp_path}", dest, recurse=False)
        uploaded.append(dest)
        print(f"     ✅ {len(r.content):,} octets → {dest}")
    except Exception as e:
        print(f"     ⚠️  Échec : {e}")

print(f"\n✅ {len(uploaded)} fichier(s) déposé(s) dans Bronze SSMSI")
for f in uploaded:
    print(f"   {f}")

# COMMAND ----------

# ── Step 3 : Vérification Bronze ─────────────────────────────────────────────

files = dbutils.fs.ls(BRONZE_SSMSI)
print(f"\n📁 Contenu {BRONZE_SSMSI} :")
for f in files:
    print(f"   {f.name:60s}  {f.size:>10,} octets")
