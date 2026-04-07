#!/usr/bin/env bash
set -euo pipefail

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test src/services/oauth/routes.test.ts src/services/twitch-oauth.test.ts src/apps/oauth-service.oauth-routes.test.ts

echo "✅ Validation complete."
