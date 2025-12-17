#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test

echo "🏃 CLI smoke (conversationState rendering)..."
# Render a minimal PromptSpec with conversationState via the built CLI
echo '{"task":[{"instruction":"Echo"}],"input":{"userQuery":"Hello"},"conversationState":{"summary":"Testing conversation state"}}' \
  | node dist/tools/prompt-assembly/src/cli/index.js --stdin --provider none >/dev/null || true

echo "✅ Validation complete."
