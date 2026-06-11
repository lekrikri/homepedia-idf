#!/usr/bin/env bash
# Pipeline HomePedia — Cloud Run Job entrypoint
set -euo pipefail

ANNEE="${ANNEE:-2025}"
EXECUTION_ID="${CLOUD_RUN_EXECUTION:-local}"
START=$(date +%s)

echo "╔══════════════════════════════════════════╗"
echo "║   Pipeline HomePedia — Cloud Run Job     ║"
echo "║   Année cible : ${ANNEE}                      ║"
echo "╚══════════════════════════════════════════╝"
echo "Démarrage : $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo ""

# Enregistrer le début du run dans Supabase
RUN_ID=$(python3 ingestion/pipeline_logger.py start --annee "${ANNEE}" --execution-id "${EXECUTION_ID}" 2>/dev/null || echo "0")
echo "Run ID : ${RUN_ID}"
echo ""

NB_COMMUNES=0
NB_TRANSACTIONS=0
STATUS="success"
ERROR_MSG=""

# ── Étape 1 : Export gold (communes_agregat) → Supabase ─────────────────────
echo "▶ [1/4] Export communes_agregat → Supabase"
T1=$(date +%s)
python3 ingestion/export_gold_to_postgres.py 2>&1 | tee /tmp/step1.log
STEP1=$(($(date +%s)-T1))
NB_COMMUNES=$(grep -oP '\d+(?= communes mises à jour)' /tmp/step1.log 2>/dev/null | tail -1 || echo "0")
echo "   ✅ Durée : ${STEP1}s"
echo ""

# ── Étape 2 : Export transactions → Supabase ────────────────────────────────
echo "▶ [2/4] Export transactions ${ANNEE} → Supabase"
T2=$(date +%s)
python3 ingestion/export_transactions_to_postgres.py --annee "${ANNEE}" 2>&1 | tee /tmp/step2.log
STEP2=$(($(date +%s)-T2))
NB_TRANSACTIONS=$(grep -oP '[\d,]+(?= nouvelles transactions)' /tmp/step2.log 2>/dev/null | tail -1 | tr -d ',' || echo "0")
echo "   ✅ Durée : ${STEP2}s"
echo ""

# ── Étape 3 : Enrichissements depuis GCS ────────────────────────────────────
echo "▶ [3/4] Enrichissements (IPS, énergie, délinquance)"
T3=$(date +%s)
python3 ingestion/ips/download_gcs.py         2>&1 || echo "   ⚠️  IPS ignoré"
python3 ingestion/energie/download_gcs.py     2>&1 || echo "   ⚠️  Énergie ignoré"
python3 ingestion/delinquance/download_gcs.py 2>&1 || echo "   ⚠️  Délinquance ignoré"
STEP3=$(($(date +%s)-T3))
echo "   ✅ Durée : ${STEP3}s"
echo ""

# ── Étape 4 : Calcul des scores ─────────────────────────────────────────────
echo "▶ [4/4] Calcul des scores qualité de vie"
T4=$(date +%s)
python3 ingestion/scores/compute_scores.py 2>&1
STEP4=$(($(date +%s)-T4))
echo "   ✅ Durée : ${STEP4}s"
echo ""

TOTAL=$(($(date +%s)-START))
STEPS="{\"gold\":${STEP1},\"transactions\":${STEP2},\"enrichments\":${STEP3},\"scores\":${STEP4}}"

echo "╔══════════════════════════════════════════╗"
echo "║   🎉 Pipeline terminé en ${TOTAL}s             ║"
echo "║   Communes : ${NB_COMMUNES} | Transactions : ${NB_TRANSACTIONS}  ║"
echo "╚══════════════════════════════════════════╝"

# Enregistrer les métriques finales
if [ "${RUN_ID}" != "0" ]; then
    python3 ingestion/pipeline_logger.py finish \
        --id "${RUN_ID}" --status "${STATUS}" \
        --duration "${TOTAL}" \
        --nb-communes "${NB_COMMUNES}" \
        --nb-transactions "${NB_TRANSACTIONS}" \
        --steps "${STEPS}" 2>/dev/null || true
fi
