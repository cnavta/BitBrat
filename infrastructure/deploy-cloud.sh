#!/usr/bin/env bash
set -euo pipefail

# BitBrat — Single entrypoint for cloud deploys
# Orchestrates IaC for oauth-flow: secret adoption + Terraform init/validate/plan/apply
# Also supports optional Cloud Build trigger creation and deletion-protection fix.
#
# Defaults align with Sprint 2 (prod): project=twitch-452523, region=us-central1.
# You can override via flags or env vars.
#
# Usage examples:
#   ./infrastructure/deploy-cloud.sh --dry-run                    # plan only (no side effects)
#   ./infrastructure/deploy-cloud.sh --apply                      # apply prod IaC
#   ./infrastructure/deploy-cloud.sh --apply --fix-deletion-protection
#   ./infrastructure/deploy-cloud.sh --create-trigger \
#     --github-connection github-connection --github-repo cnavta/BitBrat --branch main
#
# Flags:
#   --project-id <ID>            GCP project ID (default: twitch-452523)
#   --region <REGION>            Region (default: us-central1)
#   --env-dir <PATH>             Terraform overlay dir (default: infrastructure/gcp/prod)
#   --apply                      Run terraform apply (default: plan)
#   --dry-run                    No side effects; still runs terraform plan
#   --skip-secret-import         Skip adopting existing secrets into TF state
#   --fix-deletion-protection    Run helper to untaint Cloud Run + update deletion_protection
#   --create-trigger             Create Cloud Build trigger (GitHub App connection recommended)
#   --github-connection <NAME>   Cloud Build GitHub connection name (for --create-trigger)
#   --github-repo <REPO>         Repo identifier within connection (e.g., cnavta/BitBrat)
#   --branch <BRANCH>            Branch name or regex (default: main)
#   --build-sa <EMAIL>           Trigger service account (default: cloud-build-bb@${PROJECT_ID}.iam.gserviceaccount.com)
#   --cb-location <LOCATION>     Cloud Build connections location (default: global)
#   --build-image                Force build & push container image via Cloud Build before Terraform
#   --skip-build                 Skip image build/push step even on --apply
#   --service-name <NAME>        Service name for image tags/substitutions (default: oauth-flow)
#   --repo-name <NAME>           Artifact Registry repo name (default: bitbrat-services)
#   --cb-config <PATH>           Cloud Build config file (default: cloudbuild.oauth-flow.yaml)
#   --cb-dry-run <true|false>    Pass-through for _DRY_RUN substitution in Cloud Build (default: true)
#   --dockerfile <PATH>          Dockerfile to use for build (default: Dockerfile.<service> if present, else Dockerfile.oauth-flow)
#   --env <NAME>                 Environment folder under env/ to load variables from (default: prod or $BITBRAT_ENV)
#   --max-concurrency <N>        Max concurrent service builds/deploys in multi-service mode (default from architecture.yaml)
#   -h|--help                    Show this help

# Enforce running from repo root
if [[ ! -f "package.json" || ! -f "architecture.yaml" ]]; then
  echo "[deploy-cloud] Error: please run this command from the repository root (where package.json and architecture.yaml reside)." >&2
  exit 2
fi

PROJECT_ID=${PROJECT_ID:-twitch-452523}
REGION=${REGION:-us-central1}
ENV_DIR=${ENV_DIR:-infrastructure/gcp/prod}
APPLY=false
DRY_RUN=false
SKIP_SECRET_IMPORT=false
FIX_DELETION=false
CREATE_TRIGGER=false
GITHUB_CONNECTION=""
GITHUB_REPO=""
BRANCH="main"
CB_LOCATION="global"
BUILD_SA=""
BUILD_IMAGE=false
SKIP_BUILD=false
SERVICE_NAME=${SERVICE_NAME:-oauth-flow}
REPO_NAME=${REPO_NAME:-bitbrat-services}
CB_CONFIG=${CB_CONFIG:-cloudbuild.oauth-flow.yaml}
CB_DRY_RUN=${CB_DRY_RUN:-true}
DOCKERFILE=""
# Populated from architecture.yaml via extractor
PORT=""
MIN_INSTANCES=""
MAX_INSTANCES=""
CPU=""
MEMORY=""
ALLOW_UNAUTH=""
SECRETS_CSV=""
SECRET_SET_ARG=""
ENV_KEYS_CSV=""
ENV_NAME="${BITBRAT_ENV:-prod}"
TF_TMP_DIR=""
TF_VARS_FILE=""
SERVICE_SET=false
MULTI_MODE=false
MAX_CONCURRENCY="${MAX_CONCURRENCY:-}"

print_help() {
  sed -n '1,120p' "$0"
}

log() { echo "[deploy-cloud] $*"; }

# Helper: resolve Secret Manager versions to numeric (avoids API errors on ':latest' in gcloud run deploy)
# Input: semicolon-delimited "ENV=SECRET:latest;..."
# Output: semicolon-delimited "ENV=SECRET:<number>;..."
resolve_secret_versions() {
  local mapping="$1"
  echo "[deploy-cloud][secrets] Resolving secret versions for mapping: $mapping\n"
  local out=""
  local had_missing=0
  local rest="$mapping"
  while IFS= read -r pair; do
    # Trim whitespace (portable)
    pair="${pair#${pair%%[![:space:]]*}}"
    pair="${pair%${pair##*[![:space:]]}}"
    [[ -z "$pair" ]] && continue
    # Extract ENV and SECRET
    local env_name="${pair%%=*}"
    local rhs="${pair#*=}"
    local secret="${rhs%%:*}"
    local resolved_ver=""
    echo "[deploy-cloud][secrets] Checking secret '$secret' for env '$env_name'\n"
    if [[ -n "$secret" ]]; then
      # Newest ENABLED version by createTime desc
      resolved_ver="$(gcloud secrets versions list "$secret" --project "$PROJECT_ID" \
        --filter="state=ENABLED" --sort-by="~createTime" --limit=1 --format="value(name)" || true)"
    fi
    if [[ -z "$resolved_ver" ]]; then
      echo "[deploy-cloud][secrets] ERROR: No ENABLED versions found for secret '$secret' (required for '$env_name')." >&2
      had_missing=1
      continue
    fi
    echo "[deploy-cloud][secrets] Resolved '$secret' -> version $resolved_ver\n"
    if [[ -n "$out" ]]; then out+=";"; fi
    out+="${env_name}=${secret}:${resolved_ver}"
  done < <(printf "%s" "$rest" | tr ';' '\n')
  if [[ $had_missing -ne 0 ]]; then
    return 1
  fi
  echo "[deploy-cloud][secrets] Resolved mapping: $out\n"
  printf "%s" "$out"
}

# Helper: Filters KEY=VAL env pairs (semicolon-delimited) to remove any keys that are provided via secrets.
# Args: $1 = env_kv (e.g., "LOG_LEVEL=info;FOO=bar"), $2 = secret_map (e.g., "TWITCH_CLIENT_ID=TWITCH_CLIENT_ID:5;...")
filter_env_kv_excluding_secret_keys() {
  local env_kv="$1"
  local secret_map="$2"
  # Build a newline list of secret keys
  local secret_keys
  secret_keys=$(printf "%s" "$secret_map" | tr ';' '\n' | awk -F'=' 'NF>=1 {print $1}')
  # If no secrets, return original env_kv
  if [[ -z "$secret_keys" ]]; then
    printf "%s" "$env_kv"
    return 0
  fi
  local out=""
  local removed=()
  # Iterate env pairs and keep those not in secret_keys
  while IFS= read -r pair; do
    [[ -z "$pair" ]] && continue
    local k="${pair%%=*}"
    # check membership
    local is_secret=0
    while IFS= read -r sk; do
      [[ -z "$sk" ]] && continue
      if [[ "$k" == "$sk" ]]; then is_secret=1; break; fi
    done <<< "$secret_keys"
    if [[ $is_secret -eq 0 ]]; then
      if [[ -n "$out" ]]; then out+=";"; fi
      out+="$pair"
    else
      removed+=("$k")
    fi
  done < <(printf "%s" "$env_kv" | tr ';' '\n')
  if [[ ${#removed[@]} -gt 0 ]]; then
    echo "[deploy-cloud][secrets] Removing plain env keys overridden by secrets: ${removed[*]}\n"
  fi
  printf "%s" "$out"
}

REGION_EXPLICIT=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-id) PROJECT_ID="$2"; shift 2 ;;
    --region) REGION="$2"; REGION_EXPLICIT=true; shift 2 ;;
    --env-dir) ENV_DIR="$2"; shift 2 ;;
    --apply) APPLY=true; shift 1 ;;
    --dry-run) DRY_RUN=true; shift 1 ;;
    --skip-secret-import) SKIP_SECRET_IMPORT=true; shift 1 ;;
    --fix-deletion-protection) FIX_DELETION=true; shift 1 ;;
    --create-trigger) CREATE_TRIGGER=true; shift 1 ;;
    --github-connection) GITHUB_CONNECTION="$2"; shift 2 ;;
    --github-repo) GITHUB_REPO="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --build-sa) BUILD_SA="$2"; shift 2 ;;
    --cb-location) CB_LOCATION="$2"; shift 2 ;;
    --build-image) BUILD_IMAGE=true; shift 1 ;;
    --skip-build) SKIP_BUILD=true; shift 1 ;;
    --service-name) SERVICE_NAME="$2"; SERVICE_SET=true; shift 2 ;;
    --repo-name) REPO_NAME="$2"; shift 2 ;;
    --cb-config) CB_CONFIG="$2"; shift 2 ;;
    --cb-dry-run) CB_DRY_RUN="$2"; shift 2 ;;
    --dockerfile) DOCKERFILE="$2"; shift 2 ;;
    --env) ENV_NAME="$2"; shift 2 ;;
    --max-concurrency) MAX_CONCURRENCY="$2"; shift 2 ;;
    -h|--help) print_help; exit 0 ;;
    *) echo "Unknown option: $1" >&2; print_help; exit 1 ;;
  esac
done

# Determine max concurrency (flag > env > architecture.yaml > default 1)
if [[ -z "${MAX_CONCURRENCY:-}" ]]; then
  if command -v node >/dev/null 2>&1; then
    MAX_CONCURRENCY=$(node -e "const fs=require('fs');const yaml=require('js-yaml');try{const y=yaml.load(fs.readFileSync('architecture.yaml','utf8'))||{};const v=y.deploymentDefaults&&y.deploymentDefaults.maxConcurrentDeployments;console.log(v||1);}catch(e){console.log(1)}")
  else
    MAX_CONCURRENCY=1
  fi
fi
case "$MAX_CONCURRENCY" in
  ''|*[!0-9]*) MAX_CONCURRENCY=1 ;;
  0) MAX_CONCURRENCY=1 ;;
 esac

# Set default build SA if not provided
if [[ -z "$BUILD_SA" ]]; then
  BUILD_SA="cloud-build-bb@${PROJECT_ID}.iam.gserviceaccount.com"
fi

# Determine mode (single vs multi-service)
if [[ "$SERVICE_SET" == false ]]; then
  MULTI_MODE=true
fi

# In single-service mode, load configuration for the selected service
if [[ "$MULTI_MODE" == false ]]; then
  if command -v node >/dev/null 2>&1; then
    CFG_OUT=$(node infrastructure/scripts/extract-config.js --service "$SERVICE_NAME" --format env || true)
    if [[ -n "$CFG_OUT" ]]; then
      # Safely assign CFG_ variables, preserving special characters like semicolons and equals in values
      CFG_ASSIGN=$(
        while IFS= read -r line; do
          [[ -z "$line" ]] && continue
          k="${line%%=*}"
          v="${line#*=}"
          [[ -z "$k" ]] && continue
          printf 'CFG_%s=%q\n' "$k" "$v"
        done <<< "$CFG_OUT"
      )
      eval "$CFG_ASSIGN"
      if [[ "$REGION_EXPLICIT" == false && -n "${CFG_REGION:-}" ]]; then
        REGION="$CFG_REGION"
      fi
      PORT="${CFG_PORT:-$PORT}"
      MIN_INSTANCES="${CFG_MIN_INSTANCES:-$MIN_INSTANCES}"
      MAX_INSTANCES="${CFG_MAX_INSTANCES:-$MAX_INSTANCES}"
      CPU="${CFG_CPU:-$CPU}"
      MEMORY="${CFG_MEMORY:-$MEMORY}"
      ALLOW_UNAUTH="${CFG_ALLOW_UNAUTH:-$ALLOW_UNAUTH}"
      SECRET_SET_ARG="${CFG_SECRET_SET_ARG:-}"
      ENV_KEYS_CSV="${CFG_ENV_KEYS:-}"
      SECRETS_CSV="${CFG_SECRETS:-}"
      echo "[deploy-cloud][secrets][single] Declared secrets (architecture): ${SECRETS_CSV:-<none>}"
      echo "[deploy-cloud][secrets][single] SECRET_SET_ARG (from extractor): ${SECRET_SET_ARG:-<empty>}"
      # Synthesize missing secret mappings if any are absent
      if [[ -z "${SECRET_SET_ARG:-}" && -n "${SECRETS_CSV:-}" ]]; then
        IFS=',' read -r -a _tmp_secs <<< "$SECRETS_CSV"
        for _s in "${_tmp_secs[@]}"; do
          _k="${_s//[[:space:]]/}"
          [[ -z "$_k" ]] && continue
          if [[ -n "$SECRET_SET_ARG" ]]; then SECRET_SET_ARG+=";"; fi
          SECRET_SET_ARG+="${_k}=${_k}:latest"
        done
        echo "[deploy-cloud][secrets][single] synthesized SECRET_SET_ARG: ${SECRET_SET_ARG}"
      fi
    fi
  else
    echo "ERROR: Node.js is required to parse architecture.yaml (missing 'node')." >&2
    exit 1
  fi
fi

# Multi-service mode: deploy ALL services when --service-name is not provided
if [[ "$MULTI_MODE" == true ]]; then
  log "Project: ${PROJECT_ID}, Region: ${REGION}"
  log "Mode: $([[ "$APPLY" == true ]] && echo apply || echo plan)$([[ "$DRY_RUN" == true ]] && echo ' (dry-run)' || true)"
  log "Using environment: ${ENV_NAME}"
  log "Max concurrency: ${MAX_CONCURRENCY}"
  if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: Node.js is required to parse architecture.yaml (missing 'node')." >&2
    exit 1
  fi
  SERVICES=$(node infrastructure/scripts/extract-config.js --list-services || true)
  if [[ -z "$SERVICES" ]]; then
    echo "ERROR: No services found in architecture.yaml" >&2
    exit 1
  fi
  # Informational: show discovered services to provide immediate feedback
  log "Discovered services: $(echo "$SERVICES" | tr '\n' ' ')"
  if [[ "$APPLY" == true && "$DRY_RUN" == false ]]; then
    if ! command -v gcloud >/dev/null 2>&1; then
      echo "ERROR: gcloud is required to build/deploy images in multi-service mode." >&2
      exit 1
    fi
    # Build tag shared across services for traceability
    BUILD_TAG="${BUILD_TAG:-}"
    if [[ -z "$BUILD_TAG" ]]; then
      if git rev-parse --short HEAD >/dev/null 2>&1; then
        BUILD_TAG="$(git rev-parse --short HEAD)"
      else
        BUILD_TAG="$(date -u +%Y%m%d%H%M%S)"
      fi
    fi
    log "Using image tag: ${BUILD_TAG} for all services"

    # Prepare concurrency control (Bash 3 compatible)
    LOG_DIR=$(mktemp -d -t bitbrat-cloud-logs.XXXXXX)
    log "Streaming per-service logs under: $LOG_DIR"
    PIDS=()
    NAMES=()
    FAILED=()
    STARTED_COUNT=0

    run_one_service_cb() {
      local svc="$1"; shift
      local dockerfile="$1"; shift
      local env_kv="$1"; shift
      local secret_set_arg="$1"; shift
      local build_tag="$1"; shift
      local region="$1"; shift
      local port="$1"; shift
      local min_i="$1"; shift
      local max_i="$1"; shift
      local cpu="$1"; shift
      local mem="$1"; shift
      local allow_unauth="$1"; shift

      local subs="_SERVICE_NAME=$svc,_REGION=$region,_REPO_NAME=$REPO_NAME,_DRY_RUN=false,_TAG=$build_tag,_PORT=$port,_MIN_INSTANCES=$min_i,_MAX_INSTANCES=$max_i,_CPU=$cpu,_MEMORY=$mem,_ALLOW_UNAUTH=$allow_unauth,_SECRET_SET_ARG=$secret_set_arg,_ENV_VARS_ARG=$env_kv,_DOCKERFILE=$dockerfile,_BILLING=instance,_GRUMBLE=tank"
      gcloud builds submit --project "$PROJECT_ID" --config "$CB_CONFIG" \
        --substitutions="$subs" \
        .
    }

    # Resolve Secret Manager versions to numeric (avoids API errors on ':latest' in gcloud run deploy)
    # Input: semicolon-delimited "ENV=SECRET:latest;..."
    # Output: semicolon-delimited "ENV=SECRET:<number>;..."
    resolve_secret_versions() {
      local mapping="$1"
      echo "[deploy-cloud][secrets] Resolving secret versions for mapping: $mapping\n"
      local out=""
      local had_missing=0
      local rest="$mapping"
      while IFS= read -r pair; do
        # Trim whitespace (portable)
        pair="${pair#${pair%%[![:space:]]*}}"
        pair="${pair%${pair##*[![:space:]]}}"
        [[ -z "$pair" ]] && continue
        # Extract ENV and SECRET
        local env_name="${pair%%=*}"
        local rhs="${pair#*=}"
        local secret="${rhs%%:*}"
        local resolved_ver=""
        echo "[deploy-cloud][secrets] Checking secret '$secret' for env '$env_name'\n"
        if [[ -n "$secret" ]]; then
          # Newest ENABLED version by createTime desc
          resolved_ver="$(gcloud secrets versions list "$secret" --project "$PROJECT_ID" \
            --filter="state=ENABLED" --sort-by="~createTime" --limit=1 --format="value(name)" || true)"
        fi
        if [[ -z "$resolved_ver" ]]; then
          echo "[deploy-cloud][secrets] ERROR: No ENABLED versions found for secret '$secret' (required for '$env_name')." >&2
          had_missing=1
          continue
        fi
        echo "[deploy-cloud][secrets] Resolved '$secret' -> version $resolved_ver\n"
        if [[ -n "$out" ]]; then out+=";"; fi
        out+="${env_name}=${secret}:${resolved_ver}"
      done < <(printf "%s" "$rest" | tr ';' '\n')
      if [[ $had_missing -ne 0 ]]; then
        return 1
      fi
      echo "[deploy-cloud][secrets] Resolved mapping: $out\n"
      printf "%s" "$out"
    }

    # Filters KEY=VAL env pairs (semicolon-delimited) to remove any keys that are provided via secrets.
    # Args: $1 = env_kv (e.g., "LOG_LEVEL=info;FOO=bar"), $2 = secret_map (e.g., "TWITCH_CLIENT_ID=TWITCH_CLIENT_ID:5;...")
    filter_env_kv_excluding_secret_keys() {
      local env_kv="$1"
      local secret_map="$2"
      # Build a newline list of secret keys
      local secret_keys
      secret_keys=$(printf "%s" "$secret_map" | tr ';' '\n' | awk -F'=' 'NF>=1 {print $1}')
      # If no secrets, return original env_kv
      if [[ -z "$secret_keys" ]]; then
        printf "%s" "$env_kv"
        return 0
      fi
      local out=""
      local removed=()
      # Iterate env pairs and keep those not in secret_keys
      while IFS= read -r pair; do
        [[ -z "$pair" ]] && continue
        local k="${pair%%=*}"
        # check membership
        local is_secret=0
        while IFS= read -r sk; do
          [[ -z "$sk" ]] && continue
          if [[ "$k" == "$sk" ]]; then is_secret=1; break; fi
        done <<< "$secret_keys"
        if [[ $is_secret -eq 0 ]]; then
          if [[ -n "$out" ]]; then out+=";"; fi
          out+="$pair"
        else
          removed+=("$k")
        fi
      done < <(printf "%s" "$env_kv" | tr ';' '\n')
      if [[ ${#removed[@]} -gt 0 ]]; then
        echo "[deploy-cloud][secrets] Removing plain env keys overridden by secrets: ${removed[*]}\n"
      fi
      printf "%s" "$out"
    }

    start_job() {
      local svc="$1"; shift
      local dockerfile="$1"; shift
      local env_kv="$1"; shift
      local secret_set_arg="$1"; shift
      local build_tag="$1"; shift
      local region="$1"; shift
      local port="$1"; shift
      local min_i="$1"; shift
      local max_i="$1"; shift
      local cpu="$1"; shift
      local mem="$1"; shift
      local allow_unauth="$1"; shift
      local log_file="$LOG_DIR/${svc}.log"
      # Immediate console feedback for user
      echo "[deploy-cloud][$svc] ▶️  build+deploy started (logs: $log_file)\n"
      (
        echo "[deploy-cloud][$svc] starting build+deploy...\n"
        run_one_service_cb "$svc" "$dockerfile" "$env_kv" "$secret_set_arg" "$build_tag" "$region" "$port" "$min_i" "$max_i" "$cpu" "$mem" "$allow_unauth"
      ) >"$log_file" 2>&1 &
      PIDS+=("$!")
      NAMES+=("$svc")
      STARTED_COUNT=$((STARTED_COUNT+1))
    }

    wait_one() {
      local pid="${PIDS[0]}"; local name="${NAMES[0]}"
      wait "$pid"
      local rc=$?
      if [[ $rc -ne 0 ]]; then
        FAILED+=("$name:$rc")
        echo "[deploy-cloud][$name] FAILED (exit=$rc). See log: $LOG_DIR/$name.log" >&2
      else
        echo "[deploy-cloud][$name] ✅ success. Log: $LOG_DIR/$name.log"
      fi
      PIDS=("${PIDS[@]:1}")
      NAMES=("${NAMES[@]:1}")
    }
  fi

  while IFS= read -r svc; do
    [[ -z "$svc" ]] && continue
    # Load per-service config
    CFG=$(node infrastructure/scripts/extract-config.js --service "$svc" --format env || true)
    if [[ -z "$CFG" ]]; then
      echo "[deploy-cloud] WARN: Skipping service '$svc' (could not load config)." >&2
      continue
    fi
    # Safely assign CFG_ variables to preserve semicolons/colons in values
    CFG_ASSIGN=$(while IFS='=' read -r k v; do [[ -z "$k" ]] && continue; printf 'CFG_%s=%q\n' "$k" "$v"; done <<< "$CFG")
    eval "$CFG_ASSIGN"
    # Region from cfg when not explicitly overridden
    if [[ "$REGION_EXPLICIT" == false && -n "${CFG_REGION:-}" ]]; then REGION="$CFG_REGION"; fi
    # Compute env and secrets arguments for CB
    ENV_KEYS_CSV_LOCAL="${CFG_ENV_KEYS:-}"
    ENV_KV_LOCAL=""
    # New behavior: always load ALL env vars from overlay; use ENV_KEYS_CSV_LOCAL only for validation
    ENV_KV_LOCAL=$(node infrastructure/scripts/load-env.js --env "$ENV_NAME" --format kv || echo "")
    # Trace env keys selected and prepared (names only; no values)
    if [[ -n "$ENV_KEYS_CSV_LOCAL" ]]; then
      echo "[deploy-cloud][$svc][env] ENV_KEYS: $ENV_KEYS_CSV_LOCAL"
    fi
    if [[ -n "$ENV_KV_LOCAL" ]]; then
      ENV_KEYS_LIST=$(printf "%s" "$ENV_KV_LOCAL" | tr ';' '\n' | awk -F'=' 'NF>=1 {print $1}' | paste -sd, -)
      echo "[deploy-cloud][$svc][env] env keys to set: $ENV_KEYS_LIST"
    else
      echo "[deploy-cloud][$svc][env] No env key/values loaded for service."
    fi
    # Validate required env keys declared in architecture.yaml are present in overlay
    BLOCK_DEPLOY_LOCAL=0
    if [[ -n "$ENV_KEYS_CSV_LOCAL" ]]; then
      IFS=',' read -r -a _req_keys <<< "$ENV_KEYS_CSV_LOCAL"
      present_keys=$(printf "%s" "$ENV_KV_LOCAL" | tr ';' '\n' | awk -F'=' 'NF>=1 {print $1}')
      missing_keys=()
      # Keys provided by the runtime (e.g., Cloud Run) should not be required in overlays
      RUNTIME_PROVIDED_KEYS=("K_REVISION")
      is_runtime_provided() { local key="$1"; for rk in "${RUNTIME_PROVIDED_KEYS[@]}"; do [[ "$rk" == "$key" ]] && return 0; done; return 1; }
      for rk in "${_req_keys[@]}"; do
        k_trimmed="${rk//[[:space:]]/}"
        [[ -z "$k_trimmed" ]] && continue
        # Skip runtime-provided keys from validation
        if is_runtime_provided "$k_trimmed"; then
          continue
        fi
        if ! printf "%s\n" $present_keys | grep -qx "$k_trimmed"; then
          missing_keys+=("$k_trimmed")
        fi
      done
      if [[ ${#missing_keys[@]} -gt 0 ]]; then
        if [[ "$APPLY" == true && "$DRY_RUN" == false ]]; then
          echo "[deploy-cloud][$svc][env] ERROR: Missing required env keys (architecture.yaml): ${missing_keys[*]}" >&2
          BLOCK_DEPLOY_LOCAL=1
        else
          echo "[deploy-cloud][$svc][env] DRY-RUN: would fail due to missing required env keys: ${missing_keys[*]}" >&2
        fi
      fi
    fi
    SECRET_SET_ARG_LOCAL="${CFG_SECRET_SET_ARG:-}"
    echo "[deploy-cloud][$svc][secrets] initial SECRET_SET_ARG from extractor: ${SECRET_SET_ARG_LOCAL:-<empty>}"
    # Synthesize missing secret mappings from CFG_SECRETS when absent or incomplete
    CFG_SECRETS_CSV_LOCAL="${CFG_SECRETS:-}"
    if [[ -n "$CFG_SECRETS_CSV_LOCAL" ]]; then
      # Build a set of keys currently present in SECRET_SET_ARG_LOCAL
      present_keys=""
      if [[ -n "$SECRET_SET_ARG_LOCAL" ]]; then
        present_keys=$(printf "%s" "$SECRET_SET_ARG_LOCAL" | tr ';' '\n' | awk -F'=' 'NF>=1 {print $1}')
      fi
      IFS=',' read -r -a _svc_secs <<< "$CFG_SECRETS_CSV_LOCAL"
      synthesized=()
      for _s in "${_svc_secs[@]}"; do
        _k="${_s//[[:space:]]/}"
        [[ -z "$_k" ]] && continue
        # If key not already present, append mapping
        if ! printf "%s\n" $present_keys | grep -qx "$_k"; then
          if [[ -n "$SECRET_SET_ARG_LOCAL" ]]; then SECRET_SET_ARG_LOCAL+=";"; fi
          SECRET_SET_ARG_LOCAL+="${_k}=${_k}:latest"
          synthesized+=("$_k")
        fi
      done
      if [[ ${#synthesized[@]} -gt 0 ]]; then
        echo "[deploy-cloud][$svc] synthesized missing secret mappings: ${synthesized[*]}"
      fi
    else
      if [[ -z "$SECRET_SET_ARG_LOCAL" ]]; then
        echo "[deploy-cloud][$svc][secrets] No secrets declared in architecture.yaml"
      fi
    fi
    # Resolve ':latest' to numeric versions to satisfy Cloud Run API expectations
    if [[ -n "$SECRET_SET_ARG_LOCAL" ]]; then
      RESOLVED_SECRETS=""
      if RESOLVED_SECRETS="$(resolve_secret_versions "$SECRET_SET_ARG_LOCAL")"; then
        # Use the resolved numeric versions mapping
        SECRET_SET_ARG_LOCAL="$RESOLVED_SECRETS"
        # Log which secret envs will be set (names only)
        KEYS_LIST=$(printf "%s" "$SECRET_SET_ARG_LOCAL" | tr ';' '\n' | awk -F'=' 'NF>=1 {print $1}' | paste -sd, -)
        echo "[deploy-cloud][$svc] using secret envs: $KEYS_LIST"
        echo "[deploy-cloud][$svc][secrets] final mapping to apply: $SECRET_SET_ARG_LOCAL"
      else
        if [[ "$APPLY" == true && "$DRY_RUN" == false ]]; then
          echo "[deploy-cloud][$svc] ERROR: Missing ENABLED secret versions; cannot deploy service '$svc'. See errors above." >&2
          # Mark as failure by setting an impossible dockerfile so start_job is skipped
          DOCKERFILE_LOCAL=""
        else
          echo "[deploy-cloud][$svc] DRY-RUN: would fail due to missing secret versions." >&2
        fi
      fi
    fi
    # Ensure we don't pass plain env vars for keys that are provided via secrets
    if [[ -n "$ENV_KV_LOCAL" && -n "$SECRET_SET_ARG_LOCAL" ]]; then
      ENV_KV_LOCAL="$(filter_env_kv_excluding_secret_keys "$ENV_KV_LOCAL" "$SECRET_SET_ARG_LOCAL")"
    fi
    # Determine Dockerfile for service
    DOCKERFILE_LOCAL="Dockerfile.${svc}"
    if [[ ! -f "$DOCKERFILE_LOCAL" ]]; then
      # try kebab-case filename
      svc_kebab="${svc// /-}"
      DOCKERFILE_LOCAL="Dockerfile.${svc_kebab}"
    fi
    if [[ ! -f "$DOCKERFILE_LOCAL" ]]; then
      echo "[deploy-cloud] WARN: Dockerfile not found for '$svc' (expected Dockerfile.$svc or Dockerfile.$svc_kebab). Skipping." >&2
      continue
    fi
    if [[ "$APPLY" == true && "$DRY_RUN" == false ]]; then
      if [[ "$BLOCK_DEPLOY_LOCAL" == 1 ]]; then
        echo "[deploy-cloud][$svc] Skipping deploy due to missing required env keys."
      else
        start_job "$svc" "$DOCKERFILE_LOCAL" "$ENV_KV_LOCAL" "$SECRET_SET_ARG_LOCAL" "$BUILD_TAG" "$REGION" "${CFG_PORT}" "${CFG_MIN_INSTANCES}" "${CFG_MAX_INSTANCES}" "${CFG_CPU}" "${CFG_MEMORY}" "${CFG_ALLOW_UNAUTH}"
      fi
      while [[ ${#PIDS[@]} -ge $MAX_CONCURRENCY ]]; do
        wait_one
      done
    else
      log "(dry-run/plan) Would build and deploy '$svc' with: dockerfile=$DOCKERFILE_LOCAL, region=$REGION, port=${CFG_PORT}, min=${CFG_MIN_INSTANCES}, max=${CFG_MAX_INSTANCES}, cpu=${CFG_CPU}, memory=${CFG_MEMORY}, allowUnauth=${CFG_ALLOW_UNAUTH}"
    fi
  done <<< "$SERVICES"

  if [[ "$APPLY" == true && "$DRY_RUN" == false ]]; then
    if [[ ${STARTED_COUNT:-0} -eq 0 ]]; then
      echo "[deploy-cloud] ERROR: No services were scheduled for build/deploy (likely missing Dockerfiles)." >&2
      echo "[deploy-cloud] Hint: ensure a Dockerfile.<service> exists at repo root for each service, or specify --service-name to target one." >&2
      exit 2
    fi
    while [[ ${#PIDS[@]} -gt 0 ]]; do
      wait_one
    done
    if [[ ${#FAILED[@]} -gt 0 ]]; then
      echo "[deploy-cloud] One or more services failed:" >&2
      for f in "${FAILED[@]}"; do echo "  - $f" >&2; done
      exit 1
    fi
    log "✅ Multi-service deploy path completed in parallel (logs in $LOG_DIR)."
  else
    log "✅ Multi-service deploy path completed."
  fi
  exit 0
fi

# Build Terraform vars file for env and secrets
TF_TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TF_TMP_DIR"' EXIT
TF_VARS_FILE="$TF_TMP_DIR/override.auto.tfvars.json"

ENV_JSON="{}"
ENV_KV=""
if [[ -n "$ENV_KEYS_CSV" ]]; then
  ENV_JSON=$(node infrastructure/scripts/load-env.js --env "$ENV_NAME" --format json --only-keys "$ENV_KEYS_CSV" || echo "{}")
  ENV_KV=$(node infrastructure/scripts/load-env.js --env "$ENV_NAME" --format kv --only-keys "$ENV_KEYS_CSV" || echo "")
else
  ENV_JSON=$(node infrastructure/scripts/load-env.js --env "$ENV_NAME" --format json || echo "{}")
  ENV_KV=$(node infrastructure/scripts/load-env.js --env "$ENV_NAME" --format kv || echo "")
fi

SECRETS_JSON="[]"
if [[ -n "$SECRETS_CSV" ]]; then
  log "[secrets][single] Terraform will receive secret names: ${SECRETS_CSV}"
fi
if [[ -n "$SECRETS_CSV" ]]; then
  # Build JSON array from CSV
  IFS=',' read -r -a _arr <<< "$SECRETS_CSV"
  if [[ ${#_arr[@]} -gt 0 ]]; then
    _json_elems=()
    for s in "${_arr[@]}"; do
      s_trimmed="${s//\ /}"
      if [[ -n "$s_trimmed" ]]; then _json_elems+=("\"$s_trimmed\""); fi
    done
    if [[ ${#_json_elems[@]} -gt 0 ]]; then
      # Join with commas to produce valid JSON array
      SECRETS_JSON="[$(IFS=,; echo "${_json_elems[*]}")]"
    fi
  fi
fi

cat > "$TF_VARS_FILE" <<EOF
{
  "env": $ENV_JSON,
  "secrets": $SECRETS_JSON
}
EOF

log "Project: ${PROJECT_ID}, Region: ${REGION}"
log "Terraform overlay: ${ENV_DIR}"
log "Mode: $([[ "$APPLY" == true ]] && echo apply || echo plan)$([[ "$DRY_RUN" == true ]] && echo ' (dry-run)' || true)"
log "Using environment: ${ENV_NAME}"
log "Env keys: ${ENV_KEYS_CSV:-<none>}"

# Pre-flight checks
if ! command -v terraform >/dev/null 2>&1; then
  echo "ERROR: terraform is required on PATH." >&2
  exit 1
fi

if [[ ! -d "$ENV_DIR" ]]; then
  echo "ERROR: ENV_DIR not found: $ENV_DIR" >&2
  exit 1
fi

# Optional: fix Cloud Run deletion protection/taint prior to apply
if [[ "$FIX_DELETION" == true ]]; then
  if [[ "$DRY_RUN" == true ]]; then
    log "--fix-deletion-protection requested, but --dry-run is set; performing untaint only..."
    bash infrastructure/gcp/scripts/fix-cloud-run-deletion-protection.sh \
      --env-dir "$ENV_DIR" || true
  else
    bash infrastructure/gcp/scripts/fix-cloud-run-deletion-protection.sh \
      --env-dir "$ENV_DIR" \
      --project-id "$PROJECT_ID" \
      --region "$REGION" \
      ${APPLY:+--apply} || true
  fi
fi

# Secret Manager management disabled by policy
log "[secrets] Secret Manager creation/import is disabled. Manage secrets manually outside of this pipeline."

# Build & push image when applicable
DO_BUILD=false
if [[ "$SKIP_BUILD" == true ]]; then
  log "Skipping image build/push as requested."
elif [[ "$BUILD_IMAGE" == true ]]; then
  DO_BUILD=true
elif [[ "$APPLY" == true && "$DRY_RUN" == false ]]; then
  DO_BUILD=true
fi

if [[ "$DO_BUILD" == true ]]; then
  if ! command -v gcloud >/dev/null 2>&1; then
    echo "ERROR: gcloud is required to build/push images. Install gcloud or use --skip-build." >&2
    exit 1
  fi
  log "Building & pushing container image via Cloud Build (config=${CB_CONFIG}) ..."
  BUILD_TAG="${BUILD_TAG:-}"
  if [[ -z "$BUILD_TAG" ]]; then
    if git rev-parse --short HEAD >/dev/null 2>&1; then
      BUILD_TAG="$(git rev-parse --short HEAD)"
    else
      BUILD_TAG="$(date -u +%Y%m%d%H%M%S)"
    fi
  fi
  log "Using image tag: ${BUILD_TAG}"
  if [[ -z "$DOCKERFILE" ]]; then
    CANDIDATE="Dockerfile.${SERVICE_NAME}"
    # normalize candidate by replacing spaces (unlikely) with hyphens
    CANDIDATE="${CANDIDATE// /-}"
    if [[ -f "$CANDIDATE" ]]; then
      DOCKERFILE="$CANDIDATE"
    else
      DOCKERFILE="Dockerfile.oauth-flow"
    fi
  fi
  log "Using Dockerfile: ${DOCKERFILE}"
  if [[ -n "${SECRET_SET_ARG:-}" ]]; then
    log "[secrets][single] Cloud Build _SECRET_SET_ARG: ${SECRET_SET_ARG}"
  else
    log "[secrets][single] Cloud Build _SECRET_SET_ARG: <empty>"
  fi
  gcloud builds submit --project "$PROJECT_ID" --config "$CB_CONFIG" \
    --substitutions _SERVICE_NAME="$SERVICE_NAME",_REGION="$REGION",_REPO_NAME="$REPO_NAME",_DRY_RUN="$CB_DRY_RUN",_TAG="$BUILD_TAG",_PORT="${PORT}",_MIN_INSTANCES="${MIN_INSTANCES}",_MAX_INSTANCES="${MAX_INSTANCES}",_CPU="${CPU}",_MEMORY="${MEMORY}",_ALLOW_UNAUTH="${ALLOW_UNAUTH}",_SECRET_SET_ARG="${SECRET_SET_ARG}",_DOCKERFILE="${DOCKERFILE}",_BILLING=instance \
    .
fi

# Run Terraform (plan or apply)
log "Initializing Terraform in ${ENV_DIR} ..."
pushd "$ENV_DIR" >/dev/null
terraform init -input=false -no-color
terraform validate -no-color

if [[ "$APPLY" == true && "$DRY_RUN" == false ]]; then
  log "Running terraform apply ..."
  terraform apply -no-color -auto-approve \
    -var="project_id=${PROJECT_ID}" \
    -var="region=${REGION}" \
    -var="service_name=${SERVICE_NAME}" \
    -var="repo_name=${REPO_NAME}" \
    -var="min_instances=${MIN_INSTANCES}" \
    -var="max_instances=${MAX_INSTANCES}" \
    -var="cpu=${CPU}" \
    -var="memory=${MEMORY}" \
    -var="port=${PORT}" \
    -var="allow_unauth=${ALLOW_UNAUTH}" \
    -var-file="${TF_VARS_FILE}"
else
  log "Running terraform plan ..."
  terraform plan -input=false -lock=false -no-color \
    -var="project_id=${PROJECT_ID}" \
    -var="region=${REGION}" \
    -var="service_name=${SERVICE_NAME}" \
    -var="repo_name=${REPO_NAME}" \
    -var="min_instances=${MIN_INSTANCES}" \
    -var="max_instances=${MAX_INSTANCES}" \
    -var="cpu=${CPU}" \
    -var="memory=${MEMORY}" \
    -var="port=${PORT}" \
    -var="allow_unauth=${ALLOW_UNAUTH}" \
    -var-file="${TF_VARS_FILE}" \
    -out=tfplan || true
fi
popd >/dev/null

# Enforce instance-based billing on Cloud Run services after Terraform apply (best-effort)
if [[ "$APPLY" == true && "$DRY_RUN" == false ]]; then
  if command -v gcloud >/dev/null 2>&1; then
    # Single service mode: ensure the primary service billing is set to instance
    if [[ "$SERVICE_SET" == false || -n "$SERVICE_NAME" ]]; then
      log "Ensuring Cloud Run billing mode=instance for service ${SERVICE_NAME} in ${REGION}"
      gcloud run services update "${SERVICE_NAME}" --region "${REGION}" --platform managed --billing instance || true
    fi
  fi
fi

# Optional: Create/Update Cloud Build trigger
if [[ "$CREATE_TRIGGER" == true ]]; then
  if ! command -v gcloud >/dev/null 2>&1; then
    log "gcloud not available; skipping trigger creation."
  else
    if [[ -z "$GITHUB_CONNECTION$GITHUB_REPO" ]]; then
      echo "ERROR: --create-trigger requires --github-connection and --github-repo" >&2
      exit 1
    fi
    log "Creating/Updating Cloud Build trigger for oauth-flow ..."
    bash infrastructure/gcp/scripts/create-cloudbuild-trigger.sh \
      --project-id "$PROJECT_ID" \
      --trigger-name oauth-flow-main \
      --github-connection "$GITHUB_CONNECTION" \
      --github-repo "$GITHUB_REPO" \
      --branch "$BRANCH" \
      --cb-location "$CB_LOCATION" \
      --build-sa "$BUILD_SA"
  fi
fi

log "✅ Cloud deploy script completed."
