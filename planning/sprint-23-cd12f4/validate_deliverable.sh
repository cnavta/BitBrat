#!/usr/bin/env bash
set -euo pipefail

echo "Sprint 23 validation — planning artifacts only"
echo "Running root validate_deliverable.sh for build and tests..."

if [ -f "$(git rev-parse --show-toplevel)/validate_deliverable.sh" ]; then
  "$(git rev-parse --show-toplevel)/validate_deliverable.sh"
else
  echo "Root validate_deliverable.sh not found; skipping."
fi

echo "Sprint 23 planning validation complete."
