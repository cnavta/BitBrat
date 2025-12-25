#!/usr/bin/env bash
set -euo pipefail

echo "🔍 Validating Sprint 165 Artifacts..."

FILES=(
    "planning/sprint-165-b4e5f6/sprint-manifest.yaml"
    "planning/sprint-165-b4e5f6/implementation-plan.md"
    "planning/sprint-165-b4e5f6/vip-routing-rule.json"
    "planning/sprint-165-b4e5f6/request-log.md"
)

for file in "${FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ Missing file: $file"
        exit 1
    fi
    echo "✅ Found: $file"
done

echo "🧪 Running validation tests..."
npm test src/services/routing/__tests__/vip-rule-validation.spec.ts

echo "✅ Validation complete."
