#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# npm ci # Skip for speed, assume installed

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test src/common/__tests__/assert-required-secrets.test.ts src/services/ingress/discord/discord-bot-token-use.spec.ts

echo "✅ Validation complete."
