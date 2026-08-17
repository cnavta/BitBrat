#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Verifying firebase.json configuration..."
if grep -q '"websocketPort": 9150' firebase.json; then
  echo "✅ firebase.json contains websocketPort: 9150"
else
  echo "❌ firebase.json missing websocketPort: 9150"
  exit 1
fi

echo "🧪 Verifying docker-compose.local.yaml port mapping..."
if grep -q '"9150:9150"' infrastructure/docker-compose/docker-compose.local.yaml; then
  echo "✅ docker-compose.local.yaml exposes port 9150"
else
  echo "❌ docker-compose.local.yaml missing port 9150"
  exit 1
fi

echo "🚀 Local deployment check (dry-run)..."
./infrastructure/deploy-local.sh --dry-run

echo "✅ Validation complete."
