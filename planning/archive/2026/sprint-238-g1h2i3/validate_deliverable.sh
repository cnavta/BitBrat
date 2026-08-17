#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test src/services/api-gateway/__tests__/auth.spec.ts
npm test tools/brat/src/cli/setup.test.ts

echo "✅ Validation complete."
