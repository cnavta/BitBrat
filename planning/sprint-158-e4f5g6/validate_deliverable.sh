#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running llm-bot tests..."
npm test tests/services/llm-bot/

echo "✅ Validation complete."
