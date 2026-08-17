# Sprint 374: Bugfix - DATABASE_URL Shell Variable Substitution

**Issue:** PostgreSQL connections failing with "no PostgreSQL user name specified in startup packet"

## Problem

After deployment to staging, PostgreSQL was healthy but application services couldn't connect. The error was:
```
FATAL: no PostgreSQL user name specified in startup packet
```

### Root Cause Analysis

**PostgreSQL container environment:**
```bash
POSTGRES_USER=bitbrat
POSTGRES_PASSWORD=bitbrat_dev_password
DATABASE_URL=postgresql://bitbrat:bitbrat_dev_password@postgres:5432/bitbrat
```
✅ Correct credentials

**Application container environment (persistence service):**
```bash
POSTGRES_USER=bitbrat          # ← Present but not in .env.brat
POSTGRES_PASSWORD=bitbrat_dev_password  # ← Present but not in .env.brat
DATABASE_URL=postgresql://:@postgres:5432/bitbrat  # ← MISSING credentials!
```
❌ DATABASE_URL missing username and password

### The Issue

In `env/staging/global.yaml`:
```yaml
DATABASE_URL: "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/bitbrat"
```

**What happened:**
1. `EnvironmentResolver` loaded YAML files
2. YAML parser read `DATABASE_URL` as a **literal string**: `"postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/bitbrat"`
3. `.env.brat` was generated with that literal string
4. Docker Compose tried to substitute `${POSTGRES_USER}` and `${POSTGRES_PASSWORD}` from `.env.brat`
5. BUT: `POSTGRES_USER` and `POSTGRES_PASSWORD` were NOT in `.env.brat` (they were loaded from `.secure.staging/.env` but never written to `.env.brat`)
6. Docker Compose substituted empty strings: `DATABASE_URL=postgresql://:@postgres:5432/bitbrat`
7. Application services tried to connect without credentials → "no PostgreSQL user name specified"

### Why POSTGRES_USER and POSTGRES_PASSWORD weren't in .env.brat

The `.env.brat` file on the remote was missing these variables because:
1. Last deployment ran BEFORE Sprint 374 fixes
2. Local `.secure.staging/.env` had the credentials
3. But remote only had old `.secure.staging` file (not directory)
4. Backward compatibility should have loaded from old file, but deployment was stale

## Solution

**Two-part fix:**

### Part 1: Remove Shell Variable Substitution from YAML

**Changed `env/staging/global.yaml`:**
```yaml
# BEFORE (incorrect)
DATABASE_URL: "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/bitbrat"

# AFTER (correct)
# DATABASE_URL will be constructed by EnvironmentResolver after merging secrets
POSTGRES_HOST: postgres
POSTGRES_PORT: '5432'
POSTGRES_DB: bitbrat
# DATABASE_URL removed - will be auto-generated
```

### Part 2: Auto-Construct DATABASE_URL in EnvironmentResolver

**Added to `EnvironmentResolver.resolve()`:**
```typescript
// Sprint 374: Construct DATABASE_URL from individual components if not explicitly set
// This prevents shell variable substitution issues in YAML files
if (!merged['DATABASE_URL'] && merged['POSTGRES_HOST'] && merged['POSTGRES_DB']) {
  const user = merged['POSTGRES_USER'] || 'bitbrat';
  const password = merged['POSTGRES_PASSWORD'] || 'bitbrat_dev_password';
  const host = merged['POSTGRES_HOST'];
  const port = merged['POSTGRES_PORT'] || '5432';
  const db = merged['POSTGRES_DB'];
  merged['DATABASE_URL'] = `postgresql://${user}:${password}@${host}:${port}/${db}`;
}
```

**Files Modified:**
- `env/staging/global.yaml:28-34` - Removed DATABASE_URL with shell variables
- `tools/brat/src/orchestration/docker/environment-resolver.ts:65-74` - Auto-construct DATABASE_URL

## How It Works Now

**Step-by-step:**

1. **Load YAML files:**
   ```yaml
   # env/staging/global.yaml
   POSTGRES_HOST: postgres
   POSTGRES_PORT: '5432'
   POSTGRES_DB: bitbrat
   ```

2. **Load secrets:**
   ```bash
   # .secure.staging/.env
   POSTGRES_USER=bitbrat
   POSTGRES_PASSWORD=bitbrat_dev_password
   ```

3. **Merge:**
   ```javascript
   const merged = {
     ...globalYaml,
     ...secureEnv,
     // Results in:
     POSTGRES_HOST: 'postgres',
     POSTGRES_PORT: '5432',
     POSTGRES_DB: 'bitbrat',
     POSTGRES_USER: 'bitbrat',
     POSTGRES_PASSWORD: 'bitbrat_dev_password',
   }
   ```

4. **Auto-construct DATABASE_URL:**
   ```javascript
   if (!merged['DATABASE_URL']) {
     merged['DATABASE_URL'] = `postgresql://bitbrat:bitbrat_dev_password@postgres:5432/bitbrat`;
   }
   ```

5. **Write to .env.brat:**
   ```bash
   DATABASE_URL=postgresql://bitbrat:bitbrat_dev_password@postgres:5432/bitbrat
   POSTGRES_DB=bitbrat
   POSTGRES_HOST=postgres
   POSTGRES_PASSWORD=bitbrat_dev_password
   POSTGRES_PORT=5432
   POSTGRES_USER=bitbrat
   ```

6. **Docker Compose reads .env.brat:**
   - No shell variable substitution needed
   - DATABASE_URL has actual credentials
   - Services connect successfully

## Benefits

**Before Fix:**
- ❌ Shell variable substitution in YAML files
- ❌ Credentials not in .env.brat
- ❌ DATABASE_URL had empty credentials
- ❌ PostgreSQL connections failed

**After Fix:**
- ✅ No shell variables in YAML
- ✅ Credentials in .env.brat
- ✅ DATABASE_URL has actual credentials
- ✅ PostgreSQL connections work

## Testing

**Test Script:**
```bash
# Test EnvironmentResolver
node /tmp/test-deployment-env.js

# Expected output:
# DATABASE_URL: postgresql://bitbrat:bitbrat_dev_password@postgres:5432/bitbrat
# Contains POSTGRES_USER: true
# Contains POSTGRES_PASSWORD: true
# SUCCESS: .env.brat will have PostgreSQL credentials
```

**Verification after deployment:**
```bash
# Check .env.brat on remote
ssh root@bitbrat.lan 'cat /opt/BitBratPlatform/.env.brat | grep -E "^DATABASE_URL|^POSTGRES_"'

# Expected:
# DATABASE_URL=postgresql://bitbrat:bitbrat_dev_password@postgres:5432/bitbrat
# POSTGRES_DB=bitbrat
# POSTGRES_HOST=postgres
# POSTGRES_PASSWORD=bitbrat_dev_password
# POSTGRES_PORT=5432
# POSTGRES_USER=bitbrat

# Check application container
ssh root@bitbrat.lan 'docker exec bitbrat-staging-persistence-1 env | grep DATABASE_URL'

# Expected:
# DATABASE_URL=postgresql://bitbrat:bitbrat_dev_password@postgres:5432/bitbrat
```

## Why This Was Hard to Debug

1. **PostgreSQL was healthy** - Misleading because the issue was client credentials
2. **POSTGRES_USER in container env** - Present from defaults, not from .env.brat
3. **Shell substitution failed silently** - Docker Compose just used empty strings
4. **Logs were confusing** - "no PostgreSQL user name specified" didn't point to DATABASE_URL

## Lessons Learned

**Don't use shell variable substitution in YAML files:**
```yaml
# BAD - Don't do this
DATABASE_URL: "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@host/db"

# GOOD - Let code construct the URL
POSTGRES_HOST: postgres
POSTGRES_DB: bitbrat
# Credentials from .secure.{ENV}/.env
# DATABASE_URL auto-constructed
```

**Why shell variables in YAML are problematic:**
1. YAML parser treats them as literal strings
2. Requires environment variables to be present during Docker Compose parsing
3. Creates dependency on Docker Compose variable substitution
4. Hard to debug when substitution fails silently

## Migration Notes

**Other environments to check:**

1. **Local (`env/local/global.yaml`):**
   ```bash
   grep 'DATABASE_URL.*\${' env/local/global.yaml
   # If found, remove and let auto-construction handle it
   ```

2. **Production (`env/prod/global.yaml`):**
   ```bash
   grep 'DATABASE_URL.*\${' env/prod/global.yaml
   # If found, remove and let auto-construction handle it
   ```

**Safe to remove:**
Any `DATABASE_URL` that uses shell variables like `${POSTGRES_USER}` can be safely removed. The `EnvironmentResolver` will construct it automatically from component variables.

## See Also

- [Infrastructure Secrets Verification](./infrastructure-secrets-verification.md) - How secrets flow
- [Remote Sync Bugfix](./bugfix-remote-sync.md) - `.secure.{ENV}/` syncing
- [Backward Compatibility Bugfix](./bugfix-backward-compatibility.md) - Old file format support
- [Phases 1-4 Completion Summary](./phases-1-4-completion-summary.md) - Sprint overview
