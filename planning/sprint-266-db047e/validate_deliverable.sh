#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT"

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧹 Linting touched production files..."
npx eslint \
  src/apps/event-router-service.ts \
  src/apps/llm-bot-service.ts \
  src/apps/query-analyzer.ts \
  src/common/base-server.ts \
  src/services/router/rule-loader.ts \
  src/services/router/rule-mapper.ts \
  src/services/routing/dlq.ts \
  src/services/routing/router-engine.ts \
  src/services/routing/slip.ts \
  src/types/events.ts

echo "🧪 Running wrapped-routing and staged-route regression suites..."
export CI=1
export MESSAGE_BUS_DRIVER="${MESSAGE_BUS_DRIVER:-noop}"
export DISCORD_ENABLED="${DISCORD_ENABLED:-false}"
export MESSAGE_BUS_DISABLE_IO=1
export PUBSUB_ENSURE_DISABLE=1

npm test -- --runInBand \
  src/services/router \
  src/services/routing \
  src/services/llm-bot \
  src/apps/__tests__/event-router-ingress.integration.test.ts \
  src/apps/query-analyzer.test.ts \
  src/types/events.types.test.ts \
  tests/llm-bot-service.spec.ts \
  tests/base-server-step-update.spec.ts \
  tests/base-server-routing.spec.ts \
  tests/router-annotations-e2e.spec.ts \
  tests/services/llm-bot/processor.spec.ts \
  tests/services/llm-bot/processor-tools.spec.ts \
  tests/services/query-analyzer/llm-provider.test.ts \
  tests/services/rule-mapper.test.ts \
  tests/sprint-225-egress-dest.spec.ts

echo "🏃 Local runtime checks..."
echo "Skipping local runtime start/healthcheck: this sprint changed routing contracts and staged route promotion logic, with no infrastructure or local deployment workflow changes."

echo "🚀 Cloud dry-run deployment..."
if [[ -n "${PROJECT_ID:-}" ]]; then
  npm run deploy:cloud -- --dry-run
else
  echo "Skipping cloud dry-run deployment because PROJECT_ID is not set in this environment."
fi

echo "✅ Validation complete."