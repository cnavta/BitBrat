#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"

cd "$ROOT"
echo "[sprint-114] Running top-level validation script..."
if [[ ! -x "$ROOT/validate_deliverable.sh" ]]; then
  echo "Top-level validate_deliverable.sh not found or not executable" >&2
  exit 2
fi
"$ROOT/validate_deliverable.sh" "$@"
echo "[sprint-114] Validation complete."
