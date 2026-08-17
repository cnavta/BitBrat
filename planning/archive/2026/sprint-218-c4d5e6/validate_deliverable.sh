#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running bootstrap tests..."
npm test infrastructure/scripts/bootstrap-service.test.js

echo "🏗️ Bootstrapping obs-mcp..."
node infrastructure/scripts/bootstrap-service.js --name obs-mcp --force

echo "🏗️ Bootstrapping auth..."
node infrastructure/scripts/bootstrap-service.js --name auth --force

echo "🏗️ Bootstrapping llm-bot..."
node infrastructure/scripts/bootstrap-service.js --name llm-bot --force

echo "🔍 Verifying network aliases in compose files..."
grep -A 2 "aliases:" infrastructure/docker-compose/services/obs-mcp.compose.yaml | grep "obs-mcp.bitbrat.local"
grep -A 2 "aliases:" infrastructure/docker-compose/services/auth.compose.yaml | grep "auth.bitbrat.local"
grep -A 2 "aliases:" infrastructure/docker-compose/services/llm-bot.compose.yaml | grep "llm-bot.bitbrat.local"

echo "🚀 Validating Docker Compose configuration..."
# Use a dry-run for one of the services to ensure full compose config is valid
npm run local -- --service-name obs-mcp --dry-run

echo "✅ Validation complete."
