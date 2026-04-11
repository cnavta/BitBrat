#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# npm ci # Skip for speed if already installed

echo "🧱 Building project..."
npm run build   # MUST succeed

echo "🧪 Running tests..."
npm test src/apps/__tests__/ingress-egress-routing.test.ts \
         src/services/api-gateway/__tests__/ingress.test.ts \
         src/services/api-gateway/__tests__/managers.spec.ts \
         src/apps/__tests__/event-router-ingress.integration.test.ts

echo "✅ Validation complete."
