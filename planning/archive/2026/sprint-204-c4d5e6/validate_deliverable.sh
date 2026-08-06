#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# npm ci # Skip for now as it takes too long in this environment

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
# Run auth and user-repo related tests
npm test src/services/auth/__tests__/user-repo-admin.spec.ts src/apps/__tests__/auth-service-mcp.spec.ts src/services/auth/__tests__/user-repo.spec.ts

echo "✅ Validation complete."
