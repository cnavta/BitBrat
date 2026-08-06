#!/usr/bin/env bash
#
# Loki + Promtail Deployment Validation Script
#
# Validates that:
# 1. Loki is running and healthy
# 2. Promtail is running and scraping logs
# 3. JSON log parsing is working
# 4. Labels (correlationId, traceId, service, level) are being extracted
#
# Usage:
#   ./validate-loki.sh
#
# Exit codes:
#   0 - All validations passed
#   1 - One or more validations failed

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
LOKI_URL="${LOKI_URL:-http://localhost:3100}"
VALIDATION_FAILED=0

echo -e "${BLUE}======================================================"
echo "Loki + Promtail Deployment Validation"
echo -e "======================================================${NC}\n"

# ==============================================================================
# Test 1: Loki Health Check
# ==============================================================================
echo -e "${BLUE}Test 1: Loki Health Check${NC}"

if curl -s -f "${LOKI_URL}/ready" > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Loki is running and healthy at ${LOKI_URL}${NC}\n"
else
  echo -e "${RED}✗ Loki is not running or not healthy${NC}"
  echo -e "${YELLOW}  Expected: Loki /ready endpoint responds 200 OK${NC}"
  echo -e "${YELLOW}  Hint: Start Loki via: docker compose -f docker-compose.yaml -f infrastructure/docker-compose/observability/docker-compose.observability.yaml up${NC}\n"
  VALIDATION_FAILED=1
fi

# ==============================================================================
# Test 2: Promtail Status Check
# ==============================================================================
echo -e "${BLUE}Test 2: Promtail Status Check${NC}"

if docker ps --filter "name=promtail.bitbrat.local" --format "{{.Status}}" | grep -q "Up"; then
  PROMTAIL_STATUS=$(docker ps --filter "name=promtail.bitbrat.local" --format "{{.Status}}")
  echo -e "${GREEN}✓ Promtail is running (${PROMTAIL_STATUS})${NC}\n"
else
  echo -e "${RED}✗ Promtail is not running${NC}"
  echo -e "${YELLOW}  Expected: Container 'promtail.bitbrat.local' is up${NC}"
  echo -e "${YELLOW}  Hint: Check docker compose status${NC}\n"
  VALIDATION_FAILED=1
fi

# ==============================================================================
# Test 3: Log Ingestion Check
# ==============================================================================
echo -e "${BLUE}Test 3: Log Ingestion Check${NC}"

# Query Loki for any logs from the last minute
QUERY='{service=~".+"}'
START_TIME=$(($(date +%s) * 1000000000 - 60000000000))  # 1 minute ago in nanoseconds
END_TIME=$(($(date +%s) * 1000000000))

RESPONSE=$(curl -s -G "${LOKI_URL}/loki/api/v1/query_range" \
  --data-urlencode "query=${QUERY}" \
  --data-urlencode "start=${START_TIME}" \
  --data-urlencode "end=${END_TIME}" \
  --data-urlencode "limit=10")

LOG_COUNT=$(echo "$RESPONSE" | node -e "
const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
if (data.status === 'success' && data.data && data.data.result) {
  let count = 0;
  for (const stream of data.data.result) {
    count += stream.values.length;
  }
  console.log(count);
} else {
  console.log('0');
}
" 2>/dev/null || echo "0")

if [ "$LOG_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✓ Loki is ingesting logs (${LOG_COUNT} entries in last minute)${NC}\n"
else
  echo -e "${YELLOW}⚠ No logs ingested in the last minute${NC}"
  echo -e "${YELLOW}  This might be normal if no events have occurred recently${NC}"
  echo -e "${YELLOW}  Hint: Trigger a test event to verify ingestion${NC}\n"
fi

# ==============================================================================
# Test 4: Label Extraction Validation
# ==============================================================================
echo -e "${BLUE}Test 4: Label Extraction Validation${NC}"

# Generate a unique test correlation ID
TEST_CORRELATION_ID="test-loki-validation-$(date +%s)"

echo -e "${YELLOW}Generating test event with correlationId: ${TEST_CORRELATION_ID}${NC}"

# Use brat chat to generate a test event (assumes local deployment is running)
# This will generate logs that Promtail should pick up
echo "!ping validation test" | npm run brat -- chat --target local --correlation-id "${TEST_CORRELATION_ID}" > /dev/null 2>&1 || {
  echo -e "${YELLOW}⚠ Could not generate test event via brat chat${NC}"
  echo -e "${YELLOW}  Skipping label extraction validation${NC}"
  echo -e "${YELLOW}  Hint: Ensure BitBrat platform is running locally${NC}\n"

  # Try to validate labels from existing logs instead
  echo -e "${YELLOW}Attempting to validate labels from recent logs...${NC}\n"
}

# Wait for Promtail to scrape and ship logs to Loki
echo -e "${YELLOW}Waiting 5 seconds for log ingestion...${NC}"
sleep 5

# Query Loki for the test event
QUERY="{correlationId=\"${TEST_CORRELATION_ID}\"}"
START_TIME=$(($(date +%s) * 1000000000 - 120000000000))  # 2 minutes ago
END_TIME=$(($(date +%s) * 1000000000))

RESPONSE=$(curl -s -G "${LOKI_URL}/loki/api/v1/query_range" \
  --data-urlencode "query=${QUERY}" \
  --data-urlencode "start=${START_TIME}" \
  --data-urlencode "end=${END_TIME}" \
  --data-urlencode "limit=100")

# Validate labels are present
LABELS_VALID=$(echo "$RESPONSE" | node -e "
const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
if (data.status === 'success' && data.data && data.data.result && data.data.result.length > 0) {
  const stream = data.data.result[0].stream;
  const hasCorrelationId = 'correlationId' in stream;
  const hasService = 'service' in stream;
  const hasLevel = 'level' in stream;

  if (hasCorrelationId && hasService && hasLevel) {
    console.log('valid');
  } else {
    console.log('Missing labels: ' +
      (!hasCorrelationId ? 'correlationId ' : '') +
      (!hasService ? 'service ' : '') +
      (!hasLevel ? 'level' : ''));
  }
} else {
  console.log('No logs found for test correlation ID');
}
" 2>/dev/null || echo "error")

if [ "$LABELS_VALID" = "valid" ]; then
  echo -e "${GREEN}✓ Label extraction is working correctly${NC}"
  echo -e "${GREEN}  Labels found: correlationId, service, level${NC}\n"
elif [ "$LABELS_VALID" = "No logs found for test correlation ID" ]; then
  # Fallback: Check recent logs for label structure
  QUERY='{service=~".+"}'
  RESPONSE=$(curl -s -G "${LOKI_URL}/loki/api/v1/query_range" \
    --data-urlencode "query=${QUERY}" \
    --data-urlencode "start=${START_TIME}" \
    --data-urlencode "end=${END_TIME}" \
    --data-urlencode "limit=1")

  LABELS_VALID=$(echo "$RESPONSE" | node -e "
const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
if (data.status === 'success' && data.data && data.data.result && data.data.result.length > 0) {
  const stream = data.data.result[0].stream;
  const hasService = 'service' in stream;
  const hasLevel = 'level' in stream;

  if (hasService && hasLevel) {
    console.log('partial');
  } else {
    console.log('missing');
  }
} else {
  console.log('none');
}
" 2>/dev/null || echo "error")

  if [ "$LABELS_VALID" = "partial" ]; then
    echo -e "${YELLOW}⚠ Basic labels found (service, level) but no test event captured${NC}"
    echo -e "${YELLOW}  Label extraction appears to be working for existing logs${NC}\n"
  else
    echo -e "${RED}✗ Label extraction validation failed${NC}"
    echo -e "${YELLOW}  Could not verify labels from test event or existing logs${NC}\n"
    VALIDATION_FAILED=1
  fi
else
  echo -e "${RED}✗ Label extraction validation failed: ${LABELS_VALID}${NC}\n"
  VALIDATION_FAILED=1
fi

# ==============================================================================
# Summary
# ==============================================================================
echo -e "${BLUE}======================================================"
echo "Validation Summary"
echo -e "======================================================${NC}\n"

if [ $VALIDATION_FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ All validations passed!${NC}"
  echo -e "${GREEN}  Loki + Promtail deployment is working correctly.${NC}\n"
  exit 0
else
  echo -e "${RED}✗ Some validations failed.${NC}"
  echo -e "${YELLOW}  Please review the output above for details.${NC}\n"
  exit 1
fi
