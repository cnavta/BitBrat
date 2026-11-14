#!/bin/bash
# Debug script to check MCP service registry status in staging
# Run this to diagnose why llm-bot isn't seeing tools from other services

echo "=== MCP Registry Diagnostics ==="
echo ""

echo "1. Checking PostgreSQL for registered MCP servers..."
echo "SELECT name, transport, url, status FROM mcp_servers ORDER BY updated_at DESC LIMIT 20;" | \
  PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" 2>/dev/null || \
  echo "❌ Could not connect to PostgreSQL. Check DATABASE_URL and credentials."

echo ""
echo "2. Checking which services are actually running in Docker..."
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "obs-mcp|image-gen|story-engine|scheduler|claim-check|context-pack" || \
  echo "❌ No MCP services found running in Docker"

echo ""
echo "3. Checking tool-gateway logs for registration events..."
docker logs tool-gateway 2>&1 | grep -i "mcp.*registration\|registry_watcher" | tail -20 || \
  echo "❌ Could not find tool-gateway logs"

echo ""
echo "4. Checking tool-gateway connectivity to a sample MCP service (obs-mcp)..."
curl -s -X POST http://obs-mcp:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${MCP_AUTH_TOKEN}" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"1.0.0","clientInfo":{"name":"test","version":"1.0.0"}},"id":1}' \
  2>&1 | head -20 || echo "❌ Could not connect to obs-mcp:3000/mcp"

echo ""
echo "5. Checking llm-bot logs for tool discovery..."
docker logs llm-bot 2>&1 | grep -i "tool.*discover\|mcp.*connect\|tools.*list" | tail -20 || \
  echo "❌ Could not find llm-bot logs"

echo ""
echo "=== Diagnosis Complete ==="
echo ""
echo "Common issues:"
echo "  - No MCP services registered → Deploy obs-mcp, image-gen-mcp, etc."
echo "  - Services registered but not running → Start the services"
echo "  - Services running but can't connect → Check /mcp endpoint (not /sse)"
echo "  - Connection works but no tools → Check service logs for errors"
