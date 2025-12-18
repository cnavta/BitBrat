#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build   # MUST succeed

echo "🧪 Running tests..."
npx jest src/apps src/services/ingress

echo "✅ Validation complete."
