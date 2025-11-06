#!/usr/bin/env bash
set -euo pipefail

# BitBrat — Local deployment entrypoint (Compose + config merge)
# Usage:
#   npm run local               # build + up + health probe
#   npm run local -- --down     # tear down stack
#   npm run local -- --dry-run  # print actions only
#   npm run local -- --env prod # use env/prod instead of env/local

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${SCRIPT_DIR%/infrastructure}"
# Enforce running from repo root
if [[ "$PWD" != "$REPO_ROOT" || ! -f "package.json" || ! -f "architecture.yaml" ]]; then
  echo "[deploy-local] Error: please run this command from the repository root (where package.json and architecture.yaml reside)." >&2
  exit 2
fi
ENV_NAME="local"
DRY_RUN="false"
DO_DOWN="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --down) DO_DOWN="true"; shift ;;
    --dry-run) DRY_RUN="true"; shift ;;
    --env) ENV_NAME="${2:-local}"; shift 2 ;;
    *) echo "[deploy-local] Unknown arg: $1"; exit 2 ;;
  esac
done

compose() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "+ docker compose --project-directory . $*"
  else
    docker compose --project-directory . "$@"
  fi
}

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "+ $*"
  else
    eval "$@"
  fi
}

cd "$REPO_ROOT"

# Ensure Node dependencies (for merge script + tests)
if [[ ! -d node_modules ]]; then
  run npm ci
fi

# Generate .env.local from env YAMLs + .secure.local
run node infrastructure/scripts/merge-env.js "$ENV_NAME"

if [[ "$DO_DOWN" == "true" ]]; then
  compose \
    -f infrastructure/docker-compose/docker-compose.local.yaml \
    -f infrastructure/docker-compose/services/oauth-flow.compose.yaml \
    --env-file ./.env.local \
    down
  echo "[deploy-local] Stack brought down."
  exit 0
fi

# Sanity and validation for ADC secret mapping (host path for compose substitution)
GC_LINE="$(grep '^GOOGLE_APPLICATION_CREDENTIALS=' .env.local || true)"
if [[ -z "$GC_LINE" ]]; then
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[deploy-local] DRY RUN: GOOGLE_APPLICATION_CREDENTIALS missing from .env.local (would fail in real run)."
  else
    echo "[deploy-local] ERROR: GOOGLE_APPLICATION_CREDENTIALS not found in .env.local."
    echo "  Add a line to .secure.local: GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/sa-key.json"
    echo "  Notes: absolute path only (no ~), no quotes, no 'export', avoid spaces."
    exit 1
  fi
fi
GC_PATH="${GC_LINE#GOOGLE_APPLICATION_CREDENTIALS=}"
# Basic normalization: trim whitespace
GC_PATH="${GC_PATH#${GC_PATH%%[![:space:]]*}}"
GC_PATH="${GC_PATH%${GC_PATH##*[![:space:]]}}"
if [[ -n "${GC_PATH:-}" ]]; then
  if [[ "$GC_PATH" != /* ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "[deploy-local] DRY RUN: GOOGLE_APPLICATION_CREDENTIALS must be absolute; got '$GC_PATH'."
    else
      echo "[deploy-local] ERROR: GOOGLE_APPLICATION_CREDENTIALS must be an absolute path; got '$GC_PATH'."
      exit 1
    fi
  fi
  if [[ "$GC_PATH" == *" "* ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "[deploy-local] DRY RUN: Path contains spaces; Docker bind mounts may fail: '$GC_PATH'."
    else
      echo "[deploy-local] ERROR: GOOGLE_APPLICATION_CREDENTIALS path contains spaces, which breaks Compose volume mounts."
      echo "  Move/rename the key to a path without spaces and update .secure.local."
      exit 1
    fi
  fi
  if [[ ! -f "$GC_PATH" ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "[deploy-local] DRY RUN: File not found at GOOGLE_APPLICATION_CREDENTIALS='$GC_PATH' (would fail)."
    else
      echo "[deploy-local] ERROR: File not found at GOOGLE_APPLICATION_CREDENTIALS='$GC_PATH'."
      exit 1
    fi
  fi
  echo "[deploy-local] Using ADC key: $GC_PATH"
fi

# Verify Dockerfile exists at repo root and log build settings
if [[ ! -f "Dockerfile.oauth-flow" ]]; then
  echo "[deploy-local] ERROR: Expected Dockerfile.oauth-flow at repo root but not found." >&2
  exit 1
fi
echo "[deploy-local] Build context: . ; Dockerfile: Dockerfile.oauth-flow"

# Determine host port for oauth-flow and ensure it's available
PORT_LINE="$(grep '^OAUTH_FLOW_HOST_PORT=' .env.local || true)"
HOST_PORT="${PORT_LINE#OAUTH_FLOW_HOST_PORT=}"
if [[ -z "$HOST_PORT" ]]; then HOST_PORT="3001"; fi

# Preflight: check if HOST_PORT is already in use on localhost
if [[ "$DRY_RUN" == "false" ]]; then
  IN_USE=0
  if command -v lsof >/dev/null 2>&1; then
    if lsof -iTCP -sTCP:LISTEN -n -P | grep -E ":${HOST_PORT} .*LISTEN" >/dev/null 2>&1; then IN_USE=1; fi
  elif command -v netstat >/dev/null 2>&1; then
    if netstat -an | grep LISTEN | grep -E "\.${HOST_PORT} |:${HOST_PORT} " >/dev/null 2>&1; then IN_USE=1; fi
  elif command -v nc >/dev/null 2>&1; then
    if nc -z localhost "$HOST_PORT" >/dev/null 2>&1; then IN_USE=1; fi
  fi
  if [[ $IN_USE -eq 1 ]]; then
    echo "[deploy-local] ERROR: Host port ${HOST_PORT} is already in use."
    echo "  To change it, set OAUTH_FLOW_HOST_PORT in env/local/oauth-flow.yaml or override in .secure.local, then rerun."
    exit 1
  fi
fi

# Preflight: validate compose configuration and env file resolution
compose \
  -f infrastructure/docker-compose/docker-compose.local.yaml \
  -f infrastructure/docker-compose/services/oauth-flow.compose.yaml \
  --env-file ./.env.local \
  config >/dev/null

# Bring up infra + service (build as needed)
compose \
  -f infrastructure/docker-compose/docker-compose.local.yaml \
  -f infrastructure/docker-compose/services/oauth-flow.compose.yaml \
  --env-file ./.env.local \
  up -d --build

# Health probe oauth-flow
if [[ "$DRY_RUN" == "false" ]]; then
  echo "[deploy-local] Probing http://localhost:${HOST_PORT}/healthz ..."
  for i in {1..30}; do
    if curl -sf "http://localhost:${HOST_PORT}/healthz" >/dev/null; then
      echo "[deploy-local] oauth-flow healthy on port ${HOST_PORT}."
      break
    fi
    sleep 2
  done
fi

echo "[deploy-local] Done. Use 'npm run local:down' to stop services."
