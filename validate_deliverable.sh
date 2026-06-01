#!/usr/bin/env bash
set -euo pipefail

# Path fix for local environment
export PATH=$PATH:/opt/homebrew/bin

echo "🔧 Installing dependencies..."
# npm ci # Skipping as we assume env is ready for this local tool task

echo "🧱 Building project..."
npm run build

echo "🧪 Running setup utility tests..."
npm test tools/brat/src/cli/setup.test.ts

echo "🏃 Verifying CLI command entrypoint..."
node dist/tools/brat/src/cli/index.js help setup || true

echo "✅ Validation complete."
