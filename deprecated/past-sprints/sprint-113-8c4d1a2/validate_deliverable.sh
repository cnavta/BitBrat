#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test

echo "🧪 Infra plan (dry-run): network"
npm run brat -- infra plan network --env dev --project-id "${PROJECT_ID:-bitbrat-local}" --dry-run || true

echo "🧪 Infra plan (dry-run): connectors"
npm run brat -- infra plan connectors --env dev --project-id "${PROJECT_ID:-bitbrat-local}" --dry-run || true

echo "✅ Validation complete."
