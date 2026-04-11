#!/usr/bin/env bash
set -euo pipefail

echo "🧱 Building project..."
npm run build

echo "🧪 Running affected tests..."
npm test src/services/oauth/routes.test.ts src/services/oauth/providers/discord-adapter.test.ts

echo "✅ Validation complete."
