# Slack Integration

**Sprint 348: Slack Integration**

Dual-mode connector (Socket Mode + Events API) for Slack platform integration.

---

## Quick Start

### 1. Create Slack App

Use the app manifest to create your Slack app:

```bash
# Open Slack app creation page
open https://api.slack.com/apps

# Choose "From an app manifest"
# Paste contents of: ../../../../slack-app-manifest.yaml
# Copy tokens:
#   - Bot Token (xoxb-...) → SLACK_BOT_TOKEN
#   - App Token (xapp-...) → SLACK_APP_TOKEN
#   - Signing Secret → SLACK_SIGNING_SECRET
```

### 2. Configure BitBrat

```bash
# Local development (.env)
cat >> .env << EOF
SLACK_APP_TOKEN=xapp-1-YOUR-TOKEN
SLACK_BOT_TOKEN=xoxb-YOUR-TOKEN
SLACK_SIGNING_SECRET=your-secret
SLACK_ENABLED=true
EOF

# Production (Secret Manager)
gcloud secrets create SLACK_APP_TOKEN --data-file=- <<< "xapp-1-..."
gcloud secrets create SLACK_BOT_TOKEN --data-file=- <<< "xoxb-..."
gcloud secrets create SLACK_SIGNING_SECRET --data-file=- <<< "..."
```

### 3. Deploy & Test

```bash
# Deploy ingress-egress service
npm run brat -- deploy service ingress-egress

# Test in Slack
# 1. Invite bot to channel: /invite @BitBrat
# 2. Mention bot: @BitBrat hello
# 3. Check logs: npm run brat -- fleet logs ingress-egress --since 5m
```

---

## Architecture

### Dual-Mode Connector

BitBrat uses **Socket Mode (primary)** with **Events API (fallback)**:

| Mode | Method | Advantages | Use Case |
|------|--------|-----------|----------|
| **Socket Mode** | WebSocket | Real-time, no public URL | Primary (always enabled) |
| **Events API** | Webhook | Multi-region, retries | Fallback (redundancy) |

### Component Diagram

```
┌──────────────────────────────────────┐
│   SlackConnectorAdapter              │
│   (IngressConnector +                │
│    WebhookConnector)                 │
├──────────────────────────────────────┤
│ ┌────────────┐   ┌────────────────┐ │
│ │  Socket    │   │  Events API    │ │
│ │   Mode     │   │   (Webhook)    │ │
│ │ (Primary)  │   │  (Fallback)    │ │
│ └─────┬──────┘   └────────┬───────┘ │
│       │                   │         │
│       └───────┬───────────┘         │
│               ▼                     │
│   ┌──────────────────────┐         │
│   │ SlackIngressClient   │         │
│   │ - Socket Mode WS     │         │
│   │ - Web API (egress)   │         │
│   │ - Bot message filter │         │
│   └──────────┬───────────┘         │
└──────────────┼──────────────────────┘
               │
               ▼
     buildSlackEnvelope()
     (Normalize → Envelope v1)
               │
               ▼
      internal.ingress.v1
```

---

## Files

| File | Purpose | Lines |
|------|---------|-------|
| `connector-adapter.ts` | Dual-mode connector (IngressConnector + WebhookConnector) | 175 |
| `slack-ingress-client.ts` | Socket Mode client, message handling, egress | 183 |
| `envelope-builder.ts` | Slack event → Envelope v1 normalization | ~80 |
| `webhook-utils.ts` | HMAC-SHA256 signature verification | ~50 |
| `index.ts` | Public exports | ~10 |
| `__tests__/*.test.ts` | 17+ unit tests (100% coverage) | ~800 |

---

## Key Patterns

### 1. Bot Message Filtering (Loop Prevention)

```typescript
// Filter bot messages to prevent infinite loops
if (event.user === this.botUserId || event.bot_id) {
  logger.debug('slack.client.message_filtered');
  counters.filtered++;
  return;
}
```

### 2. Webhook Response SLA (< 3 seconds)

```typescript
// IMPORTANT: Return 200 OK immediately
// Process event asynchronously after response
async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
  setImmediate(async () => {
    // Heavy processing here (publish to event-router)
  });

  return { status: 200, body: { ok: true } };
}
```

### 3. Signature Verification (HMAC-SHA256)

```typescript
// Verify Slack signature: HMAC-SHA256 of `v0:timestamp:body`
const signatureBaseString = `v0:${timestamp}:${JSON.stringify(body)}`;
const expectedSignature = 'v0=' + crypto
  .createHmac('sha256', secret)
  .update(signatureBaseString, 'utf-8')
  .digest('hex');

// Timing-safe comparison
crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
```

### 4. Envelope Normalization

```typescript
// Normalize Slack event → Envelope v1
export function buildSlackEnvelope(event: SlackEventMeta): InternalEventV2 {
  return {
    id: randomUUID(),
    correlationId: randomUUID(),
    platform: 'slack',
    source: {
      platform: 'slack',
      platformUserId: event.user || 'unknown',
      platformChannelId: event.channel || 'unknown',
      platformMessageId: event.ts || randomUUID(),
    },
    message: {
      text: event.text || '',
      timestamp: new Date().toISOString(),
    },
    egressDestination: event.channel,
    timestamp: new Date().toISOString(),
    version: 'v2',
    routingSlip: [],
    annotations: [],
  };
}
```

---

## Event Flow

```
User: @BitBrat hello
       ↓
┌─────────────────────┐
│ Slack Socket Mode   │ (WebSocket, real-time)
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ SlackIngressClient  │ handleMessage(event)
│ - Filter bot msgs   │
│ - Build envelope    │
│ - Publish to router │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ buildSlackEnvelope()│ Normalize → Envelope v1
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ internal.ingress.v1 │ Event Router picks up
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ Event Router        │ Attach routing slip (JsonLogic)
│ - internal.query.   │
│   analysis.v1       │
│ - internal.llmbot.v1│
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ LLM Bot             │ Generate response
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ internal.egress.v1  │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ SlackIngressClient  │ sendText(response, channel)
│ - Web API call      │
│ - chat.postMessage  │
└─────────────────────┘
           │
           ▼
    Slack delivers message
```

---

## Testing

### Unit Tests (17+ tests)

```bash
npm test -- src/services/ingress/slack

# Test files:
# - connector-adapter.test.ts (IngressConnector interface)
# - connector-adapter-webhook.test.ts (WebhookConnector interface)
# - webhook-utils.test.ts (signature verification)
# - envelope-builder.test.ts (normalization)
```

### Integration Tests

```bash
npm test -- tests/integration/webhook-routing.test.ts
# Tests generic POST /webhooks/slack routing
```

### Architecture Validation

```bash
npm run validate:ingress-architecture
# Validates SlackConnectorAdapter against framework compliance
```

---

## Troubleshooting

### Connection Issues

```bash
# Check connection state
npm run brat -- fleet info ingress-egress | jq '.connectors.slack.state'
# Expected: "CONNECTED"

# View connection errors
npm run brat -- fleet info ingress-egress | jq '.connectors.slack.lastError'

# Restart connector
npm run brat -- fleet restart ingress-egress
```

### No Response to @Mentions

```bash
# 1. Verify bot is invited to channel
# In Slack: /invite @BitBrat

# 2. Check bot has app_mentions:read scope
# https://api.slack.com/apps → OAuth & Permissions

# 3. Check event-router is running
npm run brat -- fleet info event-router

# 4. View logs with correlation ID
npm run brat -- fleet logs ingress-egress --correlationId <id>
```

### High Filtered Count

```bash
# Check counters
npm run brat -- fleet info ingress-egress | jq '.connectors.slack.counters'

# Expected: filtered < 10% of received
# Cause: Bot messages intentionally filtered (loop prevention)
```

---

## Configuration

### Required Environment Variables

| Variable | Format | Source |
|----------|--------|--------|
| `SLACK_APP_TOKEN` | `xapp-1-...` | App settings → Socket Mode |
| `SLACK_BOT_TOKEN` | `xoxb-...` | OAuth & Permissions → Bot Token |
| `SLACK_SIGNING_SECRET` | Hex string | Basic Information → Signing Secret |

### Optional Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SLACK_ENABLED` | `true` | Enable/disable connector |
| `SLACK_LOG_LEVEL` | `info` | SDK log level (debug, info, warn, error) |

---

## Capabilities

### Ingress

- ✅ Real-time message delivery (Socket Mode)
- ✅ @mention detection (`app_mentions:read`)
- ✅ Direct messages (`im:history`)
- ✅ Private channels (`groups:history`)
- ✅ Threads (`thread_ts` preserved)
- ✅ Bot message filtering (loop prevention)
- ✅ Webhook fallback (Events API)

### Egress

- ✅ Send channel messages (`chat:write`)
- ✅ Send DMs (`im:write`)
- ✅ Respond in threads (`thread_ts`)
- ✅ Add reactions (`reactions:write`)
- ✅ Upload files (`files:write`)
- ⏳ Block Kit messages (future)
- ⏳ Interactive components (future)

### Moderation

- ✅ Delete messages (`chat:write`)
- ❌ Ban users (Slack API limitation)
- ❌ Timeout users (Slack API limitation)

---

## Metrics

### ConnectorSnapshot

```typescript
{
  state: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'ERROR',
  id: 'slack-socket-mode',
  displayName: 'Slack Socket Mode',
  lastError: { code: string, message: string } | null,
  counters: {
    received: number,    // Total messages received
    published: number,   // Events published to event-router
    filtered: number,    // Bot messages filtered
    failed: number,      // Publish failures
  },
  lastMessageAt: string | null,  // ISO timestamp
}
```

### Monitoring

```bash
# Watch counters in real-time
watch -n 2 'npm run brat -- fleet info ingress-egress | jq ".connectors.slack.counters"'

# Expected healthy values:
# - received: increasing
# - published: ≈ received - filtered
# - filtered: < 10%
# - failed: 0
```

---

## Security

### Token Management

- **Never commit tokens** to version control
- Use `.env` for local development (gitignored)
- Use Secret Manager for production
- Rotate tokens every 90 days (manual)

### Webhook Verification

- **Always verify signatures** (validateSlackSignature)
- Reject requests older than 5 minutes (replay attack prevention)
- Use timing-safe comparison (crypto.timingSafeEqual)

### Network Security

- HTTPS required for webhook URL
- Valid SSL certificate required
- Self-signed certificates not supported
- IP allowlisting optional (Socket Mode doesn't need it)

---

## Future Enhancements

### Planned (Next Sprints)

- [ ] Slash commands (`/bitbrat <command>`)
- [ ] Interactive components (buttons, select menus, modals)
- [ ] Block Kit rich messages (cards, sections, actions)
- [ ] Message shortcuts (right-click → "Ask BitBrat")
- [ ] Scheduled messages (reminders, announcements)

### Experimental (Research)

- [ ] App Home dashboard (custom bot home tab)
- [ ] Workflow Steps (integrate with Slack Workflows)
- [ ] Enterprise Grid (multi-workspace support)
- [ ] Canvas integration (collaborative docs)
- [ ] Huddles (audio/video integration)

---

## Documentation

### Local Documentation

- **Manifest**: `../../../../slack-app-manifest.yaml`
- **Setup Guide**: `../../../../documentation/guides/slack-app-setup.md`
- **Quick Reference**: `../../../../documentation/quick-reference/slack-integration.md`
- **CLAUDE.md**: "Integrating Chat Platforms: The Webhook Pattern"

### External Documentation

- [Slack API Reference](https://api.slack.com/methods)
- [Socket Mode Guide](https://api.slack.com/apis/connections/socket)
- [Events API Guide](https://api.slack.com/apis/connections/events-api)
- [Verifying Requests from Slack](https://api.slack.com/authentication/verifying-requests-from-slack)

---

## Support

- **GitHub Issues**: https://github.com/bitbrat/platform/issues
- **Slack Workspace**: [#bitbrat-support](https://bitbrat.slack.com)
- **Discord**: [BitBrat Community](https://discord.gg/bitbrat)

---

**Sprint 348 Status**: ✅ Production-ready
**Maintainer**: BitBrat Platform Team
**Last Updated**: 2026-07-19
