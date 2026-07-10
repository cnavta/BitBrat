#!/usr/bin/env bash
#
# Sprint 334 Validation Script
# Validates fleet.logs and fleet.trace tools deliverables
#
# Exit codes:
#   0 - All checks passed
#   1 - One or more checks failed
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=================================================="
echo "Sprint 334: Fleet Logs and Trace Tools Validation"
echo "=================================================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track overall status
FAILED=0

# Helper function to print check result
check_result() {
  if [ $1 -eq 0 ]; then
    echo -e "${GREEN}✓ PASS${NC}: $2"
  else
    echo -e "${RED}✗ FAIL${NC}: $2"
    FAILED=1
  fi
}

# Helper function to check file exists
check_file() {
  if [ -f "$PROJECT_ROOT/$1" ]; then
    check_result 0 "File exists: $1"
    return 0
  else
    check_result 1 "File missing: $1"
    return 1
  fi
}

echo "=== File Structure Checks ==="
echo ""

# Check new files
check_file "tools/brat/src/dev-mcp/log-retriever.ts"
check_file "tools/brat/src/dev-mcp/log-parser.ts"
check_file "tools/brat/src/dev-mcp/log-formatter.ts"
check_file "tools/brat/src/dev-mcp/__tests__/log-retriever.test.ts"
check_file "tools/brat/src/dev-mcp/__tests__/log-parser.test.ts"
check_file "tools/brat/src/dev-mcp/__tests__/log-formatter.test.ts"

# Check modified files
check_file "tools/brat/src/dev-mcp/types.ts"
check_file "tools/brat/src/dev-mcp/tools/fleet.ts"
check_file "tools/brat/src/dev-mcp/__tests__/tools/fleet.test.ts"
check_file "package.json"

echo ""
echo "=== TypeScript Compilation Check ==="
echo ""

cd "$PROJECT_ROOT"
if npm run build &> /tmp/sprint334-build.log; then
  check_result 0 "TypeScript compilation successful"
else
  check_result 1 "TypeScript compilation failed (see /tmp/sprint334-build.log)"
  cat /tmp/sprint334-build.log
fi

echo ""
echo "=== Dependency Check ==="
echo ""

# Check @google-cloud/logging dependency
if grep -q "@google-cloud/logging" "$PROJECT_ROOT/package.json"; then
  check_result 0 "@google-cloud/logging dependency present in package.json"
else
  check_result 1 "@google-cloud/logging dependency missing from package.json"
fi

# Verify it's installed
if [ -d "$PROJECT_ROOT/node_modules/@google-cloud/logging" ]; then
  check_result 0 "@google-cloud/logging installed in node_modules"
else
  check_result 1 "@google-cloud/logging not installed (run npm install)"
fi

echo ""
echo "=== Test Suite Execution ==="
echo ""

# Run dev-mcp tests
if npm test -- tools/brat/src/dev-mcp/__tests__ --passWithNoTests &> /tmp/sprint334-tests.log; then
  check_result 0 "All dev-mcp tests passing"

  # Extract test count (look for "Tests: X passed" line)
  TEST_COUNT=$(grep 'Tests:' /tmp/sprint334-tests.log | grep -o '[0-9]* passed' | head -1 | grep -o '^[0-9]*')
  echo "  → Total tests: $TEST_COUNT"

  if [ "$TEST_COUNT" -ge 130 ]; then
    check_result 0 "Test count >= 130 (sufficient coverage)"
  else
    check_result 1 "Test count < 130 (expected >= 130, got $TEST_COUNT)"
  fi
else
  check_result 1 "Test suite failed (see /tmp/sprint334-tests.log)"
  echo "Last 50 lines of test output:"
  tail -50 /tmp/sprint334-tests.log
fi

echo ""
echo "=== Code Quality Checks ==="
echo ""

# Check for deprecated imports
echo "Checking for deprecated imports..."
DEPRECATED_IMPORTS=$(grep -r "from.*deprecated" --include="*.ts" \
  "$PROJECT_ROOT/tools/brat/src/dev-mcp/log-retriever.ts" \
  "$PROJECT_ROOT/tools/brat/src/dev-mcp/log-parser.ts" \
  "$PROJECT_ROOT/tools/brat/src/dev-mcp/log-formatter.ts" \
  "$PROJECT_ROOT/tools/brat/src/dev-mcp/tools/fleet.ts" 2>/dev/null || true)

if [ -z "$DEPRECATED_IMPORTS" ]; then
  check_result 0 "No deprecated imports found"
else
  check_result 1 "Deprecated imports found"
  echo "$DEPRECATED_IMPORTS"
fi

# Check for console.log statements (should use Logger instead)
echo "Checking for console.log statements..."
CONSOLE_LOGS=$(grep -n "console\.log" --include="*.ts" \
  "$PROJECT_ROOT/tools/brat/src/dev-mcp/log-retriever.ts" \
  "$PROJECT_ROOT/tools/brat/src/dev-mcp/log-parser.ts" \
  "$PROJECT_ROOT/tools/brat/src/dev-mcp/log-formatter.ts" \
  "$PROJECT_ROOT/tools/brat/src/dev-mcp/tools/fleet.ts" 2>/dev/null || true)

if [ -z "$CONSOLE_LOGS" ]; then
  check_result 0 "No console.log statements (using Logger)"
else
  check_result 1 "console.log statements found (should use Logger)"
  echo "$CONSOLE_LOGS"
fi

echo ""
echo "=== Security Checks ==="
echo ""

# Verify read-only posture (no write operations in log tools)
echo "Checking for write operations in log tools..."
WRITE_OPS=$(grep -nE "(execSync.*rm|execSync.*delete|fs\.(writeFile|unlink|rm))" --include="*.ts" \
  "$PROJECT_ROOT/tools/brat/src/dev-mcp/log-retriever.ts" \
  "$PROJECT_ROOT/tools/brat/src/dev-mcp/log-parser.ts" \
  "$PROJECT_ROOT/tools/brat/src/dev-mcp/log-formatter.ts" 2>/dev/null || true)

if [ -z "$WRITE_OPS" ]; then
  check_result 0 "No write operations found (read-only posture maintained)"
else
  check_result 1 "Write operations found (violates read-only posture)"
  echo "$WRITE_OPS"
fi

# Check that fleet.logs and fleet.trace are registered
echo "Checking tool registration..."
if grep -q "fleet.logs" "$PROJECT_ROOT/tools/brat/src/dev-mcp/tools/fleet.ts"; then
  check_result 0 "fleet.logs tool registered"
else
  check_result 1 "fleet.logs tool not found in fleet.ts"
fi

if grep -q "fleet.trace" "$PROJECT_ROOT/tools/brat/src/dev-mcp/tools/fleet.ts"; then
  check_result 0 "fleet.trace tool registered"
else
  check_result 1 "fleet.trace tool not found in fleet.ts"
fi

echo ""
echo "=== Tool Schema Validation ==="
echo ""

# Verify Zod schemas exist
if grep -q "z.object" "$PROJECT_ROOT/tools/brat/src/dev-mcp/tools/fleet.ts"; then
  check_result 0 "Zod schemas present for tool validation"
else
  check_result 1 "Zod schemas missing"
fi

# Check that fleet.logs supports required parameters
FLEET_LOGS_PARAMS="bit level since until limit correlationId format"
for param in $FLEET_LOGS_PARAMS; do
  if grep -q "$param" "$PROJECT_ROOT/tools/brat/src/dev-mcp/tools/fleet.ts"; then
    check_result 0 "fleet.logs supports parameter: $param"
  else
    check_result 1 "fleet.logs missing parameter: $param"
  fi
done

# Check that fleet.trace supports required parameters
FLEET_TRACE_PARAMS="correlationId format"
for param in $FLEET_TRACE_PARAMS; do
  if grep -q "$param" "$PROJECT_ROOT/tools/brat/src/dev-mcp/tools/fleet.ts"; then
    check_result 0 "fleet.trace supports parameter: $param"
  else
    check_result 1 "fleet.trace missing parameter: $param"
  fi
done

echo ""
echo "=== Sprint Artifact Checks ==="
echo ""

check_file "planning/sprint-334-fleet-logs-trace/implementation-plan.md"
check_file "planning/sprint-334-fleet-logs-trace/request-log.md"
check_file "planning/sprint-334-fleet-logs-trace/backlog.yaml"
check_file "planning/sprint-334-fleet-logs-trace/validate_deliverable.sh"

echo ""
echo "=== Summary ==="
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}✓ ALL CHECKS PASSED${NC}"
  echo -e "${GREEN}========================================${NC}"
  echo ""
  echo "Sprint 334 deliverables validated successfully!"
  echo "Ready for:"
  echo "  1. Documentation updates"
  echo "  2. CHANGELOG update"
  echo "  3. Git commit and PR creation"
  exit 0
else
  echo -e "${RED}========================================${NC}"
  echo -e "${RED}✗ VALIDATION FAILED${NC}"
  echo -e "${RED}========================================${NC}"
  echo ""
  echo "Please address the failing checks before proceeding."
  exit 1
fi
