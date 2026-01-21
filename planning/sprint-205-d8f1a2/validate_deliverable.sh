#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Verifying bootstrap command..."
# Use a temporary name to avoid conflicts if needed, but we already added test-svc to architecture.yaml
TEST_SVC="test-svc"

# Cleanup any previous runs
rm -f src/apps/${TEST_SVC}.ts
rm -f src/apps/${TEST_SVC}.test.ts
rm -f Dockerfile.${TEST_SVC}
rm -f infrastructure/docker-compose/services/${TEST_SVC}.compose.yaml

echo "🏃 Running: BITBRAT_INTERPOLATION=0 npm run brat -- service bootstrap --name ${TEST_SVC} --mcp"
BITBRAT_INTERPOLATION=0 npm run brat -- service bootstrap --name ${TEST_SVC} --mcp

echo "🔍 Checking generated files..."
ls -l src/apps/${TEST_SVC}.ts
ls -l src/apps/${TEST_SVC}.test.ts
ls -l Dockerfile.${TEST_SVC}
ls -l infrastructure/docker-compose/services/${TEST_SVC}.compose.yaml

grep "McpServer" src/apps/${TEST_SVC}.ts
grep "test-svc" src/apps/${TEST_SVC}.ts

echo "🧱 Attempting to build generated service..."
# Force regeneration and rebuild
BITBRAT_INTERPOLATION=0 npm run brat -- service bootstrap --name ${TEST_SVC} --mcp --force
npm run build

echo "✅ Validation complete."
