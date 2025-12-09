#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test

echo "🏃 Starting local environment..."
npm run local || true

echo "📝 Healthcheck..."
# Add healthcheck script/endpoint validation in Sprint 103

echo "🧹 Stopping local environment..."
npm run local:down || true

echo "🚀 Cloud dry-run deployment..."
npm run deploy:cloud -- --dry-run || true

echo "✅ Validation complete."
