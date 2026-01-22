#!/usr/bin/env bash
set -euo pipefail

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test infrastructure/scripts/bootstrap-service.test.js

echo "🏗️ Verifying llm-bot.compose.yaml content..."
grep "MCP_AUTH_TOKEN=\${MCP_AUTH_TOKEN}" infrastructure/docker-compose/services/llm-bot.compose.yaml
grep "obs-mcp" infrastructure/docker-compose/services/llm-bot.compose.yaml
grep "auth" infrastructure/docker-compose/services/llm-bot.compose.yaml
grep "scheduler" infrastructure/docker-compose/services/llm-bot.compose.yaml

echo "🚀 Local dry-run for llm-bot..."
npm run local -- --dry-run --service-name llm-bot

echo "🚀 Local dry-run for obs-mcp..."
npm run local -- --dry-run --service-name obs-mcp

echo "✅ Validation complete."
