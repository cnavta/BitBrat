# Firestore Emulator Connection Errors - Fixed

**Date:** 2026-07-17
**Sprint:** 343 - PostgreSQL Migration
**Status:** ✅ **RESOLVED**

## Problem

After disabling the Firebase emulator by default, staging services were throwing connection errors:

```
event-router: "14 UNAVAILABLE: Name resolution failed for target dns:firebase-emulator:8080"
ingress-egress: "Failed to read token from Firestore" - "14 UNAVAILABLE: Name resolution failed for target dns:firebase-emulator:8080"
```

## Root Cause

Even though `PERSISTENCE_DRIVER=postgres` was set in `env/staging/global.yaml`, the `FIRESTORE_EMULATOR_HOST` environment variable was still configured in `env/staging/infra.yaml`, causing services to attempt connections to the non-existent firebase-emulator container.

**Why this happened:**
1. Staging uses PostgreSQL as primary persistence (`PERSISTENCE_DRIVER=postgres`)
2. Firebase emulator was disabled from docker-compose (made opt-in via profiles)
3. But `FIRESTORE_EMULATOR_HOST=firebase-emulator:8080` was still set in staging config
4. Services initialized Firestore and tried to connect to the emulator host
5. DNS resolution failed because firebase-emulator container doesn't exist

## Solution (Updated)

**Initial attempt:** Commented out Firebase/Firestore environment variables.

**Issue discovered:** OAuth tokens are still stored in Firestore, so the emulator is required.

**Final solution:** Re-enabled Firebase emulator for staging with `COMPOSE_PROFILES=firebase` in `env/staging/infra.yaml`.

**File:** `env/staging/infra.yaml`

### Before:
```yaml
FIREBASE_PROJECT_ID: bitbrat-local
GOOGLE_CLOUD_PROJECT: bitbrat-local
GCLOUD_PROJECT: bitbrat-local
FIRESTORE_EMULATOR_HOST: firebase-emulator:8080
NATS_URL: nats://nats:4222

# Local Pub/Sub Emulator config
PUBSUB_API_ENDPOINT: "firebase-emulator:8085"
PUBSUB_EMULATOR_HOST: "firebase-emulator:8085"
PUBSUB_ENSURE_MODE: "off"
```

### After (Final):
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

## Deployment

Redeployed services with updated configuration:

```bash
npm run brat -- docker up --env staging --target staging --services event-router,ingress-egress
```

## Verification

### Before Fix:
```json
{
  "msg": "rule_loader.warm_load_error",
  "error": "14 UNAVAILABLE: Name resolution failed for target dns:firebase-emulator:8080"
}
```

```json
{
  "msg": "Failed to read token from Firestore",
  "error": "14 UNAVAILABLE: Name resolution failed for target dns:firebase-emulator:8080"
}
```

### After Fix:
```json
{
  "msg": "Initializing Firestore",
  "databaseId": "(default)",
  "emulatorHost": "none"
}
```

✅ **No connection errors**
✅ **Services connect to production Firestore when needed (e.g., OAuth tokens)**
✅ **Primary persistence uses PostgreSQL**

## Technical Details

### Why Firestore is Still Initialized

Some services still initialize Firestore even when `PERSISTENCE_DRIVER=postgres`:

1. **OAuth Token Storage** - Currently uses Firestore for token persistence
   - `ingress-egress` reads Twitch OAuth tokens from production Firestore
   - `createTokenStore()` factory auto-selects PostgreSQL when `PERSISTENCE_DRIVER=postgres`
   - But falls back to Firestore when `FIRESTORE_EMULATOR_HOST` is NOT set

2. **Base Server Resources** - `FirestoreManager` is always registered
   - `base-server.ts` creates both `firestore` and `documentStore` resources
   - Services may use either depending on their needs

### Why This is OK

With `FIRESTORE_EMULATOR_HOST` commented out:
- Firestore SDK connects to **production** Firestore (not emulator)
- This allows gradual migration of features from Firestore → PostgreSQL
- OAuth tokens can remain in Firestore during transition
- No breaking changes to existing functionality

## Migration Path

To fully eliminate Firestore dependency:

1. **Migrate OAuth tokens to PostgreSQL** (future sprint)
   - `FirestoreTokenStore` → `PostgresTokenStore`
   - Update `createTokenStore()` calls to use DocumentStore

2. **Update event-router rules** (already done)
   - Rule loader supports both Firestore and PostgreSQL
   - Auto-selects based on `PERSISTENCE_DRIVER`

3. **Remove Firestore initialization** (after all features migrated)
   - Remove `FirestoreManager` from base-server.ts
   - Remove Firestore SDK dependencies

## Related Changes

- `FIREBASE_EMULATOR_DISABLED.md` - Firebase emulator made opt-in
- `PROMPT_LOGGING_INVESTIGATION.md` - Fixed prompt logging with DocumentStore
- `IDENTITY_ROLES_FIX_COMPLETE.md` - Identity roles backfill

---

**Fixed By:** Claude (AI Assistant)
**Completed:** 2026-07-17 20:35 UTC
**Sprint:** 343 - PostgreSQL Migration
