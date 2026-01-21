#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Building brat tool..."
npm run build

echo "🧪 Bootstrapping test service..."
# Disable interpolation for now as it fails in this environment due to missing variables
BITBRAT_INTERPOLATION=0 node dist/tools/brat/src/cli/index.js service bootstrap --name api-gateway --force

echo "🔍 Verifying depends_on in compose file..."
COMPOSE_FILE="infrastructure/docker-compose/services/api-gateway.compose.yaml"
if grep -q "depends_on:" "$COMPOSE_FILE" && \
   grep -q "nats:" "$COMPOSE_FILE" && \
   grep -q "firebase-emulator:" "$COMPOSE_FILE" && \
   grep -q "condition: service_healthy" "$COMPOSE_FILE"; then
  echo "✅ Found expected dependencies."
else
  echo "❌ Dependencies missing or incorrect in $COMPOSE_FILE"
  cat "$COMPOSE_FILE"
  exit 1
fi

echo "🧹 Cleaning up..."
rm -f Dockerfile.api-gateway
rm -f src/apps/api-gateway.ts
rm -f src/apps/api-gateway.test.ts
rm -f "$COMPOSE_FILE"

echo "✅ Validation complete."
