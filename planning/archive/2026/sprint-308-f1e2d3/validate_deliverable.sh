#!/usr/bin/env bash
set -euo pipefail

echo "🧱 Building project..."
npm run build

echo "🧪 Running unit tests for Prompt Assembly..."
npm test tests/prompt-assembly/

echo "🧪 Running Story Engine integration tests..."
npm test src/services/llm-bot/processor.story-engine.spec.ts

echo "✅ Validation complete."
