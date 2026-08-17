#!/bin/bash
#
# Pre-Deploy GCP Authentication Hook (Staging)
# Sprint 15: Deployment Lifecycle Hooks
#
# Purpose: Authenticate Docker to Google Artifact Registry before deployment
# Execution Context: Local machine (before deployment operations begin)
# Target: Staging environment (remote Docker daemon at bitbrat.lan)
#
# Environment Variables Available:
# - BRAT_CONTEXT_NAME: Execution context name (e.g., "staging")
# - BRAT_DEPLOYMENT_TYPE: Deployment type (e.g., "docker-compose")
# - BRAT_TARGET_HOST: Remote Docker host (e.g., "ssh://root@bitbrat.lan")
# - BRAT_REMOTE_DIR: Remote deployment directory (e.g., "/opt/bitbrat-staging")
# - BRAT_SERVICES: Space-separated service names being deployed
# - BRAT_REPO_ROOT: Repository root directory
#

set -e  # Exit on error
set -u  # Exit on undefined variable

# Log function
log() {
  echo "[pre-deploy-gcp-auth] $*"
}

log "Starting GCP Artifact Registry authentication for staging deployment"
log "Context: ${BRAT_CONTEXT_NAME}"
log "Services: ${BRAT_SERVICES}"
log "Target: ${BRAT_TARGET_HOST:-local}"

# GCP Project and Region (Artifact Registry location)
GCP_PROJECT="bitbrat-dev"
GCP_REGION="us-central1"
GCP_REGISTRY="${GCP_REGION}-docker.pkg.dev"

# Authenticate Docker to Artifact Registry
# Uses Application Default Credentials (gcloud auth application-default login)
# or GOOGLE_APPLICATION_CREDENTIALS service account key
log "Authenticating to ${GCP_REGISTRY}..."

if ! gcloud auth configure-docker "${GCP_REGISTRY}" --quiet; then
  log "ERROR: Failed to configure Docker for Artifact Registry"
  log "Ensure you have run: gcloud auth application-default login"
  log "Or set GOOGLE_APPLICATION_CREDENTIALS to a valid service account key"
  exit 1
fi

log "✓ Successfully authenticated to ${GCP_REGISTRY}"
log "Docker can now pull images from ${GCP_REGISTRY}/${GCP_PROJECT}"

# Verify authentication by checking Docker config
if grep -q "${GCP_REGISTRY}" ~/.docker/config.json 2>/dev/null; then
  log "✓ Docker config updated successfully"
else
  log "WARNING: Could not verify Docker config update"
fi

log "Pre-deploy hook completed successfully"
exit 0
