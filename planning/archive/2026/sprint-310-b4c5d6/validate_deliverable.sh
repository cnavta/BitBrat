#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
export PATH="/opt/homebrew/bin:$PATH"
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running auth service and enrichment tests..."
export CI=1
export MESSAGE_BUS_DRIVER=noop
export MESSAGE_BUS_DISABLE_IO=1
export PUBSUB_ENSURE_DISABLE=1
npm test src/services/auth tests/apps/auth-service-events.spec.ts tests/apps/auth-service.spec.ts

echo "✅ Validation complete."
