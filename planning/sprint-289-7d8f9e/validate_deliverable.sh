#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# npm ci

echo "🧱 Building project..."
# npm run build

echo "🧪 Running tests..."
# No new tests for this sprint as per minimal requirements, but verify build
npm run build

echo "📝 Healthcheck..."
# Verify image-gen-mcp service is reachable via build check and presence of files
ls src/services/image-gen-mcp/index.ts
ls Dockerfile.image-gen-mcp
grep "image-gen-mcp" architecture.yaml
grep "bitbrat-media-gen" infrastructure/gcs-buckets.yaml

echo "✅ Validation complete."
