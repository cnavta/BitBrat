# Service Compose Files Audit: GOOGLE_APPLICATION_CREDENTIALS

**Date**: 2026-07-20
**Sprint**: 351 - Bootstrap Automation & Bug Remediation
**Task**: T1.1 - Audit ALL Service Compose Files
**Status**: ✅ COMPLETE

---

## Executive Summary

Audited all 18 service compose files for legacy Firestore dependencies (`GOOGLE_APPLICATION_CREDENTIALS`). Found **11 services** still requiring Google credentials despite the PostgreSQL migration completed in Sprint 344.

**Impact**: HIGH - Blocks all new context creation and service deployment
**Remediation**: Remove environment variable and volume mount from all 11 affected files (Task T1.2)

---

## Audit Results

### Affected Services (11 total)

| # | Service | File | Environment Var | Volume Mount | Notes |
|---|---------|------|----------------|--------------|-------|
| 1 | state-engine | state-engine.compose.yaml | ✅ | ✅ | Core platform service |
| 2 | oauth-flow | oauth-flow.compose.yaml | ✅ | ✅ | Core platform service |
| 3 | scheduler | scheduler.compose.yaml | ✅ | ✅ | Core platform service |
| 4 | persistence | persistence.compose.yaml | ✅ | ✅ | Core platform service |
| 5 | tool-gateway | tool-gateway.compose.yaml | ✅ | ✅ | Core platform service |
| 6 | llm-bot | llm-bot.compose.yaml | ✅ | ✅ | Core platform service |
| 7 | query-analyzer | query-analyzer.compose.yaml | ✅ | ✅ | Core platform service |
| 8 | image-gen-mcp | image-gen-mcp.compose.yaml | ✅ | ✅ | Domain service (MCP server) |
| 9 | obs-mcp | obs-mcp.compose.yaml | ✅ | ✅ | Domain service (MCP server) |
| 10 | ingress-egress | ingress-egress.compose.yaml | ✅ | ✅ | Core platform service |
| 11 | auth | auth.compose.yaml | ✅ | ✅ | Core platform service |

### Clean Services (7 total)

Services already updated (likely fixed in Sprint 350 or never had dependency):

| # | Service | File | Status |
|---|---------|------|--------|
| 1 | api-gateway | api-gateway.compose.yaml | ✅ Fixed in Sprint 350 Phase 5 |
| 2 | event-router | event-router.compose.yaml | ✅ Fixed in Sprint 350 Phase 5 |
| 3 | reflex | reflex.compose.yaml | ✅ Clean |
| 4 | disposition-service | disposition-service.compose.yaml | ✅ Clean |
| 5 | context-pack | context-pack.compose.yaml | ✅ Clean |
| 6 | story-engine-mcp | story-engine-mcp.compose.yaml | ✅ Clean |
| 7 | dev-mcp | dev-mcp.compose.yaml | ✅ Clean |

---

## Pattern Analysis

### Common Pattern (All 11 Affected Services)

**Environment Variable**:
```yaml
environment:
  - GOOGLE_APPLICATION_CREDENTIALS=/var/secrets/google-app-creds.json
```

**Volume Mount**:
```yaml
volumes:
  - ${GOOGLE_APPLICATION_CREDENTIALS:?Set GOOGLE_APPLICATION_CREDENTIALS to a local JSON file}:/var/secrets/google-app-creds.json:ro
```

**Error Message When Variable Missing**:
```
Set GOOGLE_APPLICATION_CREDENTIALS to a local JSON file
```

### Why This Is a Bug

1. **PostgreSQL Migration Complete**: Sprint 344 migrated from Firestore to PostgreSQL as primary backend
2. **No Firestore Dependency**: Services use `PERSISTENCE_DRIVER=postgres` (default since Sprint 344)
3. **Blocks Bootstrap**: New contexts (like agent-dev) cannot start services without this legacy requirement
4. **Inconsistent State**: 7 services already clean, 11 still have legacy references

### Root Cause

During PostgreSQL migration (Sprint 344), compose files were not systematically audited and updated. Only services actively tested during agent-dev bootstrap (api-gateway, event-router) were fixed in Sprint 350.

---

## Remediation Plan (Task T1.2)

### Changes Required Per Service

For each of the 11 affected services:

1. **Remove environment variable**:
   ```yaml
   # DELETE THIS LINE:
   - GOOGLE_APPLICATION_CREDENTIALS=/var/secrets/google-app-creds.json
   ```

2. **Remove volume mount**:
   ```yaml
   # DELETE THIS BLOCK:
   - ${GOOGLE_APPLICATION_CREDENTIALS:?Set GOOGLE_APPLICATION_CREDENTIALS to a local JSON file}:/var/secrets/google-app-creds.json:ro
   ```

3. **Add postgres dependency** (if not already present):
   ```yaml
   depends_on:
     - postgres  # ADD if missing
     - nats
   ```

### Example: state-engine.compose.yaml

**Before**:
```yaml
services:
  state-engine:
    env_file:
      - .env.brat
    build:
      context: .
      dockerfile: Dockerfile.service
      args:
        SERVICE_NAME: state-engine
        SERVICE_ENTRY: dist/apps/state-engine.js
        SERVICE_PORT: "3000"
    environment:
      - GOOGLE_APPLICATION_CREDENTIALS=/var/secrets/google-app-creds.json
    volumes:
      - ${GOOGLE_APPLICATION_CREDENTIALS:?Set GOOGLE_APPLICATION_CREDENTIALS to a local JSON file}:/var/secrets/google-app-creds.json:ro
    ports:
      - "${STATE_ENGINE_HOST_PORT:-3001}:${SERVICE_PORT:-3000}"
    depends_on:
      - nats
```

**After**:
```yaml
services:
  state-engine:
    env_file:
      - .env.brat
    build:
      context: .
      dockerfile: Dockerfile.service
      args:
        SERVICE_NAME: state-engine
        SERVICE_ENTRY: dist/apps/state-engine.js
        SERVICE_PORT: "3000"
    ports:
      - "${STATE_ENGINE_HOST_PORT:-3001}:${SERVICE_PORT:-3000}"
    depends_on:
      - postgres
      - nats
```

---

## Validation Plan

After remediation (Task T1.2), validate:

1. **Build Test**: All 11 services build successfully
   ```bash
   docker compose -f infrastructure/docker-compose/services/<service>.compose.yaml build
   ```

2. **Startup Test**: Services start without GOOGLE_APPLICATION_CREDENTIALS error
   ```bash
   npm run brat -- docker up --context agent-dev --services <service>
   ```

3. **Dependency Check**: Services connect to PostgreSQL successfully
   ```bash
   # Check logs for successful postgres connection
   docker logs bitbrat-agent-dev-<service>-1 | grep -i postgres
   ```

4. **End-to-End Test**: Create new test context and deploy all services (Task T5.3)

---

## CI/CD Prevention (Task T1.3)

Create automated check to prevent regression:

**Proposed Script** (`tools/validate-no-firestore-deps.sh`):
```bash
#!/usr/bin/env bash
set -e

echo "Scanning service compose files for legacy Firestore dependencies..."

FOUND=0

# Check for GOOGLE_APPLICATION_CREDENTIALS in environment
if grep -r 'GOOGLE_APPLICATION_CREDENTIALS' infrastructure/docker-compose/services/ --include="*.yaml" --quiet; then
  echo "❌ ERROR: Found GOOGLE_APPLICATION_CREDENTIALS in service compose files:"
  grep -r 'GOOGLE_APPLICATION_CREDENTIALS' infrastructure/docker-compose/services/ --include="*.yaml"
  FOUND=1
fi

# Check for google-app-creds.json volume mounts
if grep -r 'google-app-creds.json' infrastructure/docker-compose/services/ --include="*.yaml" --quiet; then
  echo "❌ ERROR: Found google-app-creds.json volume mounts in service compose files:"
  grep -r 'google-app-creds.json' infrastructure/docker-compose/services/ --include="*.yaml"
  FOUND=1
fi

if [ $FOUND -eq 0 ]; then
  echo "✅ All service compose files clean (no Firestore dependencies)"
  exit 0
else
  echo ""
  echo "GOOGLE_APPLICATION_CREDENTIALS should NO LONGER be required after PostgreSQL migration."
  echo "Remove environment variable and volume mount from affected compose files."
  exit 1
fi
```

**GitHub Actions Integration** (`.github/workflows/validate-compose-files.yml`):
```yaml
name: Validate Compose Files

on:
  pull_request:
    paths:
      - 'infrastructure/docker-compose/services/*.yaml'
  push:
    branches:
      - main
    paths:
      - 'infrastructure/docker-compose/services/*.yaml'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Check for legacy Firestore dependencies
        run: bash tools/validate-no-firestore-deps.sh
```

---

## Impact Assessment

### Immediate Impact (Post-Remediation)

- ✅ New contexts (agent-dev, test contexts) can bootstrap without errors
- ✅ All 18 services deployable with PostgreSQL only
- ✅ Cleaner, more consistent compose file structure
- ✅ Reduced configuration burden (no more GOOGLE_APPLICATION_CREDENTIALS env var)

### Long-Term Impact

- ✅ Prevents regression via CI check
- ✅ Clearer separation: PostgreSQL = default, Firestore = legacy
- ✅ Easier onboarding for new developers (one less credential to manage)
- ✅ Foundation for eventual Firestore removal (Sprint 360+)

---

## Related Tasks

- **T1.2** (Next): Remove GOOGLE_APPLICATION_CREDENTIALS from all 11 affected files
- **T1.3**: Create CI check to prevent regression
- **T5.3**: End-to-end bootstrap test to validate all services work post-remediation

---

## Appendix: File Paths

### Affected Files (11)
```
infrastructure/docker-compose/services/state-engine.compose.yaml
infrastructure/docker-compose/services/oauth-flow.compose.yaml
infrastructure/docker-compose/services/scheduler.compose.yaml
infrastructure/docker-compose/services/persistence.compose.yaml
infrastructure/docker-compose/services/tool-gateway.compose.yaml
infrastructure/docker-compose/services/llm-bot.compose.yaml
infrastructure/docker-compose/services/query-analyzer.compose.yaml
infrastructure/docker-compose/services/image-gen-mcp.compose.yaml
infrastructure/docker-compose/services/obs-mcp.compose.yaml
infrastructure/docker-compose/services/ingress-egress.compose.yaml
infrastructure/docker-compose/services/auth.compose.yaml
```

### Clean Files (7)
```
infrastructure/docker-compose/services/api-gateway.compose.yaml
infrastructure/docker-compose/services/event-router.compose.yaml
infrastructure/docker-compose/services/reflex.compose.yaml
infrastructure/docker-compose/services/disposition-service.compose.yaml
infrastructure/docker-compose/services/context-pack.compose.yaml
infrastructure/docker-compose/services/story-engine-mcp.compose.yaml
infrastructure/docker-compose/services/dev-mcp.compose.yaml
```

---

**Audit Complete**: Ready for Task T1.2 (Remediation)
