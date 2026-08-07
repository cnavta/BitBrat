# Sprint 374: Bugfix - Remote Sync of .secure.{ENV}/ Directories

**Issue:** Secrets not being applied on staging after deployment - `.secure.staging/.env` file not synced to remote host

## Problem

After deploying to staging with Sprint 374 changes, all secrets were missing from the remote environment, causing Docker Compose warnings:

```bash
WARNING: The "OPENAI_API_KEY" variable is not set. Defaulting to a blank string.
WARNING: The "TWILIO_API_KEY" variable is not set. Defaulting to a blank string.
```

**Root Cause:**

The deployment process has two environments:
1. **Local workstation** (where `brat deploy` runs) - has `.secure.staging/.env` (new format)
2. **Remote staging host** - has `.secure.staging` file (old format, 1970 bytes)

The `DockerOrchestrator.syncRemoteFiles()` method was NOT syncing `.secure.{ENV}/` directories to the remote host. This meant:

1. During deployment, `EnvironmentResolver.resolve()` loaded secrets from **LOCAL** `.secure.staging/.env`
2. `.env.brat` was generated with those secrets
3. `.env.brat` was synced to remote host
4. BUT on remote host, containers couldn't access credential files (they weren't synced)
5. Future deployments would fail because `.secure.staging/.env` doesn't exist on remote

**The Missing Sync:**
```typescript
// tools/brat/src/orchestration/docker/orchestrator.ts:327-346
const filesToSync = [
  'infrastructure/docker-compose',
  '.env.brat',
  'src',
  'dist',
  // ... other files
  // MISSING: .secure.{ENV}/ directory!
];
```

## Solution

Added `.secure.{ENV}/` directory to the `filesToSync` array in `DockerOrchestrator.syncRemoteFiles()`:

```typescript
// Sprint 374: Sync .secure.{ENV}/ directories for secure file deployment
// These contain .env files and credential files needed for deployment
const envName = this.options.env || target.env || 'local';
const secureDir = `.secure.${envName}`;

const filesToSync = [
  'infrastructure/docker-compose',
  '.env.brat',
  // ... other files
  'tools',
  // Sprint 374: Secure files directory (if exists as directory)
  ...(fs.existsSync(path.join(this.options.repoRoot, secureDir)) &&
      fs.statSync(path.join(this.options.repoRoot, secureDir)).isDirectory() ? [secureDir] : []),
].filter(file => fs.existsSync(path.join(this.options.repoRoot, file)));
```

**Key Features:**
1. ✅ Only syncs if `.secure.{ENV}/` exists as a **directory** (not old file format)
2. ✅ Environment-specific: syncs `.secure.staging/` for staging, `.secure.local/` for local, etc.
3. ✅ Conditional: uses spread operator to avoid pushing `undefined`
4. ✅ Safe: checks existence before syncing

**Files Modified:**
- `tools/brat/src/orchestration/docker/orchestrator.ts:316-355`
- `tools/brat/src/orchestration/docker/orchestrator.sync.spec.ts:53-75` (new test)

## Testing

**New Test Added:**
```typescript
it('syncs .secure.{ENV}/ directory when it exists', async () => {
  const repoRoot = makeRepo([...]);

  // Create .secure.staging/ directory with .env file
  fs.mkdirSync(path.join(repoRoot, '.secure.staging'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, '.secure.staging', '.env'),
    'OPENAI_API_KEY=sk-test\n',
  );

  const orch = new DockerOrchestrator({ repoRoot, env: 'staging' });
  const target = { host: 'ssh://user@example', remoteDir: '/remote/dir', env: 'staging' };

  await (orch as any).syncRemoteFiles(target);

  const rsyncCall = execCmdMock.mock.calls.find(([cmd]) => cmd === 'rsync');
  expect(rsyncCall).toBeDefined();
  const rsyncArgs = rsyncCall![1] as string[];
  expect(rsyncArgs).toContain('.secure.staging');
});
```

**Test Results:**
- All 7 tests in `orchestrator.sync.spec.ts` passing ✓
- New test verifies `.secure.{ENV}/` is included in rsync args

## Deployment Impact

**Before Fix:**
1. Local `.secure.staging/.env` loaded during deployment
2. `.env.brat` created with secrets
3. `.env.brat` synced to remote (but secrets only work if referenced by environment variables)
4. Credential files (GCP keys, certs) NOT synced → services fail
5. Future deployments fail because remote has old `.secure.staging` file

**After Fix:**
1. Local `.secure.staging/.env` loaded during deployment
2. `.env.brat` created with secrets
3. **`.secure.staging/` directory synced to remote (including `.env` and credential files)**
4. Remote services can access both environment variables AND credential files
5. Future deployments work correctly

## Migration Path for Staging

**Current State on Staging Host:**
```bash
/opt/BitBratPlatform/.secure.staging    # Old file (1970 bytes)
```

**After Next Deployment:**
```bash
/opt/BitBratPlatform/.secure.staging/   # New directory
├── .env                                # Environment variables
└── gcp-credentials.json                # Credential files (if configured)
```

**Old file handling:**
The old `.secure.staging` file will remain on the remote host but will be ignored by `EnvironmentResolver` (backward compatibility prefers directory format when both exist).

**Manual cleanup (optional):**
```bash
ssh root@bitbrat.lan
cd /opt/BitBratPlatform
rm .secure.staging  # Remove old file (only after confirming new directory works)
```

## Security Considerations

**Q: Is it safe to sync secrets via rsync?**
A: Yes, with caveats:
- **SSH transport:** rsync uses SSH, which is encrypted in transit
- **File permissions:** `.secure.{ENV}/.gitignore` ensures secrets are never committed to git
- **Target host security:** Assumes remote host is trusted (staging/prod servers)

**Q: What about the old `.secure.staging` file on remote?**
A: It will be preserved for backward compatibility. After confirming the new directory works, it can be manually removed.

**Q: Are credential files synced?**
A: Yes - the entire `.secure.{ENV}/` directory is synced, including:
- `.env` file (environment variables)
- `gcp-credentials.json` (GCP service account)
- Any other credential files configured in `architecture.yaml` `secureFiles`

## See Also

- [Backward Compatibility Bugfix](./bugfix-backward-compatibility.md) - Related fix for old format support
- [Path Construction Bugfix](./bugfix-path-construction.md) - Related fix
- [Final Directory Structure](./final-directory-structure.md) - Target structure
- [Phases 1-4 Completion Summary](./phases-1-4-completion-summary.md) - Sprint summary
