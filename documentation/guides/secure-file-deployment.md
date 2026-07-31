# Secure File Deployment Guide

**Sprint 374** | Platform-agnostic secure file deployment for Bits

## Overview

The secure file deployment feature enables declarative deployment of credentials, certificates, and other sensitive files across all BitBrat deployment platforms (Docker Compose local/remote, Cloud Run) **without committing secrets to version control**.

**All secrets are centralized in `.secure.{ENV}/` directories:**
- **`.secure.{ENV}/.env`** — Environment variables (API keys, tokens, passwords)
- **`.secure.{ENV}/*.json`** — Credential files (GCP service accounts, AWS credentials)
- **`.secure.{ENV}/*.pem`** — Certificates and SSL keys

This unified approach keeps all environment-specific secrets in one place, with only the directory structure (.gitignore/.gitkeep) tracked in git.

**Key Features:**
- **Git-ignore validation** prevents accidental secret commits
- **Platform-agnostic** works identically on Docker (local/remote) and Cloud Run
- **Automatic mounting** based on execution context
- **Type-safe configuration** with Zod validation
- **Read-only by default** enforces security best practices (0400 permissions)

## Quick Start

### 1. Add Credential File

```bash
# Create or copy your credential file
cp ~/Downloads/gcp-service-account.json .secure.local/gcp-credentials.json

# Verify it's git-ignored
git status .secure.local/gcp-credentials.json
# Should output nothing (file is ignored)
```

### 2. Configure in architecture.yaml

```yaml
services:
  your-service:
    secureFiles:
      - local: .secure.local/gcp-credentials.json
        target: /var/secrets/gcp-credentials.json
        env: GOOGLE_APPLICATION_CREDENTIALS
        permissions: "0400"
        required: false
        context: local
```

### 3. Deploy

```bash
npm run brat -- deploy service your-service --context local
```

The deployment strategy automatically:
1. Validates the file is git-ignored
2. Mounts it at `/var/secrets/gcp-credentials.json` inside the container
3. Sets `GOOGLE_APPLICATION_CREDENTIALS=/var/secrets/gcp-credentials.json`

## Configuration Reference

### SecureFile Schema

```typescript
interface SecureFile {
  local: string;          // Source path (relative to repo root)
  target: string;         // Destination path (must be /var/secrets/* or /run/secrets/*)
  env?: string;           // Environment variable to set
  permissions?: string;   // File permissions (default: "0400")
  required?: boolean;     // Fail if missing (default: true)
  context?: string;       // Only deploy in this context (e.g., "local", "staging")
}
```

### Property Details

#### `local` (required)

**Source file path relative to repository root.**

- Must be git-ignored (validator checks `.gitignore` patterns)
- Typical directories:
  - `.secure.local/` — Local development credentials
  - `.secure.staging/` — Staging environment credentials
  - `.secure.prod/` — Production credentials (prefer cloud-native secrets for prod)

**Examples:**
```yaml
local: .secure.local/gcp-credentials.json
local: .secure.staging/db-cert.pem
local: .secure.prod/api-key.json
```

#### `target` (required)

**Destination path inside container.**

- **MUST** be under `/var/secrets/` or `/run/secrets/` (security constraint)
- Validator rejects paths with `../`, `~/`, or outside allowed directories
- File will be mounted read-only (`:ro` flag for Docker, immutable for Secret Manager)

**Examples:**
```yaml
target: /var/secrets/gcp-credentials.json
target: /run/secrets/db-cert.pem
target: /var/secrets/api-key.json
```

#### `env` (optional)

**Environment variable to set pointing to the target path.**

- Common use case: `GOOGLE_APPLICATION_CREDENTIALS`, `AWS_SHARED_CREDENTIALS_FILE`
- Automatically injected during deployment
- Service can read file using `process.env[env]`

**Examples:**
```yaml
env: GOOGLE_APPLICATION_CREDENTIALS
env: DB_CERT_PATH
env: SSL_CERTIFICATE_FILE
```

#### `permissions` (optional, default: `"0400"`)

**File permissions in octal string format.**

- **Default:** `"0400"` (owner read-only, most secure)
- Must match regex: `/^0[0-7]{3}$/`
- Validator warns if world-readable (`0004`) or group-readable (`0040`)

**Common values:**
```yaml
permissions: "0400"  # Read-only for owner (recommended)
permissions: "0440"  # Read-only for owner and group
permissions: "0600"  # Read-write for owner only
```

#### `required` (optional, default: `true`)

**Fail deployment if file is missing.**

- `true`: Deployment aborts if file doesn't exist (recommended for production)
- `false`: Deployment continues with warning (useful for optional credentials)

**Examples:**
```yaml
required: true   # Abort if missing
required: false  # Warn but continue
```

#### `context` (optional)

**Only deploy file in specific execution context.**

- Filters files based on `--context` flag passed to `brat deploy`
- Allows different credentials per environment in same service definition

**Examples:**
```yaml
context: local     # Only when --context local
context: staging   # Only when --context staging
context: prod      # Only when --context prod
```

## Multi-Environment Example

```yaml
services:
  image-gen-mcp:
    secureFiles:
      # Local development (optional - filesystem storage works without GCP)
      - local: .secure.local/gcp-credentials.json
        target: /var/secrets/gcp-credentials.json
        env: GOOGLE_APPLICATION_CREDENTIALS
        permissions: "0400"
        required: false
        context: local

      # Staging deployment (required - uses GCS)
      - local: .secure.staging/gcp-credentials.json
        target: /var/secrets/gcp-credentials.json
        env: GOOGLE_APPLICATION_CREDENTIALS
        permissions: "0400"
        required: true
        context: staging

      # Production deployment (required - uses GCS)
      - local: .secure.prod/gcp-credentials.json
        target: /var/secrets/gcp-credentials.json
        env: GOOGLE_APPLICATION_CREDENTIALS
        permissions: "0400"
        required: true
        context: prod
```

**Deploy to different environments:**
```bash
npm run brat -- deploy service image-gen-mcp --context local     # Uses .secure.local/
npm run brat -- deploy service image-gen-mcp --context staging   # Uses .secure.staging/
npm run brat -- deploy service image-gen-mcp --context prod      # Uses .secure.prod/
```

## Platform-Specific Behavior

### Docker Compose (Local)

**Mechanism:** Direct volume mount

**Process:**
1. Validator checks file is git-ignored and exists
2. Generate volume mount: `${repoRoot}/${local}:${target}:ro`
3. Inject into docker-compose.yaml:
   ```yaml
   volumes:
     - /Users/user/BitBratPlatform/.secure.local/gcp-credentials.json:/var/secrets/gcp-credentials.json:ro
   environment:
     - GOOGLE_APPLICATION_CREDENTIALS=/var/secrets/gcp-credentials.json
   ```
4. Deploy with `docker-compose up`

**Advantages:**
- Instant (no file transfer)
- Changes to local file reflected immediately (hot reload)

**Limitations:**
- Local file must exist at deployment time
- Host path exposed in compose file

### Docker Compose (Remote via SSH)

**Mechanism:** SCP transfer + volume mount

**Process:**
1. Validator checks file is git-ignored and exists locally
2. Transfer file via SCP:
   ```bash
   ssh user@host mkdir -p /opt/BitBratPlatform/.secure
   scp .secure.staging/gcp-credentials.json user@host:/opt/BitBratPlatform/.secure/
   ssh user@host chmod 400 /opt/BitBratPlatform/.secure/gcp-credentials.json
   ```
3. Generate volume mount using remote path:
   ```yaml
   volumes:
     - /opt/BitBratPlatform/.secure/gcp-credentials.json:/var/secrets/gcp-credentials.json:ro
   ```
4. Deploy with `docker-compose up` on remote host

**Advantages:**
- Automatic transfer (no manual scp required)
- Retry logic with exponential backoff (3 attempts)
- Secure permissions enforced (chmod 400)

**Limitations:**
- Requires SSH access with key-based auth
- Network latency for file transfer
- Remote file persists after deployment

### Cloud Run (GCP Secret Manager)

**Mechanism:** Upload to Secret Manager + mount as file

**Process:**
1. Validator checks file is git-ignored and exists
2. Derive secret name: `bitbrat-<context>-<filename-without-extension>`
   - Example: `bitbrat-staging-gcp-credentials`
3. Check if secret exists:
   ```bash
   gcloud secrets describe bitbrat-staging-gcp-credentials --project my-project
   ```
4. Create secret if missing:
   ```bash
   gcloud secrets create bitbrat-staging-gcp-credentials \
     --project my-project \
     --replication-policy automatic
   ```
5. Upload file content as new version:
   ```bash
   gcloud secrets versions add bitbrat-staging-gcp-credentials \
     --project my-project \
     --data-file .secure.staging/gcp-credentials.json
   ```
6. Generate Cloud Build substitution:
   ```yaml
   _SECRET_FILE_MOUNTS: "/var/secrets/gcp-credentials.json=bitbrat-staging-gcp-credentials:latest"
   _ENV_VARS_ARG: "GOOGLE_APPLICATION_CREDENTIALS=/var/secrets/gcp-credentials.json"
   ```
7. Cloud Run mounts secret as file at deploy time

**Advantages:**
- Centralized secret management (GCP console UI)
- Automatic versioning (every upload creates new version)
- No files on Cloud Run container filesystem (mounted at runtime)
- IAM-based access control

**Limitations:**
- Requires GCP Secret Manager API enabled
- Quota limits (1000 secrets per project, 64KB per secret)
- Upload on every deployment (no checksum caching yet)

## Validation

### Git-Ignore Check

**Purpose:** Prevent accidental commits of credentials

**Mechanism:**
```bash
git check-ignore --quiet .secure.local/gcp-credentials.json
# Exit code 0 = ignored, 1 = not ignored
```

**Error if not git-ignored:**
```
Secure file validation failed:
  - File is not git-ignored: .secure.local/gcp-credentials.json
    Please add to .gitignore before deployment.
```

**Fix:**
```bash
# Ensure .gitignore includes:
.secure.*
!.secure.*/.gitkeep
!.secure.*/.gitignore
```

### Target Path Check

**Purpose:** Enforce security best practices (only allow secure directories)

**Allowed paths:**
- `/var/secrets/*`
- `/run/secrets/*`

**Blocked patterns:**
- `../` (path traversal)
- `~/` (user home directory)
- Paths outside allowed directories

**Error if invalid path:**
```
Secure file validation failed:
  - Invalid target path: /tmp/credentials.json
    Target must be under /var/secrets/ or /run/secrets/
```

### Permissions Format Check

**Purpose:** Ensure permissions are valid octal strings

**Valid format:** `/^0[0-7]{3}$/`

**Examples:**
- ✅ `"0400"` — Valid
- ✅ `"0600"` — Valid
- ❌ `"400"` — Invalid (missing leading zero)
- ❌ `"0999"` — Invalid (9 is not octal)

**Error if invalid:**
```
Secure file validation failed:
  - Invalid permissions format: 400
    Must be octal string matching /^0[0-7]{3}$/ (e.g., "0400")
```

### File Existence Check

**Purpose:** Fail early if required file is missing

**Behavior:**
- `required: true` (default) → Deployment aborts with error
- `required: false` → Warning logged, deployment continues

**Error if missing (required=true):**
```
Secure file validation failed:
  - Required file not found: .secure.local/gcp-credentials.json
```

**Warning if missing (required=false):**
```
[WARNING] Optional secure file not found: .secure.local/gcp-credentials.json
Deployment will continue without this file.
```

## Troubleshooting

### Error: "File is not git-ignored"

**Cause:** The file is tracked by git or not excluded in `.gitignore`

**Solution:**
```bash
# 1. Verify .gitignore includes .secure.* pattern
grep "\.secure\.\*" .gitignore

# 2. Test git-ignore status
git check-ignore -v .secure.local/gcp-credentials.json
# Should output: .gitignore:22:.secure.*  .secure.local/gcp-credentials.json

# 3. If file is already tracked, remove from git
git rm --cached .secure.local/gcp-credentials.json
git commit -m "Remove tracked credential file"
```

### Error: "Invalid target path"

**Cause:** Target path is outside `/var/secrets/` or `/run/secrets/`

**Solution:**
```yaml
# ❌ Bad - outside allowed directories
target: /tmp/credentials.json
target: /app/secrets/credentials.json

# ✅ Good - inside allowed directories
target: /var/secrets/credentials.json
target: /run/secrets/credentials.json
```

### Error: "Required file not found"

**Cause:** File doesn't exist at specified `local` path

**Solution:**
```bash
# 1. Check file exists
ls -la .secure.local/gcp-credentials.json

# 2. If missing, download or copy file
cp ~/Downloads/gcp-credentials.json .secure.local/

# 3. Or make file optional
secureFiles:
  - local: .secure.local/gcp-credentials.json
    target: /var/secrets/gcp-credentials.json
    required: false  # Don't fail if missing
```

### Error: "SCP transfer failed" (Remote Docker)

**Cause:** SSH connection issues or permissions

**Solution:**
```bash
# 1. Test SSH connection
ssh root@bitbrat.lan "echo OK"

# 2. Verify SSH key-based auth is configured
ssh-add -L  # Should show your key

# 3. Test manual SCP
scp .secure.staging/gcp-credentials.json root@bitbrat.lan:/tmp/test.json

# 4. Check remote directory exists and is writable
ssh root@bitbrat.lan "mkdir -p /opt/BitBratPlatform/.secure && ls -ld /opt/BitBratPlatform/.secure"
```

### Error: "gcloud secrets create failed" (Cloud Run)

**Cause:** Secret Manager API not enabled or insufficient permissions

**Solution:**
```bash
# 1. Enable Secret Manager API
gcloud services enable secretmanager.googleapis.com --project my-project

# 2. Verify IAM permissions
gcloud projects get-iam-policy my-project --flatten="bindings[].members" --format="table(bindings.role)" --filter="bindings.members:user:your-email@example.com"
# Should include: roles/secretmanager.admin or roles/secretmanager.secretAccessor

# 3. Test manual secret creation
gcloud secrets create test-secret --project my-project --replication-policy automatic
```

## Security Best Practices

### 1. Never Commit Secrets

**❌ NEVER:**
```bash
git add .secure.local/gcp-credentials.json  # BAD!
git commit -m "Add credentials"             # VERY BAD!
```

**✅ ALWAYS:**
```bash
# Verify git-ignore before committing anything
git status .secure.local/
# Should show nothing (ignored)

# Use validator in CI
npm run brat -- deploy service my-service --context local --dry-run
# Validator will abort if secrets not git-ignored
```

### 2. Use Minimal Permissions

**❌ Avoid:**
```yaml
permissions: "0644"  # World-readable (BAD)
permissions: "0777"  # World-writable (VERY BAD)
```

**✅ Recommended:**
```yaml
permissions: "0400"  # Owner read-only (BEST)
permissions: "0440"  # Owner + group read-only (OK if needed)
```

### 3. Rotate Credentials Regularly

```bash
# 1. Download new credential file
cp ~/Downloads/new-gcp-credentials.json .secure.staging/gcp-credentials.json

# 2. Redeploy service (automatically uploads new version)
npm run brat -- deploy service image-gen-mcp --context staging

# 3. Verify service uses new credentials
npm run brat -- fleet health image-gen-mcp --context staging
```

### 4. Use Context-Specific Files

**❌ Single file for all environments:**
```yaml
secureFiles:
  - local: .secure.local/gcp-credentials.json  # Used in all contexts (BAD)
    target: /var/secrets/gcp-credentials.json
```

**✅ Separate files per environment:**
```yaml
secureFiles:
  - local: .secure.local/gcp-credentials.json
    target: /var/secrets/gcp-credentials.json
    context: local
  - local: .secure.staging/gcp-credentials.json
    target: /var/secrets/gcp-credentials.json
    context: staging
  - local: .secure.prod/gcp-credentials.json
    target: /var/secrets/gcp-credentials.json
    context: prod
```

### 5. Mark Production Credentials as Required

```yaml
secureFiles:
  - local: .secure.local/gcp-credentials.json
    required: false  # Optional in local dev
    context: local
  - local: .secure.prod/gcp-credentials.json
    required: true   # MUST exist for production
    context: prod
```

## Migration from Manual Credentials

### Before (Manual GOOGLE_APPLICATION_CREDENTIALS)

```yaml
# architecture.yaml
services:
  image-gen-mcp:
    secrets:
      - GOOGLE_APPLICATION_CREDENTIALS  # Path to credentials (manual setup)
```

```bash
# Manual deployment steps
# 1. SCP credentials to remote host
scp gcp-credentials.json root@bitbrat.lan:/opt/credentials/

# 2. Manually set env var in docker-compose.yaml
environment:
  - GOOGLE_APPLICATION_CREDENTIALS=/opt/credentials/gcp-credentials.json

# 3. Manually add volume mount
volumes:
  - /opt/credentials/gcp-credentials.json:/opt/credentials/gcp-credentials.json
```

### After (Automated Secure Files)

```yaml
# architecture.yaml
services:
  image-gen-mcp:
    secureFiles:
      - local: .secure.staging/gcp-credentials.json
        target: /var/secrets/gcp-credentials.json
        env: GOOGLE_APPLICATION_CREDENTIALS
        context: staging
```

```bash
# Automated deployment (one command)
npm run brat -- deploy service image-gen-mcp --context staging
# Automatically: validates, transfers, sets permissions, mounts, sets env var
```

**Migration Steps:**

1. **Copy credentials to .secure.* directory:**
   ```bash
   cp /opt/credentials/gcp-credentials.json .secure.staging/gcp-credentials.json
   ```

2. **Update architecture.yaml** (add `secureFiles`, remove manual instructions)

3. **Test deployment:**
   ```bash
   npm run brat -- deploy service image-gen-mcp --context staging --dry-run
   # Verify validation passes
   ```

4. **Deploy:**
   ```bash
   npm run brat -- deploy service image-gen-mcp --context staging
   ```

5. **Verify service functionality:**
   ```bash
   npm run brat -- fleet health image-gen-mcp --context staging
   ```

## See Also

- [CLAUDE.md - Deploying Secure Files](../../CLAUDE.md#deploying-secure-files-sprint-374) — Quick reference
- [Architecture YAML Schema](../../architecture.yaml) — See `image-gen-mcp` for working example
- [Sprint 374 Technical Architecture](../../planning/sprint-374-secure-file-deployment/technical-architecture.md) — Design decisions
