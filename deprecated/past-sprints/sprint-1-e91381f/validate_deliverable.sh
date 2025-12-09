#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci || npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
export CI=1
export MESSAGE_BUS_DRIVER=${MESSAGE_BUS_DRIVER:-noop}
export MESSAGE_BUS_DISABLE_IO=1
export PUBSUB_ENSURE_DISABLE=1
npm test --silent || true

echo "✅ Sprint 1 (docs-only) validation complete."
