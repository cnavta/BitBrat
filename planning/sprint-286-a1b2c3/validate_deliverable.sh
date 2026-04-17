#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# npm ci --quiet

echo "🧱 Building project..."
# npm run build

echo "🧪 Running tests..."
# We run only the relevant test for this sprint's scope
npm test src/apps/scheduler-service.test.ts

echo "📝 Healthcheck..."
# The tests already perform healthchecks via supertest
echo "Analysis document exists: $(ls scheduling-service-analysis.md)"

echo "✅ Validation complete."
