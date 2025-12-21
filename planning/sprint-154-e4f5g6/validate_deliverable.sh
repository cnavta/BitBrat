#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build   # MUST succeed

echo "🧪 Running persistence tests..."
npm test -- src/services/persistence/store.spec.ts

echo "✅ Validation complete."
