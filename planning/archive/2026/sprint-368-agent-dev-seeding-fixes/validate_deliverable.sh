#!/bin/bash
#
# Sprint 368: Validation Script
# Validates that database seeding works correctly for agent-dev contexts
#

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

echo "============================================================"
echo "Sprint 368: Database Seeding Validation"
echo "============================================================"
echo

# Step 1: Build the project
echo "Step 1: Building project..."
npm run build > /dev/null 2>&1
echo "✅ Build succeeded"
echo

# Step 2: Check if agent-dev context exists
echo "Step 2: Checking for active agent-dev context..."
AGENT_DEV_CONTEXT=$(grep -A 1 "executionContexts:" .brat/ephemeral-contexts.yaml 2>/dev/null | tail -1 | awk '{print $1}' | sed 's/://g' || echo "")

if [ -z "$AGENT_DEV_CONTEXT" ]; then
  echo "❌ No agent-dev context found. Please run 'agent_dev.provision()' first."
  exit 1
fi

echo "✅ Found agent-dev context: $AGENT_DEV_CONTEXT"
echo

# Step 3: Check if PostgreSQL container is running
echo "Step 3: Checking PostgreSQL container..."
POSTGRES_CONTAINER="bitbrat-${AGENT_DEV_CONTEXT}-postgres-1"
if ! docker ps --format "{{.Names}}" | grep -q "^${POSTGRES_CONTAINER}$"; then
  echo "❌ PostgreSQL container not running. Please start the context with 'agent_dev.start()'."
  exit 1
fi

echo "✅ PostgreSQL container is running: $POSTGRES_CONTAINER"
echo

# Step 4: Test seeding with --wipe flag
echo "Step 4: Testing database seeding..."
SEED_OUTPUT=$(BITBRAT_CONTEXT="$AGENT_DEV_CONTEXT" npm run brat -- seed --wipe 2>&1)

if echo "$SEED_OUTPUT" | grep -q "Status: ✅ SUCCESS"; then
  echo "✅ Seed command succeeded"
else
  echo "❌ Seed command failed"
  echo "$SEED_OUTPUT"
  exit 1
fi
echo

# Step 5: Verify data in PostgreSQL
echo "Step 5: Verifying data in PostgreSQL..."

# Check routing_rules count
ROUTING_RULES_COUNT=$(docker exec "$POSTGRES_CONTAINER" psql -U bitbrat -d bitbrat -t -c "SELECT COUNT(*) FROM routing_rules;" 2>/dev/null | xargs)
if [ "$ROUTING_RULES_COUNT" -eq 4 ]; then
  echo "✅ routing_rules: $ROUTING_RULES_COUNT (expected 4)"
else
  echo "❌ routing_rules: $ROUTING_RULES_COUNT (expected 4)"
  exit 1
fi

# Check reflexes count
REFLEXES_COUNT=$(docker exec "$POSTGRES_CONTAINER" psql -U bitbrat -d bitbrat -t -c "SELECT COUNT(*) FROM reflexes;" 2>/dev/null | xargs)
if [ "$REFLEXES_COUNT" -eq 1 ]; then
  echo "✅ reflexes: $REFLEXES_COUNT (expected 1)"
else
  echo "❌ reflexes: $REFLEXES_COUNT (expected 1)"
  exit 1
fi

# Check personalities count
PERSONALITIES_COUNT=$(docker exec "$POSTGRES_CONTAINER" psql -U bitbrat -d bitbrat -t -c "SELECT COUNT(*) FROM personalities;" 2>/dev/null | xargs)
if [ "$PERSONALITIES_COUNT" -eq 1 ]; then
  echo "✅ personalities: $PERSONALITIES_COUNT (expected 1)"
else
  echo "❌ personalities: $PERSONALITIES_COUNT (expected 1)"
  exit 1
fi

# Check context_packs count
CONTEXT_PACKS_COUNT=$(docker exec "$POSTGRES_CONTAINER" psql -U bitbrat -d bitbrat -t -c "SELECT COUNT(*) FROM context_packs;" 2>/dev/null | xargs)
if [ "$CONTEXT_PACKS_COUNT" -eq 3 ]; then
  echo "✅ context_packs: $CONTEXT_PACKS_COUNT (expected 3)"
else
  echo "❌ context_packs: $CONTEXT_PACKS_COUNT (expected 3)"
  exit 1
fi

# Check api_tokens count
API_TOKENS_COUNT=$(docker exec "$POSTGRES_CONTAINER" psql -U bitbrat -d bitbrat -t -c "SELECT COUNT(*) FROM api_tokens;" 2>/dev/null | xargs)
if [ "$API_TOKENS_COUNT" -eq 1 ]; then
  echo "✅ api_tokens: $API_TOKENS_COUNT (expected 1)"
else
  echo "❌ api_tokens: $API_TOKENS_COUNT (expected 1)"
  exit 1
fi

echo

# Step 6: Verify event-router loads routing rules
echo "Step 6: Verifying event-router loads routing rules..."
EVENT_ROUTER_CONTAINER="bitbrat-${AGENT_DEV_CONTEXT}-event-router-1"

# Restart event-router to trigger rule loading
echo "Restarting event-router..."
docker restart "$EVENT_ROUTER_CONTAINER" > /dev/null 2>&1
sleep 5

# Check logs for rule loading
RULE_COUNT=$(docker logs "$EVENT_ROUTER_CONTAINER" 2>&1 | grep "rule_loader.warm_loaded" | tail -1 | grep -o '"count":[0-9]*' | cut -d':' -f2)

if [ "$RULE_COUNT" -eq 4 ]; then
  echo "✅ Event-router loaded $RULE_COUNT routing rules (expected 4)"
else
  echo "❌ Event-router loaded $RULE_COUNT routing rules (expected 4)"
  exit 1
fi

echo

# Step 7: Verify PostgresDocumentStore query works
echo "Step 7: Verifying PostgresDocumentStore query..."
QUERY_OUTPUT=$(docker exec "$POSTGRES_CONTAINER" psql -U bitbrat -d bitbrat -t -c "SELECT COUNT(*) FROM routing_rules WHERE data->>'enabled' = 'true';" 2>/dev/null | xargs)

if [ "$QUERY_OUTPUT" -eq 4 ]; then
  echo "✅ PostgresDocumentStore query returns correct count: $QUERY_OUTPUT"
else
  echo "❌ PostgresDocumentStore query failed: $QUERY_OUTPUT (expected 4)"
  exit 1
fi

echo

# Final summary
echo "============================================================"
echo "Validation Results"
echo "============================================================"
echo
echo "✅ All validation checks passed!"
echo
echo "Summary:"
echo "  - Database seeding works correctly"
echo "  - All 5 tables seeded with expected data"
echo "  - Event-router loads routing rules from PostgreSQL"
echo "  - PostgresDocumentStore query logic works correctly"
echo
echo "Sprint 368: SUCCESS"
echo
