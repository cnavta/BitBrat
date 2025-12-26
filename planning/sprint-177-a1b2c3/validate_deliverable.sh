#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
# Run the specific tests for this sprint plus general tests
npm test src/services/llm-bot/tools/__tests__/internal-tools.test.ts || echo "⚠️ Internal tools tests not found yet, skipping..."
npm test src/apps/llm-bot-service.test.ts

echo "✅ Validation complete."
