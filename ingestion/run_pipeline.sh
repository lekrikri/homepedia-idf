#!/usr/bin/env bash
# =============================================================================
# run_pipeline.sh — Pipeline complet HomePedia GCP
# =============================================================================
# Ordre d'exécution :
#   1. BigQuery : créer/mettre à jour les tables externes (DVF + DPE)
#   2. DBT : bronze → silver → gold
#   3. PostgreSQL : exporter gold → Supabase
#
# Usage :
#   bash ingestion/run_pipeline.sh          # pipeline complet
#   bash ingestion/run_pipeline.sh --dbt    # DBT + export seulement
# =============================================================================

set -euo pipefail

cd "$(dirname "$0")/.."
echo "📍 Répertoire : $(pwd)"
echo ""

DBT_BIN="/home/lekrikri/.local/bin/dbt"
PYTHON="python3"
export GOOGLE_CLOUD_PROJECT="homepedia-493013"

# ── Étape 1 : Tables BigQuery externes ────────────────────────────────────────
if [[ "${1:-}" != "--dbt" ]]; then
  echo "╔══════════════════════════════════════╗"
  echo "║  Étape 1 : BigQuery External Tables  ║"
  echo "╚══════════════════════════════════════╝"
  $PYTHON ingestion/setup_bigquery.py
  echo ""
fi

# ── Étape 2 : DBT bronze → silver → gold ──────────────────────────────────────
echo "╔══════════════════════════════════════╗"
echo "║  Étape 2 : DBT run                   ║"
echo "╚══════════════════════════════════════╝"
cd homepedia_dbt
$DBT_BIN run --profiles-dir . --select bronze_transactions silver_transactions gold_communes_agregat
# DPE seulement si la table existe
$DBT_BIN run --profiles-dir . --select bronze_dpe silver_dpe 2>/dev/null || echo "⚠️  DPE ignoré (table absente)"
cd ..
echo ""

# ── Étape 2b : Relancer le gold avec DPE si disponible ────────────────────────
cd homepedia_dbt
$DBT_BIN run --profiles-dir . --select gold_communes_agregat
cd ..
echo ""

# ── Étape 3 : Export gold → PostgreSQL ────────────────────────────────────────
echo "╔══════════════════════════════════════╗"
echo "║  Étape 3 : Export → PostgreSQL       ║"
echo "╚══════════════════════════════════════╝"
$PYTHON ingestion/export_gold_to_postgres.py
echo ""

# ── Étape 4 : Enrichissements post-export ─────────────────────────────────────
echo "╔══════════════════════════════════════╗"
echo "║  Étape 4 : Enrichissements Python    ║"
echo "╚══════════════════════════════════════╝"
$PYTHON ingestion/ips/download_gcs.py
$PYTHON ingestion/energie/download_gcs.py
$PYTHON ingestion/delinquance/download_gcs.py
$PYTHON ingestion/distance_paris/compute.py
$PYTHON ingestion/georisques/download_gcs.py
$PYTHON ingestion/transports/download_gcs.py
$PYTHON ingestion/fibre/download_gcs.py
$PYTHON ingestion/scores/compute_scores.py
echo ""

echo "🎉 Pipeline terminé !"
