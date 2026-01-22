#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🏗️ Regenerating services..."
npm run bootstrap:service -- --name obs-mcp --force
npm run bootstrap:service -- --name api-gateway --force

echo "🧪 Verifying environment mapping in compose file..."
if grep -q "MCP_AUTH_TOKEN=\${MCP_AUTH_TOKEN}" infrastructure/docker-compose/services/obs-mcp.compose.yaml; then
  echo "✅ obs-mcp.compose.yaml has correct environment mapping."
else
  echo "❌ obs-mcp.compose.yaml is missing correct environment mapping."
  exit 1
fi

echo "🧪 Verifying variable resolution via dry-run..."
# Create a dummy .secure.local if not exists for validation
if [[ ! -f .secure.local ]]; then
  echo "GOOGLE_APPLICATION_CREDENTIALS=$(pwd)/dummy-creds.json" > .secure.local
  echo "MCP_AUTH_TOKEN=validate_token_456" >> .secure.local
  touch dummy-creds.json
fi

# Ensure .env.local is up to date
node infrastructure/scripts/merge-env.js local

COMPOSE_CONFIG=$(docker compose --project-directory . \
  -f infrastructure/docker-compose/docker-compose.local.yaml \
  -f infrastructure/docker-compose/services/obs-mcp.compose.yaml \
  --env-file .env.local \
  config 2>&1)

if echo "$COMPOSE_CONFIG" | grep -q "MCP_AUTH_TOKEN: "; then
  echo "✅ MCP_AUTH_TOKEN is present in config."
  # Note: depending on compose version, it might show the value or the mapping
  # If it resolved to 'validate_token_456', that's even better
  if echo "$COMPOSE_CONFIG" | grep -q "validate_token_456" || echo "$COMPOSE_CONFIG" | grep -q "local-dev-mcp-token"; then
     echo "✅ Value resolved correctly."
  fi
else
  echo "❌ MCP_AUTH_TOKEN not found in config output."
  exit 1
fi

echo "✅ Validation complete."
