#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# npm ci # Skip for speed in this environment as they should be present

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests for brat chat..."
npx jest tools/brat/src/cli/__tests__/chat.test.ts

echo "✅ Validation complete."
