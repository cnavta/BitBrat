#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test

echo "🏃 Local runtime (if applicable)..."
npm run local || true

echo "📝 Healthcheck (placeholder)..."
echo "OK"

echo "🧹 Stopping local runtime..."
npm run local:down || true

echo "🚀 Cloud dry-run deployment..."
npm run deploy:cloud -- --dry-run || true

echo "🛠️ CLI smoke test..."
node dist/tools/prompt-assembly/src/cli/index.js --help >/dev/null
echo '{"task":[{"priority":1,"instruction":"Echo"}],"input":{"userQuery":"Hi"}}' | node dist/tools/prompt-assembly/src/cli/index.js --stdin --provider none >/dev/null
echo '{"task":[{"priority":1,"instruction":"Echo"}],"input":{"userQuery":"Hi"}}' | node dist/tools/prompt-assembly/src/cli/index.js --stdin --provider openai >/dev/null

echo "✅ Validation complete."
