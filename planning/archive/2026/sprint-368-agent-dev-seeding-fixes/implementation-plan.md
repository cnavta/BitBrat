# Sprint 368: Agent-Dev Database Seeding & Rule Loading Fixes

**Sprint Goal:** Fix PostgresDocumentStore query bug and database seeding to enable end-to-end agent-dev functionality.

## Context from Sprint 367

Sprint 367 validated that agent-dev infrastructure works correctly, but uncovered two critical bugs:

1. **PostgresDocumentStore Query Bug**: Returns 0 rows even when data exists
   - Event-router can't load routing rules
   - Blocks all event processing

2. **Database Seeding Bug**: routing_rules, personalities, reflexes not inserted
   - Seed command reports success but data missing
   - context_packs work correctly (3/3 inserted)

## Investigation Plan

### Phase 1: Diagnose PostgresDocumentStore Query Bug

**Hypothesis:** Query filtering or caching preventing data retrieval

**Steps:**
1. Read `src/common/postgres-document-store.ts` implementation
2. Check query construction for `routing_rules` table
3. Verify connection pooling isn't causing stale reads
4. Test direct query vs. DocumentStore abstraction
5. Check if `active` filter is incorrectly applied

**Expected Findings:**
- Query may be filtering on `data->>'active' = 'true'` but seed data has boolean true
- Or: Cache not invalidated after insert
- Or: Transaction isolation preventing reads

### Phase 2: Fix PostgresDocumentStore (if needed)

**Potential Fixes:**
- Adjust boolean handling in JSONB queries
- Add cache invalidation after writes
- Fix query filter construction

**Acceptance Criteria:**
- Event-router logs show `"rule_loader.warm_loaded","count":1` (or more)
- Manual test: Insert rule → restart event-router → verify loaded

### Phase 3: Diagnose Database Seeding Bug

**Hypothesis:** Schema mismatch or validation error causing silent failures

**Steps:**
1. Read `tools/brat/src/seeding/postgres-seed-writer.ts`
2. Check seed data format vs. expected schema
3. Add verbose logging to insert operations
4. Check for transaction rollbacks
5. Verify error handling doesn't swallow failures

**Expected Findings:**
- Seed data might have wrong structure
- Insert might fail validation but not throw
- Transaction might rollback without logging

### Phase 4: Fix Database Seeding

**Potential Fixes:**
- Correct seed data structure
- Add proper error handling and logging
- Fix transaction management
- Validate data before insert

**Acceptance Criteria:**
- `npm run brat -- seed` results match database counts
- All tables seeded: routing_rules (4), personalities (1), reflexes (1), context_packs (3)

### Phase 5: End-to-End Validation

**Test Scenario:**
```bash
# 1. Provision fresh agent-dev context
agent_dev.provision()

# 2. Start services
agent_dev.start({ name: "agent-dev-*" })

# 3. Verify seeding
docker exec postgres psql -c "SELECT COUNT(*) FROM routing_rules"
# Expected: > 0

# 4. Verify rule loading
docker logs event-router | grep warm_loaded
# Expected: "count":4 or similar

# 5. Test chat flow
DATABASE_URL="..." npm run brat -- chat --message "!ping" --user TestUser
# Expected: Receives "pong" response, NOT timeout
```

**Acceptance Criteria:**
- Fresh agent-dev contexts work end-to-end
- Chat messages are routed correctly
- No manual intervention required

## Out of Scope

- DNS timing issues (ingress-egress race condition) - Sprint 369
- MCP fleet tools for agent-dev - Sprint 370
- Environment hostname detection - Sprint 369

## Timeline

- **Phase 1**: 30 minutes (investigate query bug)
- **Phase 2**: 30 minutes (fix if needed)
- **Phase 3**: 30 minutes (investigate seeding bug)
- **Phase 4**: 1 hour (fix seeding)
- **Phase 5**: 30 minutes (end-to-end test)

**Total**: 3 hours

## Success Metrics

1. ✅ PostgresDocumentStore returns correct row counts
2. ✅ Event-router loads routing rules from PostgreSQL
3. ✅ Seed command inserts all data types successfully
4. ✅ Fresh agent-dev context processes chat messages end-to-end
5. ✅ No manual SQL intervention required

---

**Ready to Begin:** Awaiting user approval to start Phase 1.
