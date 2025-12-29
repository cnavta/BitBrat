#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running Twilio specific tests..."
npm test src/services/ingress/twilio/

echo "🧪 Running all tests..."
npm test

echo "✅ Validation complete."
