# Deployment Flow Analysis (BL-001)

**Sprint**: sprint-15-gpcvez
**Task**: BL-001 - Verify deployment flow for Docker Compose strategy
**Date**: 2026-08-16

---

## Complete Deployment Flow

### High-Level Flow

```
DockerComposeStrategy.execute()
  └─> DockerOrchestrator.up()
      ├─> prepare() - Load architecture, resolve context
      ├─> writeEnvFile() - Generate .env files
      ├─> ensureRemoteSynced() → syncRemoteFiles() [REMOTE ONLY]
      ├─> ensureNetworkExists() - Create Docker network
      ├─> buildBaseImage() - Build bitbrat-base shared image
      ├─> build services (sequential/batched)
      └─> up services (docker compose up)
```

---

## Detailed Flow with Line Numbers

### Stage 1: Strategy Prepare & Execute
**File**: `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`

```
execute() (lines 188-373):
  1. Line 201: Read original compose content
  2. Lines 204-245: Merge service-specific compose file (if exists)
  3. Lines 248-305: Process secureFiles (validate, transfer if remote)
  4. Line 308: Write merged compose content to base path
  5. Lines 314-328: Create DockerOrchestrator with options
  6. Line 328: Call orchestrator.up() → Delegates to orchestrator
```

### Stage 2: Orchestrator Prepare
**File**: `tools/brat/src/orchestration/docker/orchestrator.ts`

```
up() (lines 91-257):
  1. Line 92: prepare() → Load architecture, resolve context, get target config
  2. Line 93: writeEnvFile() → Generate temporary .env files with env vars
  3. Lines 100-111: Get compose file set (base + service-specific)
```

### Stage 3: Remote Sync (Remote Deployments Only)
**File**: `tools/brat/src/orchestration/docker/orchestrator.ts`

```
up() continued:
  4. Line 120: ensureRemoteSynced() → Calls syncRemoteFiles()

syncRemoteFiles() (lines 567-678):
  - Line 577: Create remote directory (mkdir -p)
  - Lines 599-626: Define filesToSync array (HARDCODED)
    * infrastructure/docker-compose
    * infrastructure/postgres
    * src, dist, package.json, package-lock.json
    * Dockerfiles (base, service, brat, obs-mcp)
    * config, tools
    * .secure.{ENV}/ (if exists)
  - Lines 631-654: rsync or scp files to remote
  - Line 659: syncAdcCredentials() → Transfer GCP service account key
```

**CRITICAL FINDING**: `.brat/hooks/` is NOT in the `filesToSync` array (orchestrator.ts:599-626). Hook scripts will NOT be synced to remote hosts without additionalSyncPaths feature.

### Stage 4: Infrastructure Setup

```
up() continued:
  5. Line 121: ensureNetworkExists() → Create bitbrat-network Docker network
  6. Line 124: buildBaseImage() → Build bitbrat-base shared image
```

### Stage 5: Build Services
**File**: `tools/brat/src/orchestration/docker/orchestrator.ts`

```
up() continued (lines 166-188):
  7. Determine buildServices list (base + target services)
  8. If remote (lines 174-188):
     - Build services in batches (maxConcurrent limit)
     - Sequential or batched docker compose build calls
  9. If local (implicit in line 239):
     - Single docker compose up --build call
```

### Stage 6: Start Services

```
up() continued:
  10. If remote (lines 211-224):
      - Line 211: docker compose up -d --no-build
      - Line 212-217: Add flags (--force-recreate, --no-deps)
      - Line 218-223: Add service names
  11. If local (lines 239-252):
      - Line 239: docker compose up -d --build
      - Line 240-250: Add flags and service names
```

### Stage 7: Cleanup

```
up() finally block (lines 254-256):
  12. Line 255: cleanupEnvFile() → Remove temporary .env files
```

---

## Current Authentication Status

**NO authentication step present** in current flow.

- Docker relies on pre-configured credentials in `~/.docker/config.json`
- Remote Docker daemon has NO mechanism to receive credentials
- Image pulls from private registries will fail on remote hosts

---

## Hook Injection Points (BL-002 Preview)

Based on the flow analysis, the optimal hook injection points are:

| Hook Type | Injection Point | Purpose |
|-----------|----------------|---------|
| **pre-deploy** | Before `syncRemoteFiles()` (orchestrator.ts:120) | Authenticate to registries on **local** daemon (before sync) |
| **pre-build** | After `syncRemoteFiles()`, before `buildBaseImage()` (orchestrator.ts:120-124) | Authenticate to registries on **remote** daemon (after sync) |
| **post-build** | After build loops, before `docker compose up` (orchestrator.ts:188-211) | Image scanning, tagging, validation |
| **post-deploy** | After `docker compose up` (orchestrator.ts:224/252) | Health checks, notifications, verification |

---

## Key Findings

1. **Deployment flow verified**: Sync → Build → Up sequence confirmed
2. **No authentication step**: Confirmed - no registry auth in current flow
3. **Remote sync whitelist**: Hardcoded in `orchestrator.ts:599-626`
4. **Hook scripts NOT synced**: `.brat/hooks/` not in default sync list
5. **Build happens remotely**: Images built on remote daemon, not transferred
6. **Two execution contexts**: Local (build + up together) vs Remote (sync, then build, then up)

---

## Next Steps (BL-002)

Identify exact line numbers for hook injection in `DockerComposeStrategy.execute()`:
- Pre-deploy hook location
- Pre-build hook location
- Post-build hook location
- Post-deploy hook location

---

**Status**: ✅ Complete (BL-001)
**Evidence**: Deployment flow documented with file paths and line numbers
**Acceptance**: Current sync → build → up sequence verified, no authentication step present
