# Sprint 374: Infrastructure Secrets Verification

**Issue:** Ensuring PostgreSQL, NATS, and other infrastructure services receive secrets correctly in both local and remote Docker deployments

## Overview

All infrastructure services (PostgreSQL, NATS, etc.) and application services load environment variables from `.env.brat`, which is generated during deployment from multiple sources including `.secure.{ENV}/.env`.

## Infrastructure Services Configuration

### PostgreSQL

**Docker Compose Configuration:**
```yaml
postgres:
  env_file:
    - ".env.brat"
  image: "pgvector/pgvector:pg15"
  environment:
    - "POSTGRES_USER=${POSTGRES_USER:-bitbrat}"
    - "POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-bitbrat_dev_password}"
    - "POSTGRES_DB=${POSTGRES_DB:-bitbrat}"
```

**Secret Sources:**
- `POSTGRES_USER` - from `.secure.{ENV}/.env`
- `POSTGRES_PASSWORD` - from `.secure.{ENV}/.env`
- `POSTGRES_DB` - from `env/{ENV}/global.yaml`

**How It Works:**
1. Docker Compose reads `.env.brat`
2. Finds `POSTGRES_USER=bitbrat` and `POSTGRES_PASSWORD=bitbrat_dev_password`
3. Substitutes `${POSTGRES_USER}` and `${POSTGRES_PASSWORD}` in environment section
4. Passes resolved values to postgres container
5. PostgreSQL starts with those credentials

**Verification:**
```bash
# Check .env.brat has POSTGRES credentials
grep "^POSTGRES_" .env.brat

# Expected output:
# POSTGRES_DB=bitbrat
# POSTGRES_HOST=postgres
# POSTGRES_PASSWORD=bitbrat_dev_password
# POSTGRES_PORT=5432
# POSTGRES_USER=bitbrat
```

### NATS

**Docker Compose Configuration:**
```yaml
nats:
  env_file:
    - ".env.brat"
  image: "nats:2-alpine"
  command:
    - "-js"
    - "-sd"
    - "/data"
```

**Secret Sources:**
- `NATS_URL` - from `env/{ENV}/global.yaml` or `env/{ENV}/infra.yaml`
- No authentication secrets required (default NATS configuration)

**How It Works:**
1. Docker Compose reads `.env.brat`
2. NATS container receives environment variables
3. Application services use `NATS_URL=nats://nats:4222` to connect

### NATS Box (Debug Container)

**Docker Compose Configuration:**
```yaml
nats-box:
  env_file:
    - ".env.brat"
  image: "natsio/nats-box:latest"
  depends_on:
    - "nats"
  environment:
    - "NATS_URL=nats://nats:4222"
```

Same pattern - loads from `.env.brat`.

## Secret Flow: Local to Remote

### Local Development (unix:// socket)

**Workflow:**
1. `brat deploy --context local` runs on local machine
2. `EnvironmentResolver.resolve('local')` loads:
   - `env/local/global.yaml` - base config
   - `.secure.local/.env` - secrets (POSTGRES credentials, API keys)
3. `writeEnvFile()` generates `.env.brat` with merged variables
4. Docker Compose launches containers with `.env.brat`
5. Services receive secrets

**Directory Structure (Local Machine):**
```
.secure.local/
├── .env                    # POSTGRES_USER, POSTGRES_PASSWORD, OPENAI_API_KEY, etc.
├── gcp-credentials.json    # (optional)
└── .gitignore

.env.brat                   # Generated during deployment (merged from all sources)
```

### Remote Deployment (ssh:// target)

**Workflow:**
1. `brat deploy --context staging` runs on **local machine**
2. `EnvironmentResolver.resolve('staging')` loads **LOCAL** secrets:
   - `env/staging/global.yaml` - base config
   - `.secure.staging/.env` - secrets (from local machine)
3. `writeEnvFile()` generates `.env.brat` locally
4. `syncRemoteFiles()` syncs to remote host:
   - **Before Sprint 374 fix:** `.env.brat` only (missing secrets!)
   - **After Sprint 374 fix:** `.env.brat` + `.secure.staging/` directory
5. Remote Docker Compose launches containers with `.env.brat`
6. Services receive secrets

**Directory Structure (Remote Host - After Fix):**
```
/opt/BitBratPlatform/
├── .secure.staging/
│   ├── .env                # Synced from local machine
│   ├── .gitignore
│   └── .gitkeep
├── .env.brat               # Generated locally, synced to remote
└── infrastructure/docker-compose/
    └── docker-compose.staging.yaml
```

## Current Issue (Before Deployment)

**On Staging Host (Current State):**
```bash
$ ssh root@bitbrat.lan 'cat /opt/BitBratPlatform/.env.brat | grep POSTGRES'
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/bitbrat
POSTGRES_DB=bitbrat
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
# MISSING: POSTGRES_USER
# MISSING: POSTGRES_PASSWORD
```

**Why Missing:**
The last deployment ran BEFORE the Sprint 374 fix that syncs `.secure.staging/` directory. The deployment loaded from local `.secure.staging/.env`, but that directory wasn't synced to remote, so on the next deployment, the remote environment resolver couldn't find the secrets.

**PostgreSQL Container Behavior:**
```yaml
POSTGRES_USER=${POSTGRES_USER:-bitbrat}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-bitbrat_dev_password}
```

Since `POSTGRES_USER` and `POSTGRES_PASSWORD` are missing from `.env.brat`, Docker Compose uses the defaults:
- `POSTGRES_USER=bitbrat` (default)
- `POSTGRES_PASSWORD=bitbrat_dev_password` (default)

This happens to work because the defaults match the intended values! But it's not secure - the actual secrets from `.secure.staging/.env` should be used.

## Expected After Next Deployment (With Fix)

**After deploying with Sprint 374 fix:**

```bash
$ ssh root@bitbrat.lan 'cat /opt/BitBratPlatform/.env.brat | grep POSTGRES'
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/bitbrat
POSTGRES_DB=bitbrat
POSTGRES_HOST=postgres
POSTGRES_PASSWORD=bitbrat_dev_password
POSTGRES_PORT=5432
POSTGRES_USER=bitbrat
```

**Why Fixed:**
1. `.secure.staging/` directory synced to remote (includes `.env` file)
2. Future deployments can load from remote `.secure.staging/.env`
3. `.env.brat` generated with actual secrets
4. PostgreSQL receives correct credentials (no longer relying on defaults)

## Application Services

All application services follow the same pattern:

**Example: llm-bot**
```yaml
llm-bot:
  env_file:
    - ".env.brat"
  environment:
    OPENAI_API_KEY: "${OPENAI_API_KEY}"
    OPENAI_MODEL: "${OPENAI_MODEL}"
```

**Secret Sources:**
- `OPENAI_API_KEY` - from `.secure.{ENV}/.env`
- `OPENAI_MODEL` - from `env/{ENV}/llm-bot.yaml` or `env/{ENV}/global.yaml`

**Example: oauth-flow**
```yaml
oauth-flow:
  env_file:
    - ".env.brat"
  environment:
    TWITCH_CLIENT_ID: "${TWITCH_CLIENT_ID}"
    TWITCH_CLIENT_SECRET: "${TWITCH_CLIENT_SECRET}"
    DISCORD_CLIENT_ID: "${DISCORD_CLIENT_ID}"
    DISCORD_CLIENT_SECRET: "${DISCORD_CLIENT_SECRET}"
```

**Secret Sources:**
- `TWITCH_CLIENT_SECRET` - from `.secure.{ENV}/.env`
- `DISCORD_CLIENT_SECRET` - from `.secure.{ENV}/.env`
- Client IDs - from `.secure.{ENV}/.env` or `env/{ENV}/oauth-flow.yaml`

## Verification Checklist

### Pre-Deployment Verification

**Local Machine:**
```bash
# 1. Check .secure.staging/.env has required secrets
grep -E "^POSTGRES_|^OPENAI_|^TWITCH_|^DISCORD_" .secure.staging/.env

# Expected:
# POSTGRES_USER=bitbrat
# POSTGRES_PASSWORD=bitbrat_dev_password
# OPENAI_API_KEY=sk-proj-...
# TWITCH_CLIENT_ID=...
# TWITCH_CLIENT_SECRET=...
# DISCORD_CLIENT_SECRET=...

# 2. Check .secure.staging/ is a directory (not old file)
[ -d .secure.staging ] && echo "✓ Directory" || echo "✗ File"

# 3. Verify orchestrator will sync .secure.staging/
# (This is automatic with Sprint 374 fix)
```

### Post-Deployment Verification

**Remote Host:**
```bash
# 1. Verify .secure.staging/ directory synced
ssh root@bitbrat.lan 'ls -la /opt/BitBratPlatform/.secure.staging/'
# Expected: .env, .gitignore, .gitkeep

# 2. Verify .env.brat has secrets
ssh root@bitbrat.lan 'cat /opt/BitBratPlatform/.env.brat | grep -E "^POSTGRES_|^OPENAI_|^TWITCH_CLIENT_SECRET|^DISCORD_CLIENT_SECRET"'
# Expected: All secrets present

# 3. Verify PostgreSQL container has correct credentials
ssh root@bitbrat.lan 'docker exec bitbrat-staging-postgres-1 env | grep POSTGRES'
# Expected:
# POSTGRES_USER=bitbrat
# POSTGRES_PASSWORD=bitbrat_dev_password
# POSTGRES_DB=bitbrat

# 4. Test PostgreSQL connection with credentials
ssh root@bitbrat.lan 'docker exec bitbrat-staging-postgres-1 psql -U bitbrat -d bitbrat -c "SELECT 1"'
# Expected: Connection succeeds

# 5. Check application services have secrets
ssh root@bitbrat.lan 'docker exec bitbrat-staging-llm-bot-1 env | grep OPENAI_API_KEY'
# Expected: OPENAI_API_KEY=sk-proj-...
```

### Common Issues

**Issue 1: Secrets Missing After Deployment**
- **Cause:** `.secure.{ENV}/` directory not synced
- **Fix:** Ensure Sprint 374 fix is deployed (orchestrator.ts includes secureDir in filesToSync)

**Issue 2: PostgreSQL Uses Default Credentials**
- **Cause:** `POSTGRES_USER` and `POSTGRES_PASSWORD` missing from `.env.brat`
- **Fix:** Verify `.secure.{ENV}/.env` has these variables

**Issue 3: API Keys Are "local-*" Stubs**
- **Cause:** Loading from wrong environment (local instead of staging)
- **Fix:** Ensure `--context staging` flag is used in deployment command

**Issue 4: Old .secure.staging File Blocks Directory**
- **Cause:** Old file format exists, preventing directory creation
- **Fix:** Remove old file: `rm /opt/BitBratPlatform/.secure.staging`

## Security Best Practices

1. ✅ **Never commit `.env` files** - Protected by `.secure.*/.gitignore`
2. ✅ **Different credentials per environment** - Separate `.secure.{ENV}/` directories
3. ✅ **Use strong passwords** - Don't use defaults like `bitbrat_dev_password` in production
4. ✅ **Rotate secrets regularly** - Update `.secure.{ENV}/.env` and redeploy
5. ✅ **Audit access** - Limit who can access `.secure.{ENV}/.env` files
6. ✅ **Encrypt at rest** - Use encrypted filesystems for remote hosts

## See Also

- [Remote Sync Bugfix](./bugfix-remote-sync.md) - Fix for syncing `.secure.{ENV}/` directories
- [Backward Compatibility Bugfix](./bugfix-backward-compatibility.md) - Support for old file format
- [Final Directory Structure](./final-directory-structure.md) - Target directory layout
- [Phases 1-4 Completion Summary](./phases-1-4-completion-summary.md) - Sprint overview
