# Slack Integration Quick Reference

**Sprint 348** | **Status**: Production-ready | **Last Updated**: 2026-07-19

---

## TL;DR

```bash
# 1. Create app from manifest
https://api.slack.com/apps → "From an app manifest" → paste slack-app-manifest.yaml

# 2. Enable Socket Mode, copy tokens
SLACK_APP_TOKEN=xapp-...      # Socket Mode
SLACK_BOT_TOKEN=xoxb-...      # OAuth Bot Token
SLACK_SIGNING_SECRET=...      # Webhook verification

# 3. Deploy
npm run brat -- deploy service ingress-egress

# 4. Test
@BitBrat hello
```

---

## Architecture

```
┌─────────────────┐
│  Slack Workspace│
│   @BitBrat      │
└────────┬────────┘
         │
    ┌────┴────┐
    │ Socket  │  (Primary, WebSocket)
    │  Mode   │
    └────┬────┘
         │
    ┌────┴────┐
    │ Events  │  (Fallback, Webhook)
    │   API   │
    └────┬────┘
         │
┌────────▼────────────┐
│ SlackConnectorAdapter│
│ (IngressConnector +  │
│  WebhookConnector)   │
└────────┬─────────────┘
         │
┌────────▼────────────┐
│ SlackIngressClient  │
│ (@slack/socket-mode)│
│ (@slack/web-api)    │
└────────┬─────────────┘
         │
    ┌────┴─────┐
    │ Envelope │ (Normalize to v1)
    │ Builder  │
    └────┬─────┘
         │
┌────────▼────────────┐
│  internal.ingress.v1│
│   (Event Router)    │
└─────────────────────┘
```

---

## Files

| File | Purpose |
|------|---------|
| `slack-app-manifest.yaml` | Slack app configuration (use at api.slack.com/apps) |
| `slack-app-manifest.json` | Same as YAML, JSON format |
| `documentation/guides/slack-app-setup.md` | Complete setup guide |
| `src/services/ingress/slack/connector-adapter.ts` | Dual-mode connector |
| `src/services/ingress/slack/slack-ingress-client.ts` | Socket Mode client |
| `src/services/ingress/slack/envelope-builder.ts` | Event normalization |
| `src/services/ingress/slack/webhook-utils.ts` | Signature verification |

---

## Key Scopes

| Scope | Why? |
|-------|------|
| `app_mentions:read` | Listen to @BitBrat mentions (primary trigger) |
| `channels:history` | Read message context for enrichment |
| `chat:write` | Send responses to channels |
| `chat:write.public` | Send without joining channel |
| `im:history`, `im:write` | Direct message support |
| `users:read` | User profile enrichment |
| `reactions:write` | React to messages (egress capability) |
| `files:write` | Upload images (image-gen-mcp integration) |

---

## Event Flow

```typescript
// 1. User mentions bot in Slack
@BitBrat what's the weather?

// 2. Socket Mode delivers event
SlackIngressClient.handleMessage(event: { type: 'app_mention', user: 'U123', text: '...' })

// 3. Normalize to Envelope v1
buildSlackEnvelope(event) → {
  id: uuid(),
  correlationId: uuid(),
  platform: 'slack',
  source: { platform: 'slack', platformUserId: 'U123', platformChannelId: 'C456' },
  message: { text: 'what's the weather?', timestamp: '2026-07-19T...' },
  egressDestination: 'C456',
  routingSlip: [],
  annotations: [],
}

// 4. Publish to event-router
publisher.publish(envelope) → internal.ingress.v1

// 5. Event-router attaches routing slip (JsonLogic rules)
routingSlip: [
  { topic: 'internal.query.analysis.v1', attempt: 0 },
  { topic: 'internal.llmbot.v1', attempt: 0 },
]

// 6. LLM bot processes, publishes response
llm-bot → internal.egress.v1.{instanceId}

// 7. Ingress-egress delivers to Slack
SlackIngressClient.sendText(response.text, 'C456')
```

---

## Configuration

### Local Development (`.env`)

```bash
SLACK_APP_TOKEN=xapp-1-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_ENABLED=true
SLACK_LOG_LEVEL=info  # Optional: debug, info, warn, error
```

### Production (Secret Manager)

```bash
gcloud secrets create SLACK_APP_TOKEN --data-file=- <<< "xapp-1-..."
gcloud secrets create SLACK_BOT_TOKEN --data-file=- <<< "xoxb-..."
gcloud secrets create SLACK_SIGNING_SECRET --data-file=- <<< "..."

# Grant access to Cloud Run service account
gcloud secrets add-iam-policy-binding SLACK_APP_TOKEN \
  --member="serviceAccount:bitbrat-sa@project.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### architecture.yaml

```yaml
services:
  ingress-egress:
    secrets:
      - SLACK_APP_TOKEN
      - SLACK_BOT_TOKEN
      - SLACK_SIGNING_SECRET
    env:
      - SLACK_ENABLED
```

---

## Common Tasks

### Check Connection Status

```bash
npm run brat -- fleet info ingress-egress | jq '.connectors.slack'
# Expected: state: CONNECTED, counters.published > 0
```

### View Recent Messages

```bash
npm run brat -- fleet logs ingress-egress --since 5m | grep "slack.message"
```

### Test @Mention

```slack
# In any channel where bot is invited
@BitBrat help
```

### Test Direct Message

```slack
# Open DM with @BitBrat
Hello!
```

### Monitor Counters

```bash
# Watch real-time counters
watch -n 2 'npm run brat -- fleet info ingress-egress | jq ".connectors.slack.counters"'
```

---

## Troubleshooting

| Symptom | Cause | Solution |
|---------|-------|----------|
| `state: ERROR` | Socket Mode connection failed | Verify `SLACK_APP_TOKEN`, check Socket Mode enabled |
| `state: DISCONNECTED` | Client stopped or crashed | Restart: `npm run brat -- fleet restart ingress-egress` |
| `counters.failed > 0` | Publish errors | Check event-router running, verify NATS/Pub/Sub |
| `counters.filtered` high | Bot responding to self | Expected behavior (loop prevention) |
| No response to @mention | Bot not in channel | `/invite @BitBrat` in channel |
| Signature verification fails | Wrong signing secret | Verify `SLACK_SIGNING_SECRET` matches app settings |

---

## Testing

### Unit Tests

```bash
npm test -- src/services/ingress/slack
# 17+ tests: signature verification, envelope building, webhook handling
```

### Integration Tests

```bash
npm test -- tests/integration/webhook-routing.test.ts
# Generic webhook routing: POST /webhooks/slack
```

### Architecture Validation

```bash
npm run validate:ingress-architecture
# Validates SlackConnectorAdapter compliance
```

### Manual Testing Checklist

- [ ] Socket Mode connects (`state: CONNECTED`)
- [ ] @mention publishes event (`counters.published++`)
- [ ] DM works (im:history, im:write scopes)
- [ ] Thread replies work (thread_ts preserved)
- [ ] Bot messages filtered (counters.filtered++)
- [ ] Egress sends messages (chat:write)
- [ ] Reactions work (reactions:write)
- [ ] Reconnection after disconnect

---

## Security

### Signature Verification (Webhook)

```typescript
// HMAC-SHA256 of `v0:timestamp:body`
const signatureBaseString = `v0:${timestamp}:${JSON.stringify(body)}`;
const expectedSignature = 'v0=' + crypto
  .createHmac('sha256', secret)
  .update(signatureBaseString, 'utf-8')
  .digest('hex');

// Timing-safe comparison
crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

// Replay attack prevention: reject if timestamp > 5 minutes old
```

### Bot Message Filtering (Loop Prevention)

```typescript
// Filter bot messages by user ID
if (event.user === this.botUserId || event.bot_id) {
  logger.debug('slack.client.message_filtered');
  counters.filtered++;
  return;
}
```

### Token Management

- **Never commit tokens** to git (use `.env` or Secret Manager)
- **Rotate every 90 days** (manual only, `token_rotation_enabled: false`)
- **Principle of least privilege** (only request scopes you need)

---

## Capabilities

| Feature | Supported? | Scope Required |
|---------|------------|----------------|
| Send channel messages | ✅ Yes | `chat:write` |
| Send DMs | ✅ Yes | `im:write` |
| Respond in threads | ✅ Yes | `chat:write` |
| Add reactions | ✅ Yes | `reactions:write` |
| Upload files/images | ✅ Yes | `files:write` |
| Delete messages | ✅ Yes | `chat:write` |
| Ban users | ❌ No | N/A (Slack limitation) |
| Timeout users | ❌ No | N/A (Slack limitation) |
| Slash commands | ⏳ Future | N/A |
| Interactive components | ⏳ Future | N/A |
| Block Kit messages | ⏳ Future | `chat:write` |

---

## Metrics

| Metric | Description | Healthy Range |
|--------|-------------|---------------|
| `counters.received` | Messages received | Increasing |
| `counters.published` | Events published | ≈ received - filtered |
| `counters.filtered` | Bot messages filtered | < 10% |
| `counters.failed` | Publish failures | 0 |
| `state` | Connection state | `CONNECTED` |
| `lastMessageAt` | Last event timestamp | Recent (< 5m) |

---

## Future Enhancements

### Planned

- [ ] Slash commands (`/bitbrat <command>`)
- [ ] Interactive components (buttons, menus)
- [ ] Block Kit rich messages
- [ ] Message shortcuts (right-click actions)
- [ ] Scheduled messages

### Experimental

- [ ] App Home dashboard
- [ ] Workflow Steps integration
- [ ] Enterprise Grid (multi-workspace)
- [ ] Canvas integration

---

## Reference Links

- **Manifest**: `slack-app-manifest.yaml`
- **Setup Guide**: `documentation/guides/slack-app-setup.md`
- **Implementation**: `src/services/ingress/slack/`
- **Tests**: `src/services/ingress/slack/__tests__/`
- **CLAUDE.md**: "Integrating Chat Platforms: The Webhook Pattern"
- **Slack API Docs**: https://api.slack.com/
- **Socket Mode Guide**: https://api.slack.com/apis/connections/socket
- **Events API Guide**: https://api.slack.com/apis/connections/events-api

---

**Need Help?**

- GitHub: https://github.com/bitbrat/platform/issues
- Slack: [#bitbrat-support](https://bitbrat.slack.com)
- Discord: [BitBrat Community](https://discord.gg/bitbrat)
