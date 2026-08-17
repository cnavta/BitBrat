#!/usr/bin/env bash
#
# Benchmark script for fleet.trace performance
#
# Compares trace query performance between Docker logs and Loki backends.
# Requires:
# - BitBrat platform running locally (docker compose up)
# - Optional: Loki + Promtail stack (for Loki benchmark)
#
# Usage:
#   ./benchmark-trace.sh [correlation-id]
#
# If no correlation-id is provided, the script will generate a test event
# and use its correlation ID for benchmarking.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
LOKI_URL="${LOKI_URL:-http://localhost:3100}"
MCP_DEV_TOKEN="${MCP_DEV_TOKEN:-test-token-123}"

echo -e "${BLUE}======================================================"
echo "BitBrat Fleet Trace Performance Benchmark"
echo -e "======================================================${NC}\n"

# Check if correlation ID was provided
CORRELATION_ID="$1"

if [ -z "$CORRELATION_ID" ]; then
  echo -e "${YELLOW}No correlation ID provided. Generating test event...${NC}\n"

  # Generate a test event by sending a message to the platform
  # This assumes you have a way to trigger an event (e.g., via API or chat)
  # For now, we'll prompt the user to provide a correlation ID

  echo -e "${YELLOW}Please trigger a test event in the platform and provide its correlation ID:${NC}"
  read -p "Correlation ID: " CORRELATION_ID

  if [ -z "$CORRELATION_ID" ]; then
    echo -e "${RED}Error: No correlation ID provided. Exiting.${NC}"
    exit 1
  fi
fi

echo -e "${GREEN}Using correlation ID: ${CORRELATION_ID}${NC}\n"

# Function to run fleet.trace and measure time
run_trace_benchmark() {
  local backend="$1"
  local description="$2"

  echo -e "${BLUE}Testing ${description}...${NC}"

  # Measure execution time
  START_TIME=$(node -e "console.log(Date.now())")

  # Run fleet.trace via brat CLI
  npm run brat -- fleet trace "$CORRELATION_ID" --format timeline > /tmp/trace-output.txt 2>&1 || true

  END_TIME=$(node -e "console.log(Date.now())")
  DURATION=$((END_TIME - START_TIME))

  # Extract query time from output if available
  QUERY_TIME=$(grep "Query Time:" /tmp/trace-output.txt | sed -E 's/.*Query Time: ([0-9]+)ms.*/\1/' || echo "N/A")

  # Count log entries
  LOG_COUNT=$(grep -c "^\[" /tmp/trace-output.txt || echo "0")

  echo -e "  Total Time:  ${GREEN}${DURATION}ms${NC}"
  echo -e "  Query Time:  ${GREEN}${QUERY_TIME}ms${NC}"
  echo -e "  Log Entries: ${GREEN}${LOG_COUNT}${NC}"
  echo -e "  Backend:     ${GREEN}${backend}${NC}\n"

  # Return values for comparison
  echo "${DURATION}|${QUERY_TIME}|${LOG_COUNT}|${backend}"
}

# Benchmark 1: With Loki (if available)
echo -e "${BLUE}======================================================"
echo "Benchmark 1: Loki Backend"
echo -e "======================================================${NC}\n"

# Check if Loki is available
LOKI_AVAILABLE=false
if curl -s -f "${LOKI_URL}/ready" > /dev/null 2>&1; then
  LOKI_AVAILABLE=true
  echo -e "${GREEN}✓ Loki is available at ${LOKI_URL}${NC}\n"

  LOKI_RESULT=$(run_trace_benchmark "Loki" "Loki backend")
else
  echo -e "${YELLOW}✗ Loki is not available. Skipping Loki benchmark.${NC}"
  echo -e "${YELLOW}  To enable Loki, run: docker compose -f docker-compose.yaml -f infrastructure/docker-compose/observability/docker-compose.observability.yaml up${NC}\n"

  LOKI_RESULT="N/A|N/A|N/A|Loki (unavailable)"
fi

# Benchmark 2: Without Loki (Docker logs fallback)
echo -e "${BLUE}======================================================"
echo "Benchmark 2: Docker Logs Backend (Fallback)"
echo -e "======================================================${NC}\n"

# Temporarily stop Loki if it's running
if [ "$LOKI_AVAILABLE" = true ]; then
  echo -e "${YELLOW}Stopping Loki temporarily for fallback test...${NC}\n"
  docker stop loki.bitbrat.local > /dev/null 2>&1 || true
  sleep 2
fi

DOCKER_RESULT=$(run_trace_benchmark "Docker" "Docker logs backend")

# Restart Loki if it was stopped
if [ "$LOKI_AVAILABLE" = true ]; then
  echo -e "${YELLOW}Restarting Loki...${NC}\n"
  docker start loki.bitbrat.local > /dev/null 2>&1 || true
  sleep 2
fi

# Parse results
IFS='|' read -r LOKI_TOTAL LOKI_QUERY LOKI_LOGS LOKI_BACKEND <<< "$LOKI_RESULT"
IFS='|' read -r DOCKER_TOTAL DOCKER_QUERY DOCKER_LOGS DOCKER_BACKEND <<< "$DOCKER_RESULT"

# Print comparison report
echo -e "${BLUE}======================================================"
echo "Performance Comparison"
echo -e "======================================================${NC}\n"

printf "%-20s %15s %15s %15s\n" "Backend" "Total Time" "Query Time" "Log Count"
printf "%-20s %15s %15s %15s\n" "--------------------" "---------------" "---------------" "---------------"
printf "%-20s %15s %15s %15s\n" "$LOKI_BACKEND" "${LOKI_TOTAL}ms" "${LOKI_QUERY}ms" "$LOKI_LOGS"
printf "%-20s %15s %15s %15s\n" "$DOCKER_BACKEND" "${DOCKER_TOTAL}ms" "${DOCKER_QUERY}ms" "$DOCKER_LOGS"

echo ""

# Calculate speedup if both are available
if [ "$LOKI_AVAILABLE" = true ] && [ "$LOKI_TOTAL" != "N/A" ] && [ "$DOCKER_TOTAL" != "N/A" ]; then
  SPEEDUP=$(node -e "console.log((${DOCKER_TOTAL} / ${LOKI_TOTAL}).toFixed(2))")
  echo -e "${GREEN}Speedup: ${SPEEDUP}x faster with Loki${NC}"

  if (( $(echo "$LOKI_TOTAL < 100" | bc -l) )); then
    echo -e "${GREEN}✓ Loki query time is <100ms (target achieved)${NC}"
  else
    echo -e "${YELLOW}⚠ Loki query time is >100ms (target: <100ms)${NC}"
  fi
else
  echo -e "${YELLOW}Speedup calculation skipped (Loki not available)${NC}"
fi

echo ""
echo -e "${BLUE}======================================================"
echo "Benchmark Complete"
echo -e "======================================================${NC}"

# Cleanup
rm -f /tmp/trace-output.txt
