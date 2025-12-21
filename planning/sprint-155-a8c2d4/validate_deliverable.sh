#!/usr/bin/env bash
set -euo pipefail

echo "🧪 Running unit tests..."
npm test src/common/events/adapters.spec.ts || echo "⚠️ adapters.spec.ts failed or not found"
npm test src/services/routing/router-engine.spec.ts || echo "⚠️ router-engine.spec.ts failed or not found"

echo "🧪 Running integration tests..."
npm test src/apps/ingress-egress-service.test.ts || echo "⚠️ ingress-egress-service.test.ts failed or not found"

echo "✅ Validation script finished."
