#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running unit tests..."
npm test src/services/oauth/providers/discord-adapter.test.ts

echo "🧪 Running integration tests..."
npm test src/services/oauth/routes.test.ts

echo "✅ Validation complete."
