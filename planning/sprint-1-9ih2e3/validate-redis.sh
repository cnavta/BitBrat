#!/bin/bash

# Redis Validation Script (Sprint 1)
# Validates Redis connectivity and basic operations
# Exit codes: 0 = success, 1 = connection failure, 2 = operation failure, 3 = TTL failure

set -e

# Configuration
REDIS_HOST="${REDIS_HOST:-redis}"
REDIS_PORT="${REDIS_PORT:-6379}"
TEST_KEY="bitbrat:validation:test"
TEST_VALUE="validation-$(date +%s)"
TEST_TTL=5

echo "========================================="
echo "Redis Validation Script"
echo "========================================="
echo "Target: ${REDIS_HOST}:${REDIS_PORT}"
echo ""

# Check if redis-cli is available
if ! command -v redis-cli &> /dev/null; then
    echo "❌ redis-cli not found. Installing via Docker..."
    echo ""
    echo "To validate Redis, run this script inside the nats-box container:"
    echo "  docker exec -it bitbrat-local-nats-box-1 sh"
    echo "  apk add redis"
    echo "  REDIS_HOST=redis ./planning/sprint-1-9ih2e3/validate-redis.sh"
    echo ""
    echo "Or install redis-cli locally:"
    echo "  macOS: brew install redis"
    echo "  Ubuntu: sudo apt-get install redis-tools"
    echo "  Alpine: apk add redis"
    exit 1
fi

echo "✓ redis-cli found"

# Test 1: Connection
echo ""
echo "Test 1: Connection"
echo "-------------------"
if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping > /dev/null 2>&1; then
    echo "✓ Connection successful (PING → PONG)"
else
    echo "❌ Connection failed"
    echo "   Check that Redis is running:"
    echo "     docker ps | grep redis"
    echo "     docker logs bitbrat-local-redis-1"
    exit 1
fi

# Test 2: SET operation
echo ""
echo "Test 2: SET Operation"
echo "---------------------"
if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" SET "$TEST_KEY" "$TEST_VALUE" > /dev/null 2>&1; then
    echo "✓ SET operation successful"
    echo "   Key: $TEST_KEY"
    echo "   Value: $TEST_VALUE"
else
    echo "❌ SET operation failed"
    exit 2
fi

# Test 3: GET operation
echo ""
echo "Test 3: GET Operation"
echo "---------------------"
RETRIEVED_VALUE=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" GET "$TEST_KEY")
if [ "$RETRIEVED_VALUE" = "$TEST_VALUE" ]; then
    echo "✓ GET operation successful"
    echo "   Retrieved: $RETRIEVED_VALUE"
else
    echo "❌ GET operation failed"
    echo "   Expected: $TEST_VALUE"
    echo "   Got: $RETRIEVED_VALUE"
    exit 2
fi

# Test 4: TTL operation
echo ""
echo "Test 4: TTL Expiration"
echo "----------------------"
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" EXPIRE "$TEST_KEY" "$TEST_TTL" > /dev/null 2>&1
TTL_VALUE=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" TTL "$TEST_KEY")
if [ "$TTL_VALUE" -gt 0 ] && [ "$TTL_VALUE" -le "$TEST_TTL" ]; then
    echo "✓ TTL set successfully"
    echo "   Expires in: ${TTL_VALUE}s"

    # Wait for expiration
    echo "   Waiting ${TEST_TTL}s for key to expire..."
    sleep $((TEST_TTL + 1))

    EXPIRED_VALUE=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" GET "$TEST_KEY")
    if [ -z "$EXPIRED_VALUE" ] || [ "$EXPIRED_VALUE" = "(nil)" ]; then
        echo "✓ Key expired as expected"
    else
        echo "❌ Key did not expire"
        echo "   Value still exists: $EXPIRED_VALUE"
        exit 3
    fi
else
    echo "❌ TTL operation failed"
    echo "   TTL: $TTL_VALUE (expected: 1-${TEST_TTL})"
    exit 3
fi

# Test 5: DEL operation
echo ""
echo "Test 5: DEL Operation"
echo "---------------------"
# Set a new key for deletion test
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" SET "$TEST_KEY" "$TEST_VALUE" > /dev/null 2>&1
DELETED=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" DEL "$TEST_KEY")
if [ "$DELETED" = "1" ]; then
    echo "✓ DEL operation successful"

    # Verify deletion
    DELETED_VALUE=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" GET "$TEST_KEY")
    if [ -z "$DELETED_VALUE" ] || [ "$DELETED_VALUE" = "(nil)" ]; then
        echo "✓ Key deleted successfully"
    else
        echo "❌ Key still exists after DEL"
        exit 2
    fi
else
    echo "❌ DEL operation failed"
    exit 2
fi

# Test 6: Idempotency Key Pattern (SET NX EX)
echo ""
echo "Test 6: Idempotency Pattern (SET NX EX)"
echo "----------------------------------------"
IDEMPOTENCY_KEY="bitbrat:idempotency:test:$(date +%s)"
# First attempt should succeed
RESULT1=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" SET "$IDEMPOTENCY_KEY" "processed" NX EX 60)
if [ "$RESULT1" = "OK" ]; then
    echo "✓ First SET NX succeeded (key created)"
else
    echo "❌ First SET NX failed"
    echo "   Expected: OK"
    echo "   Got: $RESULT1"
    exit 2
fi

# Second attempt should fail (key already exists)
RESULT2=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" SET "$IDEMPOTENCY_KEY" "duplicate" NX EX 60)
if [ -z "$RESULT2" ] || [ "$RESULT2" = "(nil)" ]; then
    echo "✓ Second SET NX rejected (duplicate detected)"
else
    echo "❌ Second SET NX should have failed"
    echo "   Expected: (nil)"
    echo "   Got: $RESULT2"
    exit 2
fi

# Cleanup
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" DEL "$IDEMPOTENCY_KEY" > /dev/null 2>&1

# Summary
echo ""
echo "========================================="
echo "✅ All Redis validation tests passed!"
echo "========================================="
echo ""
echo "Redis is ready for idempotency layer implementation."
echo ""
echo "Next steps:"
echo "  1. FOUND-001: Implement RedisManager"
echo "  2. FOUND-004: Implement idempotency middleware"
echo ""

exit 0
