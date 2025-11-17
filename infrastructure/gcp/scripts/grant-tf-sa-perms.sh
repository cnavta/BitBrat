#!/usr/bin/env bash
set -euo pipefail

# Grants the required IAM roles to a Terraform Service Account so it can
# apply IaC for Artifact Registry, Cloud Run v2, Service Accounts, and Secret Manager.
#
# Required inputs:
#   -p|--project-id <PROJECT_ID>
#   -s|--tf-sa-email <TF_SA_EMAIL>     (e.g., terraform@PROJECT_ID.iam.gserviceaccount.com)
#
# Optional inputs:
#   --runtime-sa <RUNTIME_SA_EMAIL>     (e.g., run-oauth-flow@PROJECT_ID.iam.gserviceaccount.com)
#   --no-project-wide-sa-user           (only bind serviceAccountUser on the runtime SA if it exists)
#   --enable-apis                       (enable required GCP APIs)
#
# Example:
#   ./grant-tf-sa-perms.sh \
#     --project-id twitch-452523 \
#     --tf-sa-email terraform@twitch-452523.iam.gserviceaccount.com \
#     --runtime-sa run-oauth-flow@twitch-452523.iam.gserviceaccount.com \
#     --enable-apis

PROJECT_ID=""
TF_SA_EMAIL=""
RUNTIME_SA_EMAIL=""
PROJECT_WIDE_SAUSER=true
ENABLE_APIS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--project-id)
      PROJECT_ID="$2"; shift 2 ;;
    -s|--tf-sa-email)
      TF_SA_EMAIL="$2"; shift 2 ;;
    --runtime-sa)
      RUNTIME_SA_EMAIL="$2"; shift 2 ;;
    --no-project-wide-sa-user)
      PROJECT_WIDE_SAUSER=false; shift 1 ;;
    --enable-apis)
      ENABLE_APIS=true; shift 1 ;;
    -h|--help)
      sed -n '1,100p' "$0"; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$PROJECT_ID" || -z "$TF_SA_EMAIL" ]]; then
  echo "ERROR: --project-id and --tf-sa-email are required" >&2
  exit 1
fi

TF_MEMBER="serviceAccount:${TF_SA_EMAIL}"

log() { echo "[grant-tf-sa-perms] $*"; }

enable_apis() {
  local apis=(
    run.googleapis.com
    artifactregistry.googleapis.com
    secretmanager.googleapis.com
    iam.googleapis.com
    cloudbuild.googleapis.com
    serviceusage.googleapis.com
  )
  for api in "${apis[@]}"; do
    log "Enabling API: ${api}"
    gcloud services enable "${api}" --project="${PROJECT_ID}" --quiet || true
  done
}

bind_project_role() {
  local role="$1"
  log "Granting ${role} to ${TF_MEMBER} on project ${PROJECT_ID}"
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="${TF_MEMBER}" --role="${role}" --quiet >/dev/null
}

bind_sa_user_on_runtime() {
  local sa_email="$1"
  if [[ -z "$sa_email" ]]; then
    log "No runtime SA provided; skipping resource-scoped serviceAccountUser on runtime SA."
    return 0
  fi
  # Verify existence (do not create here to avoid drift with Terraform)
  if gcloud iam service-accounts describe "$sa_email" --project="$PROJECT_ID" >/dev/null 2>&1; then
    log "Granting roles/iam.serviceAccountUser on ${sa_email} to ${TF_MEMBER}"
    gcloud iam service-accounts add-iam-policy-binding "$sa_email" \
      --member="${TF_MEMBER}" --role="roles/iam.serviceAccountUser" --quiet >/dev/null
  else
    log "Runtime SA ${sa_email} not found; skipping resource-scoped binding."
  fi
}

if [[ "$ENABLE_APIS" == true ]]; then
  enable_apis
fi

# Minimal roles required for this sprint
bind_project_role roles/run.admin
bind_project_role roles/artifactregistry.admin
bind_project_role roles/iam.serviceAccountAdmin
bind_project_role roles/resourcemanager.projectIamAdmin
# Secret Manager admin role intentionally NOT granted per security policy
# bind_project_role roles/secretmanager.admin
bind_project_role roles/serviceusage.serviceUsageAdmin

# Allow Terraform SA to act as service accounts
if [[ "$PROJECT_WIDE_SAUSER" == true ]]; then
  bind_project_role roles/iam.serviceAccountUser
else
  bind_sa_user_on_runtime "$RUNTIME_SA_EMAIL"
fi

log "✅ All bindings applied for ${TF_SA_EMAIL} on project ${PROJECT_ID}."