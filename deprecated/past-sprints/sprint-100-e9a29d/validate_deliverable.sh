#!/usr/bin/env bash
set -euo pipefail

echo "[sprint-100-e9a29d] Running repository-level validation script..."
DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$DIR/../.." && pwd)
cd "$REPO_ROOT"

./validate_deliverable.sh "$@"
