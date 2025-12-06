#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
export CI=1
export MESSAGE_BUS_DRIVER=${MESSAGE_BUS_DRIVER:-noop}
export MESSAGE_BUS_DISABLE_SUBSCRIBE=1
export MESSAGE_BUS_DISABLE_IO=1
export PUBSUB_ENSURE_DISABLE=1
npm test

echo "🧩 Verifying sprint artifacts exist..."
test -f "planning/sprint-112-7f5377b/sprint-manifest.yaml"
test -f "planning/sprint-112-7f5377b/implementation-plan.md"
test -f "planning/sprint-112-7f5377b/request-log.md"

echo "🩺 Brat doctor (CI-safe)..."
npm run brat -- doctor --ci --json >/dev/null 2>&1 || echo "(non-fatal) brat doctor check failed"

echo "✅ Validation complete for planning deliverable."
