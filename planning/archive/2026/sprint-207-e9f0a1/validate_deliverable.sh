#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Building brat tool..."
npm run build

echo "🧪 Running brat service bootstrap..."
BITBRAT_INTERPOLATION=0 node dist/tools/brat/src/cli/index.js service bootstrap --name api-gateway --force

echo "🔍 Verifying generated compose file..."
COMPOSE_FILE="infrastructure/docker-compose/services/api-gateway.compose.yaml"
if ! grep -q "context: ." "$COMPOSE_FILE"; then
  echo "❌ Error: context should be '.' in $COMPOSE_FILE"
  exit 1
fi

if ! grep -q "API_GATEWAY_HOST_PORT" "$COMPOSE_FILE"; then
  echo "❌ Error: missing API_GATEWAY_HOST_PORT in $COMPOSE_FILE"
  exit 1
fi

echo "🏗️ Verifying docker build (dry-run/config check)..."
# Use config check to verify paths resolve correctly with project directory
GOOGLE_APPLICATION_CREDENTIALS=/dev/null docker compose --project-directory . -f "$COMPOSE_FILE" config --no-interpolate > config_out.yaml
# Normalize paths for comparison (realpath)
RESOLVED_CONTEXT=$(grep "context:" config_out.yaml | head -n 1 | awk '{print $2}')
EXPECTED_CONTEXT=$(pwd)

if [ "$RESOLVED_CONTEXT" != "$EXPECTED_CONTEXT" ]; then
  echo "❌ Error: context did not resolve to project root"
  echo "Expected: $EXPECTED_CONTEXT"
  echo "Got:      $RESOLVED_CONTEXT"
  cat config_out.yaml
  rm config_out.yaml
  exit 1
fi
rm config_out.yaml

echo "✅ Validation complete."
