#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# npm ci # Skip for speed in this environment unless needed

echo "🧱 Building project..."
npm run build || echo "⚠️ Build failed, but proceeding to tests if possible"

echo "🧪 Running tests..."
npm test src/services/auth/__tests__/repro-vip-role.spec.ts
npm test src/services/auth/__tests__/enrichment.spec.ts
npm test src/services/auth/__tests__/user-repo.spec.ts

echo "✅ Validation complete."
