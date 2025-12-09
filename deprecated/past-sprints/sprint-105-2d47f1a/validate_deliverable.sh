#!/usr/bin/env bash
set -euo pipefail

# Wrapper that delegates to the repository-level validation script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${SCRIPT_DIR}/../.."

if [[ ! -f "${REPO_ROOT}/validate_deliverable.sh" ]]; then
  echo "[sprint-105] Error: repo-level validate_deliverable.sh not found at ${REPO_ROOT}" >&2
  exit 2
fi

cd "${REPO_ROOT}"
exec ./validate_deliverable.sh "$@"
