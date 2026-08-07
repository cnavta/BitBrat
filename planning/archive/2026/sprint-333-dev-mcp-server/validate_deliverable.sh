#!/usr/bin/env bash
#
# Validation script for Sprint 333 - Dev MCP Server Implementation
# This script verifies that all deliverables meet acceptance criteria
#

set -e  # Exit on first error

echo "================================================================"
echo "Sprint 333 - Dev MCP Server Validation"
echo "================================================================"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

VALIDATION_FAILED=0

# Helper functions
pass() {
    echo -e "${GREEN}✓${NC} $1"
}

fail() {
    echo -e "${RED}✗${NC} $1"
    VALIDATION_FAILED=1
}

warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

section() {
    echo ""
    echo "================================================================"
    echo "$1"
    echo "================================================================"
}

# Change to project root
cd "$(dirname "$0")/../.."

section "1. Build Verification"

echo "Running TypeScript compilation..."
if npm run build 2>&1 | grep -q "error"; then
    fail "Build failed with errors"
else
    pass "Build successful"
fi

section "2. Test Suite Verification"

echo "Running all dev-mcp tests..."
TEST_OUTPUT=$(npm test -- tools/brat/src/dev-mcp 2>&1 || true)

if echo "$TEST_OUTPUT" | grep -q "FAIL"; then
    fail "Test suite has failing tests"
    echo "$TEST_OUTPUT" | grep "FAIL"
else
    pass "All tests passing"
fi

# Count tests
TEST_COUNT=$(echo "$TEST_OUTPUT" | grep -oP '\d+(?= passed)' | head -1)
if [ -n "$TEST_COUNT" ]; then
    pass "Test count: $TEST_COUNT tests passing"
else
    warn "Could not determine test count"
fi

section "3. Code Quality Checks"

echo "Checking for imports from deprecated..."
DEPRECATED_IMPORTS=$(grep -r "from.*deprecated" tools/brat/src/dev-mcp/ || true)
if [ -n "$DEPRECATED_IMPORTS" ]; then
    fail "Found imports from deprecated directory"
    echo "$DEPRECATED_IMPORTS"
else
    pass "No deprecated imports found"
fi

echo "Checking for console.log statements..."
CONSOLE_LOGS=$(grep -r "console\.log" tools/brat/src/dev-mcp/*.ts tools/brat/src/dev-mcp/tools/*.ts 2>/dev/null || true)
if [ -n "$CONSOLE_LOGS" ]; then
    warn "Found console.log statements (should use logger instead)"
    echo "$CONSOLE_LOGS"
else
    pass "No console.log statements found"
fi

section "4. Read-Only Enforcement"

echo "Checking for Firestore write operations..."
WRITE_OPS=$(grep -E "(\.add\(|\.set\(|\.update\(|\.delete\()" tools/brat/src/dev-mcp/tools/persistence.ts || true)
if [ -n "$WRITE_OPS" ]; then
    fail "Found Firestore write operations in persistence tools"
    echo "$WRITE_OPS"
else
    pass "No Firestore write operations found"
fi

echo "Checking for filesystem write operations (excluding audit log)..."
FILESYSTEM_WRITES=$(grep -E "(fs\.writeFile|fs\.appendFile|fs\.unlink|fs\.rm)" tools/brat/src/dev-mcp/tools/*.ts | grep -v "audit" || true)
if [ -n "$FILESYSTEM_WRITES" ]; then
    fail "Found filesystem write operations outside audit logger"
    echo "$FILESYSTEM_WRITES"
else
    pass "No unauthorized filesystem writes found"
fi

section "5. Fail-Closed Enforcement"

echo "Checking for auth token validation..."
AUTH_CHECKS=$(grep -r "authToken" tools/brat/src/dev-mcp/server.ts || true)
if [ -n "$AUTH_CHECKS" ]; then
    pass "Auth token validation present in server"
else
    fail "No auth token validation found"
fi

echo "Checking tool handlers for auth enforcement..."
TOOL_AUTH=$(grep -E "if.*!.*authToken" tools/brat/src/dev-mcp/tools/*.ts || true)
if [ -n "$TOOL_AUTH" ]; then
    pass "Auth enforcement present in tool handlers"
else
    warn "Auth enforcement may be missing from some tools"
fi

section "6. Security & Redaction"

echo "Checking for hardcoded secrets..."
HARDCODED_SECRETS=$(grep -rE "(sk-[a-zA-Z0-9]{32,}|AIza[a-zA-Z0-9_-]{35})" tools/brat/src/dev-mcp/ || true)
if [ -n "$HARDCODED_SECRETS" ]; then
    fail "Found potential hardcoded secrets"
    echo "$HARDCODED_SECRETS"
else
    pass "No hardcoded secrets found"
fi

echo "Checking for redaction logic in audit logger..."
REDACTION_LOGIC=$(grep -E "(token|password|secret|key)" tools/brat/src/dev-mcp/audit-logger.ts | grep -i redact || true)
if [ -n "$REDACTION_LOGIC" ]; then
    pass "Redaction logic present in audit logger"
else
    warn "Redaction logic may be missing"
fi

section "7. File Structure Verification"

echo "Checking required files exist..."
REQUIRED_FILES=(
    "tools/brat/src/dev-mcp/server.ts"
    "tools/brat/src/dev-mcp/target-manager.ts"
    "tools/brat/src/dev-mcp/tool-router.ts"
    "tools/brat/src/dev-mcp/audit-logger.ts"
    "tools/brat/src/dev-mcp/types.ts"
    "tools/brat/src/dev-mcp/tools/config.ts"
    "tools/brat/src/dev-mcp/tools/fleet.ts"
    "tools/brat/src/dev-mcp/tools/persistence.ts"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        pass "$file exists"
    else
        fail "$file is missing"
    fi
done

section "8. Integration Test Verification"

echo "Checking integration test file exists..."
if [ -f "tools/brat/src/dev-mcp/__tests__/integration.test.ts" ]; then
    pass "Integration test file exists"
else
    fail "Integration test file is missing"
fi

echo "Running integration tests..."
INTEGRATION_OUTPUT=$(npm test -- tools/brat/src/dev-mcp/__tests__/integration.test.ts 2>&1 || true)
if echo "$INTEGRATION_OUTPUT" | grep -q "FAIL"; then
    fail "Integration tests failed"
else
    pass "Integration tests passing"
fi

section "9. Documentation Check"

echo "Checking for documentation files..."
DOC_FILES=(
    "tools/brat/README-MCP-SETUP.md"
    "documentation/guides/mcp-setup.md"
)

for doc in "${DOC_FILES[@]}"; do
    if [ -f "$doc" ]; then
        pass "$doc exists"
    else
        warn "$doc is missing (should be created)"
    fi
done

section "10. CLI Integration Check"

echo "Checking CLI command registration..."
CLI_REGISTRATION=$(grep -r "dev-mcp" tools/brat/src/cli/index.ts || true)
if [ -n "$CLI_REGISTRATION" ]; then
    pass "CLI command registered"
else
    warn "CLI command may not be registered"
fi

section "11. Coverage Report"

echo "Generating test coverage..."
COVERAGE_OUTPUT=$(npm test -- --coverage --testPathPattern="tools/brat/src/dev-mcp" --collectCoverageFrom="tools/brat/src/dev-mcp/**/*.ts" --collectCoverageFrom="!tools/brat/src/dev-mcp/**/*.test.ts" 2>&1 || true)

COVERAGE_PCT=$(echo "$COVERAGE_OUTPUT" | grep -oP 'All files.*\|\s+\K[0-9.]+(?=\s+\|)' | head -1 || echo "0")
if [ -n "$COVERAGE_PCT" ]; then
    if (( $(echo "$COVERAGE_PCT >= 80" | bc -l) )); then
        pass "Test coverage: ${COVERAGE_PCT}% (target: >80%)"
    else
        warn "Test coverage: ${COVERAGE_PCT}% (below target of 80%)"
    fi
else
    warn "Could not determine test coverage percentage"
fi

section "Validation Summary"

echo ""
if [ $VALIDATION_FAILED -eq 0 ]; then
    echo -e "${GREEN}================================================================"
    echo "✓ All validation checks passed!"
    echo -e "================================================================${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}================================================================"
    echo "✗ Some validation checks failed - see above for details"
    echo -e "================================================================${NC}"
    echo ""
    exit 1
fi
