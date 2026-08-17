#!/usr/bin/env bash
set -euo pipefail

echo "[sprint-131-873b2a] Delegating to root validate_deliverable.sh..."
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
"$ROOT_DIR/validate_deliverable.sh" "$@"
