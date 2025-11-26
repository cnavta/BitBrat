#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SPRINT_DIR="$SCRIPT_DIR"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

required_files=(
  "$SPRINT_DIR/sprint-manifest.yaml"
  "$SPRINT_DIR/implementation-plan.md"
  "$SPRINT_DIR/request-log.md"
  "$SPRINT_DIR/publication.yaml"
  "$SPRINT_DIR/verification-report.md"
)

echo "🔎 Validating Sprint 7 (plan-only) documentation artifacts..."

for f in "${required_files[@]}"; do
  if [[ -f "$f" ]]; then
    echo "✅ Found: ${f#$ROOT_DIR/}"
  else
    echo "❌ Missing required file: ${f#$ROOT_DIR/}" >&2
    exit 1
  fi
done

if [[ -f "$ROOT_DIR/architecture.yaml" ]]; then
  echo "✅ Found: architecture.yaml (source of truth)"
else
  echo "⚠️ Warning: architecture.yaml not found at repo root; ensure canonical config exists." >&2
fi

echo "✅ All validation steps passed for Sprint 7 plan-only deliverables."
