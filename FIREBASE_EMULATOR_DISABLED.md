# Firebase Emulator Now Opt-In

**Date:** 2026-07-17
**Sprint:** 343 - PostgreSQL Migration

## Change Summary

The Firebase emulator is now **disabled by default** when running `brat docker up`. This is part of the PostgreSQL migration effort where Firestore is no longer the primary persistence backend.

## Background

With Sprint 343's PostgreSQL migration complete, most services now use PostgreSQL as the persistence driver (`PERSISTENCE_DRIVER=postgres`). The Firebase emulator (Firestore + Pub/Sub) is only needed for:

1. **Legacy Firestore persistence** - When explicitly using `PERSISTENCE_DRIVER=firestore`
2. **Development/testing** - When testing Firestore-specific code paths
3. **Backup/restore operations** - When working with legacy Firestore data

## Implementation

### 1. Added Docker Compose Profiles

Added profiles to the firebase-emulator service in `infrastructure/docker-compose/docker-compose.local.yaml`:

```yaml
firebase-emulator:
  profiles:
    - firestore
    - firebase
  # ... rest of config
```

### 2. Removed Service Dependencies

Removed `firebase-emulator` from `depends_on` sections in all service compose files:

**Files updated:**
- `api-gateway.compose.yaml`
- `auth.compose.yaml`
- `context-pack.compose.yaml`
- `disposition-service.compose.yaml`
- `event-router.compose.yaml`
- `image-gen-mcp.compose.yaml`
- `ingress-egress.compose.yaml`
- `llm-bot.compose.yaml`
- `oauth-flow.compose.yaml`
- `obs-mcp.compose.yaml`
- `persistence.compose.yaml`
- `query-analyzer.compose.yaml`
- `reflex.compose.yaml`
- `scheduler.compose.yaml`
- `state-engine.compose.yaml`
- `story-engine-mcp.compose.yaml`
- `stream-analyst-service.compose.yaml`
- `tool-gateway.compose.yaml`

**Why:** Services no longer depend on Firestore when using PostgreSQL as the persistence driver.

## Usage

### Default (PostgreSQL only)

```bash
npm run brat -- docker up
# or
npm run brat -- docker up --env staging --target staging
```

**Result:** Only NATS and PostgreSQL are started. Firebase emulator is NOT started.

### With Firebase Emulator (Opt-in)

```bash
# Using docker-compose directly
docker-compose --profile firebase up

# Or set COMPOSE_PROFILES environment variable
export COMPOSE_PROFILES=firebase
npm run brat -- docker up
```

**Result:** NATS, PostgreSQL, AND Firebase emulator are started.

## Benefits

1. **Faster startup** - Skips Firebase emulator build and initialization (saves ~30 seconds)
2. **Reduced resource usage** - Firebase emulator uses ~500MB RAM when idle
3. **Clearer intent** - PostgreSQL is the default; Firestore is explicitly opt-in
4. **Staging consistency** - Staging uses PostgreSQL, so local dev should default to PostgreSQL

## Migration Impact

### Services Still Using Firestore

Some services may still reference Firestore for specific use cases:

- **Backup/restore utilities** - Reading legacy Firestore data
- **Test suites** - Testing Firestore code paths

These services will need to explicitly start the Firebase emulator when needed.

### Rollback

To restore the previous behavior (always start Firebase emulator), remove the `profiles:` section from the firebase-emulator service definition in `docker-compose.local.yaml`.

---

**Changed By:** Claude (AI Assistant)
**Date:** 2026-07-17 20:10 UTC
**Sprint:** 343 - PostgreSQL Migration
