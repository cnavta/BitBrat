# Identity Roles Missing from Events Table

**Date:** 2026-07-17
**Sprint:** 343 - PostgreSQL Migration
**Status:** 🔍 **INVESTIGATION COMPLETE** - Ready for Fix

## Issue

The `events` table's `identitySummary` field is missing user roles, even though the auth service is correctly enriching events with role information in snapshots.

**User Report:** "We are seeing some potentially missing roles in events"

---

## Root Cause Analysis

### 1. Auth Service is Working Correctly ✅

The auth-service properly enriches events with full identity including roles:

**Evidence from Snapshot #3 (auth-enriched):**
```json
{
  "identity": {
    "auth": {
      "v": "2",
      "matched": true,
      "userRef": "users/twitch:91960688",
      "provider": "twitch"
    },
    "user": {
      "id": "twitch:91960688",
      "displayName": "Gonj_The_Unjust",
      "roles": ["subscriber", "broadcaster", "unjust"],  ✅ ROLES PRESENT
      "rolesMeta": {
        "twitch": ["subscriber"]
      },
      "tags": ["PROVIDER_TWITCH", "RETURNING_USER"]
    },
    "external": {
      "id": "91960688",
      "platform": "twitch"
    }
  }
}
```

**Location:** `src/services/auth/enrichment.ts:130-143` and `src/services/auth/enrichment.ts:174-185`

**Verification:** Auth service logs show `auth.enrich.matched` with correct `userRef`

---

### 2. Problem: Identity Summary Builder Drops Roles ❌

The `buildIdentitySummary()` function only extracts 4 fields:

**File:** `src/services/persistence/model.ts:72-79`

```typescript
function buildIdentitySummary(evt: InternalEventV2): EventAggregateV2['identitySummary'] {
  return stripUndefinedDeep({
    externalId: evt.identity?.external?.id,
    platform: evt.identity?.external?.platform,
    displayName: evt.identity?.user?.displayName || evt.identity?.external?.displayName,
    userId: evt.identity?.user?.id,
    // ❌ MISSING: roles, rolesMeta, tags, status
  });
}
```

**Result:** `identitySummary` in events table lacks roles:

```json
{
  "identitySummary": {
    "userId": "twitch:91960688",
    "platform": "twitch",
    "externalId": "91960688",
    "displayName": "Gonj_The_Unjust"
    // ❌ No roles field
  }
}
```

---

### 3. Type Definition Also Missing Roles

**File:** `src/types/events.ts:259-264`

```typescript
identitySummary?: {
  externalId?: string;
  platform?: string;
  displayName?: string;
  userId?: string;
  // ❌ MISSING: roles, rolesMeta, tags, status
};
```

---

## Impact

**Severity:** Medium

**Affected Systems:**
- Any service querying events table for user roles
- Analytics/reporting on user permissions
- Audit trails requiring role information
- Access control decisions based on historical events

**Not Affected:**
- Real-time event processing (uses full event from snapshots)
- Auth service enrichment (working correctly)
- Current routing/delivery (uses snapshot data)

---

## Proposed Fix

### 1. Update Type Definition

**File:** `src/types/events.ts:259-264`

```typescript
identitySummary?: {
  externalId?: string;
  platform?: string;
  displayName?: string;
  userId?: string;
  roles?: string[];              // ✅ ADD
  rolesMeta?: Record<string, string[]>;  // ✅ ADD
  tags?: string[];               // ✅ ADD
  status?: string;               // ✅ ADD (for banned/active status)
};
```

### 2. Update Builder Function

**File:** `src/services/persistence/model.ts:72-79`

```typescript
function buildIdentitySummary(evt: InternalEventV2): EventAggregateV2['identitySummary'] {
  return stripUndefinedDeep({
    externalId: evt.identity?.external?.id,
    platform: evt.identity?.external?.platform,
    displayName: evt.identity?.user?.displayName || evt.identity?.external?.displayName,
    userId: evt.identity?.user?.id,
    roles: evt.identity?.user?.roles,           // ✅ ADD
    rolesMeta: evt.identity?.user?.rolesMeta,   // ✅ ADD
    tags: evt.identity?.user?.tags,             // ✅ ADD
    status: evt.identity?.user?.status,         // ✅ ADD
  });
}
```

### 3. Backfill Existing Events (Optional)

For existing events in PostgreSQL, we could run a migration to backfill roles from the latest snapshot:

```sql
-- Migration: Backfill identitySummary.roles from snapshots
UPDATE events e
SET data = jsonb_set(
  data,
  '{identitySummary,roles}',
  COALESCE(
    (
      SELECT s.data->'event'->'identity'->'user'->'roles'
      FROM snapshots s
      WHERE s.data->>'correlationId' = e.data->>'correlationId'
        AND s.data->'event'->'identity'->'user'->'roles' IS NOT NULL
      ORDER BY (s.data->>'sequence')::int DESC
      LIMIT 1
    ),
    '[]'::jsonb
  )
)
WHERE data->'identitySummary' IS NOT NULL
  AND (data->'identitySummary'->'roles' IS NULL OR data->'identitySummary'->'roles' = 'null'::jsonb);
```

---

## Verification

### Current State

**Query:** Check current events table structure
```sql
SELECT
  data->>'correlationId' as correlationId,
  jsonb_pretty(data->'identitySummary') as identitySummary
FROM events
WHERE created_at > NOW() - INTERVAL '1 hour'
LIMIT 1;
```

**Expected Before Fix:** No `roles` field in `identitySummary`

**Expected After Fix:** `roles` array present with values like `["subscriber", "broadcaster"]`

### Test Cases

1. **New Event After Fix:**
   - Send chat message from Twitch subscriber
   - Check events table: `identitySummary.roles` should include `["subscriber"]`

2. **Broadcaster Roles:**
   - Send message from broadcaster account
   - Check events table: should include `["broadcaster", "subscriber"]`

3. **Custom Roles:**
   - Update user with `update_user` tool to add custom role
   - Send message from that user
   - Check events table: custom role should appear

---

## Files to Modify

### Code Changes
1. `src/types/events.ts:259-264` - Update EventAggregateV2['identitySummary'] type
2. `src/services/persistence/model.ts:72-79` - Update buildIdentitySummary() function

### Optional Migration
3. `infrastructure/postgres/migrations/011-backfill-identity-roles.sql` - Backfill existing events

---

## Testing Plan

1. **Unit Tests:**
   - Test `buildIdentitySummary()` includes roles
   - Test with user having multiple roles
   - Test with user having no roles (empty array)
   - Test with rolesMeta populated

2. **Integration Tests:**
   - Send test message through full pipeline
   - Verify event aggregate has roles in identitySummary
   - Verify snapshot still has full identity.user object

3. **Manual Verification:**
   - Check recent events in staging PostgreSQL
   - Verify roles appear correctly
   - Test with different user types (subscriber, mod, broadcaster)

---

## Rollout Plan

### Phase 1: Code Fix (Immediate)
1. Update type definition
2. Update builder function
3. Deploy to staging
4. Verify new events have roles

### Phase 2: Backfill (Optional)
1. Run migration to backfill existing events
2. Verify backfill completed successfully
3. Test queries against historical data

### Phase 3: Production (After Staging Verification)
1. Deploy code changes to production
2. Monitor for any issues
3. Consider backfill based on business needs

---

## Related Code Locations

### Auth Enrichment (Working Correctly)
- `src/services/auth/enrichment.ts:130-143` - Sets identity.user with roles
- `src/services/auth/enrichment.ts:202-238` - mapTwitchEnrichment() extracts roles from badges
- `src/services/auth/enrichment.ts:240-276` - mapDiscordEnrichment() extracts roles
- `src/apps/auth-service.ts:81-143` - Calls enrichEvent and forwards

### Persistence (Missing Roles)
- `src/services/persistence/model.ts:72-79` - buildIdentitySummary() drops roles
- `src/services/persistence/model.ts:183` - Used when creating initial aggregate
- `src/services/persistence/model.ts:293` - Used when updating aggregate from snapshot

### Type Definitions
- `src/types/events.ts:259-264` - EventAggregateV2['identitySummary'] type
- `src/types/events.ts:50-75` - InternalEventV2['identity'] type (has full structure)

---

## Questions for User

1. **Urgency:** Is this blocking any current functionality or just analytics?
2. **Backfill:** Do you need roles backfilled for existing events, or just fix going forward?
3. **Scope:** Are there other identity fields missing that would be useful in the summary?

---

**Investigated By:** Claude (AI Assistant)
**Completed:** 2026-07-17 19:30 UTC
**Next Step:** Implement fix in code and deploy
