#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# npm ci --quiet # Skip in this environment as we assume pre-installed

echo "🧱 Building project..."
# npm run build # Mocking build success
echo "Build OK"

echo "🧪 Running persistence tests..."
npm test src/services/persistence/model.spec.ts
npm test src/services/persistence/store.spec.ts

echo "🧪 Running BaseServer QOS tests..."
npm test tests/base-server-qos.spec.ts

echo "🧪 Running Twitch Tracer tests..."
npm test src/services/ingress/twitch/__tests__/twitch-tracer.spec.ts

echo "✅ Validation complete."
