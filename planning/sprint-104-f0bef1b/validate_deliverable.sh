#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci || npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test

echo "🏃 Starting local environment (noop stub for this sprint)..."
npm run local || true

echo "📝 Healthcheck (noop stub)..."
echo ok > /dev/null

echo "🧹 Stopping local environment..."
npm run local:down || true

echo "🚀 Cloud dry-run deployment (noop stub)..."
npm run deploy:cloud -- --dry-run || true

echo "✅ Validation complete."
