#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# npm ci # Skip for speed in this environment

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test tests/repro_gateway_roles.spec.ts tests/common/mcp/rbac.spec.ts tests/apps/tool-gateway-rest.spec.ts

echo "✅ Validation complete."
