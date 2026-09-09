#!/bin/sh
#
# Example: Docker Hub Authentication
# Hook Type: pre-deploy
# Purpose: Authenticate to Docker Hub before pulling private images
#
# Environment Variables Required:
# - DOCKER_HUB_USERNAME: Docker Hub username
# - DOCKER_HUB_TOKEN: Docker Hub access token (not password!)
#
# Usage:
# 1. Create access token at https://hub.docker.com/settings/security
# 2. Store credentials in .secure.{context}/.env:
#    DOCKER_HUB_USERNAME=myusername
#    DOCKER_HUB_TOKEN=dckr_pat_xxxxxxxxxxxxx
# 3. Configure in architecture.yaml:
#    executionContexts:
#      staging:
#        deployment:
#          hooks:
#            pre-deploy: .brat/hooks/examples/pre-deploy-docker-hub-auth.sh
#

set -e
set -u

log() {
  echo "[docker-hub-auth] $*"
}

log "Authenticating to Docker Hub..."

# Check required environment variables
if [ -z "${DOCKER_HUB_USERNAME:-}" ]; then
  log "ERROR: DOCKER_HUB_USERNAME not set"
  log "Add to .secure.${BRAT_CONTEXT_NAME}/.env"
  exit 1
fi

if [ -z "${DOCKER_HUB_TOKEN:-}" ]; then
  log "ERROR: DOCKER_HUB_TOKEN not set"
  log "Add to .secure.${BRAT_CONTEXT_NAME}/.env"
  log "Generate token at https://hub.docker.com/settings/security"
  exit 1
fi

# Authenticate using token (more secure than password)
echo "${DOCKER_HUB_TOKEN}" | docker login -u "${DOCKER_HUB_USERNAME}" --password-stdin

log "✓ Successfully authenticated to Docker Hub"
exit 0
