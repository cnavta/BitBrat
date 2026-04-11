#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running unit tests..."
npx jest src/services/api-gateway/utils/__tests__/variable-resolver.test.ts
npx jest src/services/api-gateway/utils/__tests__/formatters.test.ts
npx jest src/services/api-gateway/__tests__/webhook-manager.test.ts

echo "🧪 Running existing api-gateway tests..."
npx jest src/services/api-gateway/__tests__/managers.spec.ts

echo "✅ Validation complete."
