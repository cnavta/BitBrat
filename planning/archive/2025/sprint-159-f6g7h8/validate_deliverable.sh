#!/usr/bin/env bash
set -euo pipefail

echo "🧱 Building project..."
npm run build

echo "🧪 Running LLM Bot tests..."
npm test tests/services/llm-bot/

echo "✅ Validation complete."
