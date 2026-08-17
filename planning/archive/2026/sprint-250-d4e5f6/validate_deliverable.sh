#!/usr/bin/env bash
set -euo pipefail

echo "🧪 Running query-analyzer tests..."
npx jest tests/services/query-analyzer/llm-provider.test.ts

echo "🧱 Building project..."
npm run build

echo "✅ Validation complete."
