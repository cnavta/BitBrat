# Sprint 374 Phase 4: Naming Clarification

**Issue:** Naming collision between legacy `.secure.{ENV}` files and new `.secure.{ENV}/` directories

## Problem

During Phase 4 migration, we discovered that BitBrat uses `.secure.*` for **two distinct purposes**:

1. **Environment Variable Files** (legacy)
   - **Pattern**: `.secure.local`, `.secure.staging`, `.secure.prod`
   - **Format**: `.env` format (KEY=value)
   - **Purpose**: Store API keys, tokens, passwords as environment variables
   - **Loaded by**: `EnvironmentResolver.loadSecureLocal()` in `tools/brat/src/orchestration/docker/environment-resolver.ts`
   - **Used by**: All Docker Compose deployments (local, remote)

2. **Credential File Directories** (Sprint 374)
   - **Pattern**: `.secure.local/`, `.secure.staging/`, `.secure.prod/`
   - **Format**: Directory containing files (JSON, PEM, etc.)
   - **Purpose**: Store credential files (GCP service accounts, SSL certificates, etc.)
   - **Mounted by**: `DockerComposeStrategy` and `CloudRunStrategy`
   - **Used by**: Services with `secureFiles` configuration in architecture.yaml

**Collision:**
- Both systems tried to use `.secure.local`, `.secure.staging`, etc.
- Could not coexist (file vs directory)

## Solution

**Renamed environment variable files to use `.env` extension:**
- `.secure.local` → `.secure.local.env`
- `.secure.staging` → `.secure.staging.env`
- `.secure.prod` → `.secure.prod.env`

**Updated `EnvironmentResolver` to use new naming:**
```typescript
// Before (Sprint 358)
const secureFilePath = path.join(this.repoRoot, '.secure.local');

// After (Sprint 374)
const defaultSecureFile = `.secure.${envName}.env`;
const secureFilePath = path.join(this.repoRoot, defaultSecureFile);
```

**Updated `.gitignore` to handle both:**
```gitignore
# Sprint 374: Secure file deployment
# NEVER COMMIT ACTUAL CREDENTIALS

# Exclude environment variable files (.secure.{ENV}.env)
.secure.*.env

# Exclude secure file directories (but allow .gitignore/.gitkeep)
.secure.local
.secure.local.*
.secure.*

# Allow template files and directory structure
!.secure.local.example
!**/.secure.local.example
!.secure.*.env.example
!.secure.local/
!.secure.staging/
!.secure.prod/
!.secure.*/.gitignore
!.secure.*/.gitkeep
```

## Current State

### Environment Variables (`.secure.*.env` files)

**Example: `.secure.local.env`**
```bash
# API Keys and Tokens
OPENAI_API_KEY=sk-proj-...
MCP_AUTH_TOKEN=local-dev-mcp-token

# Twitch Integration
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...

# Discord Integration
DISCORD_BOT_TOKEN=...
```

**Usage:**
```bash
# Loaded automatically by EnvironmentResolver
npm run local   # Uses .secure.local.env
```

**Git Status:**
- ✅ `.secure.local.env` — Ignored (contains secrets)
- ✅ `.secure.staging.env` — Ignored (contains secrets)
- ❌ `.secure.local.env.example` — Allowed (template)

### Credential Files (`.secure.*/` directories)

**Example: `.secure.local/gcp-credentials.json`**
```json
{
  "type": "service_account",
  "project_id": "my-project",
  "private_key": "..."
}
```

**Usage:**
```yaml
# architecture.yaml
services:
  image-gen-mcp:
    secureFiles:
      - local: .secure.local/gcp-credentials.json
        target: /var/secrets/gcp-credentials.json
        env: GOOGLE_APPLICATION_CREDENTIALS
```

**Git Status:**
- ✅ `.secure.local/` — Directory tracked (contains .gitignore/.gitkeep)
- ✅ `.secure.local/.gitignore` — Tracked (ignores all files in directory)
- ✅ `.secure.local/.gitkeep` — Tracked (preserves empty directory)
- ❌ `.secure.local/gcp-credentials.json` — Ignored (actual credential file)

## Files Modified

| File | Change | Status |
|------|--------|--------|
| `tools/brat/src/orchestration/docker/environment-resolver.ts` | Updated to use `.secure.${envName}.env` pattern | ✅ |
| `.gitignore` | Added `.secure.*.env` exclusion and directory allowances | ✅ |
| `.secure.local` → `.secure.local.env` | Renamed to avoid collision | ✅ |
| `.secure.staging` → `.secure.staging.env` | Renamed to avoid collision | ✅ |
| `CLAUDE.md` | Added clarification note about dual-purpose | ✅ |

## Migration Notes

**For users with existing `.secure.{ENV}` files:**

1. **Rename environment variable files:**
   ```bash
   mv .secure.local .secure.local.env
   mv .secure.staging .secure.staging.env
   mv .secure.prod .secure.prod.env
   ```

2. **No code changes required** — EnvironmentResolver automatically uses new naming

3. **Verify git-ignore:**
   ```bash
   git status .secure.local.env
   # Should show nothing (ignored)
   ```

**Backward Compatibility:**
- ❌ Not backward compatible (breaking change)
- **Migration required** for existing deployments
- **Recommended:** Include migration step in sprint retro

## Future Improvements

1. **Consider consolidating** environment variables into `env/{context}/secrets.yaml` (encrypted)
2. **Add validation** to ensure `.secure.*.env` files exist before deployment
3. **Create example templates** (`.secure.local.env.example`) for new developers
4. **Document** in onboarding guide

## See Also

- [Sprint 374 Technical Architecture](./technical-architecture.md)
- [Secure File Deployment Guide](../../documentation/guides/secure-file-deployment.md)
- [CLAUDE.md - Deploying Secure Files](../../CLAUDE.md#deploying-secure-files-sprint-374)
