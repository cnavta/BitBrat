#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running unit tests..."
npm test tools/brat/src/cli/__tests__/chat.test.ts tools/brat/src/cli/setup.test.ts

echo "🏃 Verifying CLI command registration..."
npm run brat -- --help | grep -E "setup|chat"

echo "✅ Validation complete."
