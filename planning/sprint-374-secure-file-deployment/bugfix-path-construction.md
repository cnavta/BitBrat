# Sprint 374: Bugfix - Incorrect Path Construction in EnvironmentResolver

**Issue:** `EnvironmentResolver` not loading environment variables from `.secure.{ENV}/.env` files

## Problem

After implementing the unified directory structure (`.secure.{ENV}/.env`), the `EnvironmentResolver.resolve()` method was constructing an incorrect file path.

**Symptom:**
```bash
# Environment variables from .secure.staging/.env not being loaded
GOOGLE_APPLICATION_CREDENTIALS=undefined

# But YAML configs were loading correctly
PERSISTENCE_DRIVER=firestore  # From env/staging/global.yaml
```

**Root Cause:**
Line 31 of `environment-resolver.ts` used `path.join()` to construct the secure file path:

```typescript
// INCORRECT (Sprint 374 Phase 4, initial implementation)
const defaultSecureFile = path.join('.secure', envName, '.env');
// Result: '.secure/staging/.env'  (forward slash separator)
```

But the actual directory structure uses a **dot separator** between "secure" and the environment name:

```
.secure.staging/    # Directory name (dot separator)
└── .env           # File inside
```

This mismatch caused `loadSecureLocal()` to look for a non-existent file:
- **Looked for:** `{repoRoot}/.secure/staging/.env` (doesn't exist)
- **Should look for:** `{repoRoot}/.secure.staging/.env` (correct path)

## Solution

Changed line 31 to use string interpolation instead of `path.join()`:

```typescript
// BEFORE (incorrect)
const defaultSecureFile = path.join('.secure', envName, '.env');
// Constructs: '.secure/staging/.env'

// AFTER (correct)
const defaultSecureFile = path.join(`.secure.${envName}`, '.env');
// Constructs: '.secure.staging/.env'
```

**Files Modified:**
- `tools/brat/src/orchestration/docker/environment-resolver.ts:31`

## Testing

**Before fix:**
```javascript
const resolver = new EnvironmentResolver(tmpDir);
const env = resolver.resolve('staging');
console.log(env.GOOGLE_APPLICATION_CREDENTIALS);
// Output: undefined (file not found)
```

**After fix:**
```javascript
const resolver = new EnvironmentResolver(tmpDir);
const env = resolver.resolve('staging');
console.log(env.GOOGLE_APPLICATION_CREDENTIALS);
// Output: /path/to/sa-key.json (loaded correctly)
```

**Test Suite Results:**
- All 6 tests in `orchestrator.sync.spec.ts` now passing ✓
- No regressions in other test suites

## Why This Bug Was Subtle

1. **YAML configs loaded fine** - They use `env/{ENV}/global.yaml` (forward slash separator)
2. **Directory structure was correct** - We used `.secure.{ENV}/` (dot separator) correctly
3. **Path construction inconsistency** - `path.join('.secure', envName)` used forward slash instead of dot

The bug only affected loading from `.secure.{ENV}/.env` files, not from YAML configs or other parts of the system.

## See Also

- [EISDIR Directory Check Bugfix](./bugfix-eisdir-directory-check.md) - Related fix for directory handling
- [Final Directory Structure](./final-directory-structure.md) - Complete directory layout
- [Phase 4 Naming Clarification](./phase-4-naming-clarification.md) - Background on unified structure
