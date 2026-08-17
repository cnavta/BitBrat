# Twitch EventSub Configuration Guide

**YAML-driven subscription management for 22 Twitch platform events.**

EventSub provides real-time notifications for Twitch platform events (follows, subscriptions, raids, moderation) independent of IRC chat. All subscriptions are configured via YAML with global defaults and per-channel overrides.

**Sprint:** 16
**Status:** Production-ready
**Dependencies:** Twitch OAuth app + NATS/PostgreSQL
**Config:** `config/twitch-eventsub/subscriptions.yaml`

---

## Quick Reference

| Feature | Description |
|---------|-------------|
| **Event Types** | 22 total (4 core + 13 Tier 1 + 5 Tier 2) |
| **Feature Flag** | `ENABLE_EVENTSUB_YAML_CONFIG` (default: `false`) |
| **Config File** | `config/twitch-eventsub/subscriptions.yaml` |
| **MCP Tools** | `twitch.eventsub.subscriptions.list`, `.status`, `.config.reload` |
| **Health Endpoint** | `GET /_debug/twitch/eventsub` |
| **Architecture** | Dual-client (IRC for chat + EventSub for platform events) |

---

## Core Concepts

### Event Categories

| Category | Events | Enabled by Default | Notes |
|----------|--------|-------------------|-------|
| **Core** | follow, update, stream.online, stream.offline | ✅ Yes | Platform essentials |
| **Tier 1** | raid, subscribe, cheer, polls, predictions, etc. | ❌ No | High-value engagement/monetization (opt-in) |
| **Tier 2** | ban, unban, moderate, chat.message | ❌ No | Moderation + chat (HIGH VOLUME, opt-in) |

### Subscription Lifecycle

1. **Load**: Platform loads `subscriptions.yaml` on startup (if `ENABLE_EVENTSUB_YAML_CONFIG=true`)
2. **Apply Overrides**: Per-channel overrides applied on top of global settings
3. **Validate Scopes**: OAuth scope validation (subscriptions skipped if missing required scope)
4. **Subscribe**: Twurple EventSub listener subscriptions created
5. **Process**: Events published to NATS as `InternalEventV2` messages
6. **Monitor**: Runtime status via MCP tools or health endpoint

### YAML vs Hardcoded Mode

| Feature | Hardcoded (Legacy) | YAML (New) |
|---------|-------------------|------------|
| **Events** | 4 (follow, update, stream.online, stream.offline) | 22 (all Tier 1 + Tier 2 events) |
| **Configuration** | Code (src/services/ingress/twitch/eventsub-client.ts) | YAML file |
| **Enable/Disable** | Code changes required | Config file edit + reload |
| **Per-Channel Control** | Not supported | `channelOverrides` section |
| **Default** | `ENABLE_EVENTSUB_YAML_CONFIG=false` | `ENABLE_EVENTSUB_YAML_CONFIG=true` |

---

## Configuration File Structure

### Top-Level Schema

```yaml
version: 1

subscriptions:
  <event-name>:
    enabled: true|false
    version: 1|2
    scope: "oauth:scope"       # Optional (not all events require scopes)
    priority: critical|high|medium|low
    builder: buildMethodName
    internalType: internal.event.type
    description: "Human-readable description"
    mutation:                  # Optional (state changes)
      key: "state.key"
      value: "state.value"
      ttl: 21600               # Seconds

channelOverrides:
  <channel-name>:
    <event-name>:
      enabled: true|false
```

### Subscription Fields

| Field | Required | Description | Example |
|-------|----------|-------------|---------|
| `enabled` | ✅ Yes | Enable/disable subscription globally | `true`, `false` |
| `version` | ❌ No | Twitch EventSub API version | `1`, `2` (default: `1`) |
| `scope` | ❌ No | Required OAuth scope | `channel:read:subscriptions` |
| `priority` | ❌ No | Processing priority | `critical`, `high`, `medium`, `low` |
| `builder` | ✅ Yes | Event builder method name | `buildFollow`, `buildRaid` |
| `internalType` | ✅ Yes | Internal event type published to NATS | `system.twitch.follow` |
| `description` | ❌ No | Human-readable description | `"New follower event"` |
| `mutation` | ❌ No | State mutation config (e.g., stream state) | See Mutations section |

---

## Enabling EventSub

### Step 1: Enable Feature Flag

Set environment variable before starting `ingress-egress` service:

```bash
# .env or deployment config
ENABLE_EVENTSUB_YAML_CONFIG=true
```

### Step 2: Verify OAuth Scopes

Ensure your Twitch OAuth app has all required scopes. See [OAuth Scopes Reference](#oauth-scopes-reference).

### Step 3: Edit Configuration

Edit `config/twitch-eventsub/subscriptions.yaml`:

```yaml
subscriptions:
  # Enable desired events
  channel.raid:
    enabled: true  # Changed from false

  channel.subscribe:
    enabled: true  # Changed from false
```

### Step 4: Restart Service

```bash
# Local development
npm run local:restart ingress-egress

# Production
brat bit deploy ingress-egress
```

### Step 5: Verify

Check logs for successful subscriptions:

```
[INFO] twitch.eventsub.using_yaml_config
[INFO] subscription_manager.subscribed { eventType: "channel.raid", channel: "bitbrat" }
[INFO] subscription_manager.subscribed { eventType: "channel.subscribe", channel: "bitbrat" }
```

---

## Event Catalog

### Core Events (Enabled by Default)

| Event | Internal Type | Scope | Use Case |
|-------|---------------|-------|----------|
| `channel.follow` | `system.twitch.follow` | `moderator:read:followers` | Track new followers |
| `channel.update` | `system.twitch.update` | None | Detect title/category changes |
| `stream.online` | `system.stream.online` | None | Stream state mutation |
| `stream.offline` | `system.stream.offline` | None | Stream state mutation |

### Tier 1: Engagement & Monetization (Opt-In)

| Event | Internal Type | Scope | Use Case |
|-------|---------------|-------|----------|
| `channel.raid` | `system.twitch.raid` | None | Community engagement |
| `channel.subscribe` | `system.twitch.subscribe` | `channel:read:subscriptions` | New subscriptions |
| `channel.subscription.message` | `system.twitch.subscription.message` | `channel:read:subscriptions` | Resubscriptions with messages |
| `channel.subscription.gift` | `system.twitch.subscription.gift` | `channel:read:subscriptions` | Gift subs |
| `channel.cheer` | `system.twitch.cheer` | `bits:read` | Bit donations |
| `channel.channel_points_custom_reward_redemption.add` | `system.twitch.channelpoints.redemption` | `channel:read:redemptions` | Channel points |
| `channel.hype_train.begin` | `system.twitch.hype_train.begin` | None | Hype train starts |
| `channel.hype_train.progress` | `system.twitch.hype_train.progress` | None | Hype train updates (HIGH VOLUME) |
| `channel.hype_train.end` | `system.twitch.hype_train.end` | None | Hype train ends |
| `channel.poll.begin` | `system.twitch.poll.begin` | None | Poll starts |
| `channel.poll.end` | `system.twitch.poll.end` | None | Poll ends |
| `channel.prediction.begin` | `system.twitch.prediction.begin` | None | Prediction starts |
| `channel.prediction.end` | `system.twitch.prediction.end` | None | Prediction ends |

### Tier 2: Moderation & Chat (Opt-In, HIGH VOLUME)

| Event | Internal Type | Scope | Use Case |
|-------|---------------|-------|----------|
| `channel.ban` | `system.twitch.moderation.ban` | `channel:moderate` | Bans/timeouts |
| `channel.unban` | `system.twitch.moderation.unban` | `channel:moderate` | Unbans |
| `channel.moderate` | `system.twitch.moderation.action` | `channel:moderate` | Moderation actions (HIGH VOLUME) |
| `channel.chat.message` | `chat.message.v1` | `user:read:chat` | All chat messages (overlaps with IRC, HIGH VOLUME) |
| `channel.chat.message_delete` | `system.twitch.chat.message_delete` | `user:read:chat` | Message deletions |

---

## Per-Channel Overrides

Enable/disable specific events for individual channels. Overrides are applied on top of global defaults.

### Example: Enable Moderation for Specific Channel

```yaml
channelOverrides:
  bitbrat:
    channel.ban:
      enabled: true
    channel.unban:
      enabled: true
    channel.moderate:
      enabled: true
```

### Example: Disable High-Volume Events Per Channel

```yaml
channelOverrides:
  smallchannel:
    # Disable high-volume events for smaller channels
    channel.hype_train.progress:
      enabled: false
    channel.chat.message:
      enabled: false
```

### Override Behavior

- If event enabled globally + disabled for channel → event disabled for that channel
- If event disabled globally + enabled for channel → event enabled for that channel
- If no override specified → global default applies

---

## State Mutations

Some events trigger state mutations (persisted key-value changes). Used for stream state tracking.

### Stream State Example

```yaml
stream.online:
  enabled: true
  builder: buildStreamOnline
  internalType: system.stream.online
  mutation:
    key: stream.state
    value: on
    ttl: 21600  # 6 hours

stream.offline:
  enabled: true
  builder: buildStreamOffline
  internalType: system.stream.offline
  mutation:
    key: stream.state
    value: off
    ttl: 21600  # 6 hours
```

**Mutation Fields:**
- `key`: State key name (scoped to channel)
- `value`: State value to set
- `ttl`: Time-to-live in seconds (default: 86400 / 24 hours)

Mutations published to `internal.mutations.v1` topic and processed by state management services.

---

## OAuth Scopes Reference

| Scope | Required For | Notes |
|-------|--------------|-------|
| `moderator:read:followers` | `channel.follow` | Must be channel owner or moderator |
| `channel:read:subscriptions` | `channel.subscribe`, `channel.subscription.message`, `channel.subscription.gift` | Subscription events |
| `bits:read` | `channel.cheer` | Bit/cheer events |
| `channel:read:redemptions` | `channel.channel_points_custom_reward_redemption.add` | Channel points |
| `channel:moderate` | `channel.ban`, `channel.unban`, `channel.moderate` | Moderation events |
| `user:read:chat` | `channel.chat.message`, `channel.chat.message_delete` | Chat events (use IRC instead) |

**Missing Scope Behavior:**
- Subscription skipped with warning log
- Service continues without errors (fail-open)
- MCP tools report "Missing OAuth scope" status

---

## Runtime Control

### MCP Tools

**List Subscription Configurations:**
```typescript
twitch.eventsub.subscriptions.list()
// Returns: { version, subscriptionCount, enabledCount, subscriptions, channelOverrides }
```

**Get Subscription Runtime Status:**
```typescript
twitch.eventsub.subscriptions.status({ channel?: "bitbrat" })
// Returns: { totalSubscriptions, subscriptions: [{ eventType, status, eventCount, errorCount, ... }] }
```

**Reload Config Without Restart:**
```typescript
twitch.eventsub.config.reload()
// Returns: { success: true, note: "Requires service restart to recreate subscriptions" }
```

⚠️ **Note:** Config reload updates in-memory config but does NOT recreate subscriptions. Restart service to apply changes.

### Health Check Endpoint

**HTTP Endpoint:**
```bash
curl http://localhost:3001/_debug/twitch/eventsub
```

**Response:**
```json
{
  "enabled": true,
  "useYamlConfig": true,
  "subscriptionCount": 22,
  "activeSubscriptions": 18,
  "totalEvents": 1234,
  "totalErrors": 0,
  "subscriptions": [
    {
      "channel": "bitbrat",
      "eventType": "channel.follow",
      "internalType": "system.twitch.follow",
      "status": "active",
      "eventCount": 42,
      "errorCount": 0,
      "createdAt": "2026-08-16T00:00:00Z",
      "lastEventAt": "2026-08-16T12:00:00Z"
    }
  ]
}
```

---

## Migration from Hardcoded to YAML

### Phase 1: Validate Config (No Changes)

1. Edit `subscriptions.yaml` - ensure 4 existing events enabled
2. Keep feature flag **OFF** (`ENABLE_EVENTSUB_YAML_CONFIG=false`)
3. Restart service - verify existing events still work
4. Config file is loaded and validated but NOT used

### Phase 2: Enable YAML (Gradual Rollout)

1. Set `ENABLE_EVENTSUB_YAML_CONFIG=true` in staging/dev environment
2. Monitor logs for successful subscriptions
3. Use MCP tools to verify subscriptions created
4. Monitor for 24-48 hours
5. Roll out to production channels gradually

### Phase 3: Enable Additional Events

1. Edit `subscriptions.yaml` - enable desired Tier 1 events
2. Restart service
3. Verify via MCP tools: `twitch.eventsub.subscriptions.status()`
4. Monitor event rates and errors

### Rollback Procedure

If issues occur:

1. Set `ENABLE_EVENTSUB_YAML_CONFIG=false` (or unset)
2. Restart service
3. Platform reverts to hardcoded 4-event subscriptions
4. No data loss - IRC chat continues working independently

---

## Best Practices

### Event Selection

✅ **DO:**
- Enable only events you need (reduces processing overhead)
- Use per-channel overrides for channel-specific needs
- Start with Tier 1 events (high value, low volume)
- Monitor event rates before enabling Tier 2 (high volume)

❌ **DON'T:**
- Enable all events by default (unnecessary processing)
- Use `channel.chat.message` if IRC is available (redundant, high volume)
- Ignore OAuth scope requirements (events will fail silently)

### High-Volume Events

These events generate significant message volume:

- `channel.hype_train.progress` - Updates every few seconds during hype train
- `channel.moderate` - Every moderation action
- `channel.chat.message` - Every chat message (use IRC instead)

**Recommendations:**
- Enable high-volume events per-channel only (not globally)
- Monitor message bus throughput
- Ensure sufficient NATS/Pub/Sub capacity

### OAuth Scope Management

- Request minimum required scopes for enabled events
- Document scope requirements in deployment docs
- Validate scopes during deployment (MCP tool shows missing scopes)

### Configuration Changes

- Test config changes in dev/staging before production
- Use `twitch.eventsub.config.reload()` to validate syntax
- Always restart service to apply subscription changes
- Monitor logs after restart for subscription errors

---

## Troubleshooting

### EventSub Not Starting

**Symptom:** No EventSub subscriptions created, health endpoint shows `enabled: false`

**Causes:**
1. Feature flag not set: `ENABLE_EVENTSUB_YAML_CONFIG=false` or unset
2. Missing Twitch credentials: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_ACCESS_TOKEN`
3. Invalid YAML config: Parse errors or schema validation failures

**Fix:**
```bash
# Check feature flag
echo $ENABLE_EVENTSUB_YAML_CONFIG  # Should be "true"

# Check credentials
echo $TWITCH_CLIENT_ID  # Should be set
echo $TWITCH_ACCESS_TOKEN  # Should be set

# Validate config
npm run brat -- config validate config/twitch-eventsub/subscriptions.yaml

# Check logs
brat fleet logs ingress-egress --level info | grep eventsub
```

### Subscription Skipped (Missing OAuth Scope)

**Symptom:** Event enabled but not subscribed, log shows `subscription_manager.scope_validation_failed`

**Cause:** Twitch OAuth token missing required scope for event

**Fix:**
1. Check required scope in `subscriptions.yaml` for that event
2. Update Twitch OAuth app scopes
3. Regenerate access token with new scopes
4. Restart service

### Events Not Publishing

**Symptom:** Subscriptions active but no events in logs

**Causes:**
1. Event builder not registered in `EventBuilderRegistry`
2. Listener method mapping missing in `SubscriptionManager.getListenerMethod()`
3. NATS connection issues

**Fix:**
```bash
# Check subscription status
twitch.eventsub.subscriptions.status()

# Check if events are being received (eventCount > 0)
# If eventCount = 0 but subscription active, Twitch may not be sending events

# Check NATS connection
brat fleet health ingress-egress
```

### High Error Count

**Symptom:** `twitch.eventsub.subscriptions.status()` shows high `errorCount`

**Causes:**
1. Event builder throwing errors (malformed event data)
2. NATS publish failures
3. Invalid internal event structure

**Fix:**
```bash
# Check logs for error details
brat fleet logs ingress-egress --level error | grep eventsub

# Check specific subscription status
twitch.eventsub.subscriptions.status({ channel: "bitbrat" })

# Look for lastErrorAt timestamp to identify when errors started
```

---

## Reference

### Related Documentation

- [Adding EventSub Events (Developer Guide)](./adding-eventsub-events.md)
- [EventSub Event Catalog](../reference/twitch-eventsub-catalog.md)
- [MCP Tools Reference](../reference/mcp-tools-twitch.md)
- [Migration Guide](../../planning/sprint-16-aalwmj/migration-guide.md)
- [Config Format Reference](../../planning/sprint-16-aalwmj/config-format-reference.md)

### External Resources

- [Twitch EventSub Documentation](https://dev.twitch.tv/docs/eventsub/)
- [Twurple EventSub Guide](https://twurple.js.org/docs/eventsub/listeners/)
- [Twitch OAuth Scopes](https://dev.twitch.tv/docs/authentication/scopes/)

### Support

- GitHub Issues: [BitBrat Platform Issues](https://github.com/navta/BitBratPlatform/issues)
- Sprint Artifacts: `planning/sprint-16-aalwmj/`
