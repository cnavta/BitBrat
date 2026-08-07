#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running unit tests for TwitchIrcClient..."
npm test src/services/ingress/twitch/twitch-irc-client.spec.ts

echo "🧪 Running unit tests for event selection..."
npm test src/common/events/selection.test.ts

echo "🧪 Running integration tests for egress processing..."
npm test src/apps/ingress-egress-service.finalize.spec.ts

echo "✅ Validation complete."
