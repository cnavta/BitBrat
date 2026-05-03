#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# Use install instead of ci because sometimes lockfiles are tricky in these environments
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test tests/apps/api-gateway-auth-debug.test.ts
npm test tests/apps/api-gateway-egress.test.ts

echo "✅ Validation complete."
