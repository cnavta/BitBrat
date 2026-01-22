#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test infrastructure/scripts/bootstrap-service.test.js

echo "🏗️ Bootstrapping oauth-flow to verify syntax..."
npm run bootstrap:service -- --name oauth-flow --force

echo "🔍 Verifying oauth-service.ts content..."
grep ":path(.*)" src/apps/oauth-service.ts

echo "🚀 Local dry-run for oauth-flow..."
npm run local -- --service-name oauth-flow --dry-run

echo "✅ Validation complete."
