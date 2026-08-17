# Additional Sync Paths - Technical Design

**Feature**: BEC-Specific File Sync Control for Remote Deployments
**Sprint**: sprint-15-gpcvez
**Related**: Deployment Lifecycle Hooks System

---

## Problem

The remote Docker deployment process uses a **hardcoded whitelist** of files to sync from local to remote:

**Current Whitelist** (`orchestrator.ts:599-626`):
```typescript
const filesToSync = [
  'infrastructure/docker-compose',
  'infrastructure/postgres',
  '.env.brat',
  'dummy-creds.json',
  'architecture.yaml',
  'firebase.json',
  'firestore.rules',
  'firestore.indexes.json',
  'src',
  'dist',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'Dockerfile.base',
  'Dockerfile.service',
  'Dockerfile.brat',
  'Dockerfile.obs-mcp',
  'config',
  'tools',
  `.secure.${envName}`,  // If exists
];
```

**Issues**:
1. Hook scripts (`.brat/hooks/**/*.sh`) are **not in whitelist** → won't sync to remote
2. Users cannot add BEC-specific files (custom scripts, configs, credentials)
3. Every new file type requires platform code change
4. No per-context control (staging might need different files than prod)

---

## Solution

Add `additionalSyncPaths` to execution context Docker configuration:

### Schema

```yaml
# architecture.yaml
executionContexts:
  staging:
    deployment:
      type: docker-compose
      docker:
        host: ssh://root@bitbrat.lan
        remoteDir: /opt/bitbrat-staging
        additionalSyncPaths:
          - .brat/hooks
          - custom-scripts
          - vendor/special-lib
      hooks:
        pre-deploy: .brat/hooks/staging/pre-deploy.sh
```

### TypeScript Interface

```typescript
// tools/brat/src/config/types.ts

export interface DockerDeploymentConfig {
  host: string;
  remoteDir?: string;
  maxConcurrent?: number;

  /**
   * Additional files/directories to sync to remote host.
   *
   * Paths are relative to repository root and appended to the
   * default sync whitelist. Useful for syncing hook scripts,
   * custom configurations, or BEC-specific files.
   *
   * Automatic additions:
   * - .brat/hooks/ is auto-added when deployment.hooks is configured
   *
   * Validation:
   * - Paths must be relative (not absolute)
   * - Paths outside repo root are rejected
   * - Non-existent paths logged as warnings (don't fail deployment)
   *
   * @example
   * ```yaml
   * additionalSyncPaths:
   *   - .brat/hooks
   *   - custom-scripts
   *   - vendor/special-lib
   * ```
   */
  additionalSyncPaths?: string[];
}
```

### Implementation

**File**: `tools/brat/src/orchestration/docker/orchestrator.ts`

```typescript
private async syncRemoteFiles(target: any): Promise<void> {
  const remoteDir = target.remoteDir;
  if (!remoteDir) return;

  const sshTarget = target.host.replace('ssh://', '');
  const envName = this.options.env || target.env || 'local';
  const secureDir = `.secure.${envName}`;

  // Default whitelist (existing)
  const filesToSync = [
    'infrastructure/docker-compose',
    'infrastructure/postgres',
    '.env.brat',
    // ... (rest of default whitelist)
  ];

  // ============================================================================
  // NEW: Add additional sync paths from execution context
  // ============================================================================

  // Auto-add .brat/hooks/ if hooks are configured
  const context = this.getResolvedContext();  // From context resolver
  if (context?.deployment?.hooks) {
    const hooksDir = '.brat/hooks';
    if (fs.existsSync(path.join(this.options.repoRoot, hooksDir))) {
      if (!filesToSync.includes(hooksDir)) {
        filesToSync.push(hooksDir);
        console.log(`[brat] Auto-added ${hooksDir} to sync list (hooks configured)`);
      }
    }
  }

  // Add user-specified additional paths
  const additionalPaths = context?.deployment?.docker?.additionalSyncPaths || [];
  for (const additionalPath of additionalPaths) {
    // Validate path is relative
    if (path.isAbsolute(additionalPath)) {
      console.warn(`[brat] Skipping absolute path in additionalSyncPaths: ${additionalPath}`);
      continue;
    }

    // Validate path is within repo
    const fullPath = path.join(this.options.repoRoot, additionalPath);
    const relativePath = path.relative(this.options.repoRoot, fullPath);
    if (relativePath.startsWith('..')) {
      console.warn(`[brat] Skipping path outside repo in additionalSyncPaths: ${additionalPath}`);
      continue;
    }

    // Warn if path doesn't exist (but don't fail)
    if (!fs.existsSync(fullPath)) {
      console.warn(`[brat] Path in additionalSyncPaths does not exist: ${additionalPath}`);
      // Continue anyway - file might be generated during build
    }

    // Add to sync list (deduplicate)
    if (!filesToSync.includes(additionalPath)) {
      filesToSync.push(additionalPath);
      console.log(`[brat] Added to sync list: ${additionalPath}`);
    }
  }

  // ============================================================================
  // Existing sync logic (unchanged)
  // ============================================================================

  // Filter to existing files
  const existingFiles = filesToSync.filter(file =>
    fs.existsSync(path.join(this.options.repoRoot, file))
  );

  if (existingFiles.length === 0) return;

  // rsync or scp (existing logic)
  const rsyncResult = await execCmd('rsync', ['-azR', ...existingFiles, `${sshTarget}:${remoteDir}`], {
    cwd: this.options.repoRoot
  });

  // ... (rest of existing sync logic)
}
```

---

## Behavior

### Automatic Hook Sync

**Trigger**: When `deployment.hooks` is configured (any hook type)

**Action**: `.brat/hooks/` is automatically added to sync whitelist

**Example**:
```yaml
executionContexts:
  staging:
    deployment:
      hooks:
        pre-deploy: .brat/hooks/staging/pre-deploy.sh
```

Result: `.brat/hooks/` synced automatically (no need to add to `additionalSyncPaths`)

### Manual Additional Paths

**Use Case**: Sync custom scripts, vendor libs, BEC-specific configs

**Example**:
```yaml
executionContexts:
  staging:
    deployment:
      docker:
        additionalSyncPaths:
          - custom-scripts       # Custom deployment scripts
          - vendor/redis-cli     # Bundled CLI tool
          - staging-configs      # Staging-specific configs
```

### Validation

| Scenario | Behavior |
|----------|----------|
| Relative path, exists | ✅ Added to sync list |
| Relative path, doesn't exist | ⚠️ Warning logged, still added (might be generated later) |
| Absolute path | ❌ Rejected, warning logged |
| Path outside repo (`../../etc`) | ❌ Rejected, warning logged |
| Duplicate path | ✅ Deduplicated silently |

### Error Handling

**Philosophy**: Warn but don't fail deployment

**Rationale**:
- Files might be generated during build
- Allows forward compatibility (define paths before files exist)
- User sees warnings in deployment output
- Deployment proceeds if files truly needed, later steps will fail with clear errors

---

## Usage Examples

### Example 1: Hook Scripts Only (Auto-Sync)

```yaml
executionContexts:
  staging:
    deployment:
      hooks:
        pre-deploy: .brat/hooks/staging/pre-deploy.sh
        post-deploy: .brat/hooks/staging/post-deploy.sh
```

**Sync List**:
- Default whitelist (infrastructure/, src/, dist/, etc.)
- `.brat/hooks/` ← **Automatically added**

### Example 2: Hooks + Custom Scripts

```yaml
executionContexts:
  staging:
    deployment:
      docker:
        additionalSyncPaths:
          - custom-deployment-scripts
          - vendor/monitoring-agent
      hooks:
        pre-deploy: custom-deployment-scripts/auth.sh
```

**Sync List**:
- Default whitelist
- `.brat/hooks/` (if hooks configured elsewhere)
- `custom-deployment-scripts/`
- `vendor/monitoring-agent/`

### Example 3: BEC-Specific Configurations

```yaml
executionContexts:
  staging:
    deployment:
      docker:
        additionalSyncPaths:
          - .staging-configs
          - .staging-overrides

  prod:
    deployment:
      docker:
        additionalSyncPaths:
          - .prod-configs
          - .prod-secrets  # Should use .secure.prod/ instead!
```

**Staging Sync List**:
- Default whitelist
- `.staging-configs/`
- `.staging-overrides/`

**Prod Sync List**:
- Default whitelist
- `.prod-configs/`
- `.prod-secrets/` (⚠️ use `.secure.prod/` instead for secrets)

---

## Security Considerations

### Path Traversal Prevention

**Attack**: User specifies `../../etc/passwd` in additionalSyncPaths

**Mitigation**: Absolute paths and paths outside repo are rejected

```typescript
// Validate path is within repo
const fullPath = path.join(this.options.repoRoot, additionalPath);
const relativePath = path.relative(this.options.repoRoot, fullPath);
if (relativePath.startsWith('..')) {
  console.warn(`[brat] Skipping path outside repo: ${additionalPath}`);
  continue;
}
```

### Secret Leakage Prevention

**Risk**: Users might sync sensitive files unintentionally

**Mitigation**:
1. Document use of `.secure.{ENV}/` for secrets (already in default whitelist)
2. Warn against syncing secrets via additionalSyncPaths in documentation
3. additionalSyncPaths paths are logged (user can audit)

**Best Practice**:
```yaml
# ❌ DON'T: Sync secrets via additionalSyncPaths
additionalSyncPaths:
  - my-secrets/  # BAD: Secrets should use .secure.{ENV}/

# ✅ DO: Use .secure.{ENV}/ pattern
# Secrets in .secure.staging/ are automatically synced
```

---

## Testing

### Unit Tests

**File**: `tools/brat/src/orchestration/docker/orchestrator.test.ts`

```typescript
describe('syncRemoteFiles with additionalSyncPaths', () => {
  it('should add additionalSyncPaths to sync list', async () => {
    // Mock context with additionalSyncPaths
    // Verify paths added to rsync command
  });

  it('should auto-add .brat/hooks when hooks configured', async () => {
    // Mock context with hooks
    // Verify .brat/hooks added to rsync command
  });

  it('should reject absolute paths', async () => {
    // Mock context with absolute path in additionalSyncPaths
    // Verify warning logged, path not added
  });

  it('should reject paths outside repo', async () => {
    // Mock context with ../../etc path
    // Verify warning logged, path not added
  });

  it('should deduplicate duplicate paths', async () => {
    // Mock context with duplicate paths
    // Verify rsync called with unique paths only
  });

  it('should warn but continue for non-existent paths', async () => {
    // Mock context with non-existent path
    // Verify warning logged, deployment continues
  });
});
```

### Integration Tests

**Scenario**: Deploy service with hooks to remote, verify hooks synced

**Steps**:
1. Create test hook script in `.brat/hooks/test/`
2. Configure execution context with hook
3. Deploy to remote (dry-run)
4. Verify `.brat/hooks/` in rsync command

---

## Documentation Updates

### 1. Deployment Hooks Guide

Add section:

```markdown
## Syncing Hook Scripts to Remote Hosts

When deploying to remote Docker hosts via SSH, hook scripts must be synced
from your local machine to the remote host.

**Automatic Sync**:

Hook scripts are **automatically synced** when you configure hooks in your
execution context. The `.brat/hooks/` directory is added to the sync whitelist
automatically.

No additional configuration needed!

**Example**:
```yaml
executionContexts:
  staging:
    deployment:
      hooks:
        pre-deploy: .brat/hooks/staging/pre-deploy.sh  # ← Auto-synced!
```

**Manual Sync (Advanced)**:

If your hooks depend on external scripts or files, add them to
`additionalSyncPaths`:

```yaml
executionContexts:
  staging:
    deployment:
      docker:
        additionalSyncPaths:
          - custom-scripts  # Custom helper scripts
      hooks:
        pre-deploy: .brat/hooks/staging/pre-deploy.sh
```
```

### 2. Extending BitBrat Guide

Add section:

```markdown
## Adding Custom Files to Remote Deployments

Use `additionalSyncPaths` to sync custom files to remote Docker hosts:

```yaml
executionContexts:
  staging:
    deployment:
      docker:
        additionalSyncPaths:
          - custom-scripts
          - vendor/special-tool
```

**Rules**:
- Paths must be relative to repo root
- Paths outside repo are rejected
- Non-existent paths logged as warnings (don't fail deployment)

**Common Use Cases**:
- Custom deployment scripts
- Vendored CLI tools
- BEC-specific configuration files
- Test fixtures for staging/dev environments
```

---

## Alternatives Considered

### Alternative 1: Sync Everything

**Approach**: Sync entire repo to remote

**Pros**: No whitelist management

**Cons**:
- Syncs unnecessary files (node_modules, .git, test fixtures)
- Slower deployments
- Larger remote disk usage
- Security risk (might sync local secrets, dev files)

**Verdict**: ❌ Rejected - performance and security issues

### Alternative 2: User-Managed rsync

**Approach**: Users write custom rsync commands in pre-deploy hooks

**Pros**: Maximum flexibility

**Cons**:
- Duplicates sync logic
- Users must manage rsync flags, compression, error handling
- No validation or safety checks
- Hook runs after main sync (timing issue)

**Verdict**: ❌ Rejected - too complex for users, timing issues

### Alternative 3: .bratignore File

**Approach**: Whitelist → Blacklist (sync everything except .bratignore entries)

**Pros**: No need to specify paths

**Cons**:
- Breaking change (behavior inversion)
- Still syncs unnecessary files by default
- .gitignore already exists for similar purpose
- Harder to reason about (what gets synced?)

**Verdict**: ❌ Rejected - breaking change, less explicit

---

## Migration

**Backward Compatibility**: ✅ 100% backward compatible

- `additionalSyncPaths` is optional
- Default behavior unchanged (existing whitelist still works)
- Hook auto-sync is additive (doesn't break existing deployments)

**Migration Path**: None required (additive feature)

---

## Backlog Tasks

- **BL-104**: Add additionalSyncPaths to DockerConfig interface
- **BL-105**: Update syncRemoteFiles() to support additionalSyncPaths
- **BL-106**: Add additionalSyncPaths schema validation
- **BL-107**: Write tests for additionalSyncPaths

---

**Document Status**: ✅ Ready for Implementation
**Author**: Lead Implementor
**Date**: 2026-08-16
