#!/usr/bin/env bash
set -euo pipefail
echo "🧪 Running MCP Server tests..."
npx jest tests/common/mcp-server.spec.ts
echo "🧱 Building project..."
npm run build
echo "✅ Validation complete."