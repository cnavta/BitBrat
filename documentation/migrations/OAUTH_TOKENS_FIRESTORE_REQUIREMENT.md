# OAuth Tokens Require Firestore Emulator in Staging

**Date:** 2026-07-17
**Sprint:** 343 - PostgreSQL Migration
**Status:** ⚠️ **PARTIAL** - Emulator running, tokens need re-creation

## Problem

After disabling the Firebase emulator by default, ingress-egress service failed to start with errors:

```
ERROR: Failed to retrieve Twitch credentials
ERROR: FirestoreTwitchCredentialsProvider: no token in store
ERROR: connector.start_error - twitch_auth_missing
```

All Twitch connectors (IRC, EventSub, broadcaster) failed to initialize.

## Root Cause

**OAuth tokens are still stored in Firestore**, even though primary persistence uses PostgreSQL (`PERSISTENCE_DRIVER=postgres`).

### Why OAuth Tokens Use Firestore

The OAuth token storage was implemented before the PostgreSQL migration and uses:
- `FirestoreTokenStore` for reading/writing tokens
- `createTokenStore()` factory that auto-selects backend
- Document paths: `oauth/twitch/bot`, `oauth/twitch/broadcaster`

### What Went Wrong

1. Sprint 343 disabled Firebase emulator by default (made opt-in via profiles)
2. Staging environment had `FIRESTORE_EMULATOR_HOST` commented out
3. `ingress-egress` couldn't connect to Firestore (no project ID, no emulator)
4. Token reads failed → credential providers failed → connectors failed
5. All Twitch integration stopped working

## Solution

**Re-enabled Firebase emulator in staging** by setting `COMPOSE_PROFILES=firebase` in `env/staging/infra.yaml`.

### Configuration Changes

**File:** `env/staging/infra.yaml`

```yaml
# Enable Firebase emulator via docker-compose profile
# Required for OAuth token storage even though PERSISTENCE_DRIVER=postgres
COMPOSE_PROFILES: firebase

# Firebase/Firestore settings
# NOTE: Even though PERSISTENCE_DRIVER=postgres, some services (ingress-egress)
# still use Firestore for OAuth token storage. These settings are required.
FIREBASE_PROJECT_ID: bitbrat-local
GOOGLE_CLOUD_PROJECT: bitbrat-local
GCLOUD_PROJECT: bitbrat-local
FIRESTORE_EMULATOR_HOST: firebase-emulator:8080

NATS_URL: nats://nats:4222
```

### Why This is Needed

| Component | Backend | Reason |
|-----------|---------|--------|
| Events, snapshots, rules | PostgreSQL | Primary persistence (PERSISTENCE_DRIVER=postgres) |
| OAuth tokens | Firestore | Not yet migrated to PostgreSQL |
| Twitch credentials | Firestore | Uses FirestoreTokenStore |
| Discord credentials | Firestore | Uses FirestoreTokenStore |

## Deployment

Redeployed staging with firebase profile enabled:

```bash
npm run brat -- docker up --env staging --target staging
```

**Result:**
- ✅ Firebase emulator started
- ✅ Firestore emulator listening on port 8080
- ✅ Services can connect to Firestore
- ⚠️ OAuth tokens are EMPTY (fresh emulator instance)

## Current State

### Firebase Emulator Status
```bash
docker ps | grep firebase
# bitbratplatform-firebase-emulator-1 (healthy)
```

### OAuth Token Status

OAuth tokens do NOT exist in the emulator:

```bash
curl -s "http://bitbrat.lan:8080/v1/projects/bitbrat-local/databases/(default)/documents/oauth/twitch"
# 404 NOT_FOUND
```

**This is expected** - the emulator started fresh with empty data.

### Ingress-Egress Status

```
ERROR: FirestoreTwitchCredentialsProvider: no token in store
connector.start_error: twitch_auth_missing
ingress-egress.status_change: twitch -> ERROR
```

**Expected behavior** - tokens don't exist yet.

## Next Steps

### Option 1: Re-run OAuth Flow (Recommended for Staging)

Navigate to OAuth flow endpoint to authorize platforms:

```bash
# Twitch Bot
open http://bitbrat.lan:3001/oauth/twitch

# Twitch Broadcaster
open http://bitbrat.lan:3001/oauth/twitch-broadcaster

# Discord (if needed)
open http://bitbrat.lan:3001/oauth/discord
```

After authorization, tokens will be stored in `oauth/twitch/bot/token` and `oauth/twitch/broadcaster/token` in Firestore emulator.

### Option 2: Migrate OAuth Tokens to PostgreSQL (Future Sprint)

**Benefits:**
- Eliminate Firebase emulator dependency
- Consistent persistence backend
- Simpler deployment

**Implementation:**
1. Create `oauth_tokens` table in PostgreSQL (similar to `twitch_tokens`)
2. Update `createTokenStore()` to use PostgreSQL when `PERSISTENCE_DRIVER=postgres`
3. Migrate existing tokens from Firestore to PostgreSQL
4. Remove Firebase emulator from staging

**Migration task:** Create in future sprint backlog

### Option 3: Restore Firestore Data from Backup (If Available)

If previous Firestore emulator data was backed up:

```bash
# Restore firebase-data-v2 volume from backup
# Or copy token documents from production Firestore
```

## Technical Details

### Token Storage Implementation

**Current implementation** (`src/services/firestore-token-store.ts`):

```typescript
export function createTokenStore(
  docPath: string,
  dbOrStore?: any,
  options?: { tableName?: string }
): ITokenStore {
  // Auto-select based on PERSISTENCE_DRIVER
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres' || driver === 'postgresql') {
    const store = createDocumentStore();
    return new PostgresTokenStore(store, docPath, 'twitch_tokens');
  }

  // Default to Firestore
  return new FirestoreTokenStore(getFirestore(), docPath);
}
```

**Issue:** Even with `PERSISTENCE_DRIVER=postgres`, the code defaults to Firestore when no `dbOrStore` is provided.

**Ingress-egress usage** (`src/apps/ingress-egress-service.ts:100`):

```typescript
const credsProvider = cfg.firestoreEnabled
  ? new FirestoreTwitchCredentialsProvider(cfg, createTokenStore(cfg.tokenDocPath || 'oauth/twitch/bot'))
  : new ConfigTwitchCredentialsProvider(cfg);
```

When `firestoreEnabled=true` (which it is in staging), it ALWAYS uses `FirestoreTwitchCredentialsProvider` with `createTokenStore()`.

### Why Tokens Aren't in PostgreSQL

The `createTokenStore()` factory checks:
1. Is `dbOrStore` provided? → Use it
2. Is `PERSISTENCE_DRIVER=postgres`? → Create `PostgresTokenStore`
3. Otherwise → Use `FirestoreTokenStore`

But `ingress-egress` calls it without `dbOrStore`, so it falls through to step 3 and creates `FirestoreTokenStore`.

## Resolution Options

### Immediate (Staging)

✅ **Re-enable Firebase emulator** - Done
⏳ **Re-create OAuth tokens** - User action required

### Long-term (All Environments)

Option A: **Update createTokenStore() to respect PERSISTENCE_DRIVER**
```typescript
// Always honor PERSISTENCE_DRIVER, even without dbOrStore
if (!dbOrStore) {
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres') {
    return new PostgresTokenStore(createDocumentStore(), docPath, 'oauth_tokens');
  }
}
```

Option B: **Pass documentStore to createTokenStore()**
```typescript
const documentStore = this.getResource('documentStore');
const credsProvider = new FirestoreTwitchCredentialsProvider(
  cfg,
  createTokenStore(cfg.tokenDocPath, documentStore)
);
```

Option C: **Create dedicated OAuth token migration**
- Migrate all tokens from Firestore → PostgreSQL
- Update all credential providers
- Remove Firestore dependency entirely

## Recommendation

**For Sprint 343:**
1. Keep Firebase emulator enabled in staging (`COMPOSE_PROFILES=firebase`)
2. Re-run OAuth flow to restore tokens
3. Document this as temporary solution

**For Future Sprint:**
1. Create migration to move OAuth tokens to PostgreSQL
2. Update credential providers to use DocumentStore
3. Remove Firebase emulator from staging
4. Update documentation

---

**Investigated By:** Claude (AI Assistant)
**Documented:** 2026-07-17 20:55 UTC
**Sprint:** 343 - PostgreSQL Migration
**Status:** Firebase emulator re-enabled; OAuth tokens need manual recreation
