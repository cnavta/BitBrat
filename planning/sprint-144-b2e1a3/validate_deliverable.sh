#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npx jest src/services/ingress/discord/discord-ingress-client.test.ts
npx jest src/common/__tests__/discord-secret.test.ts

echo "🚀 Cloud dry-run deployment..."
# Simulate checking if architecture.yaml is valid for deployment
if grep -q "DISCORD_BOT_TOKEN" architecture.yaml; then
  echo "✅ architecture.yaml contains DISCORD_BOT_TOKEN in secrets."
else
  echo "❌ architecture.yaml is missing DISCORD_BOT_TOKEN in secrets."
  exit 1
fi

echo "✅ Validation complete."
