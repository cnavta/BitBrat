#!/usr/bin/env bash
set -euo pipefail

echo "🧱 Building..."
npm run build

echo "🧪 Running tests..."
npm test src/services/oauth/auth-token-store.test.ts src/services/oauth/routes.test.ts src/services/oauth/providers/discord-adapter.test.ts

echo "✅ Validation complete."
