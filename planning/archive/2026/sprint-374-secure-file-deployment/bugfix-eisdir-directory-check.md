# Sprint 374: Bugfix - EISDIR Error on Directory Read

**Issue:** `brat docker ps` and other commands failing with `EISDIR: illegal operation on a directory, read`

## Problem

After moving `.env` files inside `.secure.{ENV}/` directories, the `EnvironmentResolver.loadSecureLocal()` method was encountering directories when it expected files.

**Error:**
```
Error: EISDIR: illegal operation on a directory, read
    at Object.readFileSync (node:fs:440:20)
    at EnvironmentResolver.loadSecureLocal
```

**Root Cause:**
The code used `fs.existsSync(filePath)` which returns `true` for both **files and directories**. When legacy `.secure.{ENV}` directories exist (from migration), the method tried to read them as files.

**Scenario:**
```bash
# Old naming (pre-Sprint 374)
.secure.staging    # File

# New naming (Sprint 374)
.secure.staging/   # Directory
└── .env           # File inside

# During migration, both could exist temporarily
```

If old `.secure.staging` directory exists, `fs.readFileSync('.secure.staging')` throws `EISDIR`.

## Solution

Added a directory check in `loadSecureLocal()` before attempting to read:

```typescript
// Before (Sprint 373)
private loadSecureLocal(filePath: string): EnvironmentVariables {
  const env: EnvironmentVariables = {};
  if (!fs.existsSync(filePath)) return env;

  const content = fs.readFileSync(filePath, 'utf8');  // EISDIR error if directory
  // ...
}

// After (Sprint 374)
private loadSecureLocal(filePath: string): EnvironmentVariables {
  const env: EnvironmentVariables = {};
  if (!fs.existsSync(filePath)) return env;

  // Sprint 374: Skip if path is a directory (not a file)
  const stats = fs.statSync(filePath);
  if (stats.isDirectory()) {
    return env;  // Return empty, don't try to read
  }

  const content = fs.readFileSync(filePath, 'utf8');  // Safe now
  // ...
}
```

**Files Modified:**
- `tools/brat/src/orchestration/docker/environment-resolver.ts`

## Testing

**Before fix:**
```bash
$ brat docker ps
Error: EISDIR: illegal operation on a directory, read
```

**After fix:**
```bash
$ brat docker ps
# Works correctly (loads .secure.staging/.env)
```

## Migration Safety

This fix provides **backward compatibility** during migration:

1. **Old structure exists** (`.secure.staging` file) → Loads it
2. **New structure exists** (`.secure.staging/` directory) → Skips directory, loads `.secure.staging/.env`
3. **Both exist** → Prefers `.env` file (path.join constructs `.secure.staging/.env` first)

**Recommended migration:**
```bash
# Remove old directory structure if it exists
rm -rf .secure.staging  # If it's an empty directory from failed migration

# Ensure .env file exists inside new directory
ls .secure.staging/.env  # Should exist
```

## See Also

- [Final Directory Structure](./final-directory-structure.md)
- [Phase 4 Naming Clarification](./phase-4-naming-clarification.md)
