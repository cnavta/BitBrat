#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running unit tests..."
npx jest src/common/__tests__/base-server-yaml.test.ts src/services/twitch-oauth.test.ts

echo "🧪 Running all relevant tests..."
npx jest src/common src/services/oauth

echo "✅ Validation complete."
