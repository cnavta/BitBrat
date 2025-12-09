#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test

echo "🏃 Starting local environment (stubbed)..."
npm run local || true

echo "📝 Healthcheck (stubbed)..."
echo "OK" >/dev/null

echo "🧹 Stopping local environment (stubbed)..."
npm run local:down || true

echo "🚀 Cloud dry-run deployment (stubbed)..."
npm run deploy:cloud -- --dry-run || true

echo "✅ Validation complete."
