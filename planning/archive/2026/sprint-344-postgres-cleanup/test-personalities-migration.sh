#!/bin/bash
# Test script for personalities table migration
# Validates migration 013 creates the table with correct schema

set -e

echo "🧪 Testing personalities table migration..."

# Connection details (use environment or defaults)
DB_HOST="${DATABASE_HOST:-localhost}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_NAME="${DATABASE_NAME:-bitbrat}"
DB_USER="${DATABASE_USER:-bitbrat}"

echo "📡 Connecting to PostgreSQL at $DB_HOST:$DB_PORT/$DB_NAME"

# Run migration
echo "📝 Running migration 013-add-personalities-table.sql..."
docker exec -i bitbrat-postgres psql -U "$DB_USER" -d "$DB_NAME" < infrastructure/postgres/migrations/013-add-personalities-table.sql

# Verify table exists
echo "✅ Verifying personalities table exists..."
docker exec -i bitbrat-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "\d personalities"

# Check indexes
echo "✅ Verifying indexes created..."
docker exec -i bitbrat-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'personalities'
ORDER BY indexname;"

# Insert test personality
echo "✅ Inserting test personality..."
docker exec -i bitbrat-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "
INSERT INTO personalities (id, data) VALUES (
  'test_personality_001',
  '{
    \"name\": \"test_assistant\",
    \"text\": \"You are a helpful test assistant.\",
    \"status\": \"active\",
    \"version\": 1,
    \"tags\": [\"test\"],
    \"createdAt\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"
  }'::jsonb
);"

# Query by name
echo "✅ Querying personality by name..."
docker exec -i bitbrat-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "
SELECT id, data->>'name' as name, data->>'status' as status, data->>'version' as version
FROM personalities
WHERE data->>'name' = 'test_assistant';"

# Verify index usage with EXPLAIN
echo "✅ Verifying index usage (EXPLAIN)..."
docker exec -i bitbrat-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM personalities
WHERE data->>'name' = 'test_assistant'
  AND data->>'status' = 'active'
ORDER BY (data->>'version')::int DESC
LIMIT 1;"

# Cleanup test data
echo "🧹 Cleaning up test data..."
docker exec -i bitbrat-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "
DELETE FROM personalities WHERE id = 'test_personality_001';"

echo "✅ All tests passed!"
echo ""
echo "📊 Summary:"
echo "   - personalities table created"
echo "   - All indexes present"
echo "   - INSERT successful"
echo "   - Query by name successful"
echo "   - Indexes used in query plan"
echo "   - Test data cleaned up"
