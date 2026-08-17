#!/usr/bin/env bash
set -euo pipefail
echo "🔧 Installing dependencies..."
npm ci
echo "🧱 Building project..."
npm run build
echo "🧪 Running unit tests..."
npm test tools/brat/src/cli/setup.test.ts
echo "🏃 Validating setup command registration..."
npm run brat -- setup --help > /dev/null
echo "✅ Validation complete."
