#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
# Skip full build if not needed, but we need brat tool compiled
npm run build:brat || true

echo "🧪 Running tests..."
npm test tools/brat/src/providers/cdktf-synth.lb.spec.ts \
         tools/brat/src/providers/cdktf-synth.loadbalancer.test.ts \
         tools/brat/src/providers/cdktf-synth.loadbalancer.routing.test.ts \
         tools/brat/src/providers/cdktf-synth.restore.test.ts

echo "✅ Validation complete."
