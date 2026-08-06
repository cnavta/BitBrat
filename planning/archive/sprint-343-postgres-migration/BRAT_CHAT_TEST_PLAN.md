# Brat Chat End-to-End Test Plan
## PostgreSQL Migration Validation

**Purpose**: Validate that the PostgreSQL migration (Phase 1B-1D) works correctly end-to-end using the `brat chat` command.

**Date**: 2026-07-16
**Environment**: Local Docker stack
**Backend**: PostgreSQL + Firestore dual-backend mode

---

## Prerequisites

### 1. Environment Setup

**Verify local stack is running:**
```bash
docker ps | grep -E "(postgres|nats|firebase)"
```

**Expected containers:**
- `bitbrat-postgres` (PostgreSQL database)
- `bitbrat-nats` (NATS JetStream message bus)
- `firebase-emulator` (Firestore emulator)
- All service containers (ingress-egress, event-router, llm-bot, etc.)

**Verify PostgreSQL migrations:**
```bash
docker exec -it bitbrat-postgres psql -U bitbrat -d bitbrat -c "\dt"
```

**Expected tables:**
- `events`, `snapshots`, `sources`, `state`, `mutation_log` (persistence)
- `routing_rules`, `context_packs` (config)
- `auth_users`, `auth_scopes`, `sessions` (auth)
- `conversation_history`, `llm_responses` (application)

**Verify environment variables:**
```bash
# Should be set to postgres for testing
echo $PERSISTENCE_DRIVER

# Should be set to local PostgreSQL
echo $DATABASE_URL
```

### 2. Seed Test Data

**Run the migration seeder:**
```bash
export DATABASE_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat"
export FIRESTORE_EMULATOR_HOST="localhost:8080"
export GOOGLE_CLOUD_PROJECT="bitbrat-local"

npm run test-migration seed 1000
```

**Verify seeded data:**
```bash
# Check Firestore
npm run brat -- backup list --json | jq '.collections | length'

# Check PostgreSQL
psql $DATABASE_URL -c "SELECT COUNT(*) FROM routing_rules"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM context_packs"
```

---

## Test Scenarios

### Scenario 1: Basic Chat Flow (Firestore Backend)

**Objective**: Verify basic chat works with Firestore backend (baseline).

**Setup:**
```bash
export PERSISTENCE_DRIVER=firestore
npm run brat -- chat
```

**Test Steps:**

1. **Send greeting**
   - Input: `Hello!`
   - Expected: Bot responds with greeting
   - Verify: Response received within 2 seconds

2. **Send help command**
   - Input: `!help`
   - Expected: Bot responds with command list
   - Verify: Response contains available commands

3. **Send context query**
   - Input: `What context packs are available?`
   - Expected: Bot lists available context packs
   - Verify: List includes seeded context packs

4. **Send stream command**
   - Input: `!stream on`
   - Expected: Bot acknowledges stream state change
   - Verify: State mutation logged to Firestore

**Success Criteria:**
- ✅ All 4 steps complete without errors
- ✅ Responses received within acceptable latency (<2s)
- ✅ Data persisted to Firestore correctly

---

### Scenario 2: Basic Chat Flow (PostgreSQL Backend)

**Objective**: Verify basic chat works with PostgreSQL backend.

**Setup:**
```bash
export PERSISTENCE_DRIVER=postgres
export DATABASE_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat"
npm run brat -- chat
```

**Test Steps:**

1. **Send greeting**
   - Input: `Hello!`
   - Expected: Bot responds with greeting
   - Verify: Response received within 2 seconds

2. **Send help command**
   - Input: `!help`
   - Expected: Bot responds with command list
   - Verify: Response contains available commands

3. **Send context query**
   - Input: `What context packs are available?`
   - Expected: Bot lists available context packs
   - Verify: List includes seeded context packs from PostgreSQL

4. **Send stream command**
   - Input: `!stream on`
   - Expected: Bot acknowledges stream state change
   - Verify: State mutation logged to PostgreSQL `state` and `mutation_log` tables

**Validation Queries:**
```sql
-- Check state mutations
SELECT * FROM state WHERE id LIKE 'stream%' ORDER BY updated_at DESC LIMIT 5;

-- Check mutation log
SELECT * FROM mutation_log ORDER BY created_at DESC LIMIT 10;

-- Check events
SELECT COUNT(*) FROM events WHERE created_at > NOW() - INTERVAL '5 minutes';

-- Check snapshots
SELECT COUNT(*) FROM snapshots WHERE created_at > NOW() - INTERVAL '5 minutes';
```

**Success Criteria:**
- ✅ All 4 steps complete without errors
- ✅ Responses received within acceptable latency (<2s)
- ✅ Data persisted to PostgreSQL correctly
- ✅ State mutations visible in `state` table
- ✅ Audit trail visible in `mutation_log` table

---

### Scenario 3: Vector Search (PostgreSQL)

**Objective**: Verify vector search works with PostgreSQL backend.

**Setup:**
```bash
export PERSISTENCE_DRIVER=postgres
export DATABASE_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat"
npm run brat -- chat
```

**Test Steps:**

1. **Query with semantic search**
   - Input: `Tell me about streaming`
   - Expected: Bot uses vector search to find relevant context packs
   - Verify: Response includes context from packs with "streaming" content

2. **Query with unrelated topic**
   - Input: `What is quantum physics?`
   - Expected: Bot uses vector search, finds no relevant context
   - Verify: Response acknowledges lack of specific context

**Validation Queries:**
```sql
-- Check context packs with embeddings
SELECT id, data->>'name', data->>'description'
FROM context_packs
WHERE embedding IS NOT NULL
LIMIT 10;

-- Manually test vector search (if embedding exists)
SELECT
  data->>'name' as name,
  (embedding <=> '[0.1, 0.2, ...]'::vector) AS distance
FROM context_packs
WHERE embedding IS NOT NULL
ORDER BY distance ASC
LIMIT 5;
```

**Success Criteria:**
- ✅ Vector search returns relevant results
- ✅ Distance-based ranking works correctly
- ✅ No errors when context packs without embeddings exist

---

### Scenario 4: Event Persistence Flow (PostgreSQL)

**Objective**: Verify end-to-end event persistence with snapshots.

**Setup:**
```bash
export PERSISTENCE_DRIVER=postgres
export DATABASE_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat"
npm run brat -- chat
```

**Test Steps:**

1. **Send message that triggers full flow**
   - Input: `!ping`
   - Expected: Bot responds with pong
   - Verify: Event persisted with snapshots

**Validation Queries:**
```sql
-- Find the correlation ID
SELECT data->>'correlationId' as corr_id, data->>'eventType', created_at
FROM events
ORDER BY created_at DESC
LIMIT 1;

-- Check snapshots for this event (replace <correlation_id>)
SELECT
  data->>'snapshotId',
  data->>'sequence',
  data->>'kind',
  data->>'stage',
  created_at
FROM snapshots
WHERE data->>'correlationId' = '<correlation_id>'
ORDER BY (data->>'sequence')::int ASC;

-- Expected snapshot sequence:
-- 1. ingress (stage: ingestion)
-- 2. enrichment (stage: contextualization)
-- 3. analysis (stage: analysis)
-- 4. reaction (stage: reaction)
-- 5. egress delivery (stage: delivery)
```

**Success Criteria:**
- ✅ Event aggregate created in `events` table
- ✅ Multiple snapshots created in `snapshots` table
- ✅ Snapshot sequence increments correctly
- ✅ Each snapshot has correct stage and metadata
- ✅ correlationId links aggregate to snapshots

---

### Scenario 5: State Engine Mutations (PostgreSQL)

**Objective**: Verify state engine mutations with optimistic concurrency.

**Setup:**
```bash
export PERSISTENCE_DRIVER=postgres
export DATABASE_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat"
npm run brat -- chat
```

**Test Steps:**

1. **Set initial state**
   - Input: `!stream on`
   - Expected: State set to "on"
   - Verify: Version = 1

2. **Update state**
   - Input: `!stream off`
   - Expected: State updated to "off"
   - Verify: Version = 2

3. **Check version incrementing**
   - Verify: Each mutation increments version

**Validation Queries:**
```sql
-- Check state versions
SELECT
  id,
  data->>'value' as value,
  (data->>'version')::int as version,
  data->>'updatedBy' as updated_by,
  updated_at
FROM state
WHERE id = 'stream.state'
ORDER BY updated_at DESC;

-- Check mutation log
SELECT
  data->>'id' as mutation_id,
  data->>'op' as operation,
  data->>'key' as key,
  data->>'value' as value,
  data->>'status' as status,
  (data->>'resultingVersion')::int as version,
  created_at
FROM mutation_log
WHERE data->>'key' = 'stream.state'
ORDER BY created_at DESC
LIMIT 10;
```

**Success Criteria:**
- ✅ State mutations succeed
- ✅ Version increments on each mutation
- ✅ Mutation log records all attempts (accepted/rejected)
- ✅ Optimistic concurrency prevents version conflicts

---

### Scenario 6: Concurrent Access (PostgreSQL)

**Objective**: Verify concurrent chat sessions don't interfere.

**Setup:**
```bash
# Terminal 1
export PERSISTENCE_DRIVER=postgres
npm run brat -- chat

# Terminal 2 (in parallel)
export PERSISTENCE_DRIVER=postgres
npm run brat -- chat
```

**Test Steps:**

1. **Send messages in parallel**
   - Terminal 1: `Hello from session 1`
   - Terminal 2: `Hello from session 2`
   - Expected: Both sessions work independently

2. **Verify event isolation**
   - Check: Events have different correlationIds
   - Check: Sessions don't interfere with each other

**Validation Queries:**
```sql
-- Check recent events from multiple sessions
SELECT
  data->>'correlationId' as corr_id,
  data->>'eventType',
  data->>'source',
  created_at
FROM events
WHERE created_at > NOW() - INTERVAL '5 minutes'
ORDER BY created_at DESC;

-- Should see distinct correlation IDs for each session
```

**Success Criteria:**
- ✅ Concurrent sessions work without errors
- ✅ Events are properly isolated
- ✅ No race conditions or deadlocks
- ✅ Each session maintains independent state

---

### Scenario 7: Backup and Restore

**Objective**: Verify backup/restore works with PostgreSQL.

**Setup:**
```bash
export DATABASE_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat"
```

**Test Steps:**

1. **Create backup**
   ```bash
   npm run brat -- pg:backup --output /tmp/test-backup.json
   ```
   - Expected: Backup file created
   - Verify: File contains all tables

2. **Verify backup contents**
   ```bash
   cat /tmp/test-backup.json | jq '.metadata'
   cat /tmp/test-backup.json | jq '.data | keys'
   ```
   - Expected: metadata shows collection count, document count
   - Expected: data contains all expected collections

3. **Restore to clean database (optional, destructive)**
   ```bash
   # CAUTION: This will overwrite existing data
   npm run brat -- pg:restore --input /tmp/test-backup.json --mode overwrite --dry-run
   ```
   - Expected: Dry-run shows planned operations
   - Verify: No errors in dry-run

**Success Criteria:**
- ✅ Backup completes without errors
- ✅ Backup file contains all expected collections
- ✅ Metadata is correct (collection count, document count)
- ✅ Dry-run restore succeeds

---

### Scenario 8: Cross-Backend Consistency

**Objective**: Verify data consistency between Firestore and PostgreSQL.

**Setup:**
```bash
# Seed both backends
export FIRESTORE_EMULATOR_HOST="localhost:8080"
export GOOGLE_CLOUD_PROJECT="bitbrat-local"
npm run test-migration seed 100

export DATABASE_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat"
npm run test-migration seed 100
```

**Test Steps:**

1. **Query same data from both backends**
   - Firestore: Query routing_rules collection
   - PostgreSQL: Query routing_rules table
   - Compare: Results should match

2. **Verify chat works with both**
   - Run chat with Firestore backend
   - Run chat with PostgreSQL backend
   - Compare: Same commands produce same results

**Validation:**
```bash
# Firestore count
npm run brat -- backup export --target local --out /tmp/fs-backup.json --collections routing_rules
cat /tmp/fs-backup.json | jq '.data.routing_rules | length'

# PostgreSQL count
psql $DATABASE_URL -c "SELECT COUNT(*) FROM routing_rules"

# Counts should match
```

**Success Criteria:**
- ✅ Data counts match between backends
- ✅ Chat behavior is consistent across backends
- ✅ No data loss when switching backends

---

## Performance Benchmarks

### Latency Comparison

**Firestore Backend:**
```bash
export PERSISTENCE_DRIVER=firestore
time npm run brat -- chat <<EOF
Hello!
!help
exit
EOF
```

**PostgreSQL Backend:**
```bash
export PERSISTENCE_DRIVER=postgres
time npm run brat -- chat <<EOF
Hello!
!help
exit
EOF
```

**Metrics to Compare:**
- Time to first response
- Time per command
- Total session duration

**Expected Results:**
- PostgreSQL should be comparable or faster for local dev
- Both should complete within acceptable thresholds (<2s per command)

---

## Error Scenarios

### 1. Database Connection Failure

**Test:**
```bash
# Stop PostgreSQL
docker stop bitbrat-postgres

# Try to chat
export PERSISTENCE_DRIVER=postgres
npm run brat -- chat
```

**Expected:**
- Graceful error message
- No crashes
- Fallback or retry logic (if implemented)

### 2. Missing Table

**Test:**
```bash
# Drop a table
psql $DATABASE_URL -c "DROP TABLE IF EXISTS routing_rules CASCADE"

# Try to chat
npm run brat -- chat
```

**Expected:**
- Clear error message about missing table
- Suggestion to run migrations

### 3. Invalid Data

**Test:**
```bash
# Insert malformed data
psql $DATABASE_URL -c "INSERT INTO routing_rules (id, data) VALUES ('bad', '{}'::jsonb)"

# Try to query
npm run brat -- chat
```

**Expected:**
- Validation errors caught
- Malformed data skipped or logged

---

## Rollback Testing

**Objective**: Verify we can switch back to Firestore if needed.

**Test Steps:**

1. **Run with PostgreSQL**
   ```bash
   export PERSISTENCE_DRIVER=postgres
   npm run brat -- chat
   # Send some messages
   ```

2. **Switch to Firestore**
   ```bash
   export PERSISTENCE_DRIVER=firestore
   npm run brat -- chat
   # Send same messages
   ```

3. **Verify:**
   - Both backends work
   - No errors when switching
   - Data persists correctly in each backend

**Success Criteria:**
- ✅ Can switch backends without code changes
- ✅ Both backends work independently
- ✅ No data corruption

---

## Test Execution Checklist

- [ ] Prerequisites verified (containers running, migrations applied)
- [ ] Test data seeded (Firestore + PostgreSQL)
- [ ] Scenario 1: Basic Chat (Firestore) - PASSED
- [ ] Scenario 2: Basic Chat (PostgreSQL) - PASSED
- [ ] Scenario 3: Vector Search (PostgreSQL) - PASSED
- [ ] Scenario 4: Event Persistence (PostgreSQL) - PASSED
- [ ] Scenario 5: State Engine Mutations (PostgreSQL) - PASSED
- [ ] Scenario 6: Concurrent Access (PostgreSQL) - PASSED
- [ ] Scenario 7: Backup and Restore - PASSED
- [ ] Scenario 8: Cross-Backend Consistency - PASSED
- [ ] Performance Benchmarks - COMPLETED
- [ ] Error Scenarios - TESTED
- [ ] Rollback Testing - VERIFIED

---

## Test Results Template

**Date**: ___________
**Tester**: ___________
**Environment**: Local Docker
**PostgreSQL Version**: ___________
**Node Version**: ___________

### Summary

| Scenario | Status | Notes |
|----------|--------|-------|
| 1. Basic Chat (Firestore) | ⬜ PASS ⬜ FAIL | |
| 2. Basic Chat (PostgreSQL) | ⬜ PASS ⬜ FAIL | |
| 3. Vector Search | ⬜ PASS ⬜ FAIL | |
| 4. Event Persistence | ⬜ PASS ⬜ FAIL | |
| 5. State Mutations | ⬜ PASS ⬜ FAIL | |
| 6. Concurrent Access | ⬜ PASS ⬜ FAIL | |
| 7. Backup/Restore | ⬜ PASS ⬜ FAIL | |
| 8. Cross-Backend Consistency | ⬜ PASS ⬜ FAIL | |

### Issues Found

1. _____________
2. _____________
3. _____________

### Recommendations

1. _____________
2. _____________
3. _____________

---

## Post-Test Cleanup

```bash
# Stop local stack
npm run local:down

# Clean up test data
docker volume rm bitbratplatform_postgres_data

# Remove backup files
rm -f /tmp/*backup*.json /tmp/*backup*.gz
```
