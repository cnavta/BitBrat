#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
# Skip tests for now as we don't have unit tests for this specific tool change yet,
# but we want to ensure everything compiles.
npm test -- tests/common/mcp-server.spec.ts

echo "🏃 Verifying brat command (dry-run)..."
export BITBRAT_ENV=dev
npm run brat -- cloud-run shutdown --dry-run --project-id bitbrat-local

echo "✅ Validation complete."
