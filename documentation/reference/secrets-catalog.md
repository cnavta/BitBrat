# Secrets Catalog

Complete reference for all secrets used in the BitBrat Platform. This catalog documents every secret, its purpose, source, and which services depend on it.

**Status**: Current (Sprint 8+)
**Last Updated**: 2026-08-10
**Replaces**: `architecture.yaml` → `conventions.secrets.catalog`

---

## Overview

BitBrat uses various secrets for external service integrations, API authentication, and secure communications between services. All secrets are managed through platform-specific secret management systems and NEVER committed to git.

### Secret Management by Environment

| Environment | Secret Source | Configuration File | Notes |
|-------------|---------------|-------------------|-------|
| **Local** | `.env` files | `.secure.local/.env` | Git-ignored, developer-specific |
| **Staging** | Google Secret Manager | `.secure.staging/.env` (references) | GCP Project: bitbrat-staging |
| **Production** | Google Secret Manager | `.secure.prod/.env` (references) | GCP Project: bitbrat-prod |

**Critical**: The `.secure.{environment}/` directories are git-ignored. Only `.env.example` files are tracked in git.

---

## Quick Reference

| Secret | Category | Required By | Production Required |
|--------|----------|-------------|---------------------|
| `MCP_AUTH_TOKEN` | Platform | 10 services | ✅ Yes |
| `OPENAI_API_KEY` | LLM | 3 services | ✅ Yes |
| `TWITCH_CLIENT_ID` | Chat Platform | 3 services | ⚠️ Optional |
| `TWITCH_CLIENT_SECRET` | Chat Platform | 3 services | ⚠️ Optional |
| `OAUTH_STATE_SECRET` | OAuth | 1 service | ⚠️ Optional |
| `DISCORD_CLIENT_ID` | Chat Platform | 1 service | ⚠️ Optional |
| `DISCORD_CLIENT_SECRET` | Chat Platform | 1 service | ⚠️ Optional |
| `DISCORD_BOT_TOKEN` | Chat Platform | 1 service | ⚠️ Optional |
| `TWILIO_ACCOUNT_SID` | Chat Platform | 1 service | ⚠️ Optional |
| `TWILIO_AUTH_TOKEN` | Chat Platform | 1 service | ⚠️ Optional |
| `TWILIO_API_KEY` | Chat Platform | 1 service | ⚠️ Optional |
| `TWILIO_API_SECRET` | Chat Platform | 1 service | ⚠️ Optional |
| `TWILIO_CHAT_SERVICE_SID` | Chat Platform | 1 service | ⚠️ Optional |
| `OBS_WEBSOCKET_PASSWORD` | Integration | 1 service | ❌ Optional |

---

## Platform Secrets

### MCP_AUTH_TOKEN

**Description**: Bearer token authorizing service-to-MCP-gateway (tool-gateway) calls.

**Source**: Google Secret Manager (staging, production) | `.env` (local)

**Used By**:
- `auth`
- `event-router`
- `obs-mcp`
- `scheduler`
- `state-engine`
- `disposition-service`
- `tool-gateway`
- `image-gen-mcp`
- `stream-analyst-service`
- `story-engine-mcp`

**Purpose**: Secures the MCP (Model Context Protocol) control plane. Services use this token to authenticate requests to the tool-gateway, which proxies and secures all MCP tool invocations.

**Required**: ✅ **Yes** (production) | ⚠️ **Optional** (local dev)

**Generation**:
```bash
# Generate a secure random token (256-bit)
openssl rand -hex 32

# Example output:
# 7f8d9c1e2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d
```

**Rotation**: Rotate every 90 days or immediately if compromised.

**Troubleshooting**:
- **Error**: `MCP authentication failed: Invalid token`
  - **Cause**: Token mismatch between services
  - **Solution**: Ensure all services use the same `MCP_AUTH_TOKEN` value

- **Error**: `MCP_AUTH_TOKEN not found`
  - **Cause**: Secret not loaded from Secret Manager or `.env`
  - **Solution**: Check `.secure.local/.env` (local) or GCP Secret Manager (production)

---

## LLM Secrets

### OPENAI_API_KEY

**Description**: OpenAI API key for LLM analysis and image generation.

**Source**: Google Secret Manager (staging, production) | `.env` (local)

**Used By**:
- `query-analyzer` (fast pre-analysis of events)
- `llm-bot` (headless LLM worker for bot responses)
- `image-gen-mcp` (DALL-E 3 image generation)

**Purpose**: Authenticates API calls to OpenAI for GPT-4 chat completions and DALL-E 3 image generation.

**Required**: ✅ **Yes** (if using OpenAI LLM provider)

**Format**: `sk-proj-...` (Project API key) or `sk-...` (Legacy API key)

**Acquisition**:
1. Create an OpenAI account at https://platform.openai.com
2. Navigate to API Keys section
3. Generate a new **Project API key** (recommended) or use account-level key
4. Restrict key to specific projects (recommended)

**Rate Limits**:
- **GPT-4**: Varies by tier (see https://platform.openai.com/docs/guides/rate-limits)
- **DALL-E 3**: 50 requests/minute (free tier), higher for paid tiers

**Cost Control**:
- Set usage limits in OpenAI dashboard
- Monitor usage via OpenAI API dashboard
- Configure `OPENAI_MAX_RETRIES` and `OPENAI_TIMEOUT_MS` to prevent runaway costs

**Rotation**: Rotate every 180 days or immediately if exposed.

**Troubleshooting**:
- **Error**: `OpenAI API key invalid`
  - **Cause**: Invalid or expired API key
  - **Solution**: Generate new key in OpenAI dashboard

- **Error**: `Rate limit exceeded`
  - **Cause**: Too many requests in short time period
  - **Solution**: Reduce request rate or upgrade OpenAI tier

---

## Chat Platform Secrets

### Twitch Integration

#### TWITCH_CLIENT_ID

**Description**: Twitch application client ID for OAuth and EventSub/IRC.

**Source**: Google Secret Manager (staging, production) | `.env` (local)

**Used By**:
- `oauth-flow` (Twitch OAuth2 authentication)
- `ingress-egress` (Twitch EventSub and IRC connection)
- `auth` (Twitch user authentication)

**Purpose**: Identifies the BitBrat application to Twitch API. Required for EventSub webhooks and IRC chat integration.

**Required**: ⚠️ **Optional** (only if Twitch integration enabled)

**Acquisition**:
1. Create a Twitch application at https://dev.twitch.tv/console
2. Note the **Client ID**
3. Add redirect URIs: `https://your-domain.com/oauth/twitch/callback`

**Format**: Alphanumeric string (e.g., `abc123xyz456`)

---

#### TWITCH_CLIENT_SECRET

**Description**: Twitch application client secret (pairs with TWITCH_CLIENT_ID).

**Source**: Google Secret Manager (staging, production) | `.env` (local)

**Used By**:
- `oauth-flow` (OAuth token exchange)
- `ingress-egress` (App Access Token generation)
- `auth` (Token validation)

**Purpose**: Authenticates OAuth token exchange and App Access Token generation for EventSub and IRC.

**Required**: ⚠️ **Optional** (only if Twitch integration enabled)

**Rotation**: Rotate every 90 days via Twitch console.

**Security**: NEVER expose in client-side code or logs.

---

### Discord Integration

#### DISCORD_CLIENT_ID

**Description**: Discord application client ID (user-level OAuth, optional/future).

**Source**: Google Secret Manager (staging, production) | `.env` (local)

**Used By**:
- `oauth-flow` (Discord OAuth2 authentication)

**Purpose**: Enables user-level OAuth for Discord. Currently used for future OAuth flow implementation.

**Required**: ❌ **No** (future feature)

**Acquisition**:
1. Create a Discord application at https://discord.com/developers/applications
2. Note the **Client ID** (also called Application ID)
3. Add redirect URIs in OAuth2 settings

---

#### DISCORD_CLIENT_SECRET

**Description**: Discord application client secret.

**Source**: Google Secret Manager (staging, production) | `.env` (local)

**Used By**:
- `oauth-flow` (OAuth token exchange)

**Purpose**: Authenticates OAuth token exchange for Discord user authentication.

**Required**: ❌ **No** (future feature)

**Rotation**: Rotate via Discord Developer Portal (Reset Secret button).

---

#### DISCORD_BOT_TOKEN

**Description**: Discord bot token used by the ingress-egress Discord connection.

**Source**: Google Secret Manager (staging, production) | `.env` (local)

**Used By**:
- `ingress-egress` (Discord Gateway connection)

**Purpose**: Authenticates the BitBrat bot to Discord Gateway for receiving and sending messages.

**Required**: ⚠️ **Optional** (only if Discord integration enabled)

**Acquisition**:
1. Create a Discord bot at https://discord.com/developers/applications
2. Navigate to Bot section
3. Click "Reset Token" to reveal token (one-time display)
4. Enable necessary Intents (Message Content, Guild Messages)

**Format**: `MTA...` (long alphanumeric string)

**Security**:
- NEVER commit to git
- Regenerate immediately if exposed
- Use Privileged Gateway Intents only if necessary

**Permissions Required**:
- Read Messages/View Channels
- Send Messages
- Embed Links
- Attach Files

---

### Twilio Integration

#### TWILIO_ACCOUNT_SID

**Description**: Twilio account SID for Conversations integration.

**Source**: Google Secret Manager (staging, production) | `.env` (local)

**Used By**:
- `ingress-egress` (Twilio Conversations SDK initialization)

**Purpose**: Identifies the Twilio account for Conversations API access.

**Required**: ⚠️ **Optional** (only if Twilio integration enabled)

**Format**: `AC...` (34-character alphanumeric string)

**Acquisition**: Found in Twilio Console dashboard

---

#### TWILIO_AUTH_TOKEN

**Description**: Twilio auth token (webhook validation + REST calls).

**Source**: Google Secret Manager (staging, production) | `.env` (local)

**Used By**:
- `ingress-egress` (Twilio webhook signature validation, REST API calls)

**Purpose**:
1. Validates webhook signatures (security)
2. Authenticates REST API calls to Twilio

**Required**: ⚠️ **Optional** (only if Twilio integration enabled)

**Security**: Primary secret for Twilio account. Rotate immediately if exposed.

---

#### TWILIO_API_KEY

**Description**: Twilio API key SID for scoped REST access.

**Source**: Google Secret Manager (staging, production) | `.env` (local)

**Used By**:
- `ingress-egress` (Scoped API access)

**Purpose**: Provides scoped access to Twilio REST API (more secure than using main auth token).

**Required**: ⚠️ **Optional** (recommended over TWILIO_AUTH_TOKEN for API calls)

**Format**: `SK...` (34-character alphanumeric string)

**Acquisition**: Create API Key in Twilio Console → Account → API Keys

**Best Practice**: Use API keys instead of main auth token for all API calls.

---

#### TWILIO_API_SECRET

**Description**: Twilio API key secret (pairs with TWILIO_API_KEY).

**Source**: Google Secret Manager (staging, production) | `.env` (local)

**Used By**:
- `ingress-egress` (API key authentication)

**Purpose**: Authenticates API calls when using TWILIO_API_KEY.

**Required**: ⚠️ **Optional** (required if using TWILIO_API_KEY)

**Security**: Shown only once during API key creation. Store securely immediately.

---

#### TWILIO_CHAT_SERVICE_SID

**Description**: Twilio Conversations service SID.

**Source**: Google Secret Manager (staging, production) | `.env` (local)

**Used By**:
- `ingress-egress` (Conversations service initialization)

**Purpose**: Identifies the Twilio Conversations service instance.

**Required**: ⚠️ **Optional** (only if Twilio Conversations integration enabled)

**Format**: `IS...` (34-character alphanumeric string)

**Acquisition**:
1. Navigate to Twilio Console → Conversations → Services
2. Create a new service or use existing
3. Note the Service SID

---

## OAuth Secrets

### OAUTH_STATE_SECRET

**Description**: HMAC secret protecting the OAuth state parameter against CSRF/replay attacks.

**Source**: Google Secret Manager (staging, production) | `.env` (local)

**Used By**:
- `oauth-flow` (OAuth state generation and validation)

**Purpose**: Signs OAuth state parameter to prevent CSRF and replay attacks during OAuth flows.

**Required**: ⚠️ **Optional** (only if OAuth flow enabled)

**Generation**:
```bash
# Generate a secure random secret (256-bit)
openssl rand -base64 32
```

**Security**:
- Unique per environment (local, staging, production)
- Rotate every 90 days
- Critical for OAuth security (prevents account takeover)

**How It Works**:
1. User initiates OAuth flow
2. `oauth-flow` generates state = HMAC(OAUTH_STATE_SECRET, nonce)
3. After OAuth callback, state is validated
4. Invalid state = reject request (CSRF attack)

---

## Integration Secrets

### OBS_WEBSOCKET_PASSWORD

**Description**: Password for the OBS WebSocket control connection.

**Source**: Google Secret Manager (staging, production) | `.env` (local)

**Used By**:
- `obs-mcp` (OBS WebSocket client authentication)

**Purpose**: Authenticates to OBS WebSocket server for scene control, source management, and streaming control.

**Required**: ❌ **Optional** (only if OBS integration enabled)

**Configuration**:
1. In OBS Studio: Tools → WebSocket Server Settings
2. Enable WebSocket Server
3. Set Server Password
4. Note the password (used as `OBS_WEBSOCKET_PASSWORD`)

**Port**: Default 4455 (configurable via `OBS_WEBSOCKET_URL`)

**Security**:
- OBS typically runs locally (not exposed to internet)
- Use firewall to restrict access if OBS is on remote machine
- Rotate password if OBS machine is compromised

---

## Secret Management Workflows

### Local Development

**Setup**:
1. Copy `.env.example` to `.secure.local/.env`
   ```bash
   cp .env.example .secure.local/.env
   ```

2. Edit `.secure.local/.env` and add secrets:
   ```bash
   # Platform Secrets
   MCP_AUTH_TOKEN=your-local-dev-token-here

   # LLM Secrets (required if using OpenAI)
   OPENAI_API_KEY=sk-proj-...

   # Chat Platform Secrets (optional)
   TWITCH_CLIENT_ID=abc123
   TWITCH_CLIENT_SECRET=xyz789
   # ... etc
   ```

3. Verify secrets loaded:
   ```bash
   npm run brat -- config show --filter secrets
   ```

**Security**:
- `.secure.local/` is git-ignored (NEVER commit)
- Use developer-specific secrets (not production secrets)
- Rotate secrets if shared accidentally

---

### Staging Deployment

**Setup**:
1. Create secrets in Google Secret Manager (bitbrat-staging project):
   ```bash
   # Example: Create MCP_AUTH_TOKEN secret
   echo -n "your-staging-token" | gcloud secrets create MCP_AUTH_TOKEN \
     --project=bitbrat-staging \
     --replication-policy=automatic \
     --data-file=-
   ```

2. Grant access to Cloud Run service account:
   ```bash
   gcloud secrets add-iam-policy-binding MCP_AUTH_TOKEN \
     --project=bitbrat-staging \
     --member="serviceAccount:bitbrat-staging@appspot.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"
   ```

3. Reference in `.secure.staging/.env`:
   ```bash
   # Reference format (resolved by Cloud Run)
   MCP_AUTH_TOKEN=${MCP_AUTH_TOKEN}
   ```

4. Deploy services:
   ```bash
   npm run brat -- deploy services --all --context staging
   ```

**Verification**:
```bash
# Check secret exists
gcloud secrets describe MCP_AUTH_TOKEN --project=bitbrat-staging

# Check permissions
gcloud secrets get-iam-policy MCP_AUTH_TOKEN --project=bitbrat-staging
```

---

### Production Deployment

**Setup**: Same as staging, but use `bitbrat-prod` project

**Critical Steps**:
1. **Rotate all secrets** (never reuse staging secrets)
2. **Use separate Google Secret Manager project**
3. **Enable audit logging** for secret access
4. **Set up secret rotation schedule** (90 days)

**Audit**:
```bash
# View secret access logs
gcloud logging read "resource.type=secret_manager_secret AND resource.labels.secret_id=MCP_AUTH_TOKEN" \
  --project=bitbrat-prod \
  --limit 50
```

---

## Adding a New Secret

**Process**:
1. **Define secret in architecture.yaml** (Sprint 8+: Add to this catalog instead):
   ```yaml
   # OLD (deprecated):
   conventions:
     secrets:
       catalog:
         MY_NEW_SECRET:
           description: Description of what this secret is for
           source: gcp-secret-manager
           used_by: [service-name]

   # NEW (Sprint 8+):
   # Document in this file (documentation/reference/secrets-catalog.md)
   ```

2. **Add secret to services** in `architecture.yaml`:
   ```yaml
   services:
     my-service:
       secrets:
         - MY_NEW_SECRET
   ```

3. **Create secret in all environments**:
   ```bash
   # Local
   echo "MY_NEW_SECRET=local-value" >> .secure.local/.env

   # Staging
   echo -n "staging-value" | gcloud secrets create MY_NEW_SECRET \
     --project=bitbrat-staging \
     --data-file=-

   # Production
   echo -n "prod-value" | gcloud secrets create MY_NEW_SECRET \
     --project=bitbrat-prod \
     --data-file=-
   ```

4. **Grant access** (staging/production):
   ```bash
   gcloud secrets add-iam-policy-binding MY_NEW_SECRET \
     --project=bitbrat-staging \
     --member="serviceAccount:..." \
     --role="roles/secretmanager.secretAccessor"
   ```

5. **Use in service code**:
   ```typescript
   // In service implementation
   const mySecret = this.getSecret('MY_NEW_SECRET');
   ```

6. **Deploy and verify**:
   ```bash
   npm run brat -- deploy service my-service --context staging
   ```

---

## Rotation Schedule

| Secret | Rotation Frequency | Automated | Notes |
|--------|-------------------|-----------|-------|
| `MCP_AUTH_TOKEN` | 90 days | ❌ Manual | Coordinate with all services |
| `OPENAI_API_KEY` | 180 days | ❌ Manual | Or immediately if exposed |
| `TWITCH_CLIENT_SECRET` | 90 days | ❌ Manual | Via Twitch console |
| `DISCORD_BOT_TOKEN` | On demand | ❌ Manual | Only if exposed |
| `TWILIO_AUTH_TOKEN` | 90 days | ❌ Manual | Critical account secret |
| `TWILIO_API_KEY/SECRET` | 90 days | ❌ Manual | Preferred over auth token |
| `OAUTH_STATE_SECRET` | 90 days | ❌ Manual | Per environment |
| `OBS_WEBSOCKET_PASSWORD` | On demand | ❌ Manual | Only if exposed |

**Automation** (future enhancement): Automated secret rotation via Cloud Scheduler + Cloud Functions.

---

## Troubleshooting

### Secret Not Found

**Symptoms**:
- Service fails to start with `Secret X not found`
- Environment variable is `undefined`

**Diagnosis**:
```bash
# Check local .env
cat .secure.local/.env | grep SECRET_NAME

# Check GCP Secret Manager
gcloud secrets describe SECRET_NAME --project=bitbrat-staging

# Check service definition
yq eval '.services.SERVICE_NAME.secrets[]' architecture.yaml
```

**Solutions**:
1. **Local**: Add secret to `.secure.local/.env`
2. **Staging/Production**: Create secret in Google Secret Manager
3. **Permissions**: Grant `roles/secretmanager.secretAccessor` to service account

---

### Secret Value Incorrect

**Symptoms**:
- Service fails authentication
- API calls return 401/403 errors

**Diagnosis**:
```bash
# View secret value (local)
cat .secure.local/.env | grep SECRET_NAME

# View secret version (GCP)
gcloud secrets versions access latest --secret=SECRET_NAME --project=bitbrat-staging
```

**Solutions**:
1. Verify secret value matches provider (OpenAI, Twitch, etc.)
2. Check for whitespace/newlines in secret value
3. Regenerate secret if format is incorrect

---

### Secret Rotation Breaks Services

**Symptoms**:
- Services suddenly fail authentication after rotation
- Multiple services affected simultaneously

**Prevention**:
1. **Staged Rollout**: Rotate in local → staging → production
2. **Overlap Period**: Keep old secret valid for 24 hours
3. **Monitoring**: Check service logs after rotation

**Recovery**:
```bash
# Rollback to previous secret version (GCP)
gcloud secrets versions access VERSION --secret=SECRET_NAME --project=bitbrat-staging

# Update services with rolled-back value
npm run brat -- deploy services --all --context staging
```

---

## Security Best Practices

### DO

✅ Use `.secure.{environment}/.env` for all secrets
✅ Rotate secrets every 90 days (or per schedule above)
✅ Use scoped API keys (e.g., Twilio API Key vs Auth Token)
✅ Grant minimum required permissions (principle of least privilege)
✅ Enable audit logging for secret access
✅ Use separate secrets per environment (local, staging, production)
✅ Validate secrets on service startup
✅ Monitor secret access logs for anomalies

### DON'T

❌ Commit secrets to git (`.secure.*/` is git-ignored)
❌ Share secrets via email, Slack, or unencrypted channels
❌ Reuse production secrets in staging/local
❌ Log secret values (even in debug mode)
❌ Store secrets in environment variables on developer machines
❌ Use default/example secrets in production
❌ Grant `roles/secretmanager.admin` to services (only `secretAccessor`)
❌ Hard-code secrets in application code

---

## See Also

- [Environment Variables Reference](./environment-variables.md) — Non-secret environment variables
- [Execution Contexts Guide](../guides/execution-contexts.md) — Context-specific configuration
- [Deploying Secure Files](../guides/secure-file-deployment.md) — Deploying credential files (JSON, PEM)
- [Google Secret Manager Documentation](https://cloud.google.com/secret-manager/docs) — GCP secret management

---

**Document Status**: ✅ Current
**Sprint**: 8 (sprint-8-uhh8fj)
**Last Reviewed**: 2026-08-10
