#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
# Run relevant tests
npm test src/services/api-gateway/__tests__/managers.spec.ts
npm test tests/apps/api-gateway-egress.test.ts

echo "✅ Validation complete."
