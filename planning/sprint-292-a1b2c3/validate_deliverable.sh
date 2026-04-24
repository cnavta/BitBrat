#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running unit tests for event selection..."
npm test src/common/events/selection.test.ts

echo "🧪 Running regression tests for ingress-egress..."
npm test src/apps/__tests__/account-type-egress.test.ts tests/apps/ingress-egress-egress.test.ts tests/integration/generic-egress.integration.test.ts src/apps/__tests__/ingress-egress-routing.test.ts

echo "🧪 Running finalized tests from previous sprint..."
npm test src/services/ingress/twitch/twitch-irc-client.spec.ts src/apps/ingress-egress-service.finalize.spec.ts

echo "✅ Validation complete."
