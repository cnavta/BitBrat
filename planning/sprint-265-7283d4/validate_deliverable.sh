#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧪 Running targeted llm-bot and prompt assembly tests..."
npm test -- --runInBand tests/prompt-assembly tests/services/llm-bot

echo "🏗️ Building project..."
npm run build

echo "✅ Sprint validation complete."