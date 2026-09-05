#!/usr/bin/env bash
# Sprint 42: Test grockle composition invocation
#
# This script tests that the grockle composition can be successfully invoked
# via the MCP tool interface.
#
# Usage:
#   bash planning/sprint-42-fcw4d1/test-grockle-invocation.sh [context]
#
# Arguments:
#   context - Execution context (default: staging)

set -euo pipefail

CONTEXT="${1:-staging}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Sprint 42: Test grockle Invocation ==="
echo "Context: $CONTEXT"
echo ""

# Step 1: Invoke grockle tool
echo "Step 1: Invoking grockle tool via MCP..."
echo "Command: npm run brat -- mcp tools.call --server tool-gateway --tool grockle --args '{}' --context $CONTEXT"
echo ""

# Note: This requires brat MCP tools access
# For now, provide manual instructions

echo "Manual test steps:"
echo "1. Run: npm run brat -- mcp tools.call --server tool-gateway --tool grockle --args '{}' --context $CONTEXT"
echo "2. Verify the response contains expected output"
echo "3. Check tool-gateway logs for execution trace"
echo ""

# Step 2: Check logs for invocation
echo "Step 2: Checking tool-gateway logs for invocation..."

if [ "$CONTEXT" = "local" ]; then
  LOGS=$(docker logs bitbrat-local-tool-gateway-1 2>&1 | grep -i "grockle" | tail -10 || echo "")
else
  LOGS=$(ssh root@bitbrat.lan "docker logs bitbrat-${CONTEXT}-tool-gateway-1 2>&1 | grep -i 'grockle' | tail -10" || echo "")
fi

if [ -n "$LOGS" ]; then
  echo "Recent grockle-related log entries:"
  echo "$LOGS"
else
  echo "⚠️  No grockle-related logs found (tool may not have been invoked yet)"
fi

echo ""

# Summary
echo "=== Test Complete ==="
echo "⚠️  Manual invocation required to fully validate"
echo ""
echo "Expected behavior:"
echo "  - Tool invocation succeeds without errors"
echo "  - grockle executes and returns expected output"
echo "  - Logs show successful composition execution"
echo ""
echo "Next: Run test-hot-reload.sh to test hot-reload functionality"
