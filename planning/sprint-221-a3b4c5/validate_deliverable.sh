#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running unit tests for TwitchIrcClient..."
npm test -- src/services/ingress/twitch/twitch-irc-client.spec.ts

echo "🧪 Running general project tests..."
# We run a subset or all tests depending on time/scope
npm test -- src/services/ingress tests/common

echo "✅ Validation complete."
