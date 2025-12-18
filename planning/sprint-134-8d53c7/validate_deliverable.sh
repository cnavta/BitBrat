#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "🔎 Sprint 134 – Validating deliverables (llm-bot scope)"

cd "$ROOT_DIR"

if [[ ! -f "validate_deliverable.sh" ]]; then
  echo "❌ Root validation script not found at $ROOT_DIR/validate_deliverable.sh" >&2
  exit 1
fi

"$ROOT_DIR/validate_deliverable.sh" --scope llm-bot || {
  echo "❌ Validation failed for llm-bot scope" >&2
  exit 2
}

echo "✅ Sprint 134 validation completed successfully."
exit 0
