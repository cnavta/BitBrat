#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running query-analyzer tests (if any)..."
# Since we don't have specific tests for this service yet, we just check build.
# In a real scenario, we'd add a test here.

echo "✅ Validation complete."
