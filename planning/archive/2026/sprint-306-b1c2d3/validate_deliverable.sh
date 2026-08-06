#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build   # MUST succeed

echo "🧪 Running tests..."
# Run the relevant tests
npx jest tests/prompt-assembly/assemble.spec.ts tests/services/llm-bot/processor.spec.ts

echo "✅ Validation complete."
