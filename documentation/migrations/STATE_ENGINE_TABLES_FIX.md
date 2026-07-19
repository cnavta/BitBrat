# State-Engine PostgreSQL Tables Fix

**Date:** 2026-07-17
**Sprint:** 343 - PostgreSQL Migration
**Status:** ✅ **COMPLETE**

## Issue

State-engine service was failing with PostgreSQL errors:

```
relation "state" does not exist
relation "mutation_log" does not exist
```

**Location:** State-engine trying to commit mutations and log mutation history

---

## Root Cause

Two tables required by state-engine were completely missing from PostgreSQL:
1. `state` - Stores current application state snapshots
2. `mutation_log` - Audit trail of state mutations

---

## Resolution

### Migration 010: State Tables

**File:** `infrastructure/postgres/migrations/010-add-state-tables.sql`
**Status:** ✅ Applied
**When:** 2026-07-17 18:15 UTC

Created two tables:

#### Table #21: state

**Purpose:** Store current application state snapshots managed by state-engine

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS state (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes:**
- `idx_state_key` - Lookup by state key
- `idx_state_type` - Filter by state type

**JSONB Fields:**
- `key`: State identifier
- `type`: State type (user, global, etc.)
- `value`: State value
- Additional fields as needed

---

#### Table #22: mutation_log

**Purpose:** Audit trail of all state mutations for debugging and compliance

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS mutation_log (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes:**
- `idx_mutation_log_mutation_id` - Lookup by mutation ID
- `idx_mutation_log_correlation_id` - Trace to events
- `idx_mutation_log_state_key` - Find mutations for specific state
- `idx_mutation_log_timestamp` - Time-based queries
- `idx_mutation_log_key_time` - Composite for state history queries

**JSONB Fields:**
- `mutationId`: Unique mutation identifier
- `correlationId`: Event correlation ID
- `stateKey`: State key being mutated
- `timestamp`: When mutation occurred
- `mutation`: The mutation proposal
- `result`: Success/failure

---

## Verification

### Tables Created
```bash
ssh root@bitbrat.lan 'docker exec docker-compose-postgres-1 psql -U bitbrat -d bitbrat -c "\d state"'
ssh root@bitbrat.lan 'docker exec docker-compose-postgres-1 psql -U bitbrat -d bitbrat -c "\d mutation_log"'
```

**Result:** ✅ Both tables created with proper indexes

### Service Health
```bash
ssh root@bitbrat.lan 'docker ps --filter "name=state-engine"'
```

**Result:** ✅ `bitbratplatform-state-engine-1` - Up (healthy)

### Error Logs
```bash
npm run brat -- fleet logs state-engine --since 5m --level error
```

**Result:** ✅ Zero errors

---

## Total PostgreSQL Tables

**Before:** 20 tables
**After:** 22 tables

**New Tables:**
- #21: `state` (2 indexes)
- #22: `mutation_log` (5 indexes)

---

## Files Modified

### Created
- `infrastructure/postgres/migrations/010-add-state-tables.sql`

### Updated
- `infrastructure/postgres/init/02-create-tables.sql` - Added state and mutation_log tables

---

## Conclusion

✅ **State-engine PostgreSQL tables fix complete**

State-engine is now fully operational with PostgreSQL:
- State snapshots stored in `state` table
- Mutation audit trail in `mutation_log` table
- All indexes in place for performance
- Zero errors in logs
- Service healthy

---

**Fixed By:** Claude (AI Assistant)
**Verified:** 2026-07-17 18:20 UTC
**Sprint:** 343 - PostgreSQL Migration
