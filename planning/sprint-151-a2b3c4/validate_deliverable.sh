#!/usr/bin/env bash
set -euo pipefail

echo "🔍 Validating documentation artifacts..."

FILES=(
  "planning/sprint-151-a2b3c4/sprint-manifest.yaml"
  "planning/sprint-151-a2b3c4/implementation-plan.md"
  "planning/sprint-151-a2b3c4/architecture-enrichment.md"
  "planning/sprint-151-a2b3c4/request-log.md"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "✅ $file exists."
  else
    echo "❌ $file is missing."
    exit 1
  fi
done

echo "🧪 Running project lint/build to ensure no regressions..."
npm run build --if-present

echo "✅ Validation complete."
