#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running auth service tests..."
npm test tests/apps/auth-service.spec.ts

echo "✅ Validation complete."
