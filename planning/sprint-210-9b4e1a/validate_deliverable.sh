#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Verifying bootstrap-service logic..."

# 1. Verify obs-mcp (image-based)
echo "   - Bootstrapping obs-mcp..."
npm run bootstrap:service -- --name obs-mcp --force

COMPOSE_FILE="infrastructure/docker-compose/services/obs-mcp.compose.yaml"
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "❌ Error: $COMPOSE_FILE not found"
  exit 1
fi

echo "   - Verifying obs-mcp.compose.yaml content..."
grep "image: us-central1-docker.pkg.dev/bitbrat-local/obs-mcp/obs-mcp:latest" "$COMPOSE_FILE"
grep "MCP_TRANSPORT" "$COMPOSE_FILE"
grep "OBS_WEBSOCKET_PASSWORD" "$COMPOSE_FILE"

# 2. Verify an entry-based service (api-gateway)
echo "   - Bootstrapping api-gateway..."
npm run bootstrap:service -- --name api-gateway --force

GW_COMPOSE_FILE="infrastructure/docker-compose/services/api-gateway.compose.yaml"
if [[ ! -f "$GW_COMPOSE_FILE" ]]; then
  echo "❌ Error: $GW_COMPOSE_FILE not found"
  exit 1
fi

echo "   - Verifying api-gateway.compose.yaml content..."
grep "build:" "$GW_COMPOSE_FILE"
grep "dockerfile: Dockerfile.api-gateway" "$GW_COMPOSE_FILE"

echo "🏃 Local dry-run check..."
# Check if deploy-local.sh can find and process the new compose file
npm run local -- --dry-run --service-name obs-mcp

echo "✅ Validation complete."
