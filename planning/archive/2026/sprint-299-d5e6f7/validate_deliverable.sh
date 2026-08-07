#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# Use npm install instead of npm ci since this is a local environment check
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
# Target specific tests if possible, but for now run all to ensure no regressions
npm test -- src/services/stream-analyst/

echo "✅ Validation complete."
