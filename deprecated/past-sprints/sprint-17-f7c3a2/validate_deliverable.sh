#!/usr/bin/env bash
set -euo pipefail

# Sprint 17 validation shim — delegates to root validator
# Usage: ./validate_deliverable.sh --env <env> --project-id <PROJECT_ID> [--extra ARGS]

ROOT_DIR="$(cd "$(dirname "$0")"/../.. && pwd)"

cd "$ROOT_DIR"

if [[ ! -x ./validate_deliverable.sh ]]; then
  echo "Root validate_deliverable.sh not found or not executable" >&2
  exit 1
fi

./validate_deliverable.sh "$@"

echo "Sprint 17 shim completed."
