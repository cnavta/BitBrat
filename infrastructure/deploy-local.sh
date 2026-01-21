#!/usr/bin/env bash
set -euo pipefail

# BitBrat — Local deployment entrypoint (Compose + config merge)
# Usage:
#   npm run local                                 # build + up + health probe (ALL services by default)
#   npm run local -- --service-name ingress-egress # target a specific service
#   npm run local -- --down                        # tear down stack (all or specific)
#   npm run local:logs                             # view logs for all services
#   npm run local:logs -- --service-name auth      # view logs for a specific service
#   npm run local -- --dry-run                     # print actions only
#   npm run local -- --env prod                    # use env/prod instead of env/local

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
DO_LOGS="false"
SERVICE_NAME=""
SERVICE_SET="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --down) DO_DOWN="true"; shift ;;
    --logs) DO_LOGS="true"; shift ;;
    --dry-run) DRY_RUN="true"; shift ;;
    --env) ENV_NAME="${2:-local}"; shift 2 ;;
    --service-name) SERVICE_NAME="${2:-oauth-flow}"; SERVICE_SET="true"; shift 2 ;;
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

# Ensure bitbrat-network exists (pre-flight)
# If it exists but lacks the expected label, we might need to recreate it or just warn.
# The most robust local fix is to recreate it if it lacks the com.docker.compose.network label.
if docker network inspect bitbrat-network >/dev/null 2>&1; then
  HAS_LABEL=$(docker network inspect bitbrat-network --format '{{index .Labels "com.docker.compose.network"}}')
  if [[ "$HAS_LABEL" != "bitbrat-network" ]]; then
    echo "[deploy-local] WARNING: bitbrat-network exists but has incorrect labels. Recreating..."
    docker network rm bitbrat-network || true
  fi
fi

if ! docker network inspect bitbrat-network >/dev/null 2>&1; then
  echo "[deploy-local] Creating bitbrat-network with correct labels..."
  docker network create \
    --driver bridge \
    --attachable \
    --label "com.docker.compose.network=bitbrat-network" \
    bitbrat-network
fi

# Generate .env.local from env YAMLs + .secure.local
run node infrastructure/scripts/merge-env.js "$ENV_NAME"

# If no specific service was provided, deploy ALL services
if [[ "$SERVICE_SET" == "false" || -z "${SERVICE_NAME:-}" ]]; then
  BASE_COMPOSE="infrastructure/docker-compose/docker-compose.local.yaml"
  SERVICE_FILES=()
  if [[ -d "infrastructure/docker-compose/services" ]]; then
    while IFS= read -r -d '' f; do
      SERVICE_FILES+=("$f")
    done < <(find infrastructure/docker-compose/services -maxdepth 1 -name '*.compose.yaml' -print0 | sort -z)
  fi
  if [[ ${#SERVICE_FILES[@]} -eq 0 ]]; then
    echo "[deploy-local] ERROR: No per-service compose files found under infrastructure/docker-compose/services." >&2
    exit 1
  fi

  # Preflight: validate compose configuration for all services
  compose_args=(-f "$BASE_COMPOSE")
  for f in "${SERVICE_FILES[@]}"; do compose_args+=(-f "$f"); done

  # Build port assignments and auto-resolve collisions when HOST_PORT not explicitly set
  PORTS=()
  SVCS=()
  EXPLICIT=() # 1 if port explicitly set in .env.local, else 0
  OVERRIDE_SVCS=()
  OVERRIDE_PORTS=()
  USED=()

  next_free_port=3001
  for f in "${SERVICE_FILES[@]}"; do
    base="$(basename "$f")"; svc="${base%.compose.yaml}"
    upper="$(echo "$svc" | tr '[:lower:]' '[:upper:]' | sed -e 's/[^A-Z0-9]/_/g')"
    port_var="${upper}_HOST_PORT"
    line="$(grep "^${port_var}=" .env.local || true)"
    host_port="${line#${port_var}=}"
    is_explicit=0
    if [[ -n "$line" ]]; then is_explicit=1; fi

    # If not explicit, tentatively assign default 3001 and adjust later
    if [[ -z "$host_port" ]]; then host_port="3001"; fi

    # Check for collision with previously reserved ports
    found_index=-1
    for i in "${!PORTS[@]}"; do
      if [[ "${PORTS[$i]}" == "$host_port" ]]; then found_index=$i; break; fi
    done
    if [[ $found_index -ge 0 ]]; then
      prev_explicit=${EXPLICIT[$found_index]:-0}
      curr_explicit=$is_explicit
      if [[ $prev_explicit -eq 1 && $curr_explicit -eq 1 ]]; then
        # Both explicit → cannot auto-resolve; error (unless dry-run)
        echo "[deploy-local] ERROR: Host port collision detected: ${host_port} used by '${SVCS[$found_index]}' and '${svc}'." >&2
        echo "  Set unique ${port_var} values in env/${ENV_NAME}/${svc}.yaml or override in .secure.local."
        if [[ "$DRY_RUN" == "false" ]]; then
          exit 1
        else
          echo "[deploy-local] DRY RUN: would fail due to explicit collision." >&2
        fi
      elif [[ $prev_explicit -eq 1 && $curr_explicit -eq 0 ]]; then
        # Previous explicit, current implicit → auto-assign current
        while :; do
          candidate="$next_free_port"
          used_conflict=0
          for j in "${!USED[@]}"; do if [[ "${USED[$j]}" == "$candidate" ]]; then used_conflict=1; break; fi; done
          for j in "${!PORTS[@]}"; do if [[ "${PORTS[$j]}" == "$candidate" ]]; then used_conflict=1; break; fi; done
          if [[ $used_conflict -eq 0 ]]; then break; fi
          next_free_port=$((next_free_port+1))
        done
        host_port="$candidate"
        OVERRIDE_SVCS+=("$svc"); OVERRIDE_PORTS+=("$host_port"); USED+=("$host_port")
        next_free_port=$((host_port+1))
      elif [[ $prev_explicit -eq 0 && $curr_explicit -eq 1 ]]; then
        # Previous implicit, current explicit → reassign previous
        while :; do
          candidate="$next_free_port"
          used_conflict=0
          for j in "${!USED[@]}"; do if [[ "${USED[$j]}" == "$candidate" ]]; then used_conflict=1; break; fi; done
          for j in "${!PORTS[@]}"; do if [[ "${PORTS[$j]}" == "$candidate" ]]; then used_conflict=1; break; fi; done
          if [[ $used_conflict -eq 0 ]]; then break; fi
          next_free_port=$((next_free_port+1))
        done
        prev_svc="${SVCS[$found_index]}"
        OVERRIDE_SVCS+=("$prev_svc"); OVERRIDE_PORTS+=("$candidate"); USED+=("$candidate")
        PORTS[$found_index]="$candidate"
        next_free_port=$((candidate+1))
        # current keeps its explicit host_port
      else
        # Both implicit → auto-assign current
        while :; do
          candidate="$next_free_port"
          used_conflict=0
          for j in "${!USED[@]}"; do if [[ "${USED[$j]}" == "$candidate" ]]; then used_conflict=1; break; fi; done
          for j in "${!PORTS[@]}"; do if [[ "${PORTS[$j]}" == "$candidate" ]]; then used_conflict=1; break; fi; done
          if [[ $used_conflict -eq 0 ]]; then break; fi
          next_free_port=$((next_free_port+1))
        done
        host_port="$candidate"
        OVERRIDE_SVCS+=("$svc"); OVERRIDE_PORTS+=("$host_port"); USED+=("$host_port")
        next_free_port=$((host_port+1))
      fi
    else
      USED+=("$host_port")
    fi

    PORTS+=("$host_port"); SVCS+=("$svc"); EXPLICIT+=("$is_explicit")
  done

  # Prepare env-file args: always include .env.local, and if overrides exist, include a temp env file last
  ENV_FILE_ARGS=(--env-file ./.env.local)
  ENV_OVR_FILE=""
  if [[ ${#OVERRIDE_SVCS[@]} -gt 0 ]]; then
    ENV_OVR_FILE="$(mktemp -t bitbrat-env-overrides.XXXXXX)"
    trap '[[ -n "$ENV_OVR_FILE" && -f "$ENV_OVR_FILE" ]] && rm -f "$ENV_OVR_FILE"' EXIT
    {
      for k in "${!OVERRIDE_SVCS[@]}"; do
        svc="${OVERRIDE_SVCS[$k]}"; port="${OVERRIDE_PORTS[$k]}"
        upper="$(echo "$svc" | tr '[:lower:]' '[:upper:]' | sed -e 's/[^A-Z0-9]/_/g')"
        echo "${upper}_HOST_PORT=${port}"
        echo "[deploy-local] Auto-assigned ${upper}_HOST_PORT=${port}" >&2
      done
    } > "$ENV_OVR_FILE"
    ENV_FILE_ARGS+=(--env-file "$ENV_OVR_FILE")
  fi

  # Validate compose configuration for all services using the selected env files
  compose "${compose_args[@]}" "${ENV_FILE_ARGS[@]}" config >/dev/null

  if [[ "$DO_DOWN" == "true" ]]; then
    compose "${compose_args[@]}" "${ENV_FILE_ARGS[@]}" down
    echo "[deploy-local] Stack brought down for ALL services."
    exit 0
  fi

  if [[ "$DO_LOGS" == "true" ]]; then
    compose "${compose_args[@]}" "${ENV_FILE_ARGS[@]}" logs -f
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


  # Bring up infra + all services (build as needed)
  compose "${compose_args[@]}" "${ENV_FILE_ARGS[@]}" up -d --build

  # Health probe each service (prefer override port when present)
  if [[ "$DRY_RUN" == "false" ]]; then
    for f in "${SERVICE_FILES[@]}"; do
      base="$(basename "$f")"; svc="${base%.compose.yaml}"
      # Check override first
      host_port=""
      for k in "${!OVERRIDE_SVCS[@]}"; do if [[ "${OVERRIDE_SVCS[$k]}" == "$svc" ]]; then host_port="${OVERRIDE_PORTS[$k]}"; fi; done
      if [[ -z "$host_port" ]]; then
        upper="$(echo "$svc" | tr '[:lower:]' '[:upper:]' | sed -e 's/[^A-Z0-9]/_/g')"
        port_var="${upper}_HOST_PORT"
        line="$(grep "^${port_var}=" .env.local || true)"
        host_port="${line#${port_var}=}"
        if [[ -z "$host_port" ]]; then host_port="3001"; fi
      fi
      echo "[deploy-local] Probing http://localhost:${host_port}/healthz for ${svc} ..."
      for i in {1..30}; do
        if curl -sf "http://localhost:${host_port}/healthz" >/dev/null; then
          echo "[deploy-local] ${svc} healthy on port ${host_port}."
          break
        fi
        sleep 2
      done
    done
  fi

  echo "[deploy-local] Done. Use 'npm run local:down' to stop all services, or '-- --service-name <name>' to target one."
  exit 0
fi

# Derive kebab-case and compose file path for the selected service
SERVICE_KEBAB="${SERVICE_NAME//_/-}"
SERVICE_COMPOSE_FILE="infrastructure/docker-compose/services/${SERVICE_KEBAB}.compose.yaml"
DOCKERFILE_PATH="Dockerfile.${SERVICE_KEBAB}"

if [[ "$DO_DOWN" == "true" ]]; then
  compose \
    -f infrastructure/docker-compose/docker-compose.local.yaml \
    -f "$SERVICE_COMPOSE_FILE" \
    --env-file ./.env.local \
    down
  echo "[deploy-local] Stack brought down for service ${SERVICE_NAME}."
  exit 0
fi

if [[ "$DO_LOGS" == "true" ]]; then
  compose \
    -f infrastructure/docker-compose/docker-compose.local.yaml \
    -f "$SERVICE_COMPOSE_FILE" \
    --env-file ./.env.local \
    logs -f "$SERVICE_KEBAB"
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

# Derive kebab-case and upper-snake variants of the service name
SERVICE_KEBAB="${SERVICE_NAME//_/-}"
SERVICE_COMPOSE_FILE="infrastructure/docker-compose/services/${SERVICE_KEBAB}.compose.yaml"
DOCKERFILE_PATH="Dockerfile.${SERVICE_KEBAB}"

# Verify Dockerfile exists at repo root and log build settings
if [[ ! -f "$DOCKERFILE_PATH" ]]; then
  echo "[deploy-local] ERROR: Expected $DOCKERFILE_PATH at repo root but not found." >&2
  echo "  You can generate it via: npm run bootstrap:service -- --name ${SERVICE_NAME}"
  exit 1
fi
echo "[deploy-local] Build context: . ; Dockerfile: $DOCKERFILE_PATH"

# Determine host port env var name for selected service and ensure it's available
# Env var pattern: <UPPER_SNAKE>_HOST_PORT
UPPER_SNAKE="$(echo "$SERVICE_NAME" | tr '[:lower:]' '[:upper:]' | sed -e 's/[^A-Z0-9]/_/g')"
PORT_VAR="${UPPER_SNAKE}_HOST_PORT"
PORT_LINE="$(grep "^${PORT_VAR}=" .env.local || true)"
HOST_PORT="${PORT_LINE#${PORT_VAR}=}"
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
    echo "  To change it, set ${PORT_VAR} in env/${ENV_NAME}/${SERVICE_KEBAB}.yaml or override in .secure.local, then rerun."
    exit 1
  fi
fi

# Preflight: validate compose configuration and env file resolution
compose \
  -f infrastructure/docker-compose/docker-compose.local.yaml \
  -f "$SERVICE_COMPOSE_FILE" \
  --env-file ./.env.local \
  config >/dev/null


# Bring up infra + service (build as needed)
compose \
  -f infrastructure/docker-compose/docker-compose.local.yaml \
  -f "$SERVICE_COMPOSE_FILE" \
  --env-file ./.env.local \
  up -d --build

# Health probe selected service
if [[ "$DRY_RUN" == "false" ]]; then
  echo "[deploy-local] Probing http://localhost:${HOST_PORT}/healthz for ${SERVICE_NAME} ..."
  for i in {1..30}; do
    if curl -sf "http://localhost:${HOST_PORT}/healthz" >/dev/null; then
      echo "[deploy-local] ${SERVICE_NAME} healthy on port ${HOST_PORT}."
      break
    fi
    sleep 2
  done
fi

echo "[deploy-local] Done. Use 'npm run local:down -- --service-name ${SERVICE_NAME}' to stop the service."
