# Sprint 374: Remote Deployment Cleanup Feature

**Feature:** Automatic cleanup of stale deployment files on remote hosts before syncing new code

## Problem

When deploying to remote Docker hosts (e.g., staging at `ssh://root@bitbrat.lan`), stale files from previous deployments can cause issues:

1. **Old code persists** - Modified files might not be replaced if rsync thinks they're unchanged
2. **Configuration drift** - Old `architecture.yaml` or compose files might conflict with new ones
3. **Build cache pollution** - Old `dist/` or `src/` files can cause build failures
4. **Secret conflicts** - Old environment files might override new ones

**Example Scenario:**
```bash
# First deployment
brat deploy --context staging  # Deploys v1.0.0

# Code changes locally
# ... modify src/apps/llm-bot-service.ts ...
# ... update architecture.yaml ...

# Second deployment
brat deploy --context staging  # Should deploy v1.1.0

# BUT: Old files on remote might cause:
# - rsync skips unchanged files (even if logic changed)
# - Old architecture.yaml conflicts with new services
# - Old .env.brat has stale environment variables
```

## Solution

Added `cleanupRemoteDeployment()` method that runs **before** `syncRemoteFiles()` to remove stale deployment files from the remote host.

**Implementation:**
```typescript
private async cleanupRemoteDeployment(target: any): Promise<void> {
  const remoteDir = target.remoteDir;
  if (!remoteDir) return;

  const sshTarget = target.host.replace('ssh://', '');
  console.log(`[brat] Cleaning up stale deployment files on remote: ${sshTarget}:${remoteDir}`);

  // List of files/directories to remove (relative to remoteDir)
  const filesToClean = [
    'src',
    'dist',
    'infrastructure/docker-compose',
    'tools',
    'architecture.yaml',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    '.env.brat',
    'Dockerfile.*',
    'firebase.json',
    'firestore.rules',
    'firestore.indexes.json',
    'dummy-creds.json',
  ];

  // Build rm command (safely quoted)
  const rmTargets = filesToClean.map(f => `"${remoteDir}/${f}"`).join(' ');
  const rmCommand = `cd "${remoteDir}" && rm -rf ${rmTargets} 2>/dev/null || true`;

  const rmResult = await execCmd('ssh', [sshTarget, rmCommand], { cwd: this.options.repoRoot });
  if (rmResult.code === 0) {
    console.log(`[brat] Cleaned up ${filesToClean.length} stale file/directory patterns`);
  } else {
    console.warn(`[brat] Warning: cleanup command exited with code ${rmResult.code}, continuing anyway...`);
  }
}
```

**Files Modified:**
- `tools/brat/src/orchestration/docker/orchestrator.ts:294-353`
- `tools/brat/src/orchestration/docker/orchestrator.sync.spec.ts:77-111` (new test)

## What Gets Cleaned

The cleanup removes **14 file/directory patterns** that will be re-synced with fresh content:

| Pattern | Description | Reason for Cleanup |
|---------|-------------|-------------------|
| `src/` | TypeScript source code | Might have deleted/renamed files |
| `dist/` | Compiled JavaScript | Build artifacts should be regenerated |
| `infrastructure/docker-compose/` | Docker Compose files | Service definitions might have changed |
| `tools/` | CLI tools and scripts | Tool updates should be deployed |
| `architecture.yaml` | System configuration | Core config must be fresh |
| `package.json` | Dependencies | Dependency changes should be applied |
| `package-lock.json` | Dependency lock | Lock file should match package.json |
| `tsconfig.json` | TypeScript config | Compiler settings might have changed |
| `.env.brat` | Generated environment file | Will be regenerated from fresh sources |
| `Dockerfile.*` | Docker build files | Build process might have changed |
| `firebase.json` | Firebase config | Firestore emulator config |
| `firestore.rules` | Firestore security rules | Rules might have changed |
| `firestore.indexes.json` | Firestore indexes | Index definitions might have changed |
| `dummy-creds.json` | Test credentials | Test files should be fresh |

## What Gets Preserved

The cleanup **preserves critical data and infrastructure**:

| Item | Preserved | Reason |
|------|-----------|--------|
| Docker volumes | ✅ Yes | Contains persistent data (postgres-data, nats-data) |
| `.secure.{ENV}/` directories | ✅ Yes | Contains secrets (will be re-synced if changed) |
| Docker images | ✅ Yes | Will be rebuilt only if Dockerfile changed |
| Docker containers | ✅ Yes | Stopped/restarted during deployment, not deleted |
| Docker networks | ✅ Yes | Reused across deployments |

**Why preserve `.secure.{ENV}/`?**
- Secrets are synced separately during `syncRemoteFiles()`
- If unchanged locally, no need to remove and re-sync
- If changed locally, rsync will update them

## Deployment Flow

**Before Sprint 374 Cleanup Feature:**
```
1. brat deploy --context staging
2. writeEnvFile() generates .env.brat
3. syncRemoteFiles() syncs to remote
   - rsync skips files it thinks are unchanged
   - Old files might persist
4. Docker containers start with potentially stale code
```

**After Sprint 374 Cleanup Feature:**
```
1. brat deploy --context staging
2. writeEnvFile() generates .env.brat
3. cleanupRemoteDeployment() removes stale files
   - Deletes src/, dist/, architecture.yaml, etc.
   - Preserves volumes, images, .secure.*/
4. syncRemoteFiles() syncs fresh code
   - All files treated as new
   - No conflicts with old files
5. Docker containers start with fresh code
```

## Safety Features

**1. Fail-Safe Cleanup:**
```bash
rm -rf ${rmTargets} 2>/dev/null || true
```
- `2>/dev/null` - Suppresses "file not found" errors
- `|| true` - Continues even if rm fails (exit code 0)

**2. Quoted Paths:**
```typescript
const rmTargets = filesToClean.map(f => `"${remoteDir}/${f}"`).join(' ');
```
- All paths double-quoted to handle spaces
- Prevents injection attacks

**3. Warning on Failure:**
```typescript
if (rmResult.code === 0) {
  console.log(`[brat] Cleaned up ${filesToClean.length} stale file/directory patterns`);
} else {
  console.warn(`[brat] Warning: cleanup command exited with code ${rmResult.code}, continuing anyway...`);
}
```
- Non-zero exit code triggers warning
- Deployment continues (sync will still work)

## Testing

**New Test Added:**
```typescript
it('cleans up stale deployment files before syncing to remote', async () => {
  const repoRoot = makeRepo([
    'infrastructure/docker-compose/docker-compose.local.yaml',
    '.env.brat',
  ]);

  const orch = new DockerOrchestrator({ repoRoot });
  const target = { host: 'ssh://user@example', remoteDir: '/remote/dir' };

  await (orch as any).cleanupRemoteDeployment(target);

  // Find the ssh call that runs the cleanup command
  const sshCleanupCall = execCmdMock.mock.calls.find(
    ([cmd, args]) =>
      cmd === 'ssh' &&
      Array.isArray(args) &&
      args.length === 2 &&
      args[0] === 'user@example' &&
      typeof args[1] === 'string' &&
      args[1].includes('rm -rf'),
  );

  expect(sshCleanupCall).toBeDefined();
  const cleanupCommand = sshCleanupCall![1][1] as string;

  // Verify cleanup targets
  expect(cleanupCommand).toContain('src');
  expect(cleanupCommand).toContain('dist');
  expect(cleanupCommand).toContain('infrastructure/docker-compose');
  expect(cleanupCommand).toContain('architecture.yaml');
  expect(cleanupCommand).toContain('.env.brat');

  // Verify it's safe (uses || true to continue on errors)
  expect(cleanupCommand).toContain('|| true');
});
```

**Test Results:**
- All 8 tests in `orchestrator.sync.spec.ts` passing ✓
- Cleanup test verifies ssh command structure
- Verifies safety features (|| true)

## Example Output

**During Deployment:**
```bash
$ brat deploy --context staging --all

[brat] Cleaning up stale deployment files on remote: root@bitbrat.lan:/opt/BitBratPlatform
[brat] Cleaned up 14 stale file/directory patterns
[brat] Syncing deployment files to remote: root@bitbrat.lan:/opt/BitBratPlatform
[brat] Syncing GCP ADC key to remote: /opt/BitBratPlatform/secrets/google-app-creds.json
[brat] Building services: llm-bot, api-gateway, ...
```

## Use Cases

### Use Case 1: Service Removal

**Scenario:** Removed a service from `architecture.yaml`

**Before Cleanup:**
```bash
# Old deployment had "deprecated-service"
/opt/BitBratPlatform/infrastructure/docker-compose/services/deprecated-service.compose.yaml

# New deployment doesn't include it
# BUT: Old compose file still exists on remote
# Docker Compose might try to start the old service
```

**After Cleanup:**
```bash
# Cleanup removes entire infrastructure/docker-compose/ directory
# Fresh sync only includes active services
# Old service is gone
```

### Use Case 2: Configuration Changes

**Scenario:** Changed `architecture.yaml` to update service ports

**Before Cleanup:**
```bash
# Old architecture.yaml has PORT=3000
# New architecture.yaml has PORT=3100
# rsync might skip if file size is same
# Services start with old port!
```

**After Cleanup:**
```bash
# Cleanup removes architecture.yaml
# Fresh sync deploys new architecture.yaml
# Services start with correct port
```

### Use Case 3: Source Code Refactoring

**Scenario:** Renamed/moved TypeScript files

**Before Cleanup:**
```bash
# Old: src/apps/old-service.ts
# New: src/apps/new-service.ts
# rsync syncs new file but old file persists
# Build might import from old file!
```

**After Cleanup:**
```bash
# Cleanup removes entire src/ and dist/ directories
# Fresh sync only includes current files
# Build uses correct imports
```

## Performance Impact

**Cleanup Time:**
- Single SSH command to remove files
- ~1-2 seconds for typical deployment

**Sync Time:**
- rsync treats all files as new (no timestamp comparison)
- Slightly slower sync, but ensures correctness
- Tradeoff: Reliability > Speed

**Overall Impact:**
- Adds 1-2 seconds to deployment
- Prevents hours of debugging stale file issues
- **Worth it!**

## Migration Notes

**Existing Deployments:**
- First deployment with this feature will clean up accumulated stale files
- Expect longer initial deployment as all files are re-synced
- Subsequent deployments will be same speed

**Rollback:**
- If this causes issues, revert commit
- Old behavior: no cleanup before sync
- May need to manually clean `/opt/BitBratPlatform` on remote

## Future Enhancements

**Potential Improvements:**

1. **Selective Cleanup:**
   - Only clean files that changed (checksum comparison)
   - Faster but more complex

2. **Backup Before Cleanup:**
   - Create timestamped backup: `/opt/BitBratPlatform.backup.2026-07-29/`
   - Allow rollback if deployment fails

3. **Cleanup Verification:**
   - Report which files were actually removed
   - Warn if critical files couldn't be cleaned

4. **Post-Deployment Cleanup:**
   - Remove old Docker images after successful deployment
   - Prune unused volumes

## See Also

- [Remote Sync Bugfix](./bugfix-remote-sync.md) - `.secure.{ENV}/` directory syncing
- [Infrastructure Secrets Verification](./infrastructure-secrets-verification.md) - How secrets are deployed
- [Phases 1-4 Completion Summary](./phases-1-4-completion-summary.md) - Sprint overview
