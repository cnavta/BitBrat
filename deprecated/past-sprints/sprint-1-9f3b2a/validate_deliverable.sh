#!/usr/bin/env bash
set -euo pipefail

# Sprint 1 validation scaffold (planning only)
# This script documents the intended validation flow. Implementation will be finalized after code lands.

echo "[planning/validate] Note: Run this from the repository root (where package.json and architecture.yaml reside)."
if [[ ! -f "package.json" || ! -f "architecture.yaml" ]]; then
  echo "[planning/validate] Error: please run this script from the repository root." >&2
  exit 2
fi

echo "🔧 Installing dependencies..."
echo "npm ci"

echo "🧱 Compiling..."
echo "npm run build"

echo "🧪 Running tests..."
echo "npm test"

echo "🐳 Building oauth-flow container (local)..."
echo "docker build -f Dockerfile.oauth-flow -t bitbrat/oauth-flow:local ."

echo "🚀 Starting local infra + oauth-flow via Docker Compose (includes)..."
echo "docker compose \
  -f infrastructure/docker-compose/docker-compose.local.yaml \
  -f infrastructure/docker-compose/services/oauth-flow.compose.yaml \
  up -d --build"

echo "🔍 Probing health endpoints..."
echo "curl -sf http://localhost:3000/healthz"
echo "curl -sf http://localhost:3000/readyz"
echo "curl -sf http://localhost:3000/livez"

echo "🧹 Teardown guidance..."
echo "docker compose \
  -f infrastructure/docker-compose/docker-compose.local.yaml \
  -f infrastructure/docker-compose/services/oauth-flow.compose.yaml \
  down"

echo "✅ Validation flow scaffold complete (no commands executed)."