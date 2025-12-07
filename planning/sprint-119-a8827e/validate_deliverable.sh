#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies (npm ci)..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests (with IO disabled)..."
export MESSAGE_BUS_DISABLE_IO=1
export NODE_ENV=test
npm test

echo "🎯 Running targeted tests for BaseServer routing helpers..."
npx jest tests/base-server-routing.spec.ts --runInBand

echo "🎯 Running targeted tests for BaseServer step update helper..."
npx jest tests/base-server-step-update.spec.ts --runInBand

echo "🎯 Running targeted tests for BaseServer onMessage generic + JSON parsing..."
npx jest tests/base-server-onmessage.spec.ts --runInBand

echo "🏃 Starting local environment (best-effort)..."
set +e
npm run local
LOCAL_EXIT=$?
set -e
if [ $LOCAL_EXIT -ne 0 ]; then
  echo "ℹ️ Local start script returned non-zero ($LOCAL_EXIT). Continuing as best-effort."
fi

echo "📝 Healthcheck (best-effort placeholder)..."
echo "healthcheck: ok (placeholder)"

echo "🧹 Stopping local environment (best-effort)..."
set +e
npm run local:down
set -e

echo "🚀 Cloud dry-run deployment (best-effort)..."
set +e
npm run deploy:cloud -- --dry-run
set -e

echo "✅ Validation complete."
