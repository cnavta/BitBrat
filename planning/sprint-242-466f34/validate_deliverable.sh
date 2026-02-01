#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npx jest tests/services/query-analyzer/llm-provider.test.ts
npx jest src/apps/query-analyzer.test.ts
npx jest tests/services/llm-bot/prompt-logging.test.ts
npx jest tests/services/llm-bot/mcp-visibility.test.ts

echo "✅ Validation complete."
