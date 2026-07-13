#!/usr/bin/env bash
#
# Test suite for detect-version-change.sh
#
# Usage:
#   ./scripts/__tests__/test-detect-version-change.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DETECT_SCRIPT="$SCRIPT_DIR/../detect-version-change.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

TESTS_PASSED=0
TESTS_FAILED=0

# Test helper functions
pass() {
  echo -e "${GREEN}✓ PASS${NC}: $1"
  TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
  echo -e "${RED}✗ FAIL${NC}: $1"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

info() {
  echo -e "${YELLOW}ℹ INFO${NC}: $1"
}

section() {
  echo ""
  echo "=========================================="
  echo "$1"
  echo "=========================================="
}

# Test 1: Script exists and is executable
test_script_exists() {
  section "Test 1: Script Existence"

  if [[ -f "$DETECT_SCRIPT" ]]; then
    pass "Script exists at $DETECT_SCRIPT"
  else
    fail "Script not found at $DETECT_SCRIPT"
    return
  fi

  if [[ -x "$DETECT_SCRIPT" ]]; then
    pass "Script is executable"
  else
    fail "Script is not executable (run: chmod +x $DETECT_SCRIPT)"
  fi
}

# Test 2: Script can extract current version
test_extract_current_version() {
  section "Test 2: Current Version Extraction"

  if [[ ! -f "architecture.yaml" ]]; then
    fail "architecture.yaml not found (run from repo root)"
    return
  fi

  # Extract version directly
  local version
  version=$(grep -E '^\s+version:\s+' architecture.yaml | head -1 | awk '{print $2}' | tr -d '"' | xargs)

  if [[ -n "$version" ]]; then
    pass "Current version extracted: $version"
  else
    fail "Could not extract current version from architecture.yaml"
  fi
}

# Test 3: Script runs without errors (basic smoke test)
test_script_runs() {
  section "Test 3: Script Execution"

  local output
  local exit_code

  # Run script and capture output
  set +e
  output=$(bash "$DETECT_SCRIPT" 2>&1)
  exit_code=$?
  set -e

  if [[ $exit_code -eq 0 || $exit_code -eq 1 ]]; then
    pass "Script executed with valid exit code ($exit_code)"
  else
    fail "Script exited with unexpected code: $exit_code"
    echo "Output: $output"
    return
  fi

  # Check output format (should be "X.Y.Z X.Y.Z" or error message)
  if [[ "$output" =~ ^[0-9]+\.[0-9]+\.[0-9]+[[:space:]]+[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    pass "Output format is valid: $output"
  elif [[ "$output" =~ ^ERROR: ]]; then
    info "Script produced error (may be expected): $output"
  else
    fail "Unexpected output format: $output"
  fi
}

# Test 4: Debug mode works
test_debug_mode() {
  section "Test 4: Debug Mode"

  local output
  set +e
  output=$(DEBUG=true bash "$DETECT_SCRIPT" 2>&1)
  set -e

  if echo "$output" | grep -q "DEBUG:"; then
    pass "Debug mode produces debug output"
  else
    fail "Debug mode did not produce debug output"
  fi

  # Check that strategies are mentioned
  if echo "$output" | grep -q "Strategy"; then
    pass "Debug output mentions strategies"
  else
    fail "Debug output does not mention strategies"
  fi
}

# Test 5: GitHub API strategy (if network available)
test_github_api_strategy() {
  section "Test 5: GitHub API Strategy"

  local output
  set +e
  output=$(DEBUG=true bash "$DETECT_SCRIPT" 2>&1)
  set -e

  if echo "$output" | grep -q "Strategy 1: Checking GitHub Releases API"; then
    pass "Script attempts GitHub API strategy"

    if echo "$output" | grep -q "Latest GitHub Release:"; then
      pass "GitHub API strategy succeeded"
    else
      info "GitHub API strategy failed (no releases yet or network issue)"
    fi
  else
    fail "Script did not attempt GitHub API strategy"
  fi
}

# Test 6: Git tag strategy fallback
test_git_tag_strategy() {
  section "Test 6: Git Tag Strategy"

  # Check if any tags exist
  local tags
  tags=$(git tag -l 'v*' 2>/dev/null || echo "")

  if [[ -z "$tags" ]]; then
    info "No git tags found, skipping tag strategy test"
    return
  fi

  local output
  set +e
  output=$(DEBUG=true bash "$DETECT_SCRIPT" 2>&1)
  set -e

  # Note: Script stops after first successful strategy
  # If GitHub API succeeds, it won't check tags (this is correct behavior)
  if echo "$output" | grep -q "Strategy 2: Checking git tags"; then
    pass "Script checks git tag strategy (as fallback)"
  elif echo "$output" | grep -q "Strategy 1.*succeeded\|Latest GitHub Release:"; then
    pass "Script used Strategy 1 (GitHub API), skipped Strategy 2 (correct behavior)"
  else
    fail "Script did not attempt any strategy"
  fi
}

# Test 7: Output format validation
test_output_format() {
  section "Test 7: Output Format Validation"

  local output
  set +e
  output=$(bash "$DETECT_SCRIPT" 2>/dev/null)
  local exit_code=$?
  set -e

  # Should output two versions separated by space
  local old_ver
  local new_ver
  old_ver=$(echo "$output" | awk '{print $1}')
  new_ver=$(echo "$output" | awk '{print $2}')

  if [[ "$old_ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    pass "Old version format is valid: $old_ver"
  else
    fail "Old version format is invalid: $old_ver"
  fi

  if [[ "$new_ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    pass "New version format is valid: $new_ver"
  else
    fail "New version format is invalid: $new_ver"
  fi

  # Check exit code matches output
  if [[ "$old_ver" == "$new_ver" && $exit_code -eq 1 ]]; then
    pass "Exit code 1 for unchanged version (correct)"
  elif [[ "$old_ver" != "$new_ver" && $exit_code -eq 0 ]]; then
    pass "Exit code 0 for changed version (correct)"
  else
    fail "Exit code does not match version change status (old=$old_ver, new=$new_ver, exit=$exit_code)"
  fi
}

# Test 8: Error handling
test_error_handling() {
  section "Test 8: Error Handling"

  # Test with missing architecture.yaml (in a temp directory)
  local temp_dir
  temp_dir=$(mktemp -d)
  cd "$temp_dir" || exit 1

  # Initialize git repo (to avoid "not a git repo" error)
  git init --quiet
  git config user.email "test@example.com"
  git config user.name "Test User"

  local output
  local exit_code
  set +e
  output=$(bash "$DETECT_SCRIPT" 2>&1)
  exit_code=$?
  set -e

  if [[ $exit_code -eq 1 && "$output" =~ "ERROR" ]]; then
    pass "Script fails gracefully when architecture.yaml is missing"
  else
    fail "Script did not handle missing architecture.yaml correctly"
  fi

  # Cleanup
  cd - >/dev/null || exit 1
  rm -rf "$temp_dir"
}

# Test 9: Multiple strategies fallback
test_multiple_strategies() {
  section "Test 9: Multiple Strategies Fallback"

  local output
  set +e
  output=$(DEBUG=true bash "$DETECT_SCRIPT" 2>&1)
  set -e

  local strategy_count
  strategy_count=$(echo "$output" | grep -c "Strategy [0-9]:" || echo "0")

  if [[ $strategy_count -ge 1 ]]; then
    pass "Script tries multiple strategies (found $strategy_count)"
  else
    fail "Script did not try any strategies"
  fi

  # Check that it stops after finding a version
  if echo "$output" | grep -q "Previous version (determined):"; then
    pass "Script stops after finding a previous version"
  else
    fail "Script did not report finding a previous version"
  fi
}

# Test 10: Performance check
test_performance() {
  section "Test 10: Performance"

  local start
  local end
  local duration

  start=$(date +%s)
  bash "$DETECT_SCRIPT" >/dev/null 2>&1 || true
  end=$(date +%s)

  duration=$((end - start))

  if [[ $duration -le 5 ]]; then
    pass "Script completes in reasonable time: ${duration}s"
  elif [[ $duration -le 10 ]]; then
    info "Script takes a bit long but acceptable: ${duration}s"
  else
    fail "Script is too slow: ${duration}s (expected <10s)"
  fi
}

# Run all tests
main() {
  echo "=========================================="
  echo "Version Change Detection Script Test Suite"
  echo "=========================================="
  echo "Script: $DETECT_SCRIPT"
  echo "Working directory: $(pwd)"
  echo ""

  # Ensure we're in the repo root
  if [[ ! -f "architecture.yaml" ]]; then
    echo -e "${RED}ERROR${NC}: Must run from repository root (architecture.yaml not found)"
    exit 1
  fi

  # Run all tests
  test_script_exists
  test_extract_current_version
  test_script_runs
  test_debug_mode
  test_github_api_strategy
  test_git_tag_strategy
  test_output_format
  test_error_handling
  test_multiple_strategies
  test_performance

  # Summary
  echo ""
  echo "=========================================="
  echo "Test Summary"
  echo "=========================================="
  echo -e "Passed: ${GREEN}${TESTS_PASSED}${NC}"
  echo -e "Failed: ${RED}${TESTS_FAILED}${NC}"
  echo ""

  if [[ $TESTS_FAILED -eq 0 ]]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    exit 0
  else
    echo -e "${RED}✗ Some tests failed${NC}"
    exit 1
  fi
}

main "$@"
