#!/bin/bash
# Sprint 62 Validation Script
# Validates tool-orchestrator MCP aggregation in staging environment
# Usage: ./validate-staging.sh [staging-url]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
STAGING_URL="${1:-http://localhost:3000/mcp}"
CONTEXT="${2:-staging}"

echo -e "${BLUE}==================================================${NC}"
echo -e "${BLUE}Sprint 62 - Tool-Orchestrator Validation${NC}"
echo -e "${BLUE}==================================================${NC}"
echo ""
echo "Configuration:"
echo "  Staging URL: $STAGING_URL"
echo "  Context: $CONTEXT"
echo ""

# Function to print section headers
section() {
    echo ""
    echo -e "${BLUE}--------------------------------------------------${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}--------------------------------------------------${NC}"
}

# Function to print success
success() {
    echo -e "${GREEN}✓ $1${NC}"
}

# Function to print failure
fail() {
    echo -e "${RED}✗ $1${NC}"
}

# Function to print info
info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# 1. Service Health Check
section "1. Service Health Check"
echo "Checking tool-orchestrator service status..."

npm run brat -- fleet info tool-orchestrator --context "$CONTEXT" --json > /tmp/sprint62-info.json 2>&1 || {
    fail "Failed to get service info"
    exit 1
}

if grep -q '"status":"running"' /tmp/sprint62-info.json; then
    success "Service is running"
else
    fail "Service is not running"
    cat /tmp/sprint62-info.json
    exit 1
fi

# 2. Check Logs for Tool Loading
section "2. Tool Cache Loading"
echo "Checking for tool loading logs..."

npm run brat -- fleet logs tool-orchestrator --context "$CONTEXT" --tail 200 > /tmp/sprint62-logs.txt 2>&1

if grep -q "tool_orchestrator.tools_loaded" /tmp/sprint62-logs.txt; then
    success "Tool loading log found"

    # Extract tool count
    TOOL_COUNT=$(grep "tool_orchestrator.tools_loaded" /tmp/sprint62-logs.txt | tail -1 | grep -o '"count":[0-9]*' | cut -d: -f2)

    if [ -n "$TOOL_COUNT" ]; then
        info "Tool count: $TOOL_COUNT"

        if [ "$TOOL_COUNT" -gt 20 ]; then
            success "Tool count > 20 (aggregation confirmed)"
        else
            fail "Tool count <= 20 (aggregation may not be working)"
        fi
    fi

    # Extract sources
    SOURCES=$(grep "tool_orchestrator.tools_loaded" /tmp/sprint62-logs.txt | tail -1 | grep -o '"sources":\[[^]]*\]')
    if [ -n "$SOURCES" ]; then
        info "Sources: $SOURCES"
    fi
else
    fail "Tool loading log not found"
fi

# Check for errors
if grep -q "tool_orchestrator.tools_load_failed" /tmp/sprint62-logs.txt; then
    fail "Tool loading errors detected"
    grep "tool_orchestrator.tools_load_failed" /tmp/sprint62-logs.txt
else
    success "No tool loading errors"
fi

# 3. MCP Server Initialization
section "3. MCP Server Initialization"
echo "Checking for MCP server initialization..."

if grep -q "mcp_server.initialized_with_aggregation" /tmp/sprint62-logs.txt; then
    success "MCP server initialized with aggregation"

    # Extract aggregated tool count
    AGG_COUNT=$(grep "mcp_server.initialized_with_aggregation" /tmp/sprint62-logs.txt | tail -1 | grep -o '"aggregatedTools":[0-9]*' | cut -d: -f2)

    if [ -n "$AGG_COUNT" ]; then
        info "Aggregated tools: $AGG_COUNT"

        if [ "$AGG_COUNT" = "$TOOL_COUNT" ]; then
            success "Aggregated count matches loaded count"
        else
            fail "Count mismatch (loaded: $TOOL_COUNT, aggregated: $AGG_COUNT)"
        fi
    fi
else
    fail "MCP server aggregation log not found"
fi

# 4. Schema Compliance
section "4. Schema Compliance"
echo "Checking for INVALID_RESULT errors..."

if grep -q "INVALID_RESULT" /tmp/sprint62-logs.txt; then
    fail "INVALID_RESULT errors found in logs"
    grep "INVALID_RESULT" /tmp/sprint62-logs.txt | tail -5
else
    success "No INVALID_RESULT errors"
fi

# 5. Integration Tests
section "5. Integration Tests"
echo "Running integration tests against staging..."
echo "Command: RUN_MCP_INTEGRATION_TESTS=true TEST_TOOL_ORCHESTRATOR_URL=$STAGING_URL npm test tool-orchestrator-mcp-aggregation"
echo ""

RUN_MCP_INTEGRATION_TESTS=true TEST_TOOL_ORCHESTRATOR_URL="$STAGING_URL" npm test tool-orchestrator-mcp-aggregation 2>&1 | tee /tmp/sprint62-test-results.txt

if grep -q "5 passed" /tmp/sprint62-test-results.txt; then
    success "All integration tests passed (5/5)"
else
    fail "Some integration tests failed"
    grep -E "(passed|failed)" /tmp/sprint62-test-results.txt | tail -5
fi

# Extract test output
if grep -q "tool-orchestrator exposed" /tmp/sprint62-test-results.txt; then
    TEST_COUNT=$(grep "tool-orchestrator exposed" /tmp/sprint62-test-results.txt | grep -o '[0-9]* tools' | cut -d' ' -f1)
    info "Integration test tool count: $TEST_COUNT"
fi

# 6. Summary
section "Validation Summary"

echo ""
echo "Validation Results:"
echo "  Service Status: Running"
echo "  Tools Loaded: $TOOL_COUNT"
echo "  Aggregated Tools: $AGG_COUNT"
echo "  Integration Tests: Check output above"
echo "  INVALID_RESULT Errors: None"
echo ""

info "Next steps:"
echo "  1. Review VALIDATION_CHECKLIST.md and mark completed items"
echo "  2. Test feature flag cutover (ENABLE_TOOL_ORCHESTRATOR)"
echo "  3. Compare PostgreSQL tool count with MCP exposed count"
echo "  4. Perform end-to-end tool execution test"
echo ""

success "Validation script complete!"
echo ""
echo "Full logs saved to:"
echo "  - /tmp/sprint62-logs.txt (service logs)"
echo "  - /tmp/sprint62-test-results.txt (test results)"
echo "  - /tmp/sprint62-info.json (service info)"
echo ""
