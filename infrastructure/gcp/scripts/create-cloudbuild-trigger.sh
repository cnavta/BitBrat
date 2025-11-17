#!/usr/bin/env bash
set -euo pipefail

# Creates a Cloud Build Trigger for the oauth-flow service.
# Supports GitHub App-connected repos and Cloud Source Repositories.
# The trigger uses cloudbuild.oauth-flow.yaml at repo root and sets default substitutions.
# Idempotent: if a trigger with the same name exists, it will be updated when possible.
#
# Usage (GitHub App via owner/repo):
#   ./create-cloudbuild-trigger.sh \
#     --project-id twitch-452523 \
#     --trigger-name oauth-flow-main \
#     --github-owner <GITHUB_OWNER> \
#     --github-repo <REPO_NAME> \
#     --branch main \
#     --build-sa cloud-build-bb@twitch-452523.iam.gserviceaccount.com
#
# Usage (GitHub App via connection/repository resource - preferred):
#   ./create-cloudbuild-trigger.sh \
#     --project-id twitch-452523 \
#     --trigger-name oauth-flow-main \
#     --github-connection <CONNECTION_NAME> \
#     --github-repo <REPO_NAME> \
#     --branch main \
#     --build-sa cloud-build-bb@twitch-452523.iam.gserviceaccount.com
#
# Usage (Cloud Source Repositories):
#   ./create-cloudbuild-trigger.sh \
#     --project-id twitch-452523 \
#     --trigger-name oauth-flow-main \
#     --csr-repo <CSR_REPO_NAME> \
#     --branch main \
#     --build-sa cloud-build-bb@twitch-452523.iam.gserviceaccount.com
#
# Flags:
#   --project-id        GCP project ID (required)
#   --trigger-name      Name of the trigger (default: oauth-flow-main)
#   --branch            Branch name or regex (simple names auto-normalized to ^name$)
#   --github-owner      GitHub org/user (mutually exclusive with --csr-repo and --github-connection)
#   --github-repo       GitHub repository name (used with --github-owner or --github-connection)
#   --github-connection Cloud Build GitHub App connection name (preferred when available)
#   --csr-repo          Cloud Source Repository name (mutually exclusive with GitHub flags)
#   --build-config      Path to Cloud Build YAML (default: cloudbuild.oauth-flow.yaml)
#   --region            Region for substitutions (default: us-central1)
#   --cb-location       Cloud Build resources location for connections/repos (default: global)
#   --repo-name-subst   Artifact Registry repo substitution (default: bitbrat-services)
#   --dry-run-default   Default for _DRY_RUN substitution (true/false, default: true)
#   --build-sa          Service Account email for the trigger to run as (recommended)
#   --print-resolved-only  Resolve and print the repository resource, then exit (debug aid)
#   --repository-resource  Fully-qualified repository resource (bypass detection), e.g., \
#                          projects/$PROJECT/locations/$CB_LOCATION/connections/$CONN/repositories/$ID
#

PROJECT_ID=""
TRIGGER_NAME="oauth-flow-main"
BRANCH_PATTERN="^main$"
GITHUB_OWNER=""
GITHUB_REPO=""
GITHUB_CONNECTION=""
CSR_REPO=""
BUILD_CONFIG="cloudbuild.oauth-flow.yaml"
REGION_SUBST="us-central1"
CB_LOCATION="global"
REPO_NAME_SUBST="bitbrat-services"
DRY_RUN_DEFAULT="true"
BUILD_SA=""
PRINT_RESOLVED_ONLY=false
REPOSITORY_RESOURCE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-id) PROJECT_ID="$2"; shift 2 ;;
    --trigger-name) TRIGGER_NAME="$2"; shift 2 ;;
    --branch) BRANCH_PATTERN="$2"; shift 2 ;;
    --github-owner) GITHUB_OWNER="$2"; shift 2 ;;
    --github-repo) GITHUB_REPO="$2"; shift 2 ;;
    --github-connection) GITHUB_CONNECTION="$2"; shift 2 ;;
    --csr-repo) CSR_REPO="$2"; shift 2 ;;
    --build-config) BUILD_CONFIG="$2"; shift 2 ;;
    --region) REGION_SUBST="$2"; shift 2 ;;
    --cb-location) CB_LOCATION="$2"; shift 2 ;;
    --repo-name-subst) REPO_NAME_SUBST="$2"; shift 2 ;;
    --dry-run-default) DRY_RUN_DEFAULT="$2"; shift 2 ;;
    --build-sa) BUILD_SA="$2"; shift 2 ;;
    --print-resolved-only) PRINT_RESOLVED_ONLY=true; shift 1 ;;
    --repository-resource) REPOSITORY_RESOURCE="$2"; shift 2 ;;
    -h|--help)
      sed -n '1,220p' "$0"; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$PROJECT_ID" ]]; then
  echo "ERROR: --project-id is required" >&2
  exit 1
fi

# Validate mutually exclusive source flags
if [[ -n "$GITHUB_OWNER" || -n "$GITHUB_REPO" || -n "$GITHUB_CONNECTION" ]]; then
  if [[ -n "$CSR_REPO" ]]; then
    echo "ERROR: Use either GitHub flags or --csr-repo, not both" >&2
    exit 1
  fi
  if [[ -n "$GITHUB_CONNECTION" ]]; then
    if [[ -z "$GITHUB_REPO" ]]; then
      echo "ERROR: --github-connection requires --github-repo (repository name within the connection)" >&2
      exit 1
    fi
  else
    if [[ -z "$GITHUB_OWNER" || -z "$GITHUB_REPO" ]]; then
      echo "ERROR: --github-owner and --github-repo must both be provided (or use --github-connection)" >&2
      exit 1
    fi
  fi
fi

if [[ -z "$GITHUB_OWNER$GITHUB_REPO$GITHUB_CONNECTION$CSR_REPO" ]]; then
  echo "ERROR: Provide GitHub (--github-owner/--github-repo or --github-connection/--github-repo) or --csr-repo" >&2
  exit 1
fi

log() { echo "[create-cloudbuild-trigger] $*"; }

SUBSTS="_SERVICE_NAME=oauth-flow,_REGION=${REGION_SUBST},_REPO_NAME=${REPO_NAME_SUBST},_DRY_RUN=${DRY_RUN_DEFAULT}"

# Normalize branch: if it's a simple name (no anchors or regex meta), anchor it.
if [[ ! "$BRANCH_PATTERN" =~ [\^\$\[\]\(\)\|\.\*\+\?] ]]; then
  RESOLVED_BRANCH_PATTERN="^${BRANCH_PATTERN}\$"
else
  RESOLVED_BRANCH_PATTERN="$BRANCH_PATTERN"
fi
log "Resolved branch pattern: ${RESOLVED_BRANCH_PATTERN}"

# Pre-flight: verify provided service account exists (if set)
if [[ -n "$BUILD_SA" ]]; then
  if ! gcloud iam service-accounts describe "$BUILD_SA" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "ERROR: The specified --build-sa service account was not found in project ${PROJECT_ID}: ${BUILD_SA}" >&2
    echo "Hint: Ensure the email is correct and the SA exists. Example: cloud-build-bb@${PROJECT_ID}.iam.gserviceaccount.com" >&2
    exit 1
  fi
fi

# Check if trigger exists
if gcloud builds triggers describe "$TRIGGER_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
  log "Trigger ${TRIGGER_NAME} exists. Updating configuration..."
  # Best-effort update (not all fields updateable; may require delete/recreate)
  gcloud builds triggers update "$TRIGGER_NAME" \
    --project="$PROJECT_ID" \
    --build-config="$BUILD_CONFIG" \
    --substitutions="$SUBSTS" \
    ${BUILD_SA:+--service-account="$BUILD_SA"} \
    --quiet || true
  log "✅ Update attempted for trigger ${TRIGGER_NAME}."
  exit 0
fi

if [[ -n "$GITHUB_CONNECTION" ]]; then
  # Resolve the repository resource under this connection. The provided --github-repo may be:
  # - the repository ID created under the connection (preferred), OR
  # - an owner/repo string (e.g., cnavta/BitBrat), OR
  # - a heuristic like owner-Repo. We attempt to discover the correct resource.
  RESOLVED_REPO_RESOURCE=""

  # If caller provided a fully-qualified repository resource, use it as-is.
  if [[ -n "$REPOSITORY_RESOURCE" ]]; then
    RESOLVED_REPO_RESOURCE="$REPOSITORY_RESOURCE"
  fi

  # List repositories for this connection and try to find an exact match by:
  # 1) Repository ID equality (resource name suffix)
  # 2) remoteUri exact match (when owner/repo is provided)
  # 3) remoteUri suffix match with provided token
  # Pre-flight: validate connection exists
  if ! gcloud builds connections describe "$GITHUB_CONNECTION" --project="$PROJECT_ID" --region="$CB_LOCATION" >/dev/null 2>&1; then
    echo "ERROR: GitHub App connection not found: ${GITHUB_CONNECTION} in project ${PROJECT_ID} (region=${CB_LOCATION})." >&2
    echo "Hint: List available connections: gcloud builds connections list --project=${PROJECT_ID} --region=\"$CB_LOCATION\"" >&2
    exit 1
  fi

  REPOS_CSV=$(gcloud builds repositories list \
      --project="$PROJECT_ID" \
      --region="$CB_LOCATION" \
      --connection="$GITHUB_CONNECTION" \
      --format="csv[no-heading](name,remoteUri)" 2>/dev/null || true)

  # Derive candidate remote URIs based on provided input
  CANDIDATE_REMOTE_URI=""
  ALT_CANDIDATE_REMOTE_URI=""
  if [[ "$GITHUB_REPO" == */* ]]; then
    CANDIDATE_REMOTE_URI="https://github.com/${GITHUB_REPO}"
  else
    # Heuristic: users sometimes pass owner-repo instead of owner/repo
    if [[ "$GITHUB_REPO" == *-* ]]; then
      ALT_CANDIDATE_REMOTE_URI="https://github.com/${GITHUB_REPO/-//}"
    fi
  fi

  # Iterate through discovered repos and resolve best match
  BASE_PATH="projects/${PROJECT_ID}/locations/$CB_LOCATION/connections/${GITHUB_CONNECTION}/repositories"
  RESOLVED_REPO_ID=""
  if [[ -n "$REPOS_CSV" ]]; then
    while IFS=',' read -r R_NAME R_REMOTE; do
      # Trim whitespace
      R_NAME="${R_NAME## }"; R_NAME="${R_NAME%% }"
      R_REMOTE="${R_REMOTE## }"; R_REMOTE="${R_REMOTE%% }"

      # Derive repo ID from name (some gcloud versions return only the ID)
      if [[ "$R_NAME" == */repositories/* ]]; then
        REPO_ID="${R_NAME##*/repositories/}"
      else
        REPO_ID="$R_NAME"
      fi

      # Normalize remote URIs for comparison (strip .git, normalize ssh to https)
      NORM_REMOTE="$R_REMOTE"
      NORM_REMOTE="${NORM_REMOTE%.git}"
      if [[ "$NORM_REMOTE" == git@github.com:* ]]; then
        NORM_REMOTE="https://github.com/${NORM_REMOTE#git@github.com:}"
      fi

      # Normalize candidate URIs similarly
      NORM_CANDIDATE="$CANDIDATE_REMOTE_URI"; NORM_CANDIDATE="${NORM_CANDIDATE%.git}"
      NORM_ALT_CANDIDATE="$ALT_CANDIDATE_REMOTE_URI"; NORM_ALT_CANDIDATE="${NORM_ALT_CANDIDATE%.git}"

      # 1) Exact ID match against provided token
      if [[ -n "$GITHUB_REPO" && "$REPO_ID" == "$GITHUB_REPO" ]]; then
        RESOLVED_REPO_ID="$REPO_ID"
        break
      fi
      # 2) Exact remoteUri match with candidate
      if [[ -n "$NORM_CANDIDATE" && "$NORM_REMOTE" == "$NORM_CANDIDATE"* ]]; then
        RESOLVED_REPO_ID="$REPO_ID"
        break
      fi
      if [[ -n "$NORM_ALT_CANDIDATE" && "$NORM_REMOTE" == "$NORM_ALT_CANDIDATE"* ]]; then
        RESOLVED_REPO_ID="$REPO_ID"
        break
      fi
      # 3) Suffix match: allow inputs like cnavta-BitBrat to match .../cnavta/BitBrat
      if [[ -n "$GITHUB_REPO" ]]; then
        # strip potential .git in comparison
        TOKEN_NO_GIT="${GITHUB_REPO%.git}"
        if [[ "$NORM_REMOTE" == */"${TOKEN_NO_GIT}" ]]; then
          RESOLVED_REPO_ID="$REPO_ID"
          # keep searching for a more exact match, do not break
        fi
      fi
    done <<< "$REPOS_CSV"
  fi

  # If we have the repo ID but not the full resource, construct it
  if [[ -z "$RESOLVED_REPO_RESOURCE" && -n "$RESOLVED_REPO_ID" ]]; then
    RESOLVED_REPO_RESOURCE="${BASE_PATH}/${RESOLVED_REPO_ID}"
  fi

  if [[ -z "$RESOLVED_REPO_RESOURCE" ]]; then
    echo "ERROR: Could not resolve repository '${GITHUB_REPO}' under connection '${GITHUB_CONNECTION}'." >&2
    echo "Discovered repositories (name | remoteUri):" >&2
    if [[ -n "$REPOS_CSV" ]]; then
      echo "$REPOS_CSV" | sed 's/,/ | /' >&2
    else
      echo "(none found)" >&2
    fi
    echo "Hint: Use the exact repository ID shown in 'name' (the segment after /repositories/)," >&2
    echo "      or pass owner/repo (e.g., --github-repo cnavta/BitBrat)." >&2
    echo "      You can also create/link the repo in Cloud Build UI, then re-run this script." >&2
    exit 1
  fi

  if [[ "$PRINT_RESOLVED_ONLY" == true ]]; then
    log "Resolved repository resource: ${RESOLVED_REPO_RESOURCE}"
    echo "${RESOLVED_REPO_RESOURCE}"
    exit 0
  fi

  log "Creating GitHub trigger ${TRIGGER_NAME} using connection ${GITHUB_CONNECTION}, repo resource ${RESOLVED_REPO_RESOURCE} on ${RESOLVED_BRANCH_PATTERN}"
  gcloud builds triggers create github \
    --project="$PROJECT_ID" \
    --name="$TRIGGER_NAME" \
    --repository="$RESOLVED_REPO_RESOURCE" \
    --branch-pattern="$RESOLVED_BRANCH_PATTERN" \
    --build-config="$BUILD_CONFIG" \
    --substitutions="$SUBSTS" \
    ${BUILD_SA:+--service-account="$BUILD_SA"} \
    --quiet
  log "✅ Created GitHub trigger: ${TRIGGER_NAME}"
elif [[ -n "$GITHUB_OWNER" ]]; then
  # If owner/repo mode is requested, try to auto-detect an existing GitHub App connection for this repo
  if command -v gcloud >/dev/null 2>&1; then
    AUTO_REPO_RESOURCE=$(gcloud builds repositories list \
      --project="$PROJECT_ID" \
      --region="$CB_LOCATION" \
      --format="value(name)" 2>/dev/null | grep "/repositories/${GITHUB_REPO}$" | head -n1 || true)
    if [[ -n "$AUTO_REPO_RESOURCE" ]]; then
      # Extract connection name from resource path
      AUTO_CONNECTION=$(echo "$AUTO_REPO_RESOURCE" | sed -E 's#.*/connections/([^/]+)/repositories/.*#\1#')
      if [[ -n "$AUTO_CONNECTION" ]]; then
        log "Detected GitHub App connection '${AUTO_CONNECTION}' for repo '${GITHUB_REPO}'. Using connection mode."
        gcloud builds triggers create github \
          --project="$PROJECT_ID" \
          --name="$TRIGGER_NAME" \
          --repository="$AUTO_REPO_RESOURCE" \
          --branch-pattern="$RESOLVED_BRANCH_PATTERN" \
          --build-config="$BUILD_CONFIG" \
          --substitutions="$SUBSTS" \
          ${BUILD_SA:+--service-account="$BUILD_SA"} \
          --quiet || {
            echo "ERROR: Trigger creation failed using detected connection. If this persists, rerun with --github-connection <CONNECTION_NAME> and --github-repo ${GITHUB_REPO}." >&2
            exit 1
          }
        log "✅ Created GitHub trigger: ${TRIGGER_NAME}"
        exit 0
      fi
    fi
  fi
  log "Creating GitHub trigger ${TRIGGER_NAME} for ${GITHUB_OWNER}/${GITHUB_REPO} on ${RESOLVED_BRANCH_PATTERN}"
  set +e
  gcloud builds triggers create github \
    --project="$PROJECT_ID" \
    --name="$TRIGGER_NAME" \
    --repo-owner="$GITHUB_OWNER" \
    --repo-name="$GITHUB_REPO" \
    --branch-pattern="$RESOLVED_BRANCH_PATTERN" \
    --build-config="$BUILD_CONFIG" \
    --substitutions="$SUBSTS" \
    ${BUILD_SA:+--service-account="$BUILD_SA"} \
    --quiet
  STATUS=$?
  set -e
  if [[ $STATUS -ne 0 ]]; then
    echo "ERROR: Trigger creation via --repo-owner/--repo-name failed (likely due to missing GitHub App connection for owner)." >&2
    echo "Hint: Prefer the connection-based flags. Try one of these:" >&2
    echo "  gcloud builds connections list --project=${PROJECT_ID} --region=\"$CB_LOCATION\"" >&2
    echo "  gcloud builds repositories list --project=${PROJECT_ID} --region=\"$CB_LOCATION\"" >&2
    echo "Then rerun with: --github-connection <CONNECTION_NAME> --github-repo ${GITHUB_REPO}" >&2
    exit 1
  fi
  log "✅ Created GitHub trigger: ${TRIGGER_NAME}"
else
  log "Creating CSR trigger ${TRIGGER_NAME} for repo ${CSR_REPO} on ${RESOLVED_BRANCH_PATTERN}"
  gcloud builds triggers create cloud-source-repositories \
    --project="$PROJECT_ID" \
    --name="$TRIGGER_NAME" \
    --repo="$CSR_REPO" \
    --branch-pattern="$RESOLVED_BRANCH_PATTERN" \
    --build-config="$BUILD_CONFIG" \
    --substitutions="$SUBSTS" \
    ${BUILD_SA:+--service-account="$BUILD_SA"} \
    --quiet
  log "✅ Created CSR trigger: ${TRIGGER_NAME}"
fi
