#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running unit tests for bootstrap-service..."
npx jest infrastructure/scripts/bootstrap-service.test.js

echo "🧪 Verifying OAuth service dry-run..."
# We can't easily run it and check for success in CI without dependencies, 
# but we can check if it compiles and if the generated code looks correct.
if grep -q "/oauth/(\.\*)" src/apps/oauth-service.ts; then
  echo "✅ oauth-service.ts wildcard updated."
else
  echo "❌ oauth-service.ts wildcard NOT updated correctly."
  exit 1
fi

echo "🧪 Bootstrapping a test service to verify wildcard fix..."
# Mock architecture.yaml entry for a test service
mkdir -p src/apps
node infrastructure/scripts/bootstrap-service.js --name oauth-flow --force

if grep -q "app.get('/oauth/(\.\*)'" src/apps/oauth-service.ts; then
  echo "✅ bootstrapped oauth-service.ts has correct wildcard."
else
  echo "❌ bootstrapped oauth-service.ts has WRONG wildcard."
  exit 1
fi

echo "🧪 Running local dry-run for oauth-flow..."
npm run local -- --service-name oauth-flow --dry-run

echo "✅ Validation complete."
