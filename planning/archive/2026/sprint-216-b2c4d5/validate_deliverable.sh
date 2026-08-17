#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test infrastructure/scripts/bootstrap-service.test.js

echo "🏗️ Bootstrapping oauth-flow..."
npm run bootstrap:service -- --name oauth-flow --force

echo "🧪 Verifying oauth-service.ts syntax..."
grep -q "app.get('/oauth/{\*path}'" src/apps/oauth-service.ts || (echo "❌ Failed to find correct wildcard syntax in src/apps/oauth-service.ts" && exit 1)

echo "🚀 Local dry-run for oauth-flow..."
npm run local -- --service-name oauth-flow --dry-run

echo "✅ Validation complete."
