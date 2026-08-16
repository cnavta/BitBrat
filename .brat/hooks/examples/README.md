# Deployment Hook Examples

This directory contains example deployment hooks for common use cases.

**Sprint 15: Deployment Lifecycle Hooks**

## Available Examples

### Registry Authentication

- **`pre-deploy-docker-hub-auth.sh`** - Authenticate to Docker Hub using access tokens
- **`pre-deploy-aws-ecr-auth.sh`** - Authenticate to AWS Elastic Container Registry
- **`../staging/pre-deploy-gcp-auth.sh`** - Authenticate to Google Artifact Registry (production example)

### Post-Deployment Actions

- **`post-deploy-health-check.sh`** - Verify container health after deployment
- **`post-deploy-slack-notification.sh`** - Send deployment notifications to Slack

## Usage

1. **Copy** the example hook to your `.brat/hooks/{context}/` directory
2. **Customize** the hook for your environment
3. **Make executable**: `chmod +x .brat/hooks/{context}/your-hook.sh`
4. **Configure** in `architecture.yaml`:

```yaml
executionContexts:
  your-context:
    deployment:
      type: docker-compose
      docker:
        host: ssh://user@host
        remoteDir: /opt/deployment
        additionalSyncPaths:
          - .brat/hooks  # Required for remote deployments
      hooks:
        pre-deploy: .brat/hooks/your-context/your-hook.sh
```

5. **Store secrets** in `.secure.{context}/.env` (never commit!)

## Hook Types

| Hook Type | Execution Timing | Local/Remote | Can Abort? | Use Cases |
|-----------|------------------|--------------|------------|-----------|
| `pre-deploy` | Before deployment | Local | ✅ Yes | Registry auth, validation |
| `pre-build` | Before build | Local/Remote | ✅ Yes | Build-time auth, checks |
| `post-build` | After build | Local/Remote | ✅ Yes | Image scanning, tagging |
| `post-deploy` | After containers start | Local/Remote | ❌ No | Health checks, notifications |

## Environment Variables

All hooks receive these environment variables:

- `BRAT_CONTEXT_NAME` - Execution context (e.g., "staging")
- `BRAT_DEPLOYMENT_TYPE` - Deployment type (e.g., "docker-compose")
- `BRAT_SERVICES` - Space-separated service names
- `BRAT_REPO_ROOT` - Repository root directory
- `BRAT_TARGET_HOST` - Remote Docker host (if remote)
- `BRAT_REMOTE_DIR` - Remote deployment directory (if remote)

## Security Best Practices

1. **Never hardcode secrets** - Use environment variables from `.secure.{context}/.env`
2. **Use git-ignore** - `.secure.*` directories are already git-ignored
3. **Validate inputs** - Check required environment variables exist
4. **Use tokens, not passwords** - Prefer access tokens over passwords
5. **Set proper permissions** - Hooks must be executable: `chmod +x`
6. **Fail fast** - Use `set -e` and `set -u` for early error detection
7. **Log securely** - Don't log sensitive values

## Creating Custom Hooks

```bash
#!/bin/bash
set -e  # Exit on error
set -u  # Exit on undefined variable

log() {
  echo "[my-hook] $*"
}

log "Starting custom hook..."

# Your logic here
# - Check environment variables
# - Authenticate to services
# - Validate configuration
# - Send notifications

log "✓ Hook completed successfully"
exit 0
```

## Testing Hooks

Test hooks locally before deployment:

```bash
# Set environment variables
export BRAT_CONTEXT_NAME=staging
export BRAT_SERVICES="my-service"
export BRAT_DEPLOYMENT_TYPE=docker-compose

# Run hook
./.brat/hooks/staging/my-hook.sh
```

## Troubleshooting

**Hook not found:**
- Verify path is relative to repo root
- Check `additionalSyncPaths` includes `.brat/hooks`

**Hook not executable:**
- Run `chmod +x .brat/hooks/{context}/your-hook.sh`

**Environment variable missing:**
- Add to `.secure.{context}/.env`
- Check variable interpolation in `architecture.yaml`

**Hook fails on remote:**
- Verify `.brat/hooks` is synced to remote
- Check remote has required tools (gcloud, aws, docker, etc.)

## Documentation

See full documentation:
- `documentation/guides/deployment-hooks.md` - Complete guide
- `documentation/guides/hook-security-best-practices.md` - Security guidelines
- `documentation/guides/extending-bitbrat.md` - Extension patterns

## Support

For issues or questions, see:
- GitHub Issues: https://github.com/anthropics/bitbrat/issues
- Sprint Documentation: `planning/sprint-15-gpcvez/`
