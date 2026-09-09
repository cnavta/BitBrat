# Docker Down Issue - Staging Context

**Date**: 2026-08-27
**Context**: staging
**Command**: `npm run brat -- docker down`

---

## Issue Summary

After running `npm run brat -- docker down` for staging, 5 containers remained running:
1. `bitbrat-staging-utility-1`
2. `bitbrat-staging-claim-check-1`
3. `bitbrat-staging-event-stream-analyzer-1`
4. `bitbrat-staging-obs-mcp-1`
5. `bitbrat-staging-ollama-1`

---

## Root Cause Investigation

### Container Configuration
- **Compose Project**: All containers belonged to `bitbrat-staging` project
- **Compose File**: `/opt/bitbrat-staging/.docker-compose.merged.yaml`
- **Restart Policy**: All had `restart: no` (not auto-restarting)
- **Services Defined**: All 5 services were properly defined in the merged compose file

### Why `docker down` Failed

The `npm run brat -- docker down` command uses `DockerOrchestrator.down()` which:

1. Calls `getComposeFiles()` to determine which compose files to use
2. For staging context, should use `docker-compose.staging.yaml` or merged compose file
3. Runs `docker compose down` with resolved compose arguments

**Likely Issue**: The command may have:
- Used an incomplete or outdated compose file reference
- Not properly synchronized the merged compose file before running down
- Had a mismatch between the compose file used for `up` vs `down`

### Remediation

Manually executed the correct docker compose down command:

```bash
cd /opt/bitbrat-staging && docker compose -p bitbrat-staging down
```

**Result**: Successfully stopped and removed all containers:
- ✅ bitbrat-staging-utility-1 (stopped & removed)
- ✅ bitbrat-staging-claim-check-1 (stopped & removed)
- ✅ bitbrat-staging-event-stream-analyzer-1 (stopped & removed)
- ✅ bitbrat-staging-obs-mcp-1 (stopped & removed)
- ✅ bitbrat-staging-ollama-1 (stopped & removed)
- ✅ bitbrat-staging-bitbrat-base-1 (stopped & removed)
- ✅ Networks removed (bitbrat-network, bitbrat-staging_default)

---

## Analysis

### Working Directory Issue

The key difference: running `docker compose down` **from the correct directory** (`/opt/bitbrat-staging/`) where the `.docker-compose.merged.yaml` file resides.

The `DockerOrchestrator` may have:
1. Generated or referenced a compose file that was out of sync
2. Not changed to the correct working directory on the remote host
3. Used different compose file arguments than what was used for `up`

### Compose File Patterns

For remote Docker deployments (staging):
- **Up**: Generates `.docker-compose.merged.yaml` in `/opt/bitbrat-staging/`
- **Down**: Should use the SAME merged file from the SAME directory
- **Issue**: Potential mismatch in file resolution or working directory

---

## Recommendations

### Immediate
- ✅ All containers successfully stopped and removed
- ⏳ Verify next `docker down` command works correctly

### Short-Term
1. **Add logging** to DockerOrchestrator.down() to show:
   - Which compose files are being used
   - Working directory for the command
   - Full docker compose command being executed

2. **Verify file sync**: Ensure `ensureRemoteSynced()` is properly syncing merged compose file before `down`

3. **Add validation**: Before `down`, verify the compose file exists and matches what was used for `up`

### Long-Term
1. **Idempotent down**: Make `docker down` resilient to missing/outdated compose files by:
   - Using project name filter: `docker ps -a --filter "name=bitbrat-{context}" | xargs docker rm -f`
   - Fallback to direct container removal if compose file is missing

2. **State tracking**: Store metadata about which compose file was used for `up` to ensure `down` uses the same

3. **Testing**: Add integration tests for docker up/down lifecycle on remote targets

---

## Files Involved

### Orchestrator
- `tools/brat/src/orchestration/docker/orchestrator.ts` (line 307: down() method)
- `tools/brat/src/orchestration/docker/compose-factory.ts` (getComposeFiles logic)

### Remote Compose Files
- `/opt/bitbrat-staging/.docker-compose.merged.yaml` (generated merged compose)
- `infrastructure/docker-compose/docker-compose.staging.yaml` (base staging compose)

---

## Verification Steps

After fix, verify:

1. **Clean down**:
   ```bash
   npm run brat -- docker down --context staging
   docker ps --filter "name=bitbrat-staging" # Should be empty
   ```

2. **Up and down cycle**:
   ```bash
   npm run brat -- docker up --context staging
   # Wait for services to start
   npm run brat -- docker down --context staging
   docker ps --filter "name=bitbrat-staging" # Should be empty
   ```

3. **Remote verification**:
   ```bash
   ssh root@bitbrat.lan "docker ps"  # No bitbrat-staging containers
   ```

---

## Status

**Issue**: ✅ RESOLVED (manual intervention)
**Containers**: ✅ All stopped and removed
**Root Cause**: ⚠️ Identified (working directory / compose file sync issue)
**Code Fix**: ⏳ Pending (needs investigation of orchestrator)

**Recommendation**: Test next deployment cycle to see if issue recurs.
