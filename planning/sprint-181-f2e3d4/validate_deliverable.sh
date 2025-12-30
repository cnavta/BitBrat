#!/usr/bin/env bash
set -euo pipefail

echo "🧪 Validating documentation artifacts..."

FILES=(
  "planning/sprint-181-f2e3d4/technical-architecture.md"
  "planning/sprint-181-f2e3d4/sprint-manifest.yaml"
  "planning/sprint-181-f2e3d4/implementation-plan.md"
  "planning/sprint-181-f2e3d4/verification-report.md"
  "planning/sprint-181-f2e3d4/retro.md"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "✅ Found $file"
  else
    echo "❌ Missing $file"
    exit 1
  fi
done

echo "✅ Validation complete."
