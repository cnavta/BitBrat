# Dev MCP Messaging Tools

**Sprint 39**: Messaging tools for coding agents to test chat flows and inject events into BitBrat execution contexts.

## Overview

Dev MCP Messaging Tools provide MCP-based interfaces for sending chat messages and injecting events into BitBrat environments (local, staging, production). Enables coding agents to:

- **Test chat flows** without manual interaction
- **Emulate platforms** (Discord, Twitch, Slack, Twilio) for integration testing
- **Inject custom events** with full control over metadata
- **Verify message routing** through the agent flow pipeline
- **Debug platform-specific behavior** in isolation

**Core capabilities:**
- `message.send`: Simple chat message sending with platform emulation
- `event.send`: Full `InternalEventV2` event injection (requires `event:inject` permission)
- Platform presets for Discord, Twitch, Slack, Twilio, API
- WebSocket connection management with automatic reconnection
- Response correlation and timeout handling
- Audit logging for security and debugging

## Quick Start

### 1. Deploy api-gateway

```bash
# Deploy to local context
npm run brat -- bit deploy api-gateway

# OR deploy to agent-dev context
npm run brat -- agent-dev provision --name agent-dev-test
npm run brat -- bit deploy api-gateway --context agent-dev-test
```

### 2. Send a test message

```typescript
// From Claude Code MCP tools
message.send({
  context: 'local',           // or 'agent-dev-test', 'staging', etc.
  text: 'Hello, world!',
  platform: 'api',            // optional: discord, twitch, slack, twilio
  waitForResponse: true
})
```

### 3. Verify in logs

```bash
# Check api-gateway logs for message
npm run brat -- fleet logs api-gateway --limit 20

# Trace full message flow
npm run brat -- fleet trace <correlationId>
```

That's it! The message flows through the full agent pipeline (ingress → routing → LLM → egress).

## Tool Reference

### `message.send`

Send simple chat message with platform emulation.

**Parameters:**
- `context` (string, optional): Execution context (`local`, `staging`, `prod`). Defaults to server startup context.
- `text` (string, **required**): Message text to send
- `platform` (enum, optional): Platform to emulate (`api`, `discord`, `twitch`, `slack`, `twilio`). Default: `api`
- `userId` (string, optional): User ID for identity. Default: `brat-dev-mcp:chat`
- `waitForResponse` (boolean, optional): Wait for response from platform. Default: `true`
- `timeoutMs` (number, optional): Timeout in milliseconds. Default: `15000` (15s)

**Returns:**
```json
{
  "status": "success",
  "correlationId": "abc123...",
  "trace": "Use fleet.trace({ correlationId: \"...\", context: \"...\" })",
  "context": "local",
  "platform": "api",
  "response": {
    "type": "chat.message.received",
    "message": { ... },
    "candidates": [ ... ]
  }
}
```

**Example - Simple chat:**
```typescript
message.send({
  text: 'What is the weather?',
  waitForResponse: true
})
```

**Example - Discord emulation:**
```typescript
message.send({
  text: '!help',
  platform: 'discord',
  userId: 'discord-user-123',
  waitForResponse: true
})
```

**Example - Fire-and-forget:**
```typescript
message.send({
  text: 'Background task trigger',
  waitForResponse: false
})
```

---

### `event.send`

Send full `InternalEventV2` event with complete control over metadata.

**Security**: Requires `event:inject` permission. Dev tokens (`brat-dev-mcp:*`, `dev-tools:*`) auto-granted.

**Parameters:**
- `context` (string, optional): Execution context. Defaults to server startup context.
- `event` (object|string, **required**): Partial `InternalEventV2` structure (object or JSON string)
- `waitForResponse` (boolean, optional): Wait for response. Default: `true`
- `timeoutMs` (number, optional): Timeout in milliseconds. Default: `15000`

**Event structure** (all fields optional except `type`):
```typescript
{
  type: 'chat.message.v1',           // Event type
  message: {                          // Message content
    id: 'msg-1',
    role: 'user',
    text: 'Message text'
  },
  ingress: {                         // Ingress metadata
    connector: 'discord',            // Platform connector
    source: 'ingress.discord',       // Source service
    ingressAt: '2026-01-01T00:00:00Z'
  },
  identity: {                        // User identity
    external: {
      id: 'user-123',
      platform: 'discord',
      displayName: 'Test User'
    }
  },
  egress: {                          // Egress destination
    destination: 'channel-123',
    connector: 'discord',
    type: 'chat'
  },
  annotations: [ ... ],              // Event annotations
  candidates: [ ... ],               // Response candidates
  payload: { ... }                   // Custom payload
}
```

**Returns:**
```json
{
  "status": "success",
  "context": "local",
  "eventType": "chat.message.v1",
  "response": {
    "type": "chat.message.received",
    "correlationId": "abc123...",
    "message": { ... },
    "candidates": [ ... ],
    "annotations": [ ... ]
  }
}
```

**Example - Minimal event:**
```typescript
event.send({
  event: {
    type: 'chat.message.v1',
    message: {
      id: 'msg-1',
      role: 'user',
      text: 'Test message'
    }
  },
  waitForResponse: true
})
```

**Example - Discord emulation:**
```typescript
event.send({
  event: {
    type: 'chat.message.v1',
    message: { id: 'msg-1', role: 'user', text: '!commands' },
    ingress: {
      connector: 'discord',
      source: 'ingress.discord'
    },
    identity: {
      external: {
        id: '123456789',
        platform: 'discord',
        displayName: 'TestUser#1234'
      }
    },
    egress: {
      destination: 'test-channel',
      connector: 'discord'
    }
  }
})
```

## Platform Emulation Guide

### Supported Platforms

| Platform | Connector | Source | Default User ID | Default Destination |
|----------|-----------|--------|-----------------|---------------------|
| Discord  | `discord` | `ingress.discord` | `dev-mcp-user` | `dev-test-channel` |
| Twitch   | `twitch`  | `ingress.twitch`  | `dev_mcp_user` | `bitbrat` (channel) |
| Slack    | `slack`   | `ingress.slack`   | `U12345DEV` | `C12345DEV` (channel) |
| Twilio   | `twilio`  | `ingress.twilio`  | `+15555551234` | `+15555551234` (phone) |
| API      | `api`     | `api-gateway`     | `brat-dev-mcp:chat` | `brat-dev-mcp:chat` |

### Discord Example

```typescript
// Method 1: Use message.send with platform parameter
message.send({
  text: '!help',
  platform: 'discord',
  userId: '987654321',
  waitForResponse: true
})

// Method 2: Use event.send for full control
event.send({
  event: {
    type: 'chat.message.v1',
    message: { id: 'msg-1', role: 'user', text: '!help' },
    ingress: {
      connector: 'discord',
      source: 'ingress.discord'
    },
    identity: {
      external: {
        id: '987654321',
        platform: 'discord',
        displayName: 'TestUser#1234'
      }
    },
    egress: {
      destination: 'test-channel-id',
      connector: 'discord'
    }
  }
})
```

### Twitch Example

```typescript
message.send({
  text: '!commands',
  platform: 'twitch',
  userId: 'streamer_name',
  waitForResponse: true
})
```

### Slack Example

```typescript
message.send({
  text: 'help',
  platform: 'slack',
  userId: 'U12345ABC',
  waitForResponse: true
})
```

### Twilio (SMS) Example

```typescript
message.send({
  text: 'sms test',
  platform: 'twilio',
  userId: '+15551234567',
  waitForResponse: true
})
```

## Authentication & Permissions

### Auto-Granted Permissions

Dev tokens automatically receive `event:inject` permission:
- User ID pattern: `brat-dev-mcp:*`
- User ID pattern: `dev-tools:*`

Example: `brat-dev-mcp:chat` → auto-granted `event:inject`

### Token Acquisition

Dev MCP server handles token acquisition automatically:

1. **Check connection cache**: Reuses existing token if available
2. **Check environment**: `DEV_MCP_AUTH_TOKEN` or `BITBRAT_AUTH_TOKEN`
3. **Generate (agent-dev only)**: Secure random token for `agent-dev-*` contexts
4. **Error (production)**: Requires `BITBRAT_AUTH_TOKEN` for non-agent-dev contexts

```bash
# Set token manually (optional)
export DEV_MCP_AUTH_TOKEN=your-token-here

# OR let system generate for agent-dev contexts
# (automatic, no action required)
```

### Permission Errors

If you receive a permission error:

```
Permission denied: event.inject.v2 requires "event:inject" permission
```

**Solutions:**
1. Verify user ID matches auto-grant patterns (`brat-dev-mcp:*` or `dev-tools:*`)
2. Check `BITBRAT_AUTH_TOKEN` is set (for non-agent-dev contexts)
3. Confirm api-gateway is running and accessible
4. Check api-gateway logs for permission denials

### Anonymous Users

Event injection is **never** available for anonymous users:

```
Permission denied: event.inject.v2 is not available for anonymous connections
```

Always authenticate with a Bearer token.

## Troubleshooting

### Connection Errors

**Error**: `Failed to connect to api-gateway`

**Solutions:**
1. Verify api-gateway is running:
   ```bash
   docker ps | grep api-gateway
   ```
2. Check gateway URL is correct:
   - Local: `ws://localhost:3008`
   - Agent-dev: `ws://localhost:3008`
   - Staging: Check execution context config
3. Check firewall/network accessibility

---

### Timeout Errors

**Error**: `Response timeout after 15000ms`

**Causes:**
- LLM inference taking >15 seconds
- Event routing misconfigured (no egress route)
- Service crash during processing
- Message bus connectivity issues

**Solutions:**
1. Increase timeout:
   ```typescript
   message.send({
     text: 'Complex query...',
     timeoutMs: 30000  // 30 seconds
   })
   ```
2. Check event-router logs for routing errors
3. Check LLM service logs for processing errors
4. Use fire-and-forget for background tasks:
   ```typescript
   message.send({ text: '...', waitForResponse: false })
   ```

---

### Invalid Connector Errors

**Error**: `Invalid connector: "xxx". Allowed connectors: api, discord, twitch, twilio, slack`

**Solution:** Use only supported connectors:
```typescript
// ❌ Bad
event.send({ event: { ingress: { connector: 'custom-platform' } } })

// ✅ Good
event.send({ event: { ingress: { connector: 'discord' } } })
```

---

### Malformed Event Errors

**Error**: `Invalid event.inject.v2 frame: payload.event is required`

**Solution:** Ensure `event` field is provided:
```typescript
// ❌ Bad
event.send({ type: 'chat.message.v1' })

// ✅ Good
event.send({
  event: {  // ← Required wrapper
    type: 'chat.message.v1',
    message: { id: 'msg-1', role: 'user', text: 'test' }
  }
})
```

---

### No Response Received

**Symptom**: Message sent but no response in result

**Causes:**
- `waitForResponse: false` (expected behavior)
- Egress destination unreachable
- WebSocket disconnected before response

**Solutions:**
1. Verify `waitForResponse: true`
2. Check api-gateway egress logs
3. Check connection status: `client.isClientConnected()`
4. Use fleet.trace to debug message flow

## Use Cases & Examples

### Testing Chat Commands

```typescript
// Test Discord bot command
message.send({
  text: '!weather San Francisco',
  platform: 'discord',
  userId: 'test-user-123',
  waitForResponse: true
})

// Verify response
fleet.trace({ correlationId: '<from-response>' })
```

### Debugging Platform-Specific Behavior

```typescript
// Emulate Twitch chat message
message.send({
  text: '!uptime',
  platform: 'twitch',
  userId: 'viewer_name',
  waitForResponse: true
})

// Check if Twitch-specific annotations applied
// (e.g., subscriber badge, moderator status)
```

### Integration Testing

```typescript
// Test full flow: ingress → routing → LLM → egress
message.send({
  text: 'integration test query',
  platform: 'api',
  waitForResponse: true,
  timeoutMs: 30000
})

// Verify:
// 1. Event routed correctly
// 2. LLM responded
// 3. Response formatted correctly
// 4. Egress delivered to correct destination
```

### Load Testing

```typescript
// Send concurrent messages
const messages = Array.from({ length: 10 }, (_, i) =>
  message.send({
    text: `Load test message ${i}`,
    waitForResponse: false
  })
);

await Promise.all(messages);
```

### Custom Event Injection

```typescript
// Inject custom event type for testing new features
event.send({
  event: {
    type: 'custom.feature.test.v1',
    payload: {
      featureName: 'new-feature',
      testData: { key: 'value' }
    },
    ingress: {
      connector: 'api',
      source: 'integration-test'
    }
  },
  waitForResponse: true
})
```

## Security Model

### Permission Enforcement

- **event.inject.v2** requires `event:inject` permission
- **chat.message.v1** requires no special permission
- Dev tokens (`brat-dev-mcp:*`, `dev-tools:*`) auto-granted
- Anonymous users always rejected
- Connector validation prevents forgery
- Routing slip always initialized (prevents manipulation)

### Audit Logging

All event injections logged with **dual identity**:

```json
{
  "realUserId": "brat-dev-mcp:chat",        // Actual authenticated user
  "emulatedIdentity": "discord-user-123",   // Emulated user in event
  "emulatedPlatform": "discord",            // Emulated platform
  "emulatedConnector": "discord",           // Emulated connector
  "permissions": ["event:inject"]
}
```

Enables security audits and debugging of platform emulation.

### Security Best Practices

1. **Never commit auth tokens** to version control
2. **Use environment variables** for `BITBRAT_AUTH_TOKEN`
3. **Rotate tokens periodically** in production
4. **Monitor audit logs** for suspicious activity
5. **Limit event:inject permission** to dev/admin users only
6. **Validate all inputs** when building custom events
7. **Test in agent-dev first** before production

## Advanced Topics

### Connection Caching

Dev MCP tools cache WebSocket connections per execution context:

```typescript
// First call: Creates new connection
message.send({ text: 'Message 1' })

// Second call: Reuses cached connection
message.send({ text: 'Message 2' })

// Reconnects automatically if connection lost
```

### Response Correlation

Messages correlated by `correlationId`:

```typescript
const result = await message.send({ text: 'Query' })

// Extract correlationId
const response = JSON.parse(result.content[0].text)
const correlationId = response.correlationId

// Trace full flow
fleet.trace({ correlationId, context: 'local' })
```

### Platform Preset Customization

Override platform presets for custom behavior:

```typescript
event.send({
  event: {
    type: 'chat.message.v1',
    message: { id: 'msg-1', role: 'user', text: 'custom' },

    // Custom Discord setup
    ingress: {
      connector: 'discord',
      source: 'ingress.discord',
      channel: 'custom-channel-id'  // ← Override default
    },
    identity: {
      external: {
        id: '123456789',
        platform: 'discord',
        displayName: 'CustomBot#0001',  // ← Custom display name
        avatarUrl: 'https://...'         // ← Additional metadata
      }
    }
  }
})
```

## API Reference

See also:
- [ApiGatewayClient API](../reference/api-gateway-client.md)
- [Platform Emulation Presets](../reference/platform-presets.md)
- [Event Injection Security](../reference/event-injection-security.md)
- [Troubleshooting Guide](./troubleshooting.md)

## Related Documentation

- **CLAUDE.md**: Pattern examples for coding agents
- **documentation/concepts/agent-dev-contexts.md**: Agent-dev provisioning
- **documentation/guides/brat-fleet.md**: Fleet administration
- **documentation/reference/topic-catalog.md**: Message bus topics
- **src/services/api-gateway/README.md**: API Gateway architecture
