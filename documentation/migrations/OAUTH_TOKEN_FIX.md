# OAuth Token Loading Fix - Sprint 343

**Date:** 2026-07-17
**Sprint:** 343 - PostgreSQL Migration
**Status:** ✅ **RESOLVED**

## Problem

After re-enabling Firebase emulator in staging, ingress-egress was still failing with OAuth token errors:

```
ERROR: FirestoreTwitchCredentialsProvider: no token in store
ERROR: connector.start_error - twitch_auth_missing
```

Despite tokens existing in Firestore (`oauth/twitch/bot` and `oauth/twitch/broadcaster`), all Twitch connectors (IRC, EventSub, broadcaster) failed to initialize.

## Root Cause

The `createTokenStore()` function was being called **without a database instance parameter**, causing it to auto-select the backend based on `PERSISTENCE_DRIVER`:

```typescript
// Before fix (src/apps/ingress-egress-service.ts:100)
const credsProvider = cfg.firestoreEnabled
  ? new FirestoreTwitchCredentialsProvider(cfg, createTokenStore(cfg.tokenDocPath || 'oauth/twitch/bot'))
  //                                              ^^^ No dbOrStore parameter provided
  : new ConfigTwitchCredentialsProvider(cfg);
```

**What happened:**
1. `PERSISTENCE_DRIVER=postgres` was set in staging environment
2. `createTokenStore()` without a `dbOrStore` parameter auto-creates `PostgresTokenStore`
3. PostgresTokenStore tries to read from `twitch_tokens` table in PostgreSQL (which is **empty**)
4. Token lookup fails → credential provider fails → connector fails
5. OAuth tokens exist in **Firestore**, but the code was looking in PostgreSQL

**File:** `/Users/christophernavta/IdeaProjects/BitBratPlatform/src/services/firestore-token-store.ts:155-181`

```typescript
export function createTokenStore(docPath: string, dbOrStore?: any, options?: { tableName?: string }): ITokenStore {
  // Auto-select based on PERSISTENCE_DRIVER when no dbOrStore provided
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres' || driver === 'postgresql') {
    const { createDocumentStore } = require('../common/persistence/factory');
    const store = createDocumentStore();
    return new PostgresTokenStore(store, docPath, options?.tableName || 'twitch_tokens');
    // ^^^ This tries to read from PostgreSQL twitch_tokens table (EMPTY)
  }

  // Default to Firestore
  return new FirestoreTokenStore(docPath);
}
```

## Solution

**Pass Firestore instance explicitly** to `createTokenStore()` to force OAuth tokens to use Firestore regardless of `PERSISTENCE_DRIVER` setting.

**File:** `src/apps/ingress-egress-service.ts`

### Changes Made

**Lines 100-105** (Bot token store):
```typescript
// Get Firestore instance for OAuth token storage (even when PERSISTENCE_DRIVER=postgres)
const firestore = cfg.firestoreEnabled ? this.getResource('firestore') : undefined;

const credsProvider = cfg.firestoreEnabled
  ? new FirestoreTwitchCredentialsProvider(cfg, createTokenStore(cfg.tokenDocPath || 'oauth/twitch/bot', firestore))
  //                                                                                                      ^^^^^^^^^^
  : new ConfigTwitchCredentialsProvider(cfg);
```

**Line 124** (Broadcaster token store):
```typescript
const broadcasterCredsProvider = new FirestoreTwitchCredentialsProvider(cfg, createTokenStore(cfg.broadcasterTokenDocPath, firestore));
//                                                                                                                         ^^^^^^^^^
```

## Deployment

Rebuilt and deployed ingress-egress to staging:

```bash
npm run build
npm run brat -- docker up --env staging --target staging --services ingress-egress
```

## Verification

### Before Fix:
```json
{
  "msg": "FirestoreTwitchCredentialsProvider: no token in store"
}
{
  "msg": "connector.start_error",
  "code": "twitch_auth_missing"
}
{
  "msg": "ingress-egress.status_change",
  "name": "twitch",
  "to": "ERROR"
}
```

### After Fix:
```json
{
  "msg": "Loaded token from Firestore",
  "userId": "1369021733",
  "scope": ["chat:read", "chat:edit", ...]
}
{
  "msg": "connector.started",
  "name": "twitch"
}
{
  "msg": "ingress-egress.status_change",
  "name": "twitch",
  "from": "NONE",
  "to": "CONNECTED"
}
```

✅ **All connectors started successfully:**
- `twitch` → CONNECTED
- `twitch-broadcaster` → CONNECTED
- `twitch-eventsub` → CONNECTED
- `discord` → CONNECTED

✅ **No errors**
✅ **OAuth tokens loaded from Firestore**
✅ **All platforms operational**

## Technical Details

### Why This Fix Works

By passing the Firestore instance explicitly, `createTokenStore()` detects it has a Firestore database via duck typing:

```typescript
// src/services/firestore-token-store.ts:155-159
if (dbOrStore && typeof dbOrStore.collection === 'function') {
  return new FirestoreTokenStore(docPath, dbOrStore);
  // ^^^ Takes this path when firestore instance is provided
}
```

This ensures OAuth tokens use Firestore **regardless of `PERSISTENCE_DRIVER`**, which is correct because:
1. OAuth tokens are still stored in Firestore (not yet migrated to PostgreSQL)
2. Firestore emulator is running in staging with valid tokens
3. Primary persistence uses PostgreSQL, but OAuth is an exception

### Long-term Solution

**Future sprint task:** Migrate OAuth tokens to PostgreSQL

**Benefits:**
- Eliminate Firebase emulator dependency entirely
- Consistent persistence backend across all features
- Simpler deployment (no dual persistence)

**Implementation plan:**
1. Create `oauth_tokens` table in PostgreSQL
2. Migrate existing tokens from Firestore → PostgreSQL
3. Update all credential providers to use DocumentStore
4. Remove Firebase emulator from staging/production

## Related Files

**Modified:**
- `src/apps/ingress-egress-service.ts:100-105` - Bot token store with Firestore instance
- `src/apps/ingress-egress-service.ts:124` - Broadcaster token store with Firestore instance

**Reference:**
- `src/services/firestore-token-store.ts:155-181` - createTokenStore() factory
- `src/services/ingress/twitch/credentials-provider.ts` - FirestoreTwitchCredentialsProvider

## Related Documentation

- `OAUTH_TOKENS_FIRESTORE_REQUIREMENT.md` - Why Firebase emulator is required
- `FIRESTORE_EMULATOR_ERRORS_FIX.md` - DNS resolution errors fix
- `SOURCES_TABLE_MIGRATION.md` - Sources table migration (012)

---

**Fixed By:** Claude (AI Assistant)
**Completed:** 2026-07-17 21:05 UTC
**Sprint:** 343 - PostgreSQL Migration
**Verification:** All Twitch and Discord connectors operational in staging
