#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test tools/brat/src/cli/setup.test.ts

echo "📝 Verifying setup command registration..."
npm run brat -- setup --help | grep "setup"

echo "✅ Validation complete."
