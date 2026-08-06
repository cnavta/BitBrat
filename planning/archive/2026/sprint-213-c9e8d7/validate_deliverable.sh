#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🏗️ Bootstrapping services..."
npm run bootstrap:service -- --name obs-mcp --force
npm run bootstrap:service -- --name api-gateway --force

echo "🧪 Verifying network configuration..."
grep -q "bitbrat-network" infrastructure/docker-compose/services/obs-mcp.compose.yaml
grep -q "bitbrat-network" infrastructure/docker-compose/services/api-gateway.compose.yaml

echo "🧪 Dry-run local deployment..."
# Use a dummy key for dry-run if not present
if [ ! -f dummy-creds.json ]; then
  echo '{"type": "service_account"}' > dummy-creds.json
fi

# Ensure GOOGLE_APPLICATION_CREDENTIALS is set for config validation
export GOOGLE_APPLICATION_CREDENTIALS=$(pwd)/dummy-creds.json

# Check if .env.local exists, if not create it
if [ ! -f .env.local ]; then
  npm run bootstrap:env -- local
fi

echo "🧪 Validating Docker Compose config..."
# Use --project-directory to ensure .env.local is found correctly
docker compose \
  --project-directory . \
  -f infrastructure/docker-compose/docker-compose.local.yaml \
  -f infrastructure/docker-compose/services/obs-mcp.compose.yaml \
  --env-file .env.local \
  config > /dev/null

echo "✅ Validation complete."
