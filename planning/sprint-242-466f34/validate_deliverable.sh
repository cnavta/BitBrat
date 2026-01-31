#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npx jest tests/services/query-analyzer/llm-provider.test.ts

echo "✅ Validation complete."
