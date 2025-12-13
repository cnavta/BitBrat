#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${SCRIPT_DIR}/../.."

cd "$REPO_ROOT"

echo "[sprint-128-4f7a2c] Delegating to root validate_deliverable.sh..."
./validate_deliverable.sh "$@"

echo "[sprint-128-4f7a2c] Validation script completed."
