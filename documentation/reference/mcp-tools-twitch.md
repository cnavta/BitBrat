# Twitch EventSub MCP Tools Reference

> **Sprint:** 16 (M5 Phase 2 - Observability)
> **Status:** Production-ready
> **Service:** `ingress-egress`
> **Exposure:** `platform-only`

The `ingress-egress` service exposes 3 MCP tools for Twitch EventSub runtime observability and control. These tools provide visibility into subscription configuration, runtime health, and config reload capabilities.

---

## Tool Namespace

| Tool | Purpose | Parameters | Returns |
|------|---------|------------|---------|
| `twitch.eventsub.subscriptions.list` | List subscription config from YAML | None | Config structure + metadata |
| `twitch.eventsub.subscriptions.status` | Get runtime subscription health | `channel?` (optional) | Runtime status array |
| `twitch.eventsub.config.reload` | Reload YAML config without restart | None | Success/error response |

**RBAC Scope:** All tools require `platform:read` (platform-only exposure).

---

## `twitch.eventsub.subscriptions.list`

**Purpose:** List all EventSub subscription configurations loaded from YAML.

**Description:** Returns the parsed YAML config structure including version, subscription count, enabled subscriptions, and per-channel overrides. Useful for verifying config was loaded correctly and understanding which events are enabled globally vs per-channel.

### Parameters

None.

### Returns

```typescript
{
  available: boolean;           // EventSub availability
  reason?: string;              // If not available, reason why
  version?: number;             // YAML config version
  subscriptionCount?: number;   // Total subscriptions defined
  enabledCount?: number;        // Subscriptions enabled globally
  subscriptions?: Record<string, {
    enabled: boolean;
    version?: number;
    scope?: string;
    priority?: string;
    builder: string;
    internalType: string;
    description?: string;
    mutation?: {
      key: string;
      value: string;
      ttl: number;
    };
  }>;
  channelOverrides?: Record<string, Record<string, { enabled: boolean }>>;
}
```

### Example Usage

```typescript
// Call via MCP
const result = await twitch.eventsub.subscriptions.list();

console.log(result);
// Output:
{
  "version": 1,
  "subscriptionCount": 22,
  "enabledCount": 4,
  "subscriptions": {
    "channel.follow": {
      "enabled": true,
      "version": 2,
      "scope": "moderator:read:followers",
      "priority": "high",
      "builder": "buildFollow",
      "internalType": "system.twitch.follow",
      "description": "New follower event - requires moderator scope..."
    },
    "channel.raid": {
      "enabled": false,
      "version": 1,
      "priority": "high",
      "builder": "buildRaid",
      "internalType": "system.twitch.raid",
      "description": "Broadcaster raids another channel..."
    },
    // ... etc for all 22 events
  },
  "channelOverrides": {
    "bitbrat": {
      "channel.raid": { "enabled": true }
    }
  }
}
```

### When EventSub Not Available

```json
{
  "available": false,
  "reason": "EventSub not enabled or listSubscriptions() not implemented"
}
```

**Reasons EventSub may not be available:**
- Feature flag `ENABLE_EVENTSUB_YAML_CONFIG` not set to `true`
- Twitch connector not registered in ingress-egress service
- EventSub client failed to initialize

### Use Cases

✅ **Verify config loaded correctly** after deployment
✅ **Audit which events are enabled** globally vs per-channel
✅ **Understand subscription structure** before enabling new events
✅ **Troubleshoot missing subscriptions** (check if event enabled in YAML)

### Related

- [EventSub Config Guide](../guides/twitch-eventsub-config.md)
- [Migration Guide](../../planning/sprint-16-aalwmj/migration-guide.md)
- Health endpoint: `GET /_debug/twitch/eventsub`

---

## `twitch.eventsub.subscriptions.status`

**Purpose:** Get runtime subscription health and event statistics.

**Description:** Returns current subscription status including event counts, error counts, timestamps, and subscription states. Useful for monitoring operational health, detecting stuck subscriptions, and validating event flow.

### Parameters

```typescript
{
  channel?: string;  // Optional: Filter by channel name
}
```

### Returns

```typescript
{
  available: boolean;            // EventSub availability
  reason?: string;               // If not available, reason why
  totalSubscriptions?: number;   // Total subscriptions active
  filteredCount?: number;        // Subscriptions after channel filter
  subscriptions?: Array<{
    channel: string;             // Channel name
    eventType: string;           // Twitch EventSub event type
    internalType: string;        // Platform internal event type
    status: 'active' | 'error';  // Subscription state
    eventCount: number;          // Total events received
    errorCount: number;          // Total errors encountered
    createdAt: string;           // ISO 8601 timestamp
    lastEventAt?: string;        // Last event received
    lastErrorAt?: string;        // Last error occurred
  }>;
}
```

### Example Usage

#### Get all subscriptions

```typescript
const result = await twitch.eventsub.subscriptions.status();

console.log(result);
// Output:
{
  "totalSubscriptions": 4,
  "filteredCount": 4,
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
    },
    {
      "channel": "bitbrat",
      "eventType": "channel.update",
      "internalType": "system.twitch.update",
      "status": "active",
      "eventCount": 8,
      "errorCount": 0,
      "createdAt": "2026-08-16T00:00:00Z",
      "lastEventAt": "2026-08-16T11:30:00Z"
    },
    // ... more subscriptions
  ]
}
```

#### Filter by channel

```typescript
const result = await twitch.eventsub.subscriptions.status({ channel: "bitbrat" });

console.log(result);
// Output: Only subscriptions for "bitbrat" channel
{
  "totalSubscriptions": 4,
  "filteredCount": 4,
  "subscriptions": [ /* filtered results */ ]
}
```

### When EventSub Not Available

```json
{
  "available": false,
  "reason": "EventSub not enabled or no subscriptions active",
  "subscriptions": []
}
```

### Health Indicators

| Field | Healthy | Unhealthy |
|-------|---------|-----------|
| `status` | `"active"` | `"error"` |
| `eventCount` | > 0 (after some time) | = 0 (no events received) |
| `errorCount` | = 0 | > 0 |
| `lastEventAt` | Recent timestamp | `null` or very old |
| `lastErrorAt` | `null` | Recent timestamp |

**Example unhealthy subscription:**
```json
{
  "channel": "testchannel",
  "eventType": "channel.subscribe",
  "internalType": "system.twitch.subscribe",
  "status": "error",
  "eventCount": 0,
  "errorCount": 15,
  "createdAt": "2026-08-16T00:00:00Z",
  "lastEventAt": null,
  "lastErrorAt": "2026-08-16T12:00:00Z"
}
```

**Diagnosis:** Check logs for error details around `lastErrorAt` timestamp. Likely causes:
- Event builder throwing errors
- NATS publish failures
- Missing OAuth scope

### Use Cases

✅ **Monitor subscription health** in production
✅ **Detect stuck subscriptions** (eventCount = 0 but status = active)
✅ **Identify error sources** (check errorCount, lastErrorAt)
✅ **Validate events flowing** after enabling new event types
✅ **Per-channel health audit** (filter by channel)

### Related

- [EventSub Config Guide](../guides/twitch-eventsub-config.md) - Troubleshooting section
- [Migration Guide](../../planning/sprint-16-aalwmj/migration-guide.md) - Monitoring section
- Health endpoint: `GET /_debug/twitch/eventsub`

---

## `twitch.eventsub.config.reload`

**Purpose:** Reload YAML configuration file without restarting service.

**Description:** Reloads the `subscriptions.yaml` file into memory, validates structure, and updates cached config. **Important:** Does NOT recreate subscriptions - requires service restart to apply subscription changes.

### Parameters

None.

### Returns

```typescript
{
  success: boolean;
  message?: string;
  note?: string;
  error?: string;
}
```

### Example Usage

#### Successful reload

```typescript
const result = await twitch.eventsub.config.reload();

console.log(result);
// Output:
{
  "success": true,
  "message": "Config reloaded successfully",
  "note": "Existing subscriptions NOT updated - requires service restart to recreate subscriptions"
}
```

#### Failure (EventSub not enabled)

```json
{
  "success": false,
  "error": "EventSub not enabled or reloadSubscriptionConfig() not implemented"
}
```

#### Failure (YAML parse error)

```json
{
  "success": false,
  "error": "YAML parse error: unexpected token at line 42"
}
```

### Behavior

**What reload DOES:**
- ✅ Reads `subscriptions.yaml` from disk
- ✅ Parses and validates YAML syntax
- ✅ Updates in-memory cached config
- ✅ Validates against JSON schema
- ✅ Returns success/error status

**What reload DOES NOT DO:**
- ❌ Create new subscriptions
- ❌ Update existing subscriptions
- ❌ Unsubscribe from disabled events
- ❌ Apply per-channel overrides to active subscriptions

**To apply config changes, you MUST restart the service:**
```bash
brat bit deploy ingress-egress
```

### Use Cases

✅ **Validate YAML syntax** before restarting service
✅ **Test config changes** without committing to restart
✅ **Pre-flight check** during migration
❌ **NOT for applying subscription changes** (restart required)

### Workflow Example

```bash
# 1. Edit subscriptions.yaml
vim config/twitch-eventsub/subscriptions.yaml

# 2. Validate changes (optional)
npm run brat -- config validate config/twitch-eventsub/subscriptions.yaml

# 3. Reload config (validate syntax)
twitch.eventsub.config.reload()
# Output: { success: true, ... }

# 4. Restart service to apply
brat bit deploy ingress-egress

# 5. Verify subscriptions updated
twitch.eventsub.subscriptions.status()
```

### Related

- [EventSub Config Guide](../guides/twitch-eventsub-config.md) - Configuration management
- [Migration Guide](../../planning/sprint-16-aalwmj/migration-guide.md) - Phased rollout approach

---

## Common Workflows

### Workflow 1: Verify Config After Deployment

```typescript
// 1. Check config loaded correctly
const config = await twitch.eventsub.subscriptions.list();
console.log(`Loaded ${config.enabledCount} of ${config.subscriptionCount} events`);

// 2. Verify subscriptions created
const status = await twitch.eventsub.subscriptions.status();
console.log(`Active subscriptions: ${status.totalSubscriptions}`);

// 3. Check for errors
const errors = status.subscriptions.filter(s => s.errorCount > 0);
if (errors.length > 0) {
  console.error(`${errors.length} subscriptions have errors:`, errors);
}
```

### Workflow 2: Enable New Event Type

```bash
# 1. Edit subscriptions.yaml
channel.raid:
  enabled: true  # Changed from false

# 2. Validate syntax
twitch.eventsub.config.reload()

# 3. Restart service
brat bit deploy ingress-egress

# 4. Verify subscription created
twitch.eventsub.subscriptions.status()
# Look for channel.raid with status: "active"

# 5. Monitor for events
# Wait 5-10 minutes, then check:
twitch.eventsub.subscriptions.status()
# Verify eventCount > 0 for channel.raid
```

### Workflow 3: Debug Failing Subscription

```typescript
// 1. Check subscription status
const status = await twitch.eventsub.subscriptions.status();

// 2. Find failing subscription
const failing = status.subscriptions.find(s => s.errorCount > 0);
console.log(failing);
// Output:
{
  "channel": "testchannel",
  "eventType": "channel.subscribe",
  "status": "error",
  "errorCount": 10,
  "lastErrorAt": "2026-08-16T12:00:00Z"
}

// 3. Check logs around lastErrorAt
// brat fleet logs ingress-egress --level error | grep "2026-08-16T12:00"

// 4. Check if OAuth scope missing
const config = await twitch.eventsub.subscriptions.list();
console.log(config.subscriptions['channel.subscribe'].scope);
// Output: "channel:read:subscriptions"

// 5. Verify token has required scope
// Check Twitch OAuth token scopes

// 6. If scope missing, disable event temporarily
channel.subscribe:
  enabled: false

// 7. Restart service
// brat bit deploy ingress-egress
```

### Workflow 4: Per-Channel Health Audit

```typescript
// Audit all channels
const channels = ["bitbrat", "channel1", "channel2"];

for (const channel of channels) {
  const status = await twitch.eventsub.subscriptions.status({ channel });

  console.log(`\n=== ${channel} ===`);
  console.log(`Subscriptions: ${status.filteredCount}`);

  const errors = status.subscriptions.filter(s => s.errorCount > 0);
  if (errors.length > 0) {
    console.log(`⚠️  ${errors.length} subscriptions with errors`);
    errors.forEach(e => {
      console.log(`   - ${e.eventType}: ${e.errorCount} errors`);
    });
  } else {
    console.log(`✅ All subscriptions healthy`);
  }

  const totalEvents = status.subscriptions.reduce((sum, s) => sum + s.eventCount, 0);
  console.log(`Total events: ${totalEvents}`);
}
```

---

## Error Handling

All tools return success/error responses (never throw exceptions).

### Common Error Responses

#### EventSub Not Enabled

```json
{
  "available": false,
  "reason": "EventSub not enabled or <method> not implemented"
}
```

**Cause:** `ENABLE_EVENTSUB_YAML_CONFIG` not set to `true`

**Fix:**
```bash
ENABLE_EVENTSUB_YAML_CONFIG=true
brat bit deploy ingress-egress
```

#### Twitch Connector Not Available

```json
{
  "available": false,
  "reason": "Twitch connector not registered"
}
```

**Cause:** ingress-egress service doesn't have Twitch connector enabled

**Fix:** Check `architecture.yaml` service config, ensure Twitch connector included

#### Config Reload Failed

```json
{
  "success": false,
  "error": "YAML parse error: unexpected token at line 42"
}
```

**Cause:** Invalid YAML syntax

**Fix:**
```bash
# Validate YAML
npm run brat -- config validate config/twitch-eventsub/subscriptions.yaml

# Check syntax at line 42
vim +42 config/twitch-eventsub/subscriptions.yaml
```

---

## HTTP Health Endpoint

In addition to MCP tools, the ingress-egress service exposes an HTTP health endpoint for monitoring systems.

### Endpoint

```
GET /_debug/twitch/eventsub
```

### Response

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
    // ... more subscriptions
  ]
}
```

### When EventSub Disabled

```json
{
  "enabled": false,
  "reason": "EventSub not enabled"
}
```

### Use Cases

✅ **Monitoring system integration** (Prometheus, Datadog, etc.)
✅ **Health checks** in load balancers
✅ **Quick status check** without MCP tooling
✅ **Debugging** via curl/browser

### Example Usage

```bash
# Local development
curl http://localhost:3001/_debug/twitch/eventsub

# Staging
curl https://staging.bitbrat.dev/_debug/twitch/eventsub

# Production
curl https://api.bitbrat.dev/_debug/twitch/eventsub | jq '.totalErrors'
```

---

## Tool Comparison

| Feature | MCP Tools | HTTP Endpoint |
|---------|-----------|---------------|
| **Access** | Requires MCP client | curl/browser |
| **Auth** | Platform RBAC | None (firewall-protected) |
| **Format** | MCP response | JSON |
| **Config Details** | `subscriptions.list()` full YAML | Not available |
| **Runtime Status** | `subscriptions.status()` detailed | Same data |
| **Config Reload** | `config.reload()` | Not available |
| **Use Case** | Operational control | Monitoring/debugging |

**Recommendation:**
- Use **MCP tools** for operational tasks (reload config, detailed status, config audit)
- Use **HTTP endpoint** for monitoring integration, quick checks, non-MCP environments

---

## RBAC and Security

### MCP Tools

**Scope:** `platform:read` (all tools)

**Exposure:** `platform-only` (not exposed to domain agents)

**Rationale:** EventSub subscription management is platform operations, not domain functionality.

### HTTP Endpoint

**Security:** Internal endpoint (firewall-protected, not public)

**Authentication:** None (relies on network security)

**Data Exposure:**
- ✅ Subscription counts, event counts, status
- ✅ Event types (public Twitch event types)
- ❌ NO secrets (access tokens, client secrets, etc.)
- ❌ NO raw event payloads (privacy)

**Recommendation:** Deploy behind firewall or VPC. Do NOT expose to public internet.

---

## Performance Considerations

### Tool Response Times

| Tool | Typical Latency | Notes |
|------|----------------|-------|
| `subscriptions.list()` | < 10ms | Cached in-memory config |
| `subscriptions.status()` | < 50ms | Iterates active subscriptions (O(n)) |
| `config.reload()` | < 100ms | File I/O + YAML parse |

### Caching

- **Config:** Cached in-memory after first load (reload() updates cache)
- **Status:** Computed on-demand from in-memory subscription map
- **No external calls:** All data local to ingress-egress service

### Scaling

- Tools are **stateless** (safe to call from multiple clients concurrently)
- **No rate limiting** (internal tools only)
- **Thread-safe** (Node.js single-threaded event loop)

---

## Related Documentation

### Guides
- [EventSub Configuration Guide](../guides/twitch-eventsub-config.md)
- [Adding EventSub Events](../guides/adding-eventsub-events.md)
- [Migration Guide](../../planning/sprint-16-aalwmj/migration-guide.md)

### Reference
- [EventSub Event Catalog](./twitch-eventsub-catalog.md)
- [Bit Control Plane](./bit-control-plane.md)
- [Topic Catalog](./topic-catalog.md)

### Sprint Artifacts
- [Milestone 5 Review](../../planning/sprint-16-aalwmj/milestone-5-review.md)
- [Config Format Reference](../../planning/sprint-16-aalwmj/config-format-reference.md)

### External Resources
- [Twitch EventSub Documentation](https://dev.twitch.tv/docs/eventsub/)
- [Twurple EventSub Listeners](https://twurple.js.org/docs/eventsub/listeners/)

---

**Last Updated:** Sprint 16 (M5 Phase 2 - Observability)
**Maintained By:** Platform team
**Status:** Production-ready
