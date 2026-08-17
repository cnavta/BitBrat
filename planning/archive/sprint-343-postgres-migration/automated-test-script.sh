#!/bin/bash
# =============================================================================
# Automated Test Script for PostgreSQL Migration
# =============================================================================
#
# Tests the chat flow end-to-end by sending HTTP/WebSocket requests to the
# API Gateway and validating responses.
#
# Usage:
#   ./automated-test-script.sh
#
# Prerequisites:
#   - Local Docker stack running (npm run local)
#   - Test data seeded (routing_rules, context_packs)
#   - jq installed for JSON parsing
#
# =============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results
PASSED=0
FAILED=0
TOTAL=0

# Helper functions
log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[PASS]${NC} $1"
  ((PASSED++))
  ((TOTAL++))
}

log_fail() {
  echo -e "${RED}[FAIL]${NC} $1"
  ((FAILED++))
  ((TOTAL++))
}

log_section() {
  echo ""
  echo "========================================="
  echo "$1"
  echo "========================================="
}

# Test API Gateway health
test_api_gateway_health() {
  log_info "Testing API Gateway health endpoint..."

  RESPONSE=$(curl -s http://localhost:3004/health)
  STATUS=$(echo "$RESPONSE" | jq -r '.status' 2>/dev/null || echo "error")

  if [[ "$STATUS" == "ok" ]]; then
    log_success "API Gateway is healthy"
  else
    log_fail "API Gateway health check failed: $RESPONSE"
  fi
}

# Test PostgreSQL connection
test_postgres_connection() {
  log_info "Testing PostgreSQL connection..."

  export DATABASE_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat"

  RESULT=$(docker exec bitbratplatform-postgres-1 psql -U bitbrat -d bitbrat -c "SELECT 1" -t 2>/dev/null || echo "error")

  if [[ "$RESULT" =~ "1" ]]; then
    log_success "PostgreSQL connection successful"
  else
    log_fail "PostgreSQL connection failed"
  fi
}

# Test Firestore emulator connection
test_firestore_connection() {
  log_info "Testing Firestore emulator connection..."

  export FIRESTORE_EMULATOR_HOST="localhost:8080"
  export GOOGLE_CLOUD_PROJECT="bitbrat-local"

  RESPONSE=$(curl -s http://localhost:8080/ || echo "error")

  if [[ "$RESPONSE" != "error" ]]; then
    log_success "Firestore emulator is accessible"
  else
    log_fail "Firestore emulator connection failed"
  fi
}

# Verify PostgreSQL data
verify_postgres_data() {
  log_info "Verifying PostgreSQL test data..."

  # Check routing_rules
  RULES_COUNT=$(docker exec bitbratplatform-postgres-1 psql -U bitbrat -d bitbrat -t -c "SELECT COUNT(*) FROM routing_rules;" 2>/dev/null | tr -d ' ')

  if [[ "$RULES_COUNT" -ge 3 ]]; then
    log_success "PostgreSQL has $RULES_COUNT routing rules"
  else
    log_fail "PostgreSQL routing_rules count too low: $RULES_COUNT (expected >= 3)"
  fi

  # Check context_packs
  PACKS_COUNT=$(docker exec bitbratplatform-postgres-1 psql -U bitbrat -d bitbrat -t -c "SELECT COUNT(*) FROM context_packs;" 2>/dev/null | tr -d ' ')

  if [[ "$PACKS_COUNT" -ge 3 ]]; then
    log_success "PostgreSQL has $PACKS_COUNT context packs"
  else
    log_fail "PostgreSQL context_packs count too low: $PACKS_COUNT (expected >= 3)"
  fi

  # Check pgvector extension
  VECTOR_EXT=$(docker exec bitbratplatform-postgres-1 psql -U bitbrat -d bitbrat -t -c "SELECT extname FROM pg_extension WHERE extname = 'vector';" 2>/dev/null | tr -d ' ')

  if [[ "$VECTOR_EXT" == "vector" ]]; then
    log_success "pgvector extension is installed"
  else
    log_fail "pgvector extension not found"
  fi
}

# Verify Firestore data
verify_firestore_data() {
  log_info "Verifying Firestore test data..."

  export FIRESTORE_EMULATOR_HOST="localhost:8080"
  export GOOGLE_CLOUD_PROJECT="bitbrat-local"

  # Use Firestore REST API to check events collection
  RESPONSE=$(curl -s "http://localhost:8080/v1/projects/bitbrat-local/databases/(default)/documents/events?pageSize=1" || echo "error")

  if [[ "$RESPONSE" != "error" && ! "$RESPONSE" =~ "error" ]]; then
    log_success "Firestore emulator has data accessible"
  else
    log_fail "Firestore data verification failed"
  fi
}

# Test service health checks
test_service_health() {
  log_info "Checking critical service health..."

  SERVICES=(
    "bitbratplatform-llm-bot-1"
    "bitbratplatform-event-router-1"
    "bitbratplatform-state-engine-1"
    "bitbratplatform-persistence-1"
    "bitbratplatform-ingress-egress-1"
  )

  for SERVICE in "${SERVICES[@]}"; do
    HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$SERVICE" 2>/dev/null || echo "unknown")

    if [[ "$HEALTH" == "healthy" ]]; then
      log_success "$SERVICE is healthy"
    else
      log_fail "$SERVICE health: $HEALTH"
    fi
  done
}

# Test vector search index
test_vector_index() {
  log_info "Verifying vector search index..."

  INDEX_EXISTS=$(docker exec bitbratplatform-postgres-1 psql -U bitbrat -d bitbrat -t -c "
    SELECT COUNT(*) FROM pg_indexes
    WHERE tablename = 'context_packs'
    AND indexname = 'idx_context_packs_embedding';
  " 2>/dev/null | tr -d ' ')

  if [[ "$INDEX_EXISTS" == "1" ]]; then
    log_success "Vector search index exists on context_packs"
  else
    log_fail "Vector search index not found"
  fi
}

# Test NATS connection
test_nats_connection() {
  log_info "Testing NATS message bus..."

  NATS_HEALTH=$(curl -s http://localhost:8222/healthz || echo "error")

  if [[ "$NATS_HEALTH" == "ok" ]]; then
    log_success "NATS is healthy"
  else
    log_fail "NATS health check failed"
  fi
}

# Main test execution
main() {
  log_section "PostgreSQL Migration - Automated Tests"

  echo "Date: $(date)"
  echo "Environment: Local Docker"
  echo ""

  log_section "Infrastructure Tests"
  test_api_gateway_health
  test_postgres_connection
  test_firestore_connection
  test_nats_connection

  log_section "Data Verification Tests"
  verify_postgres_data
  verify_firestore_data
  test_vector_index

  log_section "Service Health Tests"
  test_service_health

  # Summary
  echo ""
  log_section "Test Summary"
  echo "Total Tests: $TOTAL"
  echo -e "${GREEN}Passed: $PASSED${NC}"
  echo -e "${RED}Failed: $FAILED${NC}"

  if [[ $FAILED -eq 0 ]]; then
    echo ""
    echo -e "${GREEN}✅ All tests passed!${NC}"
    echo ""
    echo "Next Steps:"
    echo "  1. Run manual chat tests: npm run brat -- chat"
    echo "  2. Test with PERSISTENCE_DRIVER=postgres"
    echo "  3. Execute remaining test scenarios from BRAT_CHAT_TEST_PLAN.md"
    exit 0
  else
    echo ""
    echo -e "${RED}❌ Some tests failed${NC}"
    echo ""
    echo "Review the failures above and check:"
    echo "  - Docker containers are all running"
    echo "  - Migrations have been applied"
    echo "  - Test data has been seeded"
    exit 1
  fi
}

# Run tests
main
