#!/bin/bash
#
# Example: Post-Deploy Health Check
# Hook Type: post-deploy
# Purpose: Verify service health after deployment
#
# Environment Variables Available:
# - BRAT_CONTEXT_NAME: Execution context name
# - BRAT_SERVICES: Space-separated service names deployed
# - BRAT_TARGET_HOST: Remote Docker host (if remote)
# - BRAT_REMOTE_DIR: Remote deployment directory (if remote)
#
# Note: This hook runs AFTER containers start, so failures do NOT abort deployment.
#       Use for verification, notifications, and logging only.
#
# Usage:
# Configure in architecture.yaml:
#   executionContexts:
#     staging:
#       deployment:
#         hooks:
#           post-deploy: .brat/hooks/examples/post-deploy-health-check.sh
#

set -e
set -u

log() {
  echo "[health-check] $*"
}

log "Running post-deployment health checks..."
log "Services deployed: ${BRAT_SERVICES}"

# Parse service names
IFS=' ' read -r -a services <<< "${BRAT_SERVICES}"

# Health check timeout (seconds)
TIMEOUT=30
RETRY_INTERVAL=2

# Function to check if container is running
check_container_running() {
  local service=$1
  local container_name="bitbrat-${BRAT_CONTEXT_NAME}-${service}"

  if docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
    return 0
  else
    return 1
  fi
}

# Function to check container health
check_container_health() {
  local service=$1
  local container_name="bitbrat-${BRAT_CONTEXT_NAME}-${service}"

  # Get container health status (if healthcheck defined)
  local health_status
  health_status=$(docker inspect --format='{{.State.Health.Status}}' "${container_name}" 2>/dev/null || echo "none")

  if [ "${health_status}" = "healthy" ]; then
    return 0
  elif [ "${health_status}" = "none" ]; then
    # No healthcheck defined, check if running
    if check_container_running "${service}"; then
      return 0
    fi
  fi

  return 1
}

# Check each service
failed_services=()
for service in "${services[@]}"; do
  log "Checking ${service}..."

  elapsed=0
  healthy=false

  while [ $elapsed -lt $TIMEOUT ]; do
    if check_container_health "${service}"; then
      log "✓ ${service} is healthy"
      healthy=true
      break
    fi

    sleep $RETRY_INTERVAL
    elapsed=$((elapsed + RETRY_INTERVAL))
  done

  if [ "$healthy" = false ]; then
    log "✗ ${service} failed health check (timeout after ${TIMEOUT}s)"
    failed_services+=("${service}")
  fi
done

# Report results
if [ ${#failed_services[@]} -eq 0 ]; then
  log "✓ All services passed health checks"
  exit 0
else
  log "✗ Health check failed for: ${failed_services[*]}"
  log "Deployment succeeded but some services may not be healthy"
  log "Check logs with: docker logs bitbrat-${BRAT_CONTEXT_NAME}-<service>"
  # Don't exit 1 - post-deploy failures don't abort deployment
  exit 0
fi
