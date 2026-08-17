# Sprint 374: Bugfix - Backward Compatibility for Old .secure.{ENV} Files

**Issue:** Remote staging deployment failing with missing secrets after Sprint 374 Phase 4 changes

## Problem

After implementing the unified directory structure (`.secure.{ENV}/.env`), deployments to remote hosts that still used the old file format (`.secure.{ENV}` as a file) were failing with missing environment variables.

**Symptom:**
```bash
# Docker Compose warnings on staging:
time="2026-07-29T17:40:23-05:00" level=warning msg="The \"OPENAI_API_KEY\" variable is not set. Defaulting to a blank string."
time="2026-07-29T17:40:23-05:00" level=warning msg="The \"TWILIO_API_KEY\" variable is not set. Defaulting to a blank string."
time="2026-07-29T17:40:23-05:00" level=warning msg="The \"TWITCH_CLIENT_SECRET\" variable is not set. Defaulting to a blank string."
```

**Root Cause:**
After the path construction fix (bugfix-path-construction.md), `EnvironmentResolver.resolve()` only looked for the new format:
- **Looked for:** `{repoRoot}/.secure.staging/.env` (new format - file inside directory)
- **Actually exists on staging:** `{repoRoot}/.secure.staging` (old format - file at root, 1970 bytes)

The old file was created on July 23 and contained all the necessary secrets, but the new code couldn't find it.

## Solution

Added backward compatibility logic to `EnvironmentResolver.resolve()` that checks for both formats:

```typescript
// Sprint 374: Load environment variables from .secure.{ENV}/.env (inside secure directory)
// This keeps all secrets in one place: both .env files and credential files
// Backward compatibility: Also check for old .secure.{ENV} file format (Sprint 373 and earlier)
let secureFilePath: string;
if (securePath) {
  secureFilePath = path.join(this.repoRoot, securePath);
} else {
  // Try new format first: .secure.{ENV}/.env (inside directory)
  const newFormatPath = path.join(this.repoRoot, `.secure.${envName}`, '.env');
  // Fallback to old format: .secure.{ENV} (file at root)
  const oldFormatPath = path.join(this.repoRoot, `.secure.${envName}`);

  if (fs.existsSync(newFormatPath)) {
    secureFilePath = newFormatPath;
  } else if (fs.existsSync(oldFormatPath) && fs.statSync(oldFormatPath).isFile()) {
    // Old format detected - use it for backward compatibility
    secureFilePath = oldFormatPath;
  } else {
    // Neither exists - use new format path (loadSecureLocal will return empty)
    secureFilePath = newFormatPath;
  }
}
const secureEnv = this.loadSecureLocal(secureFilePath);
```

**Priority Order:**
1. **New format** (`.secure.{ENV}/.env`) - Preferred
2. **Old format** (`.secure.{ENV}` file) - Backward compatibility
3. **Neither exists** - Return empty (no secrets)

**Files Modified:**
- `tools/brat/src/orchestration/docker/environment-resolver.ts:29-51`

## Testing

**Test 1: Old Format (Backward Compatibility)**
```javascript
// Create old format: .secure.staging (file)
fs.writeFileSync(path.join(tmpDir, '.secure.staging'), 'OPENAI_API_KEY=sk-test-key\n');

const resolver = new EnvironmentResolver(tmpDir);
const env = resolver.resolve('staging');
console.log(env.OPENAI_API_KEY); // Output: sk-test-key ✓
```

**Test 2: New Format**
```javascript
// Create new format: .secure.staging/.env (file inside directory)
fs.mkdirSync(path.join(tmpDir, '.secure.staging'), { recursive: true });
fs.writeFileSync(path.join(tmpDir, '.secure.staging', '.env'), 'OPENAI_API_KEY=sk-new-key\n');

const resolver = new EnvironmentResolver(tmpDir);
const env = resolver.resolve('staging');
console.log(env.OPENAI_API_KEY); // Output: sk-new-key ✓
```

**Test 3: Existing Tests**
All 6 tests in `orchestrator.sync.spec.ts` still pass ✓

## Deployment Impact

**Before Fix:**
- Staging deployment: Missing all secrets → Services fail to start
- `.env.brat` only contained 11 lines (basic config, no secrets)

**After Fix:**
- Staging deployment: Loads secrets from old `.secure.staging` file
- `.env.brat` will contain all secrets (OPENAI_API_KEY, TWILIO_API_KEY, etc.)
- No manual migration required

## Migration Path

**Automatic (Recommended):**
The backward compatibility fix allows deployments to continue working without manual intervention. Users can migrate at their convenience:

```bash
# On the remote host (staging):
ssh root@bitbrat.lan

# 1. Create new directory
mkdir -p /opt/BitBratPlatform/.secure.staging

# 2. Move old file to new location
mv /opt/BitBratPlatform/.secure.staging /opt/BitBratPlatform/.secure.staging/.env

# 3. Verify
cat /opt/BitBratPlatform/.secure.staging/.env
# Should show all secrets (OPENAI_API_KEY, TWILIO_API_KEY, etc.)
```

**Manual Migration (Optional):**
Users can also manually migrate by copying the old file contents to the new location, allowing them to organize credential files alongside the `.env` file.

## Why This Bug Was Critical

1. **Silent Failure:** Code deployed successfully but services couldn't start due to missing secrets
2. **Production Impact:** Affected staging environment (remote Docker Compose deployment)
3. **No Error Message:** `EnvironmentResolver` silently returned empty object when file not found
4. **Scope:** Affected all environments using old file format (local, staging, prod)

## Long-Term Solution

**Deprecation Timeline:**
- **Sprint 374:** Backward compatibility added (current)
- **Sprint 375-377:** Encourage migration in documentation
- **Sprint 378+:** Remove backward compatibility, require new format

**Migration Notice (to be added to CLAUDE.md):**
```markdown
## Migration from Sprint 373 and Earlier

If your `.secure.{ENV}` files are still in the old format (files at root), migrate to the new structure:

```bash
# For each environment (local, staging, prod):
mkdir -p .secure.local
mv .secure.local .secure.local/.env

# Verify
cat .secure.local/.env
```

Backward compatibility will be removed in Sprint 378.
```

## See Also

- [EISDIR Directory Check Bugfix](./bugfix-eisdir-directory-check.md) - Related fix
- [Path Construction Bugfix](./bugfix-path-construction.md) - Prerequisite fix
- [Final Directory Structure](./final-directory-structure.md) - Target structure
- [Phase 4 Naming Clarification](./phase-4-naming-clarification.md) - Design decisions
