#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running unit tests..."
npx jest src/services/oauth/providers/discord-adapter.test.ts src/common/__tests__/discord-config.test.ts

echo "🧪 Running all relevant tests..."
npx jest src/common src/services/oauth

echo "✅ Validation complete."
