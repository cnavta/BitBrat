#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running unit tests for NATS driver..."
npm test src/services/message-bus/nats-driver.test.ts

echo "🧪 Running unit tests for Firestore (if any)..."
# Add relevant firestore tests here if available

echo "🏃 Starting local environment (smoke test)..."
# We only want to see if services start without connection errors
./infrastructure/deploy-local.sh --dry-run # Just check if it handles config correctly

echo "✅ Validation complete (logical check). Real connectivity requires Docker environment."
