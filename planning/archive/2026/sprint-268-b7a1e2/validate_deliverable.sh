#!/usr/bin/env bash
set -euo pipefail

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test src/services/oauth/providers/discord-adapter.test.ts src/services/oauth/routes.test.ts

echo "✅ Validation complete."
