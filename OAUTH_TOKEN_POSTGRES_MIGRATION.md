# OAuth Token Migration to PostgreSQL - Sprint 343

**Date:** 2026-07-17
**Sprint:** 343 - PostgreSQL Migration
**Status:** ✅ **COMPLETE**

## Overview

Successfully migrated all OAuth tokens from Firestore to PostgreSQL, eliminating the requirement for Firebase emulator in staging and production environments.

## Problem Statement

After migrating primary persistence to PostgreSQL in Sprint 343, OAuth tokens were still stored in Firestore, requiring the Firebase emulator to run in staging. This created:
- Dual persistence backends (PostgreSQL + Firestore)
- Unnecessary Firebase emulator dependency
- Complex deployment configuration
- Inconsistent data storage patterns

## Solution

**Complete migration of OAuth tokens to PostgreSQL:**
1. Created migration script to copy tokens from Firestore → PostgreSQL
2. Updated ingress-egress service to use documentStore (PostgreSQL-backed)
3. Removed Firebase emulator from staging configuration
4. Verified all OAuth flows work with PostgreSQL

## Implementation Details

### 1. Migration Script

**File:** `tools/migrate-oauth-tokens.ts`

**Purpose:** Copy OAuth tokens from Firestore to PostgreSQL `twitch_tokens` table

**Features:**
- Idempotent (can run multiple times safely)
- Verifies each token after migration
- Supports multiple token types (Twitch bot, broadcaster, Discord)
- Detailed logging with success/failure counts

**Usage:**
```bash
FIRESTORE_EMULATOR_HOST=localhost:8080 \
GOOGLE_CLOUD_PROJECT=bitbrat-local \
PERSISTENCE_DRIVER=postgres \
DATABASE_URL="postgresql://user:pass@host:port/db" \
npx ts-node tools/migrate-oauth-tokens.ts
```

**Results:**
```
✅ oauth/twitch/bot → twitch:bot (userId: 1369021733, 12 scopes)
✅ oauth/twitch/broadcaster → twitch:broadcaster (userId: 91960688, 12 scopes)
✅ oauth/discord/bot → discord:bot (2 scopes)
❌ oauth/discord/broadcaster → Not found (expected)

Total: 4 tokens processed
Success: 3 migrated
Not found: 1
Failed: 0
```

### 2. Code Changes

#### `src/apps/ingress-egress-service.ts`

**Before:**
```typescript
// Explicitly passed Firestore instance to force OAuth tokens to use Firestore
const firestore = cfg.firestoreEnabled ? this.getResource('firestore') : undefined;

const credsProvider = cfg.firestoreEnabled
  ? new FirestoreTwitchCredentialsProvider(cfg, createTokenStore(cfg.tokenDocPath || 'oauth/twitch/bot', firestore))
  : new ConfigTwitchCredentialsProvider(cfg);
```

**After:**
```typescript
// Get documentStore for OAuth token storage (uses PostgreSQL when PERSISTENCE_DRIVER=postgres)
// Falls back to Firestore if documentStore not available
const documentStore = this.getResource('documentStore') || this.getResource('firestore');

const credsProvider = cfg.firestoreEnabled
  ? new FirestoreTwitchCredentialsProvider(cfg, createTokenStore(cfg.tokenDocPath || 'oauth/twitch/bot', documentStore))
  : new ConfigTwitchCredentialsProvider(cfg);
```

**Key changes:**
- Changed from explicit `firestore` to `documentStore` resource
- `documentStore` auto-selects PostgreSQL when `PERSISTENCE_DRIVER=postgres`
- Maintains backward compatibility with Firestore fallback

#### Modified Files:
- `src/apps/ingress-egress-service.ts:100-106` - Bot token store with documentStore
- `src/apps/ingress-egress-service.ts:125` - Broadcaster token store with documentStore
- `env/staging/infra.yaml:1-11` - Removed Firebase emulator configuration

### 3. Database Schema

**Table:** `twitch_tokens` (already existed from earlier migration)

```sql
CREATE TABLE twitch_tokens (
  id VARCHAR(255) PRIMARY KEY,     -- "platform:identity" (e.g., "twitch:bot")
  data JSONB NOT NULL,              -- Token document with all fields
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_twitch_tokens_updated_at ON twitch_tokens (updated_at);
CREATE INDEX idx_twitch_tokens_user_id ON twitch_tokens ((data->>'userId'));
```

**Token document structure:**
```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "scope": ["chat:read", "chat:edit", ...],
  "expiresIn": 14336,
  "obtainmentTimestamp": 1784320218625,
  "userId": "91960688",
  "updatedAt": 1784320218625
}
```

### 4. Token Storage Factory Pattern

The `createTokenStore()` factory (src/services/firestore-token-store.ts:155-181) auto-selects the backend:

```typescript
export function createTokenStore(docPath: string, dbOrStore?: any, options?: { tableName?: string }): ITokenStore {
  // 1. If Firestore instance provided → FirestoreTokenStore
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new FirestoreTokenStore(docPath, dbOrStore);
  }

  // 2. If IDocumentStore provided → PostgresTokenStore
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new PostgresTokenStore(dbOrStore, docPath, options?.tableName || 'twitch_tokens');
  }

  // 3. Auto-select based on PERSISTENCE_DRIVER
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres' || driver === 'postgresql') {
    const { createDocumentStore } = require('../common/persistence/factory');
    const store = createDocumentStore();
    return new PostgresTokenStore(store, docPath, options?.tableName || 'twitch_tokens');
  }

  // 4. Default to Firestore
  return new FirestoreTokenStore(docPath);
}
```

**With our change:**
- `documentStore` is passed to `createTokenStore()`
- Factory detects `documentStore` has `get()/set()` methods
- Returns `PostgresTokenStore` instance
- OAuth tokens now read/write to PostgreSQL

## Deployment

### Step 1: Build and Deploy Code Changes
```bash
npm run build
npm run brat -- docker up --env staging --target staging
```

### Step 2: Migrate Existing Tokens
```bash
# Run migration script (already completed)
FIRESTORE_EMULATOR_HOST=bitbrat.lan:8080 \
GOOGLE_CLOUD_PROJECT=bitbrat-local \
PERSISTENCE_DRIVER=postgres \
DATABASE_URL="postgresql://bitbrat:bitbrat_dev_password@bitbrat.lan:5432/bitbrat" \
npx ts-node tools/migrate-oauth-tokens.ts
```

### Step 3: Disable Firebase Emulator
```bash
# Updated env/staging/infra.yaml to comment out Firebase settings
npm run brat -- docker up --env staging --target staging

# Manually stopped and removed Firebase emulator container
ssh root@bitbrat.lan 'docker stop bitbratplatform-firebase-emulator-1'
ssh root@bitbrat.lan 'docker rm bitbratplatform-firebase-emulator-1'
```

## Verification

### ✅ OAuth Tokens in PostgreSQL
```sql
SELECT id, data->>'userId' as user_id, data->>'expiresIn' as expires_in,
       jsonb_array_length(data->'scope') as scope_count
FROM twitch_tokens ORDER BY id;

         id         |  user_id   | expires_in | scope_count
--------------------+------------+------------+-------------
 discord:bot        |            |            |           2
 twitch:bot         | 1369021733 | 13084      |          12
 twitch:broadcaster | 91960688   | 15342      |          12
```

### ✅ Tokens Loaded from PostgreSQL
```json
{"msg":"Loaded token from PostgreSQL","docPath":"oauth/twitch/bot","backend":"postgres"}
{"msg":"Loaded token from PostgreSQL","docPath":"oauth/twitch/broadcaster","backend":"postgres"}
```

### ✅ All Connectors Connected
```json
{"msg":"ingress-egress.status_change","name":"twitch","from":"NONE","to":"CONNECTED"}
{"msg":"ingress-egress.status_change","name":"twitch-broadcaster","from":"NONE","to":"CONNECTED"}
{"msg":"ingress-egress.status_change","name":"twitch-eventsub","from":"NONE","to":"CONNECTED"}
{"msg":"ingress-egress.status_change","name":"discord","from":"NONE","to":"CONNECTED"}
```

### ✅ Firebase Emulator Not Running
```bash
ssh root@bitbrat.lan 'docker ps --filter "name=firebase"'
# (no results)
```

### ✅ No Errors in Logs
- No Firestore connection errors
- No token loading failures
- No connector start errors
- All services healthy

## Architecture After Migration

**Before:**
| Feature | Backend | Reason |
|---------|---------|--------|
| Events, snapshots, rules | PostgreSQL | Primary persistence |
| Prompt logs | PostgreSQL | Via DocumentStore |
| **OAuth tokens** | **Firestore** | **Not yet migrated** |
| Platform status | PostgreSQL | Sources table |

**After:**
| Feature | Backend | Reason |
|---------|---------|--------|
| Events, snapshots, rules | PostgreSQL | Primary persistence |
| Prompt logs | PostgreSQL | Via DocumentStore |
| **OAuth tokens** | **PostgreSQL** | **Migrated!** |
| Platform status | PostgreSQL | Sources table |

**Environment:**
- `PERSISTENCE_DRIVER=postgres` - All persistence uses PostgreSQL
- `FIRESTORE_EMULATOR_HOST` - **Removed** (no longer needed)
- `COMPOSE_PROFILES` - **Removed** (no firebase profile needed)

## Benefits

✅ **Single Persistence Backend**
- All data in PostgreSQL
- Consistent backup/restore procedures
- Simpler data management

✅ **Eliminated Firebase Emulator Dependency**
- Fewer containers in staging
- Simpler deployment
- Reduced memory/CPU usage

✅ **Improved Architecture**
- Consistent use of DocumentStore abstraction
- Cleaner separation of concerns
- Better abstraction boundaries

✅ **Reduced Complexity**
- No dual persistence configuration
- Fewer environment variables
- Simpler troubleshooting

## Migration Checklist

- ✅ Created migration script (`tools/migrate-oauth-tokens.ts`)
- ✅ Updated ingress-egress to use documentStore
- ✅ Migrated existing tokens to PostgreSQL
- ✅ Verified token loading from PostgreSQL
- ✅ Tested all OAuth flows (Twitch, Discord)
- ✅ Removed Firebase emulator from staging
- ✅ Verified all connectors operational
- ✅ Updated documentation

## Rollback Plan

If issues arise, rollback is simple:

1. **Re-enable Firebase emulator in `env/staging/infra.yaml`:**
   ```yaml
   COMPOSE_PROFILES: firebase
   FIRESTORE_EMULATOR_HOST: firebase-emulator:8080
   ```

2. **Revert code changes in `src/apps/ingress-egress-service.ts`:**
   ```typescript
   const firestore = cfg.firestoreEnabled ? this.getResource('firestore') : undefined;
   ```

3. **Redeploy:**
   ```bash
   npm run brat -- docker up --env staging --target staging
   ```

**Note:** Tokens in PostgreSQL will remain (no harm). Services will simply read from Firestore again.

## Future Work

### Production Deployment
Apply the same migration to production:
1. Run migration script against production Firestore
2. Deploy updated code to production Cloud Run
3. Remove Firestore dependency from production

### Additional Token Types
Extend migration to cover:
- API tokens
- Webhook secrets
- Service account credentials

### Monitoring
Add metrics for:
- Token refresh success/failure rates
- Token expiration warnings
- OAuth flow completion rates

## Related Documentation

- `OAUTH_TOKEN_FIX.md` - Temporary fix that used explicit Firestore
- `OAUTH_TOKENS_FIRESTORE_REQUIREMENT.md` - Why Firebase emulator was needed
- `FIRESTORE_EMULATOR_ERRORS_FIX.md` - DNS resolution errors
- `SPRINT_343_SESSION_SUMMARY.md` - Overall session summary

---

**Completed By:** Claude (AI Assistant)
**Date:** 2026-07-17 21:20 UTC
**Sprint:** 343 - PostgreSQL Migration
**Status:** ✅ OAuth tokens fully migrated to PostgreSQL, Firebase emulator removed
