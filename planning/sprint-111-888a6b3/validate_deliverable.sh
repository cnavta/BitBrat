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
test -f "planning/sprint-111-888a6b3/sprint-manifest.yaml"
test -f "planning/sprint-111-888a6b3/implementation-plan.md"
test -f "planning/sprint-111-888a6b3/request-log.md"

echo "ℹ️  Checking brat CLI availability (help only)..."
npm run brat -- --help >/dev/null 2>&1 || echo "(non-fatal) brat CLI help check failed; CLI will be implemented in future sprints."

echo "🧪 Dry-run single-service deploy (oauth-flow)..."
# Use a placeholder project ID and skip VPC preflight via --dry-run
npm run brat -- deploy service oauth-flow --env dev --project-id demo-project --region us-central1 --dry-run --allow-no-vpc || true

echo "✅ Validation complete for planning deliverable."
