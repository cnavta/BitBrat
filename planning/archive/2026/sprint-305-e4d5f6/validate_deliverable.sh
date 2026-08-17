#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# npm ci --quiet

echo "🧱 Building project..."
npm run build --if-present

echo "🧪 Running targeted tests..."
npx jest tests/services/llm-bot/processor-filtering.spec.ts

echo "✅ Validation complete."
