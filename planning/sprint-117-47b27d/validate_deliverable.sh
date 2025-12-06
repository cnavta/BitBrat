#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT_DIR"

echo "[sprint-117-47b27d] Running repository validation script..."

./validate_deliverable.sh "$@"
