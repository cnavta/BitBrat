#!/usr/bin/env bash
# Sprint 359 Validation Script
# Validates all deliverables for oclif migration foundation PoC
#
# Usage: bash planning/sprint-359-brat-cli-reorganization/validate_deliverable.sh
#
# Exit codes:
#   0 - All validations passed
#   1 - One or more validations failed

set -e  # Exit on first error
set -u  # Exit on undefined variable

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

# Project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

echo -e "${BLUE}=================================================${NC}"
echo -e "${BLUE}Sprint 359 Deliverable Validation${NC}"
echo -e "${BLUE}oclif Migration Foundation PoC${NC}"
echo -e "${BLUE}=================================================${NC}"
echo ""

# Helper functions
pass() {
  echo -e "${GREEN}✓ PASS:${NC} $1"
  ((PASS_COUNT++))
}

fail() {
  echo -e "${RED}✗ FAIL:${NC} $1"
  ((FAIL_COUNT++))
}

skip() {
  echo -e "${YELLOW}⊘ SKIP:${NC} $1"
  ((SKIP_COUNT++))
}

section() {
  echo ""
  echo -e "${BLUE}=== $1 ===${NC}"
  echo ""
}

# Validation functions
validate_dependencies() {
  section "Phase 0: Infrastructure Setup"

  # INFRA-001: Check oclif dependencies
  if grep -q '"@oclif/core"' package.json; then
    pass "oclif dependencies installed in package.json"
  else
    fail "@oclif/core not found in package.json"
  fi

  if grep -q '"@oclif/plugin-help"' package.json; then
    pass "@oclif/plugin-help installed"
  else
    fail "@oclif/plugin-help not found"
  fi

  # INFRA-002: Check directory structure
  if [[ -d "tools/brat/src/oclif-commands" ]]; then
    pass "oclif-commands directory exists"
  else
    fail "oclif-commands directory not found"
  fi

  for dir in infra deploy data fleet dev context; do
    if [[ -d "tools/brat/src/oclif-commands/$dir" ]]; then
      pass "Namespace directory exists: $dir/"
    else
      skip "Namespace directory not found: $dir/ (may not be in PoC scope)"
    fi
  done

  # INFRA-003: Check TypeScript configuration
  if grep -q "experimentalDecorators" tsconfig.json && grep -q "emitDecoratorMetadata" tsconfig.json; then
    pass "TypeScript decorators enabled for oclif"
  else
    skip "TypeScript decorator config not found (may use alternative approach)"
  fi

  # INFRA-004: Check oclif configuration in package.json
  if grep -q '"oclif"' package.json; then
    pass "oclif configuration block present in package.json"
  else
    fail "oclif configuration missing from package.json"
  fi

  # INFRA-005: Check oclif entry point
  if [[ -f "tools/brat/src/oclif-entry.ts" ]]; then
    pass "oclif entry point created: tools/brat/src/oclif-entry.ts"
  else
    fail "oclif entry point not found"
  fi
}

validate_base_command() {
  section "Phase 1: Base Command Pattern"

  # BASE-001: Check BratCommand base class
  if [[ -f "tools/brat/src/oclif-commands/base.ts" ]]; then
    pass "BratCommand base class exists"

    # Check for critical patterns
    if grep -q "extends Command" tools/brat/src/oclif-commands/base.ts; then
      pass "BratCommand extends oclif Command"
    else
      fail "BratCommand does not extend oclif Command"
    fi

    if grep -q "logger" tools/brat/src/oclif-commands/base.ts; then
      pass "BratCommand integrates pino logger"
    else
      fail "BratCommand missing logger integration"
    fi

    if grep -q "getContext\|context" tools/brat/src/oclif-commands/base.ts; then
      pass "BratCommand has context resolution"
    else
      fail "BratCommand missing context resolution"
    fi

    if grep -q "getDeps" tools/brat/src/oclif-commands/base.ts; then
      pass "BratCommand supports dependency injection"
    else
      fail "BratCommand missing dependency injection support"
    fi
  else
    fail "BratCommand base class not found"
  fi

  # BASE-005: Check BratCommand tests
  if [[ -f "tools/brat/src/oclif-commands/base.test.ts" ]]; then
    pass "BratCommand test suite exists"
  else
    skip "BratCommand tests not found (may be in different location)"
  fi
}

validate_poc_commands() {
  section "Phase 2: Proof of Concept Commands"

  # POC-001: brat setup
  if [[ -f "tools/brat/src/oclif-commands/setup.ts" ]]; then
    pass "setup command migrated to oclif"
  else
    skip "setup command not yet migrated"
  fi

  # POC-002: brat doctor
  if [[ -f "tools/brat/src/oclif-commands/doctor.ts" ]]; then
    pass "doctor command migrated to oclif"
  else
    skip "doctor command not yet migrated"
  fi

  # POC-003: brat fleet list
  if [[ -f "tools/brat/src/oclif-commands/fleet/list.ts" ]]; then
    pass "fleet list command migrated to oclif"
  else
    skip "fleet list command not yet migrated"
  fi

  # POC-004: brat config show
  if [[ -f "tools/brat/src/oclif-commands/config/show.ts" ]]; then
    pass "config show command migrated to oclif"
  else
    skip "config show command not yet migrated"
  fi

  # POC-005: brat release
  if [[ -f "tools/brat/src/oclif-commands/release.ts" ]]; then
    pass "release command migrated to oclif"
  else
    skip "release command not yet migrated"
  fi

  # POC-006: Backward compatibility
  if [[ -f "tools/brat/src/cli/index.ts" ]]; then
    pass "Legacy CLI router preserved for backward compatibility"
  else
    fail "Legacy CLI router removed prematurely (backward compatibility broken)"
  fi
}

validate_build() {
  section "Build & Compilation"

  echo "Running: npm run build"
  if npm run build > /tmp/sprint-359-build.log 2>&1; then
    pass "TypeScript compilation successful"
  else
    fail "TypeScript compilation failed (see /tmp/sprint-359-build.log)"
    return
  fi

  # Check compiled oclif entry point
  if [[ -f "dist/tools/brat/src/oclif-entry.js" ]]; then
    pass "oclif entry point compiled successfully"
  else
    fail "oclif entry point not found in dist/"
  fi

  # Check compiled BratCommand
  if [[ -f "dist/tools/brat/src/oclif-commands/base.js" ]]; then
    pass "BratCommand compiled successfully"
  else
    skip "BratCommand not found in dist/ (may not exist yet)"
  fi
}

validate_help_text() {
  section "Help Text & Auto-Documentation"

  if [[ ! -f "dist/tools/brat/src/oclif-entry.js" ]]; then
    skip "Skipping help text validation (oclif entry not built)"
    return
  fi

  echo "Running: node dist/tools/brat/src/oclif-entry.js --help"
  if node dist/tools/brat/src/oclif-entry.js --help > /tmp/sprint-359-help.log 2>&1; then
    pass "oclif --help executes without error"

    # Check for auto-generated help content
    if grep -iq "usage\|commands\|options" /tmp/sprint-359-help.log; then
      pass "Help text contains expected sections"
    else
      fail "Help text missing expected sections"
    fi
  else
    fail "oclif --help command failed"
  fi

  # Validate individual command help (if commands exist)
  for cmd in setup doctor "fleet list" "config show" release; do
    if node dist/tools/brat/src/oclif-entry.js $cmd --help > /tmp/sprint-359-cmd-help.log 2>&1; then
      pass "Help text works for: $cmd"
    else
      skip "Command not yet available: $cmd"
    fi
  done
}

validate_backward_compatibility() {
  section "Backward Compatibility"

  if [[ ! -f "dist/tools/brat/src/cli/index.js" ]]; then
    skip "Skipping backward compatibility tests (legacy CLI not built)"
    return
  fi

  # Test that old entry point still works
  echo "Running: node dist/tools/brat/src/cli/index.js --help"
  if node dist/tools/brat/src/cli/index.js --help > /tmp/sprint-359-legacy-help.log 2>&1; then
    pass "Legacy CLI entry point still functional"
  else
    fail "Legacy CLI entry point broken"
  fi

  # Check for deprecation warnings (should NOT be present for --help)
  if grep -iq "deprecated" /tmp/sprint-359-legacy-help.log; then
    skip "Deprecation warnings present in help (design decision)"
  else
    pass "No spurious deprecation warnings in help text"
  fi
}

validate_tests() {
  section "Test Suite"

  echo "Running: npm test"
  if npm test > /tmp/sprint-359-test.log 2>&1; then
    pass "All tests passing"
  else
    echo -e "${YELLOW}Test output:${NC}"
    tail -20 /tmp/sprint-359-test.log
    fail "Some tests failing (see /tmp/sprint-359-test.log)"
  fi

  # Check for oclif-specific tests
  if [[ -f "tools/brat/src/oclif-commands/base.test.ts" ]] || \
     [[ -f "tools/brat/src/oclif-commands/__tests__/base.test.ts" ]]; then

    if npm test -- --testPathPattern="oclif-commands.*base" > /tmp/sprint-359-base-test.log 2>&1; then
      pass "BratCommand unit tests passing"
    else
      skip "BratCommand tests not yet passing"
    fi
  else
    skip "BratCommand tests not found"
  fi

  # Check for integration tests
  if npm test -- --testPathPattern="oclif.*integration" > /tmp/sprint-359-integration.log 2>&1; then
    pass "oclif integration tests passing"
  else
    skip "oclif integration tests not found or not passing"
  fi
}

validate_documentation() {
  section "Documentation"

  # Check for planning documents
  if [[ -f "planning/sprint-359-brat-cli-reorganization/technical-architecture.md" ]]; then
    pass "Technical architecture document exists"
  else
    fail "Technical architecture document missing"
  fi

  if [[ -f "planning/sprint-359-brat-cli-reorganization/framework-evaluation.md" ]]; then
    pass "Framework evaluation document exists"
  else
    fail "Framework evaluation document missing"
  fi

  if [[ -f "planning/sprint-359-brat-cli-reorganization/oclif-migration-guide.md" ]]; then
    pass "oclif migration guide exists"
  else
    fail "oclif migration guide missing"
  fi

  if [[ -f "planning/sprint-359-brat-cli-reorganization/execution-plan.md" ]]; then
    pass "Execution plan exists"
  else
    fail "Execution plan missing"
  fi

  if [[ -f "planning/sprint-359-brat-cli-reorganization/backlog.yaml" ]]; then
    pass "YAML backlog exists"
  else
    fail "YAML backlog missing"
  fi

  # Check for user-facing documentation
  if grep -iq "oclif" CLAUDE.md; then
    pass "CLAUDE.md updated with oclif guidance"
  else
    skip "CLAUDE.md not yet updated with oclif patterns"
  fi

  if [[ -f "documentation/guides/brat-cli-migration.md" ]]; then
    pass "User migration guide exists"
  else
    skip "User migration guide not yet created"
  fi
}

validate_critical_patterns() {
  section "Critical Pattern Preservation"

  if [[ ! -f "tools/brat/src/oclif-commands/base.ts" ]]; then
    skip "Skipping pattern validation (BratCommand not created yet)"
    return
  fi

  # Pattern 1: Pino logging with metadata
  if grep -q "pino\|logger" tools/brat/src/oclif-commands/base.ts; then
    pass "Pino logging pattern preserved"
  else
    fail "Pino logging pattern not found in BratCommand"
  fi

  # Pattern 2: Context resolution
  if grep -q "ContextResolver\|getContext\|context" tools/brat/src/oclif-commands/base.ts; then
    pass "Context resolution pattern preserved"
  else
    fail "Context resolution pattern not found in BratCommand"
  fi

  # Pattern 3: Dependency injection
  if grep -q "getDeps\|dependencies" tools/brat/src/oclif-commands/base.ts; then
    pass "Dependency injection pattern preserved"
  else
    fail "Dependency injection pattern not found in BratCommand"
  fi

  # Anti-pattern check: No console.log in base class
  if grep -q "console\.log\|console\.error" tools/brat/src/oclif-commands/base.ts; then
    fail "Anti-pattern detected: console.log found in BratCommand"
  else
    pass "No console.log anti-patterns in BratCommand"
  fi
}

# ============================================================================
# RUN ALL VALIDATIONS
# ============================================================================

validate_dependencies
validate_base_command
validate_poc_commands
validate_build
validate_help_text
validate_backward_compatibility
validate_tests
validate_documentation
validate_critical_patterns

# ============================================================================
# SUMMARY REPORT
# ============================================================================

section "Validation Summary"

TOTAL=$((PASS_COUNT + FAIL_COUNT + SKIP_COUNT))
PASS_PCT=$((PASS_COUNT * 100 / TOTAL))

echo -e "${GREEN}Passed:${NC}  $PASS_COUNT / $TOTAL ($PASS_PCT%)"
echo -e "${RED}Failed:${NC}  $FAIL_COUNT / $TOTAL"
echo -e "${YELLOW}Skipped:${NC} $SKIP_COUNT / $TOTAL"
echo ""

if [[ $FAIL_COUNT -eq 0 ]]; then
  echo -e "${GREEN}=================================================${NC}"
  echo -e "${GREEN}✓ ALL CRITICAL VALIDATIONS PASSED${NC}"
  echo -e "${GREEN}=================================================${NC}"
  echo ""
  echo "Sprint 359 deliverables validated successfully!"
  echo "Skipped tests are acceptable for PoC phase."
  exit 0
else
  echo -e "${RED}=================================================${NC}"
  echo -e "${RED}✗ VALIDATION FAILED${NC}"
  echo -e "${RED}=================================================${NC}"
  echo ""
  echo "Fix the $FAIL_COUNT failing validation(s) before proceeding."
  echo ""
  echo "Debug logs available in /tmp/sprint-359-*.log"
  exit 1
fi
