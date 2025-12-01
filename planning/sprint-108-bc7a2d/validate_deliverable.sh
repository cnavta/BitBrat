#!/usr/bin/env bash
set -euo pipefail

echo "🔗 Delegating to repository-level validation script..."
if [ -x "../../validate_deliverable.sh" ]; then
  (cd ../.. && ./validate_deliverable.sh)
else
  echo "⚠️ Root validate_deliverable.sh not found or not executable. Exiting with non-zero status." >&2
  exit 1
fi
