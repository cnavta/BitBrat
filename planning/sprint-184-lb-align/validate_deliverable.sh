#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test tools/brat/src/lb
npm test tools/brat/src/providers/cdktf-synth.loadbalancer.test.ts

echo "✅ Validation complete."
