#!/usr/bin/env bash
# Sprint 42: Test composition hot-reload functionality
#
# This script tests the hot-reload capability by:
# 1. Inserting a new test composition into the database
# 2. Waiting for the watcher to detect it (poll interval)
# 3. Verifying the new composition appears in the tool list
# 4. Updating the composition and verifying the update is detected
# 5. Deleting the composition and verifying it's removed
#
# Usage:
#   bash planning/sprint-42-fcw4d1/test-hot-reload.sh [context]
#
# Arguments:
#   context - Execution context (default: staging)

set -euo pipefail

CONTEXT="${1:-staging}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Sprint 42: Test Hot-Reload Functionality ==="
echo "Context: $CONTEXT"
echo ""

# Configuration
POLL_INTERVAL_MS="${COMPOSITION_POLL_INTERVAL_MS:-30000}"
POLL_INTERVAL_SEC=$((POLL_INTERVAL_MS / 1000))
WAIT_TIME=$((POLL_INTERVAL_SEC + 5)) # Add 5 seconds buffer

TEST_COMP_NAME="test_hot_reload_$(date +%s)"
TEST_COMP_ID="test-id-$(date +%s)"

echo "Configuration:"
echo "  Poll interval: ${POLL_INTERVAL_SEC}s"
echo "  Wait time: ${WAIT_TIME}s"
echo "  Test composition: $TEST_COMP_NAME"
echo ""

# Helper function to execute SQL
execute_sql() {
  local query="$1"
  if [ "$CONTEXT" = "local" ]; then
    psql "$DATABASE_URL" -c "$query"
  else
    ssh root@bitbrat.lan "docker exec bitbrat-${CONTEXT}-postgres-1 psql -U bitbrat -d bitbrat -c \"$query\""
  fi
}

# Helper function to check logs
check_logs() {
  local pattern="$1"
  if [ "$CONTEXT" = "local" ]; then
    docker logs bitbrat-local-tool-gateway-1 2>&1 | grep "$pattern" | tail -5 || echo ""
  else
    ssh root@bitbrat.lan "docker logs bitbrat-${CONTEXT}-tool-gateway-1 2>&1 | grep '$pattern' | tail -5" || echo ""
  fi
}

# Step 1: Insert new test composition
echo "Step 1: Inserting test composition..."

SQL_INSERT="INSERT INTO compositions (id, name, version, content_hash, definition, created_at, updated_at)
VALUES (
  '$TEST_COMP_ID',
  '$TEST_COMP_NAME',
  1,
  'test-hash-1',
  '{\"apiVersion\": \"mcp-compose/v1\", \"kind\": \"Composition\", \"metadata\": {\"name\": \"$TEST_COMP_NAME\", \"description\": \"Hot-reload test composition\"}, \"spec\": {\"inputSchema\": {\"type\": \"object\"}, \"steps\": [], \"return\": {\"success\": true}}}'::jsonb,
  NOW(),
  NOW()
);"

execute_sql "$SQL_INSERT"
echo "✅ Test composition inserted"
echo ""

# Step 2: Wait for watcher to detect addition
echo "Step 2: Waiting ${WAIT_TIME}s for CompositionWatcher to detect addition..."
sleep $WAIT_TIME
echo ""

# Step 3: Check logs for addition event
echo "Step 3: Checking logs for composition.added event..."
LOGS=$(check_logs "composition_watcher.added")

if echo "$LOGS" | grep -q "$TEST_COMP_NAME"; then
  echo "✅ Composition addition detected"
  echo "$LOGS"
else
  echo "❌ Composition addition NOT detected"
  echo "Logs:"
  echo "$LOGS"
  # Continue anyway to test remaining functionality
fi
echo ""

# Step 4: Update composition (change content hash)
echo "Step 4: Updating test composition (changing content hash)..."

SQL_UPDATE="UPDATE compositions
SET
  content_hash = 'test-hash-2',
  definition = '{\"apiVersion\": \"mcp-compose/v1\", \"kind\": \"Composition\", \"metadata\": {\"name\": \"$TEST_COMP_NAME\", \"description\": \"Hot-reload test composition (updated)\"}, \"spec\": {\"inputSchema\": {\"type\": \"object\"}, \"steps\": [], \"return\": {\"success\": true, \"updated\": true}}}'::jsonb,
  updated_at = NOW()
WHERE id = '$TEST_COMP_ID';"

execute_sql "$SQL_UPDATE"
echo "✅ Test composition updated"
echo ""

# Step 5: Wait for watcher to detect update
echo "Step 5: Waiting ${WAIT_TIME}s for CompositionWatcher to detect update..."
sleep $WAIT_TIME
echo ""

# Step 6: Check logs for update event
echo "Step 6: Checking logs for composition.updated event..."
LOGS=$(check_logs "composition_watcher.updated")

if echo "$LOGS" | grep -q "$TEST_COMP_NAME"; then
  echo "✅ Composition update detected"
  echo "$LOGS"
else
  echo "❌ Composition update NOT detected"
  echo "Logs:"
  echo "$LOGS"
fi
echo ""

# Step 7: Delete composition
echo "Step 7: Deleting test composition..."

SQL_DELETE="DELETE FROM compositions WHERE id = '$TEST_COMP_ID';"
execute_sql "$SQL_DELETE"
echo "✅ Test composition deleted"
echo ""

# Step 8: Wait for watcher to detect deletion
echo "Step 8: Waiting ${WAIT_TIME}s for CompositionWatcher to detect deletion..."
sleep $WAIT_TIME
echo ""

# Step 9: Check logs for removal event
echo "Step 9: Checking logs for composition.removed event..."
LOGS=$(check_logs "composition_watcher.removed")

if echo "$LOGS" | grep -q "$TEST_COMP_NAME"; then
  echo "✅ Composition removal detected"
  echo "$LOGS"
else
  echo "❌ Composition removal NOT detected"
  echo "Logs:"
  echo "$LOGS"
fi
echo ""

# Summary
echo "=== Hot-Reload Test Complete ==="
echo "✅ Composition insertion SQL executed"
echo "✅ Composition update SQL executed"
echo "✅ Composition deletion SQL executed"
echo ""
echo "Check the results above to verify watcher detected all changes."
echo "Expected log patterns:"
echo "  - composition_watcher.added (with name: $TEST_COMP_NAME)"
echo "  - composition_watcher.updated (with name: $TEST_COMP_NAME)"
echo "  - composition_watcher.removed (with name: $TEST_COMP_NAME)"
echo ""
echo "If events were not detected, check:"
echo "  1. COMPOSITION_POLL_INTERVAL_MS environment variable"
echo "  2. tool-gateway logs for errors"
echo "  3. Database connection from tool-gateway"
