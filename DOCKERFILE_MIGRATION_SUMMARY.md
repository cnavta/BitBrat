# Dockerfile Migration Summary

**Date**: 2026-07-27
**Context**: Cleanup of legacy custom Dockerfiles

## Changes Made

### 1. Migrated `reflex` to Standard Dockerfile

**Before** (`infrastructure/docker-compose/services/reflex.compose.yaml`):
```yaml
build:
  context: .
  dockerfile: Dockerfile.reflex
```

**After**:
```yaml
build:
  context: .
  dockerfile: Dockerfile.service
  args:
    SERVICE_NAME: reflex
    SERVICE_ENTRY: dist/apps/reflex-service.js
    SERVICE_PORT: "3000"
```

### 2. Migrated `context-pack` to Standard Dockerfile

**Before** (`infrastructure/docker-compose/services/context-pack.compose.yaml`):
```yaml
build:
  context: .
  dockerfile: Dockerfile.context-pack
```

**After**:
```yaml
build:
  context: .
  dockerfile: Dockerfile.service
  args:
    SERVICE_NAME: context-pack
    SERVICE_ENTRY: dist/apps/context-pack-service.js
    SERVICE_PORT: "3000"
```

### 3. Deleted Legacy Dockerfiles

- ❌ `Dockerfile.reflex` - Deleted
- ❌ `Dockerfile.context-pack` - Deleted

### 4. Updated Remote Sync Configuration

**File**: `tools/brat/src/orchestration/docker/orchestrator.ts`

Removed deleted Dockerfiles from the sync list (lines 327-329):
- Removed `'Dockerfile.reflex'`
- Removed `'Dockerfile.context-pack'`

## Benefits

1. **Consistency**: All services now use the same base Dockerfile (`Dockerfile.service`)
2. **Maintainability**: One Dockerfile to update instead of three
3. **Smaller Build Contexts**: Standard Dockerfile uses selective COPY instead of `COPY . .`
4. **Better Debian Support**: Standard Dockerfile includes APT source fixes for Bookworm repos
5. **Dynamic Configuration**: Uses build args instead of hardcoded service names

## Testing Required

Before deploying to staging/production:

1. **Local build test**:
   ```bash
   npm run brat -- docker up --service reflex --context local --no-cache
   npm run brat -- docker up --service context-pack --context local --no-cache
   ```

2. **Verify containers start successfully**:
   ```bash
   docker ps | grep -E "(reflex|context-pack)"
   ```

3. **Check health endpoints**:
   ```bash
   curl http://localhost:3000/health  # Adjust port if needed
   ```

4. **Test on staging**:
   ```bash
   npm run brat -- docker up --service reflex --context staging --no-cache
   npm run brat -- docker up --service context-pack --context staging --no-cache
   ```

## Rollback Plan

If issues arise, restore the custom Dockerfiles from git:

```bash
git checkout HEAD~1 -- Dockerfile.reflex Dockerfile.context-pack
git checkout HEAD~1 -- infrastructure/docker-compose/services/reflex.compose.yaml
git checkout HEAD~1 -- infrastructure/docker-compose/services/context-pack.compose.yaml
git checkout HEAD~1 -- tools/brat/src/orchestration/docker/orchestrator.ts
```

## Related Changes

This migration is part of a larger cleanup that also includes:
- **Slack Event Fix**: Fixed Socket Mode event listener to use `'slack_event'` catch-all
- **Remote Sync Fix**: Added source code sync to remote deployments (`src/`, `package.json`, etc.)

See commit messages for full details.
