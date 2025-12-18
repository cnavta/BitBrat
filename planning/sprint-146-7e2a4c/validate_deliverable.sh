#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running routing tests..."
npx jest src/apps/__tests__/ingress-egress-routing.test.ts

echo "🧪 Running all relevant tests..."
npx jest src/apps src/services/ingress src/services/command-processor

echo "✅ Validation complete."
