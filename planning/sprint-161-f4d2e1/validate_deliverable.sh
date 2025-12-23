#!/usr/bin/env bash
set -euo pipefail

echo "🔍 Validating Sprint 161 Planning Artifacts..."

FILES=(
    "planning/sprint-161-f4d2e1/sprint-manifest.yaml"
    "planning/sprint-161-f4d2e1/implementation-plan.md"
    "planning/sprint-161-f4d2e1/execution-plan.md"
    "planning/sprint-161-f4d2e1/technical-architecture.md"
    "planning/sprint-161-f4d2e1/request-log.md"
    "planning/sprint-161-f4d2e1/backlog.yaml"
)

for file in "${FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ Missing file: $file"
        exit 1
    fi
    echo "✅ Found: $file"
done

echo "🧪 Running tests..."
npm test tests/services/llm-bot/mcp/web-search.test.ts

echo "✅ Validation complete."
