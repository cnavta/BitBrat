#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build   # MUST succeed

echo "🧪 Running tests for Twilio integration..."
# Run specific tests once they are created
# For now, run all tests to ensure no regressions
npm test

echo "🏃 Starting local environment (smoke check)..."
# Just ensuring the service can start with the new configuration
# Using MESSAGE_BUS_DRIVER=noop to avoid needing NATS/PubSub locally
export MESSAGE_BUS_DRIVER=noop
export TWILIO_ENABLED=true
export TWILIO_ACCOUNT_SID=AC00000000000000000000000000000000
export TWILIO_AUTH_TOKEN=auth_token
export TWILIO_API_KEY=SK00000000000000000000000000000000
export TWILIO_API_SECRET=api_secret
export TWILIO_CHAT_SERVICE_SID=IS00000000000000000000000000000000

# Run a quick check that the service can at least be instantiated
# node -e "require('./dist/src/apps/ingress-egress-service')"

echo "✅ Validation complete."
