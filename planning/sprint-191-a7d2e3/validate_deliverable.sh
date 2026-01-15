#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running MCP Server tests..."
npm test tests/common/mcp-server.spec.ts

echo "🧪 Running all tests (silent)..."
npm test -- --silent

echo "✅ Validation complete."
