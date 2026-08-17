#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧪 Running targeted tests..."
npm test tools/brat/src/providers/cdktf-synth.lb.spec.ts tools/brat/src/providers/cdktf-synth.loadbalancer.test.ts tools/brat/src/providers/cdktf-synth.loadbalancer.routing.test.ts

echo "🧪 Running all tests..."
npm test

echo "✅ Validation complete."