#!/usr/bin/env bash
set -euo pipefail

# Sprint 2 Validation Script — oauth-flow CI/CD + IaC
# Validates build, tests, optional Docker build, and Terraform plan/apply.
# Usage:
#   ./validate_deliverable.sh [--apply] [--skip-cloud-build]
# or set APPLY=true in env to run terraform apply instead of plan.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

SPRINT_ID="sprint-2-b7c4a1"
SERVICE_NAME="oauth-flow"
REGION="us-central1"
PROJECT_ID="twitch-452523" # prod confirmed in prompt
REPO_NAME="bitbrat-services"

APPLY=${APPLY:-false}
SKIP_CB=false

while [[ ${1:-} ]]; do
  case "$1" in
    --apply) APPLY=true; shift ;;
    --skip-cloud-build) SKIP_CB=true; shift ;;
    -h|--help)
      sed -n '1,120p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

log() { echo "[$SPRINT_ID] $*"; }

# 1) Install dependencies
log "🔧 Installing dependencies (npm ci) ..."
npm ci

# 2) Compile TypeScript
log "🧱 Compiling (npm run build) ..."
npm run build

# 3) Run unit tests
log "🧪 Running tests (npm test) ..."
npm test -- --ci --reporters=default

# 4) Docker build (optional local check)
if command -v docker >/dev/null 2>&1; then
  log "🐳 Docker found — building service image locally ..."
  docker build -f Dockerfile.oauth-flow -t ${SERVICE_NAME}:validate .
else
  log "⚠️ Docker not installed — skipping local image build."
fi

# 5) Terraform validate/plan/apply (optional; runs only if prod overlay exists and terraform is available)
if [ -d "infrastructure/gcp/prod" ] && command -v terraform >/dev/null 2>&1; then
  log "🌍 Terraform found and prod overlay present — validating IaC ..."
  # Import pre-existing secrets so Terraform doesn't try to re-create them
  if [ -f "infrastructure/gcp/scripts/import-existing-secrets.sh" ]; then
    bash infrastructure/gcp/scripts/import-existing-secrets.sh --project-id "${PROJECT_ID}" --env-dir infrastructure/gcp/prod || true
  fi
  pushd infrastructure/gcp/prod >/dev/null
  terraform init -input=false -no-color
  terraform validate -no-color
  if [[ "$APPLY" == "true" ]]; then
    log "🚢 Running terraform apply for prod ..."
    terraform apply -no-color -auto-approve \
      -var="project_id=${PROJECT_ID}" \
      -var="region=${REGION}" || { log "❌ Terraform apply failed"; exit 1; }
  else
    log "📝 Running terraform plan for prod ..."
    terraform plan -input=false -lock=false -no-color \
      -var="project_id=${PROJECT_ID}" \
      -var="region=${REGION}" \
      -out=tfplan || { log "❌ Terraform plan failed"; exit 1; }
  fi
  popd >/dev/null
else
  log "ℹ️ Terraform or prod overlay missing — skipping IaC validation this run."
fi

# 6) Cloud Build submission (optional)
CB_CONFIG="cloudbuild.oauth-flow.yaml"
if [[ "$SKIP_CB" == "false" ]] && command -v gcloud >/dev/null 2>&1 && [ -f "$CB_CONFIG" ]; then
  if [[ "$APPLY" == "true" ]]; then
    log "🚀 Submitting Cloud Build with DRY_RUN=false to build/push image ..."
    gcloud builds submit --config "$CB_CONFIG" \
      --substitutions=_SERVICE_NAME=${SERVICE_NAME},_REGION=${REGION},_REPO_NAME=${REPO_NAME},_DRY_RUN=false \
      --project="${PROJECT_ID}"
  else
    log "🚀 Submitting Cloud Build with DRY_RUN=true (no deploy) ..."
    gcloud builds submit --config "$CB_CONFIG" \
      --substitutions=_SERVICE_NAME=${SERVICE_NAME},_REGION=${REGION},_REPO_NAME=${REPO_NAME},_DRY_RUN=true \
      --project="${PROJECT_ID}"
  fi
else
  log "ℹ️ Skipping Cloud Build submission."
fi

log "✅ Validation completed successfully."
