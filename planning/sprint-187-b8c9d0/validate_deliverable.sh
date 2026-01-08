#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build   # MUST succeed

echo "🧪 Running tests..."
npm test        # MUST pass

echo "🚀 Cloud dry-run deployment..."
npm run deploy:cloud -- --dry-run || true

echo "🧭 Infra dry-run validation (env=dev, project=bitbrat-local)"
# Using brat to plan LB and verify URL map renderer
npm run brat -- infra plan lb --env dev --project-id bitbrat-local --dry-run

echo "✅ Validation complete."