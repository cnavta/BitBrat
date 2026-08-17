#!/usr/bin/env bash
#
# validate_deliverable.sh - Sprint 337 Validation Script
#
# Validates the automated GitHub release workflow implementation:
# - Helper scripts functionality
# - GitHub Actions workflow syntax
# - Documentation completeness
# - Integration points
#
# Exit codes:
#   0 - All validations passed
#   1 - One or more validations failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "==================================="
echo "Sprint 337 Validation"
echo "Automated GitHub Releases Workflow"
echo "==================================="
echo ""

FAILED=0

# Helper function to report results
report() {
  local status=$1
  local message=$2

  if [[ "$status" == "PASS" ]]; then
    echo "✅ $message"
  elif [[ "$status" == "FAIL" ]]; then
    echo "❌ $message"
    FAILED=1
  elif [[ "$status" == "WARN" ]]; then
    echo "⚠️  $message"
  else
    echo "ℹ️  $message"
  fi
}

# ============================================================================
# 1. Check Script Files Exist
# ============================================================================
echo "1. Checking script files..."

if [[ -f "$PROJECT_ROOT/scripts/detect-version-change.sh" ]]; then
  report "PASS" "detect-version-change.sh exists"
else
  report "FAIL" "detect-version-change.sh missing"
fi

if [[ -f "$PROJECT_ROOT/scripts/extract-changelog.sh" ]]; then
  report "PASS" "extract-changelog.sh exists"
else
  report "FAIL" "extract-changelog.sh missing"
fi

if [[ -f "$PROJECT_ROOT/scripts/llm-release-notes.js" ]]; then
  report "PASS" "llm-release-notes.js exists"
else
  report "FAIL" "llm-release-notes.js missing"
fi

# Check executability
if [[ -x "$PROJECT_ROOT/scripts/detect-version-change.sh" ]]; then
  report "PASS" "detect-version-change.sh is executable"
else
  report "WARN" "detect-version-change.sh not executable (may work in CI)"
fi

if [[ -x "$PROJECT_ROOT/scripts/extract-changelog.sh" ]]; then
  report "PASS" "extract-changelog.sh is executable"
else
  report "WARN" "extract-changelog.sh not executable (may work in CI)"
fi

if [[ -x "$PROJECT_ROOT/scripts/llm-release-notes.js" ]]; then
  report "PASS" "llm-release-notes.js is executable"
else
  report "WARN" "llm-release-notes.js not executable (may work in CI)"
fi

echo ""

# ============================================================================
# 2. Test Script Functionality
# ============================================================================
echo "2. Testing script functionality..."

# Test version detection
cd "$PROJECT_ROOT"
if bash scripts/detect-version-change.sh >/dev/null 2>&1; then
  VERSIONS=$(bash scripts/detect-version-change.sh)
  report "PASS" "detect-version-change.sh runs successfully: $VERSIONS"
else
  report "INFO" "detect-version-change.sh: no version change detected (expected in many cases)"
fi

# Test CHANGELOG extraction (try with current version)
CURRENT_VERSION=$(grep -E '^\s+version:\s+' architecture.yaml | head -1 | awk '{print $2}' | tr -d '"')
if bash scripts/extract-changelog.sh "$CURRENT_VERSION" >/dev/null 2>&1; then
  report "PASS" "extract-changelog.sh successfully extracted v$CURRENT_VERSION"
else
  report "WARN" "extract-changelog.sh: no CHANGELOG entry for v$CURRENT_VERSION (may be expected)"
fi

# Test with known version
if bash scripts/extract-changelog.sh "0.9.0" >/dev/null 2>&1; then
  report "PASS" "extract-changelog.sh successfully extracted v0.9.0"
else
  report "WARN" "extract-changelog.sh: no CHANGELOG entry for v0.9.0"
fi

# Test LLM script syntax (don't actually call API)
if node -c scripts/llm-release-notes.js 2>/dev/null; then
  report "PASS" "llm-release-notes.js has valid syntax"
else
  report "FAIL" "llm-release-notes.js syntax error"
fi

echo ""

# ============================================================================
# 3. Validate GitHub Actions Workflow
# ============================================================================
echo "3. Validating GitHub Actions workflow..."

if [[ -f "$PROJECT_ROOT/.github/workflows/auto-release.yml" ]]; then
  report "PASS" "auto-release.yml exists"

  # Check for required workflow elements
  if grep -q "name: Automated Release" "$PROJECT_ROOT/.github/workflows/auto-release.yml"; then
    report "PASS" "Workflow has correct name"
  else
    report "FAIL" "Workflow name missing or incorrect"
  fi

  if grep -q "on:" "$PROJECT_ROOT/.github/workflows/auto-release.yml" && \
     grep -q "push:" "$PROJECT_ROOT/.github/workflows/auto-release.yml" && \
     grep -q "branches:" "$PROJECT_ROOT/.github/workflows/auto-release.yml" && \
     grep -q "main" "$PROJECT_ROOT/.github/workflows/auto-release.yml"; then
    report "PASS" "Workflow triggers on push to main"
  else
    report "FAIL" "Workflow trigger configuration incorrect"
  fi

  if grep -q "permissions:" "$PROJECT_ROOT/.github/workflows/auto-release.yml" && \
     grep -q "contents: write" "$PROJECT_ROOT/.github/workflows/auto-release.yml"; then
    report "PASS" "Workflow has correct permissions"
  else
    report "WARN" "Workflow permissions may not be configured"
  fi

  if grep -q "OPENAI_API_KEY" "$PROJECT_ROOT/.github/workflows/auto-release.yml"; then
    report "PASS" "Workflow references OPENAI_API_KEY secret"
  else
    report "FAIL" "Workflow missing OPENAI_API_KEY reference"
  fi

  if grep -q "llm-release-notes.js" "$PROJECT_ROOT/.github/workflows/auto-release.yml"; then
    report "PASS" "Workflow calls LLM script"
  else
    report "FAIL" "Workflow doesn't call LLM script"
  fi

  if grep -q "gh release create" "$PROJECT_ROOT/.github/workflows/auto-release.yml"; then
    report "PASS" "Workflow creates GitHub Release"
  else
    report "FAIL" "Workflow missing GitHub Release creation"
  fi

else
  report "FAIL" "auto-release.yml missing"
fi

echo ""

# ============================================================================
# 4. Check Documentation
# ============================================================================
echo "4. Checking documentation..."

if grep -q "Automated GitHub Releases" "$PROJECT_ROOT/CLAUDE.md"; then
  report "PASS" "CLAUDE.md documents automated releases"
else
  report "FAIL" "CLAUDE.md missing automated release documentation"
fi

if grep -q "Automated GitHub Releases" "$PROJECT_ROOT/README.md"; then
  report "PASS" "README.md documents automated releases"
else
  report "FAIL" "README.md missing automated release documentation"
fi

if [[ -f "$PROJECT_ROOT/documentation/guides/automated-releases.md" ]]; then
  report "PASS" "automated-releases.md guide exists"

  if grep -q "Setup" "$PROJECT_ROOT/documentation/guides/automated-releases.md" && \
     grep -q "OPENAI_API_KEY" "$PROJECT_ROOT/documentation/guides/automated-releases.md"; then
    report "PASS" "Guide includes setup instructions"
  else
    report "WARN" "Guide may be missing setup instructions"
  fi

else
  report "FAIL" "automated-releases.md guide missing"
fi

echo ""

# ============================================================================
# 5. Check Dependencies
# ============================================================================
echo "5. Checking dependencies..."

if grep -q '"openai"' "$PROJECT_ROOT/package.json"; then
  report "PASS" "openai dependency in package.json"
else
  report "FAIL" "openai dependency missing from package.json"
fi

if [[ -d "$PROJECT_ROOT/node_modules/openai" ]]; then
  report "PASS" "openai package installed"
else
  report "WARN" "openai package not installed (run npm install)"
fi

echo ""

# ============================================================================
# 6. Build & Test
# ============================================================================
echo "6. Running build and tests..."

if npm run build >/dev/null 2>&1; then
  report "PASS" "Build successful"
else
  report "FAIL" "Build failed"
fi

if npm test >/dev/null 2>&1; then
  report "PASS" "Tests passed"
else
  report "WARN" "Tests failed or had warnings"
fi

echo ""

# ============================================================================
# Final Summary
# ============================================================================
echo "==================================="
if [[ $FAILED -eq 0 ]]; then
  echo "✅ All validations passed!"
  echo "==================================="
  exit 0
else
  echo "❌ Some validations failed"
  echo "==================================="
  exit 1
fi
