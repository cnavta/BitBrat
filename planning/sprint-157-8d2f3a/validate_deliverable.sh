#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running sprint-specific tests..."
npm test tests/services/llm-bot/prompt-logging.test.ts

echo "🧪 Running related service tests..."
npm test tests/services/llm-bot/personality-with-memory.spec.ts

echo "✅ Validation complete."
