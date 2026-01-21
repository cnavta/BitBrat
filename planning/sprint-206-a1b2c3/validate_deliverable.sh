#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
# Run brat tests if they exist
npm test tools/brat

echo "🏃 Running brat service bootstrap (the fix verification)..."
# Use a name that is in architecture.yaml to trigger the interpolation check
npm run brat -- service bootstrap --name api-gateway --force

echo "📝 Verifying generated files..."
ls -l src/apps/api-gateway.ts
ls -l src/apps/api-gateway.test.ts
ls -l Dockerfile.api-gateway

echo "🚀 Verifying no doubled paths..."
if [ -d "src/apps/src" ]; then
  echo "❌ Doubled directory src/apps/src FOUND"
  exit 1
fi

echo "✅ Validation complete."
