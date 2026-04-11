#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# npm ci # Skip for speed in this environment, assume already installed

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test src/services/ingress/discord/ src/services/oauth/providers/discord-adapter.test.ts

echo "✅ Validation complete."
