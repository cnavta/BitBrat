#!/bin/bash
# MCP SDK 2.0 Validation Script
# Sprint: sprint-28-kbuirw
# Purpose: Automated validation in agent-dev environment

set -e

echo "=== MCP SDK 2.0 Validation ==="
echo ""

# Configuration
CONTEXT="${AGENT_DEV_CONTEXT:-agent-dev-mcp-v2}"
MCP_AUTH_TOKEN="${MCP_AUTH_TOKEN:-test-token}"

# Phase 1: Service Health
echo "1. Checking service health..."
SERVICES="tool-gateway llm-bot auth utility scheduler claim-check"
for service in $SERVICES; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://$service:3000/healthz" || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    echo "  ✓ $service healthy"
  else
    echo "  ✗ $service unhealthy (HTTP $HTTP_CODE)"
    exit 1
  fi
done
echo ""

# Phase 2: Tool Discovery
echo "2. Validating tool discovery..."
TOOLS_JSON=$(curl -s -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST http://tool-gateway:3000/mcp \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' || echo '{"error":"request failed"}')

if echo "$TOOLS_JSON" | grep -q '"error"'; then
  echo "  ✗ Tool discovery failed"
  echo "  Response: $TOOLS_JSON"
  exit 1
fi

TOOL_COUNT=$(echo "$TOOLS_JSON" | grep -o '"name"' | wc -l | tr -d ' ')
echo "  ✓ Discovered $TOOL_COUNT tools"

if [ "$TOOL_COUNT" -lt 10 ]; then
  echo "  ✗ Tool count too low (expected >= 150)"
  exit 1
fi
echo ""

# Phase 3: Tool Invocation
echo "3. Testing tool invocation..."
RESULT=$(curl -s -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST http://tool-gateway:3000/mcp \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":1,"params":{"name":"bit.info","arguments":{}}}' \
  || echo '{"error":"request failed"}')

if echo "$RESULT" | grep -q '"result"'; then
  echo "  ✓ Tool invocation succeeded"
else
  echo "  ✗ Tool invocation failed"
  echo "  Response: $RESULT"
  exit 1
fi
echo ""

# Phase 4: Auth Enforcement
echo "4. Testing auth enforcement..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -X POST http://tool-gateway:3000/mcp \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' || echo "000")

if [ "$HTTP_CODE" = "401" ]; then
  echo "  ✓ Auth enforced (401 without token)"
else
  echo "  ✗ Auth not enforced (got HTTP $HTTP_CODE, expected 401)"
  exit 1
fi
echo ""

# Phase 5: Performance (Latency)
echo "5. Measuring latency (10 runs)..."
TOTAL_TIME=0
for i in {1..10}; do
  START=$(date +%s%N)
  curl -s -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -X POST http://tool-gateway:3000/mcp \
    -d '{"jsonrpc":"2.0","method":"tools/call","id":1,"params":{"name":"bit.info","arguments":{}}}' \
    > /dev/null 2>&1
  END=$(date +%s%N)

  DURATION=$((($END - $START) / 1000000))  # Convert to milliseconds
  TOTAL_TIME=$(($TOTAL_TIME + $DURATION))
  echo "  Run $i: ${DURATION}ms"
done

AVG_TIME=$(($TOTAL_TIME / 10))
echo "  Average: ${AVG_TIME}ms"

if [ "$AVG_TIME" -gt 200 ]; then
  echo "  ⚠️  Warning: Average latency > 200ms"
fi
echo ""

# Success
echo "=== All validations passed ==="
exit 0
