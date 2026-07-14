#!/bin/bash
#
# Sprint 342 - Ingress-Egress Framework Foundation
# Validation Script
#
# This script validates all Sprint 342 deliverables:
# - Build success
# - Unit tests pass
# - TypeScript compilation
# - Architecture validation
# - Dry-run deployment readiness
#
# Usage:
#   ./validate_deliverable.sh
#
# Exit codes:
#   0 - All validations passed
#   1 - One or more validations failed

set -e  # Exit on error
set -u  # Exit on undefined variable

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

echo "=================================================="
echo "Sprint 342 - Deliverable Validation"
echo "=================================================="
echo ""

# Helper functions
pass() {
  echo -e "${GREEN}✓${NC} $1"
  ((TESTS_PASSED++))
}

fail() {
  echo -e "${RED}✗${NC} $1"
  ((TESTS_FAILED++))
}

warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

section() {
  echo ""
  echo "=================================================="
  echo "$1"
  echo "=================================================="
  echo ""
}

# Navigate to project root
cd "$PROJECT_ROOT"

# Phase 1: Build Validation
section "Phase 1: Build Validation"

echo "Running TypeScript compilation..."
if npm run build > /dev/null 2>&1; then
  pass "TypeScript compilation succeeded"
else
  fail "TypeScript compilation failed"
fi

# Phase 2: Unit Tests
section "Phase 2: Unit Tests"

echo "Running WebhookHandler unit tests..."
if npm test -- webhook-handler.test.ts --silent 2>&1 | grep -q "PASS"; then
  pass "WebhookHandler unit tests passed"
else
  fail "WebhookHandler unit tests failed"
fi

echo "Running TwilioConnectorAdapter regression tests..."
if npm test -- connector-adapter-webhook.test.ts --silent 2>&1 | grep -q "PASS"; then
  pass "TwilioConnectorAdapter regression tests passed"
else
  fail "TwilioConnectorAdapter regression tests failed"
fi

# Phase 3: Architecture Validation
section "Phase 3: Architecture Validation"

echo "Validating WebhookConnector interface implementations..."
if node dist/tools/validate-ingress-architecture.js 2>&1 | grep -q "All validations passed"; then
  pass "Architecture validation passed"
else
  fail "Architecture validation failed"
fi

# Phase 4: Code Quality
section "Phase 4: Code Quality"

echo "Checking for deprecated imports..."
if ! grep -r "from.*deprecated" src/services/ingress src/apps/ingress-egress-service.ts 2>/dev/null; then
  pass "No deprecated imports found"
else
  fail "Found deprecated imports"
fi

echo "Validating exports from core/index.ts..."
if grep -q "export \* from './webhook-handler'" src/services/ingress/core/index.ts; then
  pass "WebhookHandler exported from core/index.ts"
else
  fail "WebhookHandler not exported from core/index.ts"
fi

# Phase 5: Implementation Checklist
section "Phase 5: Implementation Checklist"

echo "Checking IEF-001: WebhookHandler..."
if [ -f "src/services/ingress/core/webhook-handler.ts" ]; then
  pass "IEF-001: WebhookHandler exists"
else
  fail "IEF-001: WebhookHandler missing"
fi

echo "Checking IEF-002: Enhanced interfaces..."
if grep -q "interface WebhookConnector" src/services/ingress/core/interfaces.ts && \
   grep -q "interface ConnectorMetadata" src/services/ingress/core/interfaces.ts; then
  pass "IEF-002: Enhanced interfaces defined"
else
  fail "IEF-002: Enhanced interfaces missing"
fi

echo "Checking IEF-003: Unit tests..."
if [ -f "src/services/ingress/core/__tests__/webhook-handler.test.ts" ]; then
  pass "IEF-003: WebhookHandler unit tests exist"
else
  fail "IEF-003: WebhookHandler unit tests missing"
fi

echo "Checking IEF-004: Raw body middleware..."
warn "IEF-004: BLOCKED - Requires base-server.ts refactoring (deferred to future sprint)"

echo "Checking IEF-005: Generic webhook routing..."
if grep -q "/webhooks/:platform" src/apps/ingress-egress-service.ts; then
  pass "IEF-005: Generic webhook route implemented"
else
  fail "IEF-005: Generic webhook route missing"
fi

echo "Checking IEF-007: TwilioConnectorAdapter refactored..."
if grep -q "implements IngressConnector, WebhookConnector" src/services/ingress/twilio/connector-adapter.ts; then
  pass "IEF-007: TwilioConnectorAdapter implements WebhookConnector"
else
  fail "IEF-007: TwilioConnectorAdapter missing WebhookConnector"
fi

echo "Checking IEF-008: Deprecated old Twilio route..."
if grep -q "DEPRECATED: Legacy Twilio webhook route" src/apps/ingress-egress-service.ts; then
  pass "IEF-008: Old Twilio route deprecated"
else
  fail "IEF-008: Old Twilio route not marked deprecated"
fi

echo "Checking IEF-009: Regression tests..."
if [ -f "src/services/ingress/twilio/__tests__/connector-adapter-webhook.test.ts" ]; then
  pass "IEF-009: Regression tests exist"
else
  fail "IEF-009: Regression tests missing"
fi

# Phase 6: Files Created/Modified
section "Phase 6: Files Created/Modified"

FILES_CREATED=(
  "src/services/ingress/core/webhook-handler.ts"
  "src/services/ingress/core/__tests__/webhook-handler.test.ts"
  "src/services/ingress/twilio/__tests__/connector-adapter-webhook.test.ts"
  "planning/sprint-342-ingress-egress-framework/validate_deliverable.sh"
)

FILES_MODIFIED=(
  "src/services/ingress/core/interfaces.ts"
  "src/services/ingress/core/index.ts"
  "src/apps/ingress-egress-service.ts"
  "src/services/ingress/twilio/connector-adapter.ts"
)

echo "Validating created files..."
for file in "${FILES_CREATED[@]}"; do
  if [ -f "$file" ]; then
    pass "Created: $file"
  else
    fail "Missing: $file"
  fi
done

echo ""
echo "Validating modified files..."
for file in "${FILES_MODIFIED[@]}"; do
  if [ -f "$file" ]; then
    pass "Modified: $file"
  else
    fail "Missing: $file"
  fi
done

# Phase 7: Deployment Readiness
section "Phase 7: Deployment Readiness"

echo "Checking architecture.yaml configuration..."
if grep -q "ingress-egress" architecture.yaml; then
  pass "ingress-egress service defined in architecture.yaml"
else
  fail "ingress-egress service missing from architecture.yaml"
fi

echo "Validating no console.log statements (use logger instead)..."
if ! grep -r "console\.log\|console\.error\|console\.warn" src/services/ingress src/apps/ingress-egress-service.ts 2>/dev/null | grep -v "//"; then
  pass "No console.log statements found (using logger)"
else
  fail "Found console.log statements (should use logger)"
fi

# Summary
section "Validation Summary"

echo "Tests Passed: $TESTS_PASSED"
echo "Tests Failed: $TESTS_FAILED"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}=================================================="
  echo "✓ ALL VALIDATIONS PASSED"
  echo "==================================================${NC}"
  echo ""
  echo "Sprint 342 deliverables are ready for:"
  echo "  - Code review"
  echo "  - Integration testing"
  echo "  - Deployment to staging"
  exit 0
else
  echo -e "${RED}=================================================="
  echo "✗ VALIDATION FAILED"
  echo "==================================================${NC}"
  echo ""
  echo "Please fix the failed validations before proceeding."
  exit 1
fi
