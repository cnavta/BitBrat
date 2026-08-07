#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running relevant tests..."
npm test src/common/llm/__tests__/provider-factory.test.ts tests/services/query-analyzer/llm-provider.test.ts

echo "✅ Validation complete."
