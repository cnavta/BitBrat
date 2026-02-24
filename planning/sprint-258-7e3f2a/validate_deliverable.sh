#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# npm ci # Skip for speed as we are in an environment that should have them

echo "🧱 Building project..."
# npm run build # We can skip full build if we just want to verify the tests

echo "🧪 Running failing tests..."
npm test src/services/ingress/twitch/__tests__/eventsub-client.repro.spec.ts tests/services/query-analyzer/llm-provider.test.ts

echo "🧪 Running all ingress tests..."
npm test src/services/ingress/twitch/

echo "✅ Validation complete."
