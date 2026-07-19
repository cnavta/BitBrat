# Slack App Setup Guide

**Sprint 348: Slack Integration**

This guide walks through creating and configuring a Slack app for BitBrat Platform using the provided manifest.

---

## Prerequisites

- Slack workspace with admin permissions
- BitBrat Platform deployed (local, staging, or production)
- Access to Google Secret Manager (for production) or `.env` file (for local)

---

## Quick Start

### 1. Create Slack App from Manifest

1. Go to https://api.slack.com/apps
2. Click **"Create New App"**
3. Select **"From an app manifest"**
4. Choose your workspace
5. Paste the contents of `slack-app-manifest.yaml`
6. Review permissions and click **"Create"**

### 2. Enable Socket Mode

1. In your app settings, go to **"Socket Mode"** (left sidebar)
2. Enable Socket Mode
3. Click **"Generate an app-level token"**
   - Token name: `bitbrat-socket-mode`
   - Scopes: `connections:write`
4. Copy the token (starts with `xapp-...`)
5. Save as `SLACK_APP_TOKEN` secret

### 3. Install App to Workspace

1. Go to **"Install App"** (left sidebar)
2. Click **"Install to Workspace"**
3. Review permissions and click **"Allow"**
4. Copy the **Bot User OAuth Token** (starts with `xoxb-...`)
5. Save as `SLACK_BOT_TOKEN` secret

### 4. Copy Signing Secret

1. Go to **"Basic Information"** (left sidebar)
2. Scroll to **"App Credentials"**
3. Copy the **Signing Secret**
4. Save as `SLACK_SIGNING_SECRET` secret

### 5. Configure BitBrat

#### Local Development

Add to `.env`:

```bash
# Slack Integration (Sprint 348)
SLACK_APP_TOKEN=xapp-1-YOUR-TOKEN-HERE
SLACK_BOT_TOKEN=xoxb-YOUR-TOKEN-HERE
SLACK_SIGNING_SECRET=your-signing-secret-here
SLACK_ENABLED=true
```

#### Staging/Production (Google Cloud)

```bash
# Store secrets in Google Secret Manager
echo -n "xapp-1-YOUR-TOKEN-HERE" | gcloud secrets create SLACK_APP_TOKEN --data-file=-
echo -n "xoxb-YOUR-TOKEN-HERE" | gcloud secrets create SLACK_BOT_TOKEN --data-file=-
echo -n "your-signing-secret-here" | gcloud secrets create SLACK_SIGNING_SECRET --data-file=-

# Grant Cloud Run service account access
gcloud secrets add-iam-policy-binding SLACK_APP_TOKEN \
  --member="serviceAccount:bitbrat-sa@your-project.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Repeat for SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET
```

Update `architecture.yaml`:

```yaml
services:
  ingress-egress:
    secrets:
      - SLACK_APP_TOKEN
      - SLACK_BOT_TOKEN
      - SLACK_SIGNING_SECRET
    env:
      - SLACK_ENABLED  # Set to 'true' in deployment config
```

### 6. Deploy & Test

```bash
# Deploy ingress-egress service
npm run brat -- deploy service ingress-egress

# Verify Slack connector registered
npm run brat -- fleet info ingress-egress | grep -A 10 "slack"

# Test in Slack workspace
# 1. Invite bot to a channel: /invite @BitBrat
# 2. Mention the bot: @BitBrat hello
# 3. Check logs: npm run brat -- fleet logs ingress-egress --level info
```

---

## Architecture Overview

BitBrat uses a **dual-mode connector** for Slack integration:

### Socket Mode (Primary)

- **Method**: WebSocket connection to Slack
- **Advantages**:
  - No public URL required
  - Real-time delivery (< 100ms latency)
  - Automatic reconnection
  - No firewall configuration
- **Disadvantages**:
  - Requires persistent connection
  - Single-region deployment only

### Events API (Fallback)

- **Method**: Webhook delivery to `https://bitbrat.ai/webhooks/slack`
- **Advantages**:
  - No persistent connection required
  - Multi-region deployment support
  - Slack automatically retries failed deliveries
- **Disadvantages**:
  - Requires public URL
  - Webhook signature verification overhead
  - Higher latency (200-500ms)

**Default Configuration**: Socket Mode is enabled by default. Events API acts as a redundancy layer if Socket Mode disconnects.

---

## Supported Event Types

BitBrat listens to the following Slack events:

| Event Type | Description | Usage |
|------------|-------------|-------|
| `app_mention` | @BitBrat mentions | Primary trigger for LLM responses |
| `message.channels` | Public channel messages | Context gathering, analysis |
| `message.groups` | Private channel messages | Private conversations |
| `message.im` | Direct messages | One-on-one interactions |
| `message.mpim` | Group DMs | Multi-party private conversations |
| `reaction_added` | Emoji reactions | Disposition analysis, sentiment |
| `reaction_removed` | Reaction removals | Disposition updates |
| `user_change` | User profile updates | Enrichment, context |
| `team_join` | New members | Welcome messages (future) |
| `channel_*` | Channel lifecycle | Channel management (future) |

---

## OAuth Scopes Explained

### Core Messaging

| Scope | Purpose | Required? |
|-------|---------|-----------|
| `app_mentions:read` | Listen to @mentions | ✅ Required |
| `channels:history` | Read channel history | ✅ Required |
| `channels:read` | List channels | ✅ Required |
| `chat:write` | Send messages | ✅ Required |
| `chat:write.public` | Send without joining | ✅ Required |

### Direct Messages

| Scope | Purpose | Required? |
|-------|---------|-----------|
| `im:history` | Read DM history | ✅ Required |
| `im:read` | List DMs | ✅ Required |
| `im:write` | Send DMs | ✅ Required |

### Private Channels

| Scope | Purpose | Required? |
|-------|---------|-----------|
| `groups:history` | Read private channel history | ⚠️ Optional |
| `groups:read` | List private channels | ⚠️ Optional |
| `groups:write` | Send to private channels | ⚠️ Optional |

### User Context

| Scope | Purpose | Required? |
|-------|---------|-----------|
| `users:read` | Read user profiles | ✅ Required (enrichment) |
| `users:read.email` | Read user emails | ⚠️ Optional (auth) |

### Egress Capabilities

| Scope | Purpose | Required? |
|-------|---------|-----------|
| `reactions:write` | Add reactions | ⚠️ Optional |
| `files:write` | Upload images | ⚠️ Optional (image-gen-mcp) |
| `chat:write.customize` | Custom username/icon | ⚠️ Optional |

---

## Troubleshooting

### Socket Mode Connection Failures

**Symptom**: `slack.client.connection_failed` in logs

**Solutions**:
1. Verify `SLACK_APP_TOKEN` is correct (starts with `xapp-`)
2. Check Socket Mode is enabled in app settings
3. Ensure app-level token has `connections:write` scope
4. Restart ingress-egress service: `npm run brat -- fleet restart ingress-egress`

### Webhook Signature Verification Failures

**Symptom**: `slack.webhook.invalid_signature` in logs

**Solutions**:
1. Verify `SLACK_SIGNING_SECRET` matches app settings
2. Check request timestamp is within 5 minutes (replay attack prevention)
3. Ensure webhook URL uses HTTPS (required by Slack)
4. Verify `x-forwarded-proto` header is set correctly (cloud deployments)

### Bot Not Responding to @Mentions

**Symptom**: No events published, bot silent

**Solutions**:
1. Verify bot is invited to channel: `/invite @BitBrat`
2. Check `app_mentions:read` scope is granted
3. Ensure bot is not filtering its own messages (check `botUserId`)
4. Verify event-router is running: `npm run brat -- fleet info event-router`
5. Check logs: `npm run brat -- fleet logs ingress-egress --correlationId <id>`

### Messages Not Delivered (Egress Failures)

**Symptom**: `slack.egress.failed` in logs

**Solutions**:
1. Verify `SLACK_BOT_TOKEN` is correct (starts with `xoxb-`)
2. Check bot has `chat:write` scope
3. Ensure bot is member of target channel (or use `chat:write.public`)
4. Check Slack API rate limits: https://api.slack.com/docs/rate-limits
5. Verify channel ID is valid (not archived/deleted)

### High Filtered Message Count

**Symptom**: `slack.client.message_filtered` logs, counters.filtered increasing

**Expected Behavior**: Bot messages are intentionally filtered to prevent infinite loops.

**Investigation**:
1. Check if bot is responding to its own messages (should not happen)
2. Verify `botUserId` is resolved correctly
3. Confirm bot_id filtering is working

### Socket Mode Reconnection Loops

**Symptom**: `slack.client.disconnected` → `slack.client.reconnected` repeatedly

**Solutions**:
1. Check network stability (firewall, proxy issues)
2. Verify app token is valid (not expired/revoked)
3. Monitor Slack status: https://status.slack.com/
4. Consider using Events API as primary (if persistent issues)

---

## Configuration Reference

### Environment Variables

| Variable | Description | Required | Format |
|----------|-------------|----------|--------|
| `SLACK_APP_TOKEN` | App-level token (Socket Mode) | ✅ Yes | `xapp-1-...` |
| `SLACK_BOT_TOKEN` | Bot User OAuth Token | ✅ Yes | `xoxb-...` |
| `SLACK_SIGNING_SECRET` | Webhook signature secret | ⚠️ Events API only | Hex string |
| `SLACK_ENABLED` | Enable Slack connector | ⚠️ Optional | `true` or `false` |
| `SLACK_LOG_LEVEL` | SDK log level | ⚠️ Optional | `debug`, `info`, `warn`, `error` |

### Connector Metadata

```typescript
{
  platform: 'slack',
  version: '1.0.0',
  authMethod: 'oauth2',
  capabilities: {
    ingress: {
      method: 'hybrid',         // Socket Mode + Events API
      realtime: true,
      requiresWebhook: false,   // Socket Mode doesn't need webhooks
      requiresPublicUrl: false, // Socket Mode doesn't need public URL
    },
    egress: {
      chat: true,               // Send channel messages
      dm: true,                 // Send DMs
      reactions: true,          // Add reactions
      threads: true,            // Thread support
    },
    moderation: {
      ban: false,               // Slack doesn't support banning via API
      timeout: false,           // No timeout capability
      delete: true,             // Can delete messages (chat:write scope)
    },
  },
}
```

---

## Security Best Practices

### Token Management

1. **Never commit tokens to git**
   - Use `.env` files (local)
   - Use Secret Manager (cloud)
   - Rotate tokens every 90 days

2. **Principle of least privilege**
   - Only request scopes you need
   - Review manifest permissions regularly
   - Remove unused scopes

3. **Webhook signature verification**
   - Always verify signatures (validateSlackSignature)
   - Reject requests older than 5 minutes
   - Use timing-safe comparison (crypto.timingSafeEqual)

4. **Rate limiting**
   - Respect Slack API rate limits (Tier 3: 50+ requests/minute)
   - Implement exponential backoff
   - Monitor rate limit headers

### Network Security

1. **HTTPS required**
   - Webhook URL must use HTTPS
   - Valid SSL certificate required
   - Self-signed certificates not supported

2. **IP allowlisting** (optional)
   - Slack publishes IP ranges: https://api.slack.com/apis/connections/ip-ranges
   - Restrict webhook endpoint to Slack IPs
   - Not required for Socket Mode

---

## Testing

### Manual Testing

```bash
# 1. Deploy to staging
npm run brat -- deploy service ingress-egress --target staging

# 2. Verify connector registered
npm run brat -- fleet info ingress-egress | grep -A 20 "slack"

# 3. Test Socket Mode connection
# Expected: state: CONNECTED, counters.published > 0

# 4. Test @mention
# In Slack: @BitBrat hello
# Expected: Event published to event-router

# 5. Check logs
npm run brat -- fleet logs ingress-egress --since 5m | grep slack
```

### Automated Testing

```bash
# Unit tests (17+ tests)
npm test -- src/services/ingress/slack

# Integration tests
npm test -- tests/integration/webhook-routing.test.ts

# Architecture validation
npm run validate:ingress-architecture
```

### Load Testing

```bash
# Simulate high message volume
# 1. Create test channel
# 2. Send 100 @mentions rapidly
# 3. Monitor counters: received, published, filtered, failed
# 4. Expected: No failed messages, < 500ms publish latency

npm run brat -- fleet info ingress-egress
```

---

## Monitoring

### Key Metrics

| Metric | Description | Threshold |
|--------|-------------|-----------|
| `counters.received` | Total messages received | Increasing |
| `counters.published` | Messages published to event-router | ≈ received - filtered |
| `counters.filtered` | Bot messages filtered (loop prevention) | Low (< 10%) |
| `counters.failed` | Failed publish attempts | Zero |
| `state` | Connection state | `CONNECTED` |
| `lastMessageAt` | Last message timestamp | Recent (< 5m) |

### Logs to Monitor

```bash
# Connection events
npm run brat -- fleet logs ingress-egress --level info | grep "slack.client"

# Message flow
npm run brat -- fleet logs ingress-egress --level debug | grep "slack.message"

# Errors
npm run brat -- fleet logs ingress-egress --level error | grep "slack"

# Webhook events (if Events API enabled)
npm run brat -- fleet logs ingress-egress | grep "slack.webhook"
```

---

## Future Enhancements

### Planned (Future Sprints)

- [ ] **Slash Commands**: `/bitbrat <command>`
- [ ] **Interactive Components**: Buttons, select menus, modals
- [ ] **Block Kit**: Rich message formatting
- [ ] **Message Shortcuts**: Right-click → "Ask BitBrat"
- [ ] **Scheduled Messages**: Reminders, announcements
- [ ] **Message Deletion**: Moderation-service integration
- [ ] **Thread Summaries**: Automatically summarize long threads
- [ ] **Workspace Discovery**: List channels, users, analytics

### Experimental (Research)

- [ ] **App Home Tab**: Custom dashboard for bot interactions
- [ ] **Workflow Steps**: Integrate with Slack Workflows
- [ ] **Enterprise Grid**: Multi-workspace support
- [ ] **Canvas Integration**: Collaborative docs
- [ ] **Huddles**: Audio/video integration

---

## Reference

### Documentation

- [Slack API Reference](https://api.slack.com/methods)
- [Socket Mode Guide](https://api.slack.com/apis/connections/socket)
- [Events API Guide](https://api.slack.com/apis/connections/events-api)
- [Verifying Requests from Slack](https://api.slack.com/authentication/verifying-requests-from-slack)

### BitBrat Documentation

- **Implementation**: `src/services/ingress/slack/`
- **Architecture**: `CLAUDE.md` (Integrating Chat Platforms: The Webhook Pattern)
- **Execution Plan**: `planning/sprint-348-slack-integration/execution-plan.md`
- **Tests**: `src/services/ingress/slack/__tests__/`

### Support

- **GitHub Issues**: https://github.com/bitbrat/platform/issues
- **Slack Workspace**: [Join #bitbrat-support](https://bitbrat.slack.com)
- **Discord**: [BitBrat Community](https://discord.gg/bitbrat)

---

**Last Updated**: 2026-07-19 (Sprint 348)
**Maintainer**: BitBrat Platform Team
**Status**: Production-ready
