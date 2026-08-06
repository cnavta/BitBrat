# Sprint 374: Final Directory Structure

## Overview

All secrets (environment variables + credential files) are stored in **`.secure.{ENV}/` directories**.

This unified approach keeps all environment-specific secrets in one directory, with the directory structure tracked in git but all actual secret content git-ignored.

## Directory Structure

```
.secure.local/               # Local development secrets
├── .gitignore              # Ignore all files except .gitignore/.gitkeep
├── .gitkeep                # Preserves empty directory in git
├── .env                    # Environment variables (API keys, tokens)
├── gcp-credentials.json    # GCP service account (mounted via secureFiles)
├── db-cert.pem             # Database SSL certificate
└── api-key.json            # API credentials

.secure.staging/             # Staging environment secrets
├── .gitignore
├── .gitkeep
├── .env                    # Staging API keys
├── gcp-credentials.json
└── db-cert.pem

.secure.prod/                # Production environment secrets
├── .gitignore
├── .gitkeep
├── .env                    # Production API keys
├── gcp-credentials.json
└── db-cert.pem
```

## File Purposes

### `.env` File (Environment Variables)

**Format:** `.env` format (KEY=value)
**Loaded by:** `EnvironmentResolver.loadSecureLocal()` in `tools/brat/src/orchestration/docker/environment-resolver.ts`
**Used for:** API keys, tokens, passwords that are injected as environment variables

**Example `.secure.local/.env`:**
```bash
# OpenAI
OPENAI_API_KEY=sk-proj-...

# MCP Authentication
MCP_AUTH_TOKEN=local-dev-mcp-token

# Twitch Integration
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...

# Discord Integration
DISCORD_BOT_TOKEN=...
```

**Loaded automatically:**
```bash
npm run local   # Loads .secure.local/.env
npm run brat -- deploy --context staging  # Loads .secure.staging/.env
```

### Credential Files (JSON, PEM, etc.)

**Format:** Any file format (JSON, PEM, binary, etc.)
**Mounted by:** `DockerComposeStrategy` and `CloudRunStrategy` via `secureFiles` configuration
**Used for:** Files that services read directly (GCP service accounts, SSL certificates, AWS credentials)

**Example `.secure.local/gcp-credentials.json`:**
```json
{
  "type": "service_account",
  "project_id": "my-project-dev",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...",
  "client_email": "service-account@my-project.iam.gserviceaccount.com"
}
```

**Mounted via architecture.yaml:**
```yaml
services:
  image-gen-mcp:
    secureFiles:
      - local: .secure.local/gcp-credentials.json
        target: /var/secrets/gcp-credentials.json
        env: GOOGLE_APPLICATION_CREDENTIALS
        context: local
```

## Git Ignore Configuration

### Root `.gitignore`

```gitignore
# Sprint 374: Secure file deployment
# All secrets (env vars + credential files) stored in .secure.{ENV}/ directories
# NEVER COMMIT ACTUAL CREDENTIALS - only directory structure allowed

# Block all .secure.* files and directories by default
.secure.local
.secure.local.*
.secure.*

# Allow specific directory structure (.gitignore/.gitkeep inside directories)
!.secure.local.example
!**/.secure.local.example
!.secure.local/
!.secure.staging/
!.secure.prod/
!.secure.*/.gitignore
!.secure.*/.gitkeep
```

### `.secure.{ENV}/.gitignore`

```gitignore
# Ignore all files in this directory (secure credentials)
*

# Allow structure files only
!.gitignore
!.gitkeep

# NOTE: .env file inside this directory is also ignored (contains API keys/tokens)
```

## Git Status Examples

**What's tracked:**
```bash
$ git status .secure.local/
Untracked files:
  .secure.local/   # Directory structure will be tracked

$ git add .secure.local/
$ git status .secure.local/
Changes to be committed:
  new file:   .secure.local/.gitignore
  new file:   .secure.local/.gitkeep
```

**What's ignored:**
```bash
$ git status .secure.local/.env
# No output (file is ignored)

$ git status .secure.local/gcp-credentials.json
# No output (file is ignored)

$ git check-ignore -v .secure.local/.env
.secure.local/.gitignore:2:*  .secure.local/.env
```

## Usage Patterns

### Pattern 1: Environment Variables Only

**Use case:** Service needs API keys but no credential files

**Setup:**
```bash
# Create .env file
cat > .secure.local/.env <<EOF
OPENAI_API_KEY=sk-proj-...
MCP_AUTH_TOKEN=local-dev-token
EOF
```

**No architecture.yaml changes needed** — EnvironmentResolver loads automatically

### Pattern 2: Credential Files Only

**Use case:** Service has credentials from environment but needs mounted files

**Setup:**
```bash
# Copy credential file
cp ~/Downloads/gcp-credentials.json .secure.local/
```

**Configure architecture.yaml:**
```yaml
services:
  my-service:
    secureFiles:
      - local: .secure.local/gcp-credentials.json
        target: /var/secrets/gcp-credentials.json
        env: GOOGLE_APPLICATION_CREDENTIALS
```

### Pattern 3: Both Environment Variables and Credential Files

**Use case:** Service needs both API keys and mounted files (most common)

**Setup:**
```bash
# 1. Create .env file with API keys
cat > .secure.local/.env <<EOF
OPENAI_API_KEY=sk-proj-...
EOF

# 2. Add credential files
cp ~/Downloads/gcp-credentials.json .secure.local/
cp ~/Downloads/db-cert.pem .secure.local/
```

**Configure architecture.yaml:**
```yaml
services:
  my-service:
    secrets:
      - OPENAI_API_KEY  # From .env
    secureFiles:
      - local: .secure.local/gcp-credentials.json
        target: /var/secrets/gcp-credentials.json
      - local: .secure.local/db-cert.pem
        target: /var/secrets/db-cert.pem
```

## Migration from Sprint 373 and Earlier

**Old structure (Sprint 373 and earlier):**
```
.secure.local                   # File with environment variables (root level)
.secure.staging                 # File with environment variables (root level)
```

**New structure (Sprint 374):**
```
.secure.local/                  # Directory
├── .env                        # Environment variables (inside directory)
├── gcp-credentials.json        # Credential files
└── ...
```

**Migration steps:**

1. **Create directories:**
   ```bash
   mkdir -p .secure.local .secure.staging .secure.prod
   ```

2. **Move environment variable files:**
   ```bash
   mv .secure.local .secure.local/.env
   mv .secure.staging .secure.staging/.env
   ```

3. **Add .gitignore and .gitkeep:**
   ```bash
   # Already created by Sprint 374 setup
   ls .secure.local/.gitignore .secure.local/.gitkeep
   ```

4. **Verify git status:**
   ```bash
   git status .secure.local/
   # Should show untracked directory (will track structure only)

   git status .secure.local/.env
   # Should show nothing (ignored)
   ```

## Benefits of Unified Structure

### 1. Single Source of Truth
All secrets for an environment in one directory (`/secure.{ENV}/`)

### 2. Consistent Git Ignore
One `.gitignore` pattern handles both .env and credential files

### 3. Easier Context Switching
```bash
# All local secrets in .secure.local/
npm run local

# All staging secrets in .secure.staging/
npm run brat -- deploy --context staging
```

### 4. Clear Migration Path
Moving from local → staging → prod is just copying the directory

### 5. Discoverable
New developers see all required secrets in one directory structure

## Security Notes

### ✅ Safe to Commit
- `.secure.{ENV}/.gitignore`
- `.secure.{ENV}/.gitkeep`

### ❌ NEVER Commit
- `.secure.{ENV}/.env`
- `.secure.{ENV}/*.json`
- `.secure.{ENV}/*.pem`
- Any other files in `.secure.{ENV}/`

### Validation
Pre-deployment validation ensures secrets are git-ignored:
```bash
npm run brat -- deploy service my-service --context local
# [validator] Checking git-ignore status for .secure.local/gcp-credentials.json
# [validator] ✓ File is git-ignored
```

## See Also

- [Secure File Deployment Guide](../../documentation/guides/secure-file-deployment.md)
- [CLAUDE.md - Deploying Secure Files](../../CLAUDE.md#deploying-secure-files-sprint-374)
- [Sprint 374 Technical Architecture](./technical-architecture.md)
