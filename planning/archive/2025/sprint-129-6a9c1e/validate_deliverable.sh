#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${SCRIPT_DIR}/../.."

cd "$REPO_ROOT"

echo "[sprint-129-6a9c1e] Delegating to root validate_deliverable.sh..."
./validate_deliverable.sh "$@"

echo "[sprint-129-6a9c1e] Validation script completed."
