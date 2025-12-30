#!/usr/bin/env bash
set -euo pipefail

echo "🔍 Validating sprint artifacts..."

FILES=(
  "planning/sprint-182-e5f6g7/sprint-manifest.yaml"
  "planning/sprint-182-e5f6g7/implementation-plan.md"
  "planning/sprint-182-e5f6g7/backlog.yaml"
  "planning/sprint-182-e5f6g7/verification-report.md"
  "planning/sprint-182-e5f6g7/retro.md"
  "planning/sprint-182-e5f6g7/request-log.md"
)

for file in "${FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "❌ Missing required file: $file"
    exit 1
  fi
  echo "✅ Found: $file"
done

echo "🧪 Validating backlog.yaml format..."
# Basic check for meta and items keys
grep -q "meta:" "planning/sprint-182-e5f6g7/backlog.yaml"
grep -q "items:" "planning/sprint-182-e5f6g7/backlog.yaml"
echo "✅ backlog.yaml structure looks correct."

echo "✅ Validation complete."
