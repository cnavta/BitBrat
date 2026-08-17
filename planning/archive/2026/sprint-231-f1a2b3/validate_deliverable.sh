#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# npm ci # Skip in this env to save time, assume already there

echo "🧱 Building project..."
npm run build

echo "🧪 Running unit tests..."
npm test tools/brat/src/cli/setup.test.ts

echo "🏃 Validating setup command (dry-run/mock)..."
# We can't easily do a full interactive test, but we can verify the command is registered
npm run brat -- setup --help > /dev/null

echo "✅ Validation complete."
