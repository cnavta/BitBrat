#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing deps (if needed)..."
npm install --silent >/dev/null 2>&1 || true

echo "🧱 Building..."
npm run build --silent

echo "🧪 Running focused tests..."
CI=1 npm test --silent src/services/oauth/routes.test.ts src/services/twitch-oauth.test.ts src/apps/oauth-service.oauth-routes.test.ts

echo "✅ Validation complete."
