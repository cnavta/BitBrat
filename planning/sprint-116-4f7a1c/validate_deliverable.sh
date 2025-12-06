#!/usr/bin/env bash
set -euo pipefail

echo "Delegating to repo-level validate_deliverable.sh..."
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

if [[ -x "${REPO_ROOT}/validate_deliverable.sh" ]]; then
  (cd "${REPO_ROOT}" && ./validate_deliverable.sh "$@")
else
  echo "⚠️  Root validate_deliverable.sh not found or not executable; skipping root validation." >&2
  exit 0
fi
