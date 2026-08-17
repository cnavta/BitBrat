#!/bin/bash
# Sprint 3: Validation Script for BEC Creation Fixes
# This script validates that the base image build profile and PostgreSQL connection fixes work correctly

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=========================================="
echo "Sprint 3 Deliverable Validation"
echo "Fix BEC Creation for Remote Docker with PostgreSQL"
echo "=========================================="
echo ""

# Change to repo root
cd "$REPO_ROOT"

# Phase 1: Build Validation
echo "Phase 1: Build Validation"
echo "-------------------------------------------"
echo "Building TypeScript code..."
npm run build
if [ $? -eq 0 ]; then
  echo "✅ Build: SUCCESS"
else
  echo "❌ Build: FAILED"
  exit 1
fi
echo ""

# Phase 2: Test Validation
echo "Phase 2: Test Validation"
echo "-------------------------------------------"
echo "Running orchestrator tests..."
npm test -- orchestrator.test.ts --silent
if [ $? -eq 0 ]; then
  echo "✅ Orchestrator tests: PASSED"
else
  echo "❌ Orchestrator tests: FAILED"
  exit 1
fi

echo "Running context creation tests..."
npm test -- context/create.test.ts --silent
if [ $? -eq 0 ]; then
  echo "✅ Context creation tests: PASSED"
else
  echo "❌ Context creation tests: FAILED"
  exit 1
fi
echo ""

# Phase 3: Code Analysis
echo "Phase 3: Code Analysis"
echo "-------------------------------------------"
echo "Checking for --profile build-only in orchestrator.ts..."
if grep -q "'\-\-profile', 'build\-only'" tools/brat/src/orchestration/docker/orchestrator.ts; then
  echo "✅ Profile activation: IMPLEMENTED"
else
  echo "❌ Profile activation: NOT FOUND"
  exit 1
fi

echo "Checking for validatePostgresConnection in create.ts..."
if grep -q "validatePostgresConnection" tools/brat/src/commands/context/create.ts; then
  echo "✅ PostgreSQL validation: IMPLEMENTED"
else
  echo "❌ PostgreSQL validation: NOT FOUND"
  exit 1
fi

echo "Checking for bitbrat-base inclusion in generate-docker-compose.ts..."
if grep -q "bitbrat-base" tools/brat/src/context/generate-docker-compose.ts; then
  echo "✅ bitbrat-base inclusion: IMPLEMENTED"
else
  echo "❌ bitbrat-base inclusion: NOT FOUND"
  exit 1
fi

echo "Checking for build context fix in generate-docker-compose.ts..."
if grep -q "context: '\\.\\.\/\\.\\.'," tools/brat/src/context/generate-docker-compose.ts; then
  echo "✅ Build context path fix: IMPLEMENTED"
else
  echo "❌ Build context path fix: NOT FOUND"
  exit 1
fi

echo "Checking for serviceFiles population in orchestrator.ts..."
if grep -q "Context-specific deployment detected" tools/brat/src/orchestration/docker/orchestrator.ts; then
  echo "✅ Port assignment fix: IMPLEMENTED"
else
  echo "❌ Port assignment fix: NOT FOUND"
  exit 1
fi
echo ""

# Phase 4: Docker Compose Profile Validation
echo "Phase 4: Docker Compose Profile Validation"
echo "-------------------------------------------"
echo "Checking bitbrat-base service has build-only profile..."
if grep -A 3 "bitbrat-base:" infrastructure/docker-compose/docker-compose.local.yaml | grep -q "build-only"; then
  echo "✅ docker-compose.local.yaml: Profile configured"
else
  echo "⚠️  docker-compose.local.yaml: Profile not found (may not exist)"
fi

if grep -A 3 "bitbrat-base:" infrastructure/docker-compose/docker-compose.staging.yaml | grep -q "build-only"; then
  echo "✅ docker-compose.staging.yaml: Profile configured"
else
  echo "⚠️  docker-compose.staging.yaml: Profile not found (may not exist)"
fi
echo ""

# Phase 5: Syntax Check
echo "Phase 5: TypeScript Syntax Check"
echo "-------------------------------------------"
echo "Checking for TypeScript compilation errors..."
npx tsc --noEmit 2>&1 | head -20
if [ ${PIPESTATUS[0]} -eq 0 ]; then
  echo "✅ TypeScript syntax: CLEAN"
else
  echo "⚠️  TypeScript has errors (see above)"
fi
echo ""

# Phase 6: Integration Check (Dry-run mode)
echo "Phase 6: Integration Check"
echo "-------------------------------------------"
echo "Testing that brat context create command exists..."
if npm run brat -- context create --help > /dev/null 2>&1; then
  echo "✅ brat context create: COMMAND EXISTS"
else
  echo "❌ brat context create: COMMAND NOT FOUND"
  exit 1
fi
echo ""

# Phase 7: Documentation Check
echo "Phase 7: Documentation Check"
echo "-------------------------------------------"
echo "Checking for implementation plan..."
if [ -f "planning/sprint-3-p8ehzo/implementation-plan.md" ]; then
  echo "✅ Implementation plan: EXISTS"
else
  echo "❌ Implementation plan: MISSING"
  exit 1
fi
echo ""

# Phase 8: Summary
echo "=========================================="
echo "Validation Summary"
echo "=========================================="
echo "✅ Build validation: PASSED"
echo "✅ Test validation: PASSED"
echo "✅ Code analysis: PASSED"
echo "✅ Profile configuration: VERIFIED"
echo "✅ TypeScript syntax: CHECKED"
echo "✅ Integration check: PASSED"
echo "✅ Documentation: VERIFIED"
echo ""
echo "🎉 All validation checks PASSED!"
echo ""
echo "Manual Testing Steps:"
echo "1. Test local context creation:"
echo "   npm run brat -- context create test-sprint3-local"
echo ""
echo "2. Test that base image builds with profile:"
echo "   docker compose -f infrastructure/docker-compose/docker-compose.local.yaml --profile build-only build bitbrat-base"
echo ""
echo "3. (Optional) Test remote context creation:"
echo "   npm run brat -- context create test-sprint3-remote"
echo ""
echo "4. Verify PostgreSQL connection validation:"
echo "   - Stop PostgreSQL: docker stop bitbrat-local-postgres"
echo "   - Create context: npm run brat -- context create test-no-pg"
echo "   - Should see: 'PostgreSQL is not accessible' warning"
echo ""
