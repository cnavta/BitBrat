#!/usr/bin/env bash
set -euo pipefail

# Ensure homebrew binaries are in PATH for Junie's environment
export PATH="/opt/homebrew/bin:$PATH"

echo "🔧 Checking environment..."
node -v
npm -v

echo "🧱 Building project..."
npm run build

echo "🧪 Running integration tests..."
npm test tests/integration/mcp-discovery.test.ts

echo "✅ Validation complete."
