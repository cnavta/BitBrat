#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build   # MUST succeed

echo "🧪 Running tests (Sprint 225 repro + affected ops + empty slip)..."
npx jest src/services/router/__tests__/sprint-225-repro.spec.ts src/services/router/__tests__/jsonlogic-extra-ops.spec.ts src/services/routing/__tests__/sprint-225-empty-slip.spec.ts

echo "🧪 Running all router tests..."
npm test -- src/services/router

echo "✅ Validation complete."
