#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running OAuth token store tests..."
npm test src/services/oauth/auth-token-store.test.ts

echo "🧪 Running OAuth routes tests..."
npm test src/services/oauth/routes.test.ts

echo "🧪 Running Discord adapter tests..."
npm test src/services/oauth/providers/discord-adapter.test.ts

echo "✅ Validation complete."
