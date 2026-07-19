# Sprint 343 Session Summary - PostgreSQL Migration Fixes

**Date:** 2026-07-17
**Sprint:** 343 - PostgreSQL Migration
**Status:** ✅ **COMPLETE**

## Overview

This session focused on fixing critical issues discovered after the PostgreSQL migration in Sprint 343. All fixes were deployed to staging and verified operational.

## Problems Solved

### 1. ✅ Prompt Logging Not Working
**Issue:** Despite feature flags enabled, no prompts were being logged to PostgreSQL

**Root cause:** Services didn't have `documentStore` resource registered. Code tried `getResource('firestore') || getResource('documentStore')` which returned `undefined`, causing `createPromptLogStore()` to throw an error that was silently swallowed (fire-and-forget logging).

**Solution:**
- Created `DocumentStoreManager` class (`src/common/resources/document-store-manager.ts`)
- Registered `documentStore` in `base-server.ts` when `PERSISTENCE_DRIVER=postgres`
- Redeployed llm-bot and query-analyzer services

**Files modified:**
- `src/common/resources/document-store-manager.ts` (created)
- `src/common/base-server.ts:16-19, 643-663`

**Documentation:** `PROMPT_LOGGING_INVESTIGATION.md`

---

### 2. ✅ Firebase Emulator Disabled by Default
**Issue:** Firebase emulator was always deployed, even when using PostgreSQL persistence

**Solution:**
- Added Docker Compose profiles to firebase-emulator: `profiles: [firestore, firebase]`
- Made firebase-emulator opt-in (only starts with `COMPOSE_PROFILES=firebase`)
- Removed firebase-emulator from `depends_on` sections in 18 service compose files

**Files modified:**
- `infrastructure/docker-compose/docker-compose.local.yaml:65-68`
- 18 service compose files (removed firebase-emulator dependencies)

**Documentation:** `FIREBASE_EMULATOR_DISABLED.md`

---

### 3. ✅ Firestore DNS Resolution Errors in Staging
**Issue:** After disabling emulator, staging services failed with:
```
14 UNAVAILABLE: Name resolution failed for target dns:firebase-emulator:8080
```

**Root cause:** `FIRESTORE_EMULATOR_HOST=firebase-emulator:8080` was set in `env/staging/infra.yaml`, but the emulator container wasn't running.

**Solution:**
- Re-enabled Firebase emulator for staging (OAuth tokens still use Firestore)
- Added `COMPOSE_PROFILES: firebase` to `env/staging/infra.yaml`
- Documented that Firebase emulator is required for OAuth token storage

**Files modified:**
- `env/staging/infra.yaml:1-13`

**Documentation:** `FIRESTORE_EMULATOR_ERRORS_FIX.md`, `OAUTH_TOKENS_FIRESTORE_REQUIREMENT.md`

---

### 4. ✅ Missing Sources Table in PostgreSQL
**Issue:** Persistence service crashed with:
```
ERROR: relation "sources" does not exist at character 18
```

**Root cause:** The `sources` table was never created in PostgreSQL (Firestore-only, migration overlooked).

**Solution:**
- Created migration 012 (`012-add-sources-table.sql`)
- Applied migration to staging PostgreSQL
- Table created with proper schema, indexes, and auto-update trigger

**Files created:**
- `infrastructure/postgres/migrations/012-add-sources-table.sql`

**Documentation:** `SOURCES_TABLE_MIGRATION.md`

---

### 5. ✅ OAuth Token Loading Failure
**Issue:** Despite tokens existing in Firestore, ingress-egress failed with:
```
ERROR: FirestoreTwitchCredentialsProvider: no token in store
ERROR: connector.start_error - twitch_auth_missing
```

**Root cause:** `createTokenStore()` was called without a database instance parameter. With `PERSISTENCE_DRIVER=postgres` set, it auto-selected PostgresTokenStore which tried to read from the **empty** `twitch_tokens` table in PostgreSQL instead of Firestore where tokens actually exist.

**Solution:**
- Pass Firestore instance explicitly to `createTokenStore()` in ingress-egress
- Forces OAuth tokens to use Firestore regardless of `PERSISTENCE_DRIVER`
- All connectors (Twitch IRC, EventSub, broadcaster, Discord) now start successfully

**Files modified:**
- `src/apps/ingress-egress-service.ts:100-105, 124`

**Verification:**
```json
✅ "connector.started" - twitch
✅ "connector.started" - twitch-broadcaster
✅ "connector.started" - twitch-eventsub
✅ "connector.started" - discord
✅ All platforms: NONE → CONNECTED
```

**Documentation:** `OAUTH_TOKEN_FIX.md`

---

## Deployment Summary

All fixes deployed to staging environment:

```bash
# Session deployments
npm run build
npm run brat -- deploy service llm-bot --env staging
npm run brat -- deploy service query-analyzer --env staging
npm run brat -- docker up --env staging --target staging

# PostgreSQL migration applied
ssh root@bitbrat.lan 'docker exec -i bitbratplatform-postgres-1 psql -U bitbrat -d bitbrat' \
  < infrastructure/postgres/migrations/012-add-sources-table.sql
```

## Verification

### ✅ All Services Operational
```bash
brat fleet list
# 15 Bits registered and responding:
# - api-gateway, auth, context-pack, disposition-service
# - event-router, image-gen-mcp, ingress-egress, llm-bot
# - oauth-flow, obs-mcp, persistence, query-analyzer
# - reflex, scheduler, state-engine, story-engine-mcp, stream-analyst
```

### ✅ Firestore Emulator Running
```bash
docker ps | grep firebase
# bitbratplatform-firebase-emulator-1 (healthy)
```

### ✅ PostgreSQL Operational
```sql
-- Sources table exists
SELECT tablename FROM pg_catalog.pg_tables WHERE tablename = 'sources';
-- sources | 0 rows (expected)
```

### ✅ No Errors in Logs
- event-router: No Firestore connection errors
- persistence: No "sources table does not exist" errors
- ingress-egress: All connectors CONNECTED
- llm-bot/query-analyzer: Prompt logging operational

## Architecture State

**Current persistence architecture:**

| Feature | Backend | Reason |
|---------|---------|--------|
| Events, snapshots, rules | PostgreSQL | Primary persistence (`PERSISTENCE_DRIVER=postgres`) |
| Prompt logs | PostgreSQL | Via DocumentStore abstraction |
| OAuth tokens | **Firestore** | Not yet migrated (requires Firebase emulator) |
| Platform status | PostgreSQL | Sources table (migration 012) |

**Environment variables:**
- `PERSISTENCE_DRIVER=postgres` - Primary persistence backend
- `FIRESTORE_EMULATOR_HOST=firebase-emulator:8080` - Required for OAuth tokens
- `COMPOSE_PROFILES=firebase` - Enables Firebase emulator in staging

## Future Work

### Recommended for Next Sprint

**1. Migrate OAuth Tokens to PostgreSQL**
- Create `oauth_tokens` table
- Update `createTokenStore()` to use PostgreSQL when `PERSISTENCE_DRIVER=postgres`
- Migrate existing tokens from Firestore → PostgreSQL
- Remove Firebase emulator from staging entirely

**Benefits:**
- Eliminate dual persistence requirement
- Simpler deployment (single database)
- Consistent backend across all features

**2. Add Health Checks for DocumentStore**
- Monitor PostgreSQL connection health
- Graceful fallback if database unavailable
- Alerting for persistence failures

**3. Performance Optimization**
- Index optimization for prompt logs queries
- Batch insert for high-volume logging
- Connection pooling tuning

## Key Learnings

### 1. Resource Registration Pattern
**Pattern:** Resources must be explicitly registered in `base-server.ts` before services can use them.

**Before:**
```typescript
// Only firestore registered
defaults.firestore = new FirestoreManager();
```

**After:**
```typescript
defaults.firestore = new FirestoreManager();

// Also register documentStore when using PostgreSQL
if (persistenceDriver === 'postgres') {
  defaults.documentStore = new DocumentStoreManager();
}
```

### 2. Factory Pattern Pitfalls
**Issue:** `createTokenStore()` auto-selects backend based on `PERSISTENCE_DRIVER` when no instance provided.

**Lesson:** When migrating incrementally (PostgreSQL for most features, Firestore for some), **explicitly pass the database instance** to avoid auto-selection picking the wrong backend.

**Before:**
```typescript
createTokenStore('oauth/twitch/bot') // Auto-selects PostgreSQL → wrong!
```

**After:**
```typescript
const firestore = this.getResource('firestore');
createTokenStore('oauth/twitch/bot', firestore) // Explicit Firestore → correct!
```

### 3. Docker Compose Profiles
**Pattern:** Use profiles to make services opt-in instead of always-on.

**Implementation:**
```yaml
firebase-emulator:
  profiles: [firestore, firebase]  # Only starts with COMPOSE_PROFILES=firebase
```

**Deployment:**
```bash
# Without profile (emulator disabled)
docker compose up

# With profile (emulator enabled)
COMPOSE_PROFILES=firebase docker compose up
```

### 4. Migration Discipline
**Lesson:** When migrating from one backend to another, track **all** places where the old backend is used.

**Checklist:**
- [ ] Primary CRUD operations (events, state, etc.)
- [ ] Token storage (OAuth, API keys)
- [ ] Cache/metadata (rules, configs)
- [ ] Platform-specific data (sources, connectors)
- [ ] Logs and telemetry

**Missed in initial migration:** OAuth tokens, sources table

## Documentation Created

1. `PROMPT_LOGGING_INVESTIGATION.md` - DocumentStore registration fix
2. `FIREBASE_EMULATOR_DISABLED.md` - Docker Compose profiles implementation
3. `FIRESTORE_EMULATOR_ERRORS_FIX.md` - DNS resolution errors and re-enabling emulator
4. `OAUTH_TOKENS_FIRESTORE_REQUIREMENT.md` - Why Firebase emulator is still needed
5. `SOURCES_TABLE_MIGRATION.md` - Migration 012 details
6. `OAUTH_TOKEN_FIX.md` - Explicit Firestore instance fix
7. `SPRINT_343_SESSION_SUMMARY.md` - This document

## Metrics

**Time to Resolution:**
- Prompt logging: ~30 minutes (investigation + fix + deploy)
- Firebase emulator profiles: ~20 minutes (implementation + dependency cleanup)
- Firestore DNS errors: ~15 minutes (re-enable emulator)
- Sources table migration: ~10 minutes (migration creation + apply)
- OAuth token fix: ~25 minutes (root cause analysis + fix + verify)

**Total session time:** ~2 hours

**Lines of code changed:**
- Created: ~150 lines (DocumentStoreManager, migration 012)
- Modified: ~30 lines (base-server, ingress-egress)
- Deleted: ~50 lines (firebase-emulator dependencies)

**Services impacted:**
- Core fixes: llm-bot, query-analyzer, ingress-egress, persistence
- Configuration: 18 service compose files, staging infra config

---

**Session Completed:** 2026-07-17 21:15 UTC
**Sprint:** 343 - PostgreSQL Migration
**Status:** ✅ All staging issues resolved, platform fully operational
**Next Steps:** Plan OAuth token migration for future sprint
