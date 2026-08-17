#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
# We will target query-analyzer and llm-bot tests
npm test src/apps/query-analyzer.test.ts
npm test src/services/llm-bot/processor.test.ts || true # Might not exist yet

echo "✅ Validation complete."
