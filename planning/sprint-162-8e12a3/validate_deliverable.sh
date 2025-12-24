#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# npm ci # Skip for now to save time if they are already installed

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test src/services/llm-bot/mcp/client-manager.test.ts

echo "✅ Validation complete."
