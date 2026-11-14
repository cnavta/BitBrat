#!/bin/bash
# Comprehensive diagnostic for tool-gateway discovery issues
# This checks the entire flow: registration → storage → discovery → connection

set -e

echo "================================================"
echo "   Tool-Gateway Discovery Diagnostic"
echo "================================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check 1: PostgreSQL service_registry table
echo "1️⃣  Checking service_registry table..."
echo "-------------------------------------------"

SQL_CHECK='SELECT id,
  data->>'\''name'\'' as name,
  data->>'\''transport'\'' as transport,
  data->>'\''url'\'' as url,
  data->>'\''status'\'' as status,
  updated_at
FROM service_registry
ORDER BY updated_at DESC
LIMIT 10;'

psql "${DATABASE_URL}" -c "$SQL_CHECK" 2>&1 || {
  echo -e "${RED}❌ Could not query service_registry table${NC}"
  echo "Database URL: ${DATABASE_URL}"
}

echo ""

# Check 2: tool-gateway RegistryWatcher logs
echo "2️⃣  Checking tool-gateway RegistryWatcher status..."
echo "-------------------------------------------"

echo "Looking for watch.start and snapshot_received logs..."
docker logs tool-gateway 2>&1 | grep -E "watch.start|registry_watcher.snapshot_received|registry_watcher.starting" | tail -10 || {
  echo -e "${YELLOW}⚠️  No RegistryWatcher logs found${NC}"
}

echo ""

# Check 3: MCP registration events
echo "3️⃣  Checking MCP registration events..."
echo "-------------------------------------------"

echo "Recent registration attempts:"
docker logs tool-gateway 2>&1 | grep -E "registration.received|handleMcpRegistration" | tail -10 || {
  echo -e "${YELLOW}⚠️  No registration events found${NC}"
}

echo ""

# Check 4: McpClientManager connection attempts
echo "4️⃣  Checking McpClientManager connections..."
echo "-------------------------------------------"

echo "Connection attempts:"
docker logs tool-gateway 2>&1 | grep -E "client_manager.connecting|client_manager.connected|client_manager.connect_error" | tail -15 || {
  echo -e "${YELLOW}⚠️  No connection logs found${NC}"
}

echo ""

# Check 5: Tool discovery
echo "5️⃣  Checking tool discovery..."
echo "-------------------------------------------"

echo "Tool discovery events:"
docker logs tool-gateway 2>&1 | grep -E "list_tools.calling|list_tools.completed|tools_discovered|tool_registered" | tail -20 || {
  echo -e "${YELLOW}⚠️  No tool discovery logs found${NC}"
}

echo ""

# Check 6: What services are actually running
echo "6️⃣  Checking which MCP services are running..."
echo "-------------------------------------------"

docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "obs-mcp|image-gen|story-engine|scheduler|claim-check|context-pack|reflex" || {
  echo -e "${RED}❌ No domain MCP services running${NC}"
}

echo ""

# Check 7: Test direct MCP connection
echo "7️⃣  Testing direct MCP connection to obs-mcp..."
echo "-------------------------------------------"

if docker ps | grep -q obs-mcp; then
  curl -s -X POST http://obs-mcp:3000/mcp \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${MCP_AUTH_TOKEN}" \
    -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"test","version":"1.0.0"},"capabilities":{}},"id":1}' \
    2>&1 | jq '.' || echo -e "${RED}❌ Could not connect to obs-mcp${NC}"
else
  echo -e "${YELLOW}⚠️  obs-mcp not running${NC}"
fi

echo ""
echo "================================================"
echo "   Diagnosis Summary"
echo "================================================"
echo ""

# Summary
SQL_COUNT="SELECT COUNT(*) as count FROM service_registry WHERE data->>'status' = 'active';"
ACTIVE_COUNT=$(psql "${DATABASE_URL}" -t -c "$SQL_COUNT" 2>/dev/null | tr -d ' ' || echo "0")

if [ "$ACTIVE_COUNT" -eq "0" ]; then
  echo -e "${RED}❌ PROBLEM: No services registered in service_registry${NC}"
  echo ""
  echo "LIKELY CAUSE: Services haven't registered yet or registration is failing"
  echo ""
  echo "FIX: Check these service logs for registration errors:"
  echo "  docker logs obs-mcp 2>&1 | grep registration"
  echo "  docker logs image-gen-mcp 2>&1 | grep registration"
  echo ""
elif docker logs tool-gateway 2>&1 | grep -q "client_manager.connected"; then
  echo -e "${GREEN}✅ Services are registered AND connected${NC}"
  echo ""
  echo "If tools still not visible, check:"
  echo "  - llm-bot MCP client connection logs"
  echo "  - tool-gateway tools/list handler logs"
else
  echo -e "${YELLOW}⚠️  Services registered but NOT connected${NC}"
  echo ""
  echo "Registered services: $ACTIVE_COUNT"
  echo ""
  echo "LIKELY CAUSE: tool-gateway can't connect to registered service URLs"
  echo ""
  echo "CHECK: Are service URLs using /mcp endpoint (not /sse)?"
  psql "${DATABASE_URL}" -c "SELECT id, data->>'url' as url FROM service_registry WHERE data->>'status' = 'active';" 2>/dev/null
fi

echo ""
echo "================================================"
