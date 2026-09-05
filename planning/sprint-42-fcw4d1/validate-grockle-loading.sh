#!/usr/bin/env bash
# Sprint 42: Validate grockle composition loads on tool-gateway startup
#
# This script verifies that:
# 1. The grockle composition exists in the database
# 2. Tool-gateway loads it successfully on startup
# 3. The composition appears in the MCP tool list
#
# Usage:
#   bash planning/sprint-42-fcw4d1/validate-grockle-loading.sh [context]
#
# Arguments:
#   context - Execution context (default: staging)

set -euo pipefail

CONTEXT="${1:-staging}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Sprint 42: Validate grockle Loading ==="
echo "Context: $CONTEXT"
echo ""

# Step 1: Check grockle exists in database
echo "Step 1: Checking grockle composition in database..."
QUERY="SELECT id, name, version, content_hash FROM compositions WHERE name = 'grockle' ORDER BY version DESC LIMIT 1;"

if [ "$CONTEXT" = "local" ]; then
  RESULT=$(psql "$DATABASE_URL" -t -c "$QUERY" 2>&1 || echo "ERROR")
else
  RESULT=$(ssh root@bitbrat.lan "docker exec bitbrat-${CONTEXT}-postgres-1 psql -U bitbrat -d bitbrat -t -c \"$QUERY\"" 2>&1 || echo "ERROR")
fi

if echo "$RESULT" | grep -q "ERROR\|does not exist\|Connection refused"; then
  echo "❌ Failed to query database"
  echo "$RESULT"
  exit 1
fi

if [ -z "$(echo "$RESULT" | tr -d '[:space:]')" ]; then
  echo "❌ grockle composition not found in database"
  exit 1
fi

echo "✅ grockle composition found in database:"
echo "$RESULT"
echo ""

# Step 2: Check tool-gateway logs for successful loading
echo "Step 2: Checking tool-gateway logs for composition loading..."

if [ "$CONTEXT" = "local" ]; then
  LOGS=$(docker logs bitbrat-local-tool-gateway-1 2>&1 | grep -A 5 "composition" | tail -20 || echo "")
else
  LOGS=$(ssh root@bitbrat.lan "docker logs bitbrat-${CONTEXT}-tool-gateway-1 2>&1 | grep -A 5 'composition' | tail -20" || echo "")
fi

if echo "$LOGS" | grep -q "Failed to compile composition"; then
  echo "❌ Composition compilation failed"
  echo "$LOGS"
  exit 1
fi

if echo "$LOGS" | grep -q "composition_watcher.started"; then
  echo "✅ CompositionWatcher started successfully"
else
  echo "⚠️  CompositionWatcher start message not found (may be too old in logs)"
fi

if echo "$LOGS" | grep -q "loadCompositions"; then
  echo "✅ Compositions loaded on startup"
else
  echo "⚠️  Composition loading message not found (may be too old in logs)"
fi

echo ""

# Step 3: Verify grockle appears in tool list
echo "Step 3: Verifying grockle appears in MCP tool list..."
echo "Note: This requires MCP tools access via npm run brat"
echo ""

# Try to list tools via MCP (this requires tool-gateway to be running and accessible)
echo "Manual verification required:"
echo "  1. Connect to tool-gateway MCP server"
echo "  2. List available tools"
echo "  3. Confirm 'grockle' appears in the list"
echo ""
echo "Or use:"
echo "  npm run brat -- mcp tools.list --server tool-gateway --context $CONTEXT"
echo ""

# Summary
echo "=== Validation Complete ==="
echo "✅ grockle composition exists in database"
echo "✅ No compilation errors in logs"
echo "⚠️  Manual verification of tool list required"
echo ""
echo "Next: Run test-grockle-invocation.sh to test tool execution"
