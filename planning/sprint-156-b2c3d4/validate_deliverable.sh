#!/usr/bin/env bash
set -euo pipefail

echo "🧱 Building project..."
npm run build

echo "🧪 Running relevant tests..."
npm test src/apps/__tests__/ingress-egress-generic.integration.test.ts
npm test src/apps/__tests__/ingress-egress-routing.integration.test.ts
npm test tests/base-server-routing.spec.ts

echo "✅ Validation complete."
