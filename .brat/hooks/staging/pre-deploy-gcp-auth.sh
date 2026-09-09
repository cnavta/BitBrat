#!/bin/sh
#
# Pre-Deploy GCP Authentication Hook (Staging)
# Sprint 15: Deployment Lifecycle Hooks
#
# Purpose: Authenticate Docker to Google Artifact Registry before deployment
# Execution Context: Remote machine (on bitbrat.lan before deployment operations begin)
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
# Authentication Strategy:
# - Remote deployments: Use docker login with access token from local machine
# - Local deployments: Use gcloud auth configure-docker (requires gcloud CLI)
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

# Check if gcloud is available (indicates local deployment)
if command -v gcloud >/dev/null 2>&1; then
  log "gcloud CLI detected - using gcloud auth configure-docker"

  if ! gcloud auth configure-docker "${GCP_REGISTRY}" --quiet; then
    log "ERROR: Failed to configure Docker for Artifact Registry"
    log "Ensure you have run: gcloud auth application-default login"
    log "Or set GOOGLE_APPLICATION_CREDENTIALS to a valid service account key"
    exit 1
  fi

  log "✓ Successfully authenticated to ${GCP_REGISTRY}"
else
  log "gcloud CLI not found - using docker login with access token"

  # For remote deployments, we expect GCP_ACCESS_TOKEN to be provided via environment
  # The token should be generated on the local machine and passed to the remote hook
  if [ -z "${GCP_ACCESS_TOKEN:-}" ]; then
    log "ERROR: GCP_ACCESS_TOKEN environment variable not set"
    log "For remote deployments without gcloud, you must provide an access token"
    log "Generate token locally with: gcloud auth print-access-token"
    log "Then pass it to the remote hook via GCP_ACCESS_TOKEN environment variable"
    exit 1
  fi

  log "Using provided access token to authenticate Docker"

  # Use docker login with access token
  # Username is always 'oauth2accesstoken' for GCP
  if ! echo "${GCP_ACCESS_TOKEN}" | docker login -u oauth2accesstoken --password-stdin "https://${GCP_REGISTRY}"; then
    log "ERROR: Failed to authenticate Docker with access token"
    log "Verify the token is valid: gcloud auth print-access-token"
    exit 1
  fi

  log "✓ Successfully authenticated to ${GCP_REGISTRY} via docker login"
fi

log "Docker can now pull images from ${GCP_REGISTRY}/${GCP_PROJECT}"

# Verify authentication by checking Docker config
if grep -q "${GCP_REGISTRY}" ~/.docker/config.json 2>/dev/null; then
  log "✓ Docker config updated successfully"
else
  log "WARNING: Could not verify Docker config update"
fi

log "Pre-deploy hook completed successfully"
exit 0
