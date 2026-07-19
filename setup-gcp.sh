#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# setup-gcp.sh — Configuration GCP pour HomePedia (à lancer UNE SEULE FOIS)
#
# Prérequis :
#   - gcloud installé : source ~/google-cloud-sdk/path.bash.inc
#   - gcloud auth login
#   - gcloud config set project homepedia-493013
#
# Ce script :
#   1. Active les APIs GCP nécessaires
#   2. Crée le bucket GCS pour les Parquet
#   3. Crée le dataset BigQuery
#   4. Crée le repo Artifact Registry (images Docker)
#   5. Crée le compte de service CI/CD
#   6. Crée les secrets GCP Secret Manager (Supabase password, JWT)
#   7. Affiche la clé JSON à copier dans GitHub Secrets
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

PROJECT="homepedia-493013"
REGION="europe-west1"
SA_NAME="homepedia-cicd"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Setup GCP pour HomePedia — projet : $PROJECT"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── Vérifier qu'on est sur le bon projet ─────────────────────────────────────
CURRENT=$(gcloud config get-value project 2>/dev/null)
if [ "$CURRENT" != "$PROJECT" ]; then
  echo "⚙️  Changement de projet : $CURRENT → $PROJECT"
  gcloud config set project "$PROJECT"
fi
echo "✅ Projet actif : $PROJECT"
echo ""

# ── 1. Activer les APIs ───────────────────────────────────────────────────────
echo "🔌 Activation des APIs GCP (peut prendre 1-2 minutes)..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  bigquery.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  --project "$PROJECT"
echo "✅ APIs activées"
echo ""

# ── 2. Bucket GCS pour les Parquet ───────────────────────────────────────────
BUCKET="homepedia-datalake"
echo "🪣 Création du bucket GCS : gs://$BUCKET"
if ! gsutil ls -b "gs://$BUCKET" &>/dev/null; then
  gsutil mb -p "$PROJECT" -c STANDARD -l "$REGION" "gs://$BUCKET"
  # Cycle de vie : supprimer les fichiers temp après 30 jours
  cat > /tmp/lifecycle.json << 'EOF'
{"rule": [{"action": {"type": "Delete"}, "condition": {"age": 30, "matchesPrefix": ["tmp/"]}}]}
EOF
  gsutil lifecycle set /tmp/lifecycle.json "gs://$BUCKET"
  echo "✅ Bucket créé : gs://$BUCKET"
else
  echo "ℹ️  Bucket existe déjà : gs://$BUCKET"
fi
echo ""

# ── 3. Dataset BigQuery ───────────────────────────────────────────────────────
BQ_DATASET="homepedia_warehouse"
echo "📊 Création dataset BigQuery : $BQ_DATASET"
if ! bq ls --project_id="$PROJECT" "$BQ_DATASET" &>/dev/null; then
  bq mk --dataset \
    --location="$REGION" \
    --description="HomePedia — entrepôt de données DVF/DPE/INSEE" \
    "${PROJECT}:${BQ_DATASET}"
  echo "✅ Dataset BigQuery créé"
else
  echo "ℹ️  Dataset BigQuery existe déjà"
fi
echo ""

# ── 4. Artifact Registry — repo Docker ───────────────────────────────────────
AR_REPO="homepedia"
echo "🐳 Création repo Artifact Registry : $AR_REPO"
if ! gcloud artifacts repositories describe "$AR_REPO" \
     --location="$REGION" --project="$PROJECT" &>/dev/null; then
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Images Docker HomePedia (backend + frontend)" \
    --project "$PROJECT"
  echo "✅ Repo Artifact Registry créé"
else
  echo "ℹ️  Repo Artifact Registry existe déjà"
fi
echo ""

# ── 5. Compte de service CI/CD ────────────────────────────────────────────────
echo "👤 Création compte de service : $SA_NAME"
if ! gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT" &>/dev/null; then
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="HomePedia CI/CD (GitHub Actions)" \
    --project "$PROJECT"
  echo "✅ Compte de service créé"
else
  echo "ℹ️  Compte de service existe déjà"
fi

# Rôles nécessaires pour le CI/CD
echo "🔐 Attribution des rôles IAM..."
ROLES=(
  "roles/run.admin"                    # déployer sur Cloud Run
  "roles/artifactregistry.writer"      # pousser des images Docker
  "roles/bigquery.dataEditor"          # DBT peut créer des tables
  "roles/bigquery.jobUser"             # DBT peut lancer des jobs
  "roles/storage.objectAdmin"          # upload Parquet vers GCS
  "roles/secretmanager.secretAccessor" # lire les secrets
  "roles/iam.serviceAccountTokenCreator" # permettre le deploy Cloud Run
)

for ROLE in "${ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="$ROLE" \
    --condition=None \
    --quiet
done
echo "✅ Rôles IAM attribués"
echo ""

# ── 6. Secrets GCP Secret Manager ────────────────────────────────────────────
echo "🔑 Création des secrets GCP Secret Manager..."
echo "   (tu vas devoir entrer les vraies valeurs)"
echo ""

create_secret() {
  local NAME=$1
  local VALUE=$2
  if ! gcloud secrets describe "$NAME" --project="$PROJECT" &>/dev/null; then
    printf '%s' "$VALUE" | gcloud secrets create "$NAME" \
      --data-file=- \
      --project "$PROJECT"
    echo "  ✅ Secret créé : $NAME"
  else
    printf '%s' "$VALUE" | gcloud secrets versions add "$NAME" \
      --data-file=- \
      --project "$PROJECT"
    echo "  🔄 Secret mis à jour : $NAME"
  fi
}

# Le mot de passe n'est jamais écrit dans ce script : il est lu dans
# l'environnement, ou demandé interactivement s'il est absent.
if [ -z "${SUPABASE_PASSWORD:-}" ]; then
  read -rsp "Mot de passe Supabase : " SUPABASE_PASSWORD
  echo ""
fi
if [ -z "$SUPABASE_PASSWORD" ]; then
  echo "❌ SUPABASE_PASSWORD requis pour créer le secret." >&2
  exit 1
fi
create_secret "homepedia-supabase-password" "$SUPABASE_PASSWORD"
create_secret "homepedia-jwt-secret" "$(openssl rand -base64 32)"
echo "✅ Secrets créés"
echo ""

# ── 7. Alerte budget 5€ (protection contre les mauvaises surprises) ──────────
echo "💰 Configuration alerte budget 5€..."
# Nécessite d'avoir un compte de facturation lié au projet
BILLING_ACCOUNT=$(gcloud billing projects describe "$PROJECT" \
  --format='value(billingAccountName)' 2>/dev/null | sed 's|billingAccounts/||' || echo "")

if [ -n "$BILLING_ACCOUNT" ]; then
  # Crée un budget de 5€ avec alerte à 50% et 90%
  gcloud billing budgets create \
    --billing-account="$BILLING_ACCOUNT" \
    --display-name="HomePedia - Alerte 5€" \
    --budget-amount=5EUR \
    --threshold-rule=percent=50 \
    --threshold-rule=percent=90 \
    --threshold-rule=percent=100 \
    2>/dev/null || echo "  ℹ️  Budget déjà configuré ou API Billing Budget non activée"
  echo "  ✅ Alerte budget 5€ configurée"
else
  echo "  ⚠️  Pas de compte de facturation lié — configure manuellement :"
  echo "     GCP Console → Facturation → Budgets → Créer un budget → 5€"
fi
echo ""

# ── 8. Clé JSON pour GitHub Secrets ──────────────────────────────────────────
KEY_FILE="/tmp/homepedia-cicd-key.json"
echo "📥 Génération de la clé JSON du compte de service..."
gcloud iam service-accounts keys create "$KEY_FILE" \
  --iam-account="$SA_EMAIL" \
  --project "$PROJECT"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ SETUP TERMINÉ !"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "📋 ÉTAPE FINALE — Ajouter dans GitHub → Settings → Secrets :"
echo ""
echo "  1. GCP_SERVICE_ACCOUNT_KEY ="
cat "$KEY_FILE"
echo ""
echo "  (copie TOUT le JSON ci-dessus, y compris les accolades)"
echo ""
echo "  2. Optionnel — SUPABASE_PASSWORD (valeur dans Secret Manager)"
echo "     (si tu veux aussi pouvoir connecter localement)"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ⚠️  Supprime la clé locale après l'avoir copiée :"
echo "     rm $KEY_FILE"
echo "═══════════════════════════════════════════════════════════"
