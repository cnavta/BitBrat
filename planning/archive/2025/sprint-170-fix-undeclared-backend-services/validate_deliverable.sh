#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# Skip npm ci if node_modules already exists to save time in Junie env
if [ ! -d "node_modules" ]; then
  npm ci
fi

echo "🧱 Building project..."
npm run build

echo "🧪 Running synthesis tests..."
npm test tools/brat/src/providers/cdktf-synth.restore.test.ts
npm test tools/brat/src/providers/cdktf-synth.lb.spec.ts
npm test tools/brat/src/providers/cdktf-synth.loadbalancer.test.ts
npm test tools/brat/src/providers/cdktf-synth.loadbalancer.routing.test.ts

echo "✅ Validation complete."
