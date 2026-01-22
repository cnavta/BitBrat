#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
# No specific tests for this fix, but ensuring everything still builds
npm test

echo "🏗️ Bootstrapping obs-mcp..."
npm run bootstrap:service -- --name obs-mcp --force

echo "🧐 Verifying platform in compose file..."
grep "platform: linux/amd64" infrastructure/docker-compose/services/obs-mcp.compose.yaml

echo "🚀 Local dry-run deployment..."
npm run local -- --service-name obs-mcp --dry-run

echo "✅ Validation complete."
