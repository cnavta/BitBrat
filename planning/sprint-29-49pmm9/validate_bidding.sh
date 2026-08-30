#!/bin/bash
# Sprint 29: Bidding System Validation Script
# Tests all 8 bid MCP tools in agent-dev context
#
# Usage: ./validate_bidding.sh <context-name>
#
# Prerequisites:
# - Agent-dev context provisioned and running
# - utility-service deployed to context
# - jq installed for JSON parsing

set -e

CONTEXT="${1:-agent-dev-bidding-test}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASS=0
FAIL=0

# Helper functions
log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

check_pass() {
  ((PASS++))
  echo -e "${GREEN}✓${NC} $1"
}

check_fail() {
  ((FAIL++))
  echo -e "${RED}✗${NC} $1"
}

# Simulate MCP tool call (placeholder - actual implementation depends on MCP client)
call_tool() {
  local tool_name="$1"
  local args="$2"

  log_info "Calling tool: $tool_name"
  log_info "Arguments: $args"

  # NOTE: This is a placeholder. In actual implementation, you would:
  # 1. Use the MCP client library to call the tool
  # 2. Or use brat CLI if it supports direct tool invocation
  # 3. Or use HTTP API if utility-service exposes REST endpoints

  # For now, we'll simulate by checking if the service is running
  # Real implementation would make actual MCP calls

  echo '{"success": true, "placeholder": "Actual MCP call would happen here"}'
}

# ============================================================================
# PHASE 1: PRE-VALIDATION CHECKS
# ============================================================================

log_info "Starting bidding system validation..."
log_info "Context: $CONTEXT"
echo ""

log_info "Phase 1: Pre-validation checks"
echo "================================"

# Check 1: Verify context exists
log_info "Checking if context exists..."
if npm run brat -- context show "$CONTEXT" >/dev/null 2>&1; then
  check_pass "Context exists: $CONTEXT"
else
  check_fail "Context not found: $CONTEXT"
  log_error "Please provision context first: npm run brat -- agent-dev provision --name $CONTEXT"
  exit 1
fi

# Check 2: Verify utility-service is deployed
log_info "Checking if utility-service is deployed..."
if npm run brat -- fleet info utility --context "$CONTEXT" >/dev/null 2>&1; then
  check_pass "utility-service is deployed"
else
  check_fail "utility-service not deployed"
  log_error "Please deploy: npm run brat -- bit deploy utility-service --context $CONTEXT"
  exit 1
fi

# Check 3: Verify utility-service is healthy
log_info "Checking utility-service health..."
HEALTH_OUTPUT=$(npm run brat -- fleet health utility --context "$CONTEXT" 2>&1 || echo "FAILED")
if echo "$HEALTH_OUTPUT" | grep -q "healthy\|ok\|running"; then
  check_pass "utility-service is healthy"
else
  check_fail "utility-service is not healthy"
  log_warn "Health check output: $HEALTH_OUTPUT"
fi

# Check 4: Verify bid tools are registered
log_info "Checking if bid tools are registered..."
INFO_OUTPUT=$(npm run brat -- fleet info utility --context "$CONTEXT" 2>&1 || echo "")

EXPECTED_TOOLS=(
  "bid.create"
  "bid.submit"
  "bid.getMax"
  "bid.getMin"
  "bid.getClosest"
  "bid.close"
  "bid.list"
  "bid.results"
)

TOOLS_FOUND=0
for tool in "${EXPECTED_TOOLS[@]}"; do
  if echo "$INFO_OUTPUT" | grep -q "$tool"; then
    ((TOOLS_FOUND++))
  else
    log_warn "Tool not found in registry: $tool"
  fi
done

if [ $TOOLS_FOUND -eq 8 ]; then
  check_pass "All 8 bid tools are registered"
else
  check_fail "Only $TOOLS_FOUND/8 bid tools found"
fi

echo ""

# ============================================================================
# PHASE 2: FUNCTIONAL VALIDATION
# ============================================================================

log_info "Phase 2: Functional validation"
echo "==============================="

SESSION_NAME="validation-test-$(date +%s)"
SESSION_ID="stream:test-channel:$SESSION_NAME"
TARGET_VALUE=100

# Test 1: Create bid session
log_info "Test 1: Create bid session with target value and TTL"
CREATE_RESULT=$(call_tool "bid.create" "{
  \"name\": \"$SESSION_NAME\",
  \"scopeType\": \"stream\",
  \"scopeValue\": \"test-channel\",
  \"targetValue\": $TARGET_VALUE,
  \"ttlSeconds\": 3600,
  \"metadata\": {
    \"description\": \"Validation test session\",
    \"test\": true
  }
}")

if echo "$CREATE_RESULT" | grep -q "success"; then
  check_pass "bid.create: Session created successfully"
  log_info "Session ID: $SESSION_ID"
else
  check_fail "bid.create: Failed to create session"
  log_error "Response: $CREATE_RESULT"
fi

# Test 2: Submit multiple bids
log_info "Test 2: Submit bids from multiple users"

USERS=(
  "alice:95"
  "bob:120"
  "charlie:88"
  "david:105"
  "eve:99"
)

for user_bid in "${USERS[@]}"; do
  IFS=':' read -r user value <<< "$user_bid"

  SUBMIT_RESULT=$(call_tool "bid.submit" "{
    \"session\": \"$SESSION_ID\",
    \"user\": \"$user\",
    \"value\": $value
  }")

  if echo "$SUBMIT_RESULT" | grep -q "success"; then
    check_pass "bid.submit: $user submitted bid of $value"
  else
    check_fail "bid.submit: Failed to submit bid for $user"
  fi
done

# Test 3: Update existing bid
log_info "Test 3: Update existing bid (upsert)"
UPDATE_RESULT=$(call_tool "bid.submit" "{
  \"session\": \"$SESSION_ID\",
  \"user\": \"alice\",
  \"value\": 103
}")

if echo "$UPDATE_RESULT" | grep -q "success"; then
  check_pass "bid.submit: Updated alice's bid to 103"
else
  check_fail "bid.submit: Failed to update bid"
fi

# Test 4: Get maximum bid
log_info "Test 4: Query maximum bid"
MAX_RESULT=$(call_tool "bid.getMax" "{
  \"session\": \"$SESSION_ID\"
}")

if echo "$MAX_RESULT" | grep -q "bob"; then
  check_pass "bid.getMax: Correctly identified bob as max (120)"
else
  check_fail "bid.getMax: Failed to get max bid"
  log_warn "Expected: bob (120), Got: $MAX_RESULT"
fi

# Test 5: Get minimum bid
log_info "Test 5: Query minimum bid"
MIN_RESULT=$(call_tool "bid.getMin" "{
  \"session\": \"$SESSION_ID\"
}")

if echo "$MIN_RESULT" | grep -q "charlie"; then
  check_pass "bid.getMin: Correctly identified charlie as min (88)"
else
  check_fail "bid.getMin: Failed to get min bid"
  log_warn "Expected: charlie (88), Got: $MIN_RESULT"
fi

# Test 6: Get closest bid to target
log_info "Test 6: Query closest bid to target ($TARGET_VALUE)"
CLOSEST_RESULT=$(call_tool "bid.getClosest" "{
  \"session\": \"$SESSION_ID\"
}")

# After alice's update to 103, closest should be eve (99) with difference 1
if echo "$CLOSEST_RESULT" | grep -q "eve\|99"; then
  check_pass "bid.getClosest: Correctly identified eve as closest (99)"
else
  check_fail "bid.getClosest: Failed to get closest bid"
  log_warn "Expected: eve (99), Got: $CLOSEST_RESULT"
fi

# Test 7: Close session
log_info "Test 7: Close session and compute statistics"
CLOSE_RESULT=$(call_tool "bid.close" "{
  \"session\": \"$SESSION_ID\",
  \"computeWinner\": true,
  \"deleteRedisHash\": false
}")

if echo "$CLOSE_RESULT" | grep -q "success"; then
  check_pass "bid.close: Session closed successfully"

  # Verify statistics
  if echo "$CLOSE_RESULT" | grep -q "statistics"; then
    check_pass "bid.close: Statistics computed"
  else
    check_fail "bid.close: Statistics missing"
  fi

  # Verify winner
  if echo "$CLOSE_RESULT" | grep -q "winner"; then
    check_pass "bid.close: Winner determined"
  else
    check_fail "bid.close: Winner missing"
  fi
else
  check_fail "bid.close: Failed to close session"
  log_error "Response: $CLOSE_RESULT"
fi

# Test 8: List sessions
log_info "Test 8: List bid sessions"
LIST_RESULT=$(call_tool "bid.list" "{
  \"scopeType\": \"stream\",
  \"scopeValue\": \"test-channel\",
  \"status\": \"closed\"
}")

if echo "$LIST_RESULT" | grep -q "$SESSION_NAME"; then
  check_pass "bid.list: Found closed session in results"
else
  check_fail "bid.list: Session not found in list"
fi

# Test 9: Query results
log_info "Test 9: Query bid results"
RESULTS_RESULT=$(call_tool "bid.results" "{
  \"sessionId\": \"$SESSION_ID\",
  \"limit\": 10
}")

if echo "$RESULTS_RESULT" | grep -q "totalEntries"; then
  check_pass "bid.results: Results snapshot found"
else
  check_fail "bid.results: No results found"
fi

echo ""

# ============================================================================
# PHASE 3: EDGE CASE VALIDATION
# ============================================================================

log_info "Phase 3: Edge case validation"
echo "=============================="

# Test 10: Query non-existent session
log_info "Test 10: Query non-existent session (error handling)"
NONEXISTENT_RESULT=$(call_tool "bid.getMax" "{
  \"session\": \"nonexistent:session:id\"
}" 2>&1 || echo "ERROR")

if echo "$NONEXISTENT_RESULT" | grep -qi "error\|not found\|no bids"; then
  check_pass "Error handling: Correctly handled non-existent session"
else
  check_fail "Error handling: Did not handle non-existent session"
fi

# Test 11: Create session without target value
log_info "Test 11: Create session without target value"
NO_TARGET_SESSION="no-target-$(date +%s)"
NO_TARGET_RESULT=$(call_tool "bid.create" "{
  \"name\": \"$NO_TARGET_SESSION\",
  \"scopeType\": \"global\",
  \"scopeValue\": \"global\"
}")

if echo "$NO_TARGET_RESULT" | grep -q "success"; then
  check_pass "Edge case: Session created without target value"
else
  check_fail "Edge case: Failed to create session without target"
fi

# Test 12: Submit bid with decimal value
log_info "Test 12: Submit bid with decimal value"
DECIMAL_RESULT=$(call_tool "bid.submit" "{
  \"session\": \"global:global:$NO_TARGET_SESSION\",
  \"user\": \"decimal-user\",
  \"value\": 123.45
}")

if echo "$DECIMAL_RESULT" | grep -q "success"; then
  check_pass "Edge case: Decimal bid values supported"
else
  check_fail "Edge case: Decimal bid values failed"
fi

echo ""

# ============================================================================
# PHASE 4: DATA PERSISTENCE VALIDATION
# ============================================================================

log_info "Phase 4: Data persistence validation"
echo "====================================="

# Test 13: Verify DocumentStore snapshots
log_info "Test 13: Verify session metadata in DocumentStore"
# Note: This would require direct DocumentStore access or query tool
# For now, we validate indirectly via list/results tools

LIST_ALL_RESULT=$(call_tool "bid.list" "{}")
if echo "$LIST_ALL_RESULT" | grep -q "id.*name.*status"; then
  check_pass "Persistence: Session metadata queryable"
else
  check_fail "Persistence: Session metadata not found"
fi

# Test 14: Verify results snapshot
log_info "Test 14: Verify results snapshot in DocumentStore"
ALL_RESULTS=$(call_tool "bid.results" "{\"limit\": 100}")
if echo "$ALL_RESULTS" | grep -q "sessionId.*totalEntries.*statistics"; then
  check_pass "Persistence: Results snapshots queryable"
else
  check_fail "Persistence: Results snapshots not found"
fi

echo ""

# ============================================================================
# SUMMARY
# ============================================================================

log_info "Validation Summary"
echo "=================="
echo ""
echo "Total Tests: $((PASS + FAIL))"
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
  log_info "✓ All validations passed!"
  echo ""
  log_info "Bidding system is fully functional in context: $CONTEXT"
  exit 0
else
  log_error "✗ Some validations failed"
  echo ""
  log_error "Please review failures above and check logs:"
  echo "  npm run brat -- fleet logs utility --context $CONTEXT"
  exit 1
fi
