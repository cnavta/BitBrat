#!/usr/bin/env bash
set -euo pipefail

echo "🧪 Validating documentation deliverables for sprint-294-d2e3f4..."

FILES=(
  "planning/sprint-294-d2e3f4/sprint-manifest.yaml"
  "planning/sprint-294-d2e3f4/implementation-plan.md"
  "planning/sprint-294-d2e3f4/analysis-report.md"
  "planning/sprint-294-d2e3f4/architecture-document.md"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "✅ Found $file"
    if [ ! -s "$file" ]; then
      echo "❌ Error: $file is empty"
      exit 1
    fi
  else
    echo "❌ Error: $file missing"
    exit 1
  fi
done

echo "✅ All documentation artifacts verified."
