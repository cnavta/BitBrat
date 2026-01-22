#!/usr/bin/env bash
set -euo pipefail

echo "🔍 Validating sprint artifacts..."

FILES=(
  "planning/sprint-209-f8e9d0/sprint-manifest.yaml"
  "planning/sprint-209-f8e9d0/implementation-plan.md"
  "planning/sprint-209-f8e9d0/technical-architecture.md"
  "planning/sprint-209-f8e9d0/request-log.md"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "✅ Found $file"
  else
    echo "❌ Missing $file"
    exit 1
  fi
done

echo "📝 Checking technical-architecture.md content..."
grep -q "WebSocket" "planning/sprint-209-f8e9d0/technical-architecture.md"
grep -q "McpServer" "planning/sprint-209-f8e9d0/technical-architecture.md"
grep -q "Bearer" "planning/sprint-209-f8e9d0/technical-architecture.md"
grep -q "chat.message.send" "planning/sprint-209-f8e9d0/technical-architecture.md"

echo "✅ Validation complete."
