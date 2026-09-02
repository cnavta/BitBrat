# Technical Architecture: Dev MCP Messaging Tools

**Sprint**: sprint-39-62r0fc
**Author**: Architect (Claude Code)
**Date**: 2026-09-01
**Status**: Draft

## Executive Summary

This document specifies the architecture for a new Dev MCP tool category that enables coding agents to send chat messages and arbitrary InternalEventV2 events to any BitBrat execution context via api-gateway. The tooling provides platform emulation capabilities and integrates seamlessly with agent-dev workflows for rapid verification and debugging.

**Core Value Proposition**: Transform agent-driven testing from "deploy and hope" to "test and verify" by giving agents first-class messaging capabilities.

## 1. Goals & Non-Goals

### Primary Goals
1. **Simple Chat Interface**: Provide `message.send()` tool for basic text messaging
2. **Full Event Control**: Provide `event.send()` tool for arbitrary InternalEventV2 construction
3. **Platform Emulation**: Support posing as Discord, Twitch, Twilio, Slack, or API sources
4. **Agent-Dev Integration**: Seamless workflow for testing agent-dev environments
5. **Multi-Context Support**: Work across local, staging, prod, and agent-dev contexts

### Secondary Goals
- Response validation (verify egress messages returned)
- Correlation tracking (link sent messages to responses)
- Token management (handle api-gateway authentication)
- Error debugging (clear failure messages)

### Non-Goals
- Real platform integration (no actual Discord/Twitch API calls)
- Message persistence beyond correlation tracking
- Webhook simulation (webhooks bypass api-gateway)
- Load testing (single-message focus)

## 2. Current State Analysis

### Existing Infrastructure

**Dev MCP Server** (`tools/brat/src/dev-mcp/`):
- ✅ Runtime context switching (Sprint 366)
- ✅ Tool registration framework
- ✅ Target connection management
- ✅ Audit logging
- ✅ Existing tool categories: config, persistence, fleet, agent-dev

**API Gateway** (`src/apps/api-gateway.ts`):
- ✅ WebSocket server on `/ws/v1`
- ✅ Bearer token authentication
- ✅ Anonymous mode (`API_GATEWAY_ALLOW_ANONYMOUS_WS=true`)
- ✅ IngressManager for message normalization
- ✅ EgressManager for WebSocket delivery
- ✅ Instance-specific and broadcast egress topics

**IngressManager** (`src/services/api-gateway/ingress.ts`):
- ✅ Accepts `InboundFrame` with `type` and `payload`
- ✅ Builds InternalEventV2 events
- ✅ Maps `chat.message.send` → `chat.message.v1`
- ✅ Publishes to `internal.ingress.v1`
- ✅ Sets connector: 'api', source: 'api-gateway'

### Gaps & Challenges

1. **No WebSocket Client**: Dev MCP needs WebSocket client for api-gateway
2. **Token Management**: Need to acquire/manage auth tokens for non-anonymous access
3. **Platform Emulation**: IngressManager hardcodes `connector: 'api'`, need override mechanism
4. **Response Correlation**: No existing pattern for matching egress to ingress
5. **Connection Lifecycle**: Need to manage persistent WebSocket connections per context

## 3. Proposed Solution Architecture

### 3.1 Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Dev MCP Server                           │
│  ┌────────────────────────────────────────────────────┐     │
│  │          Messaging Tools (NEW)                      │     │
│  │  - message.send()    Simple chat interface         │     │
│  │  - event.send()      Full event construction       │     │
│  │  - session.create()  Establish context session     │     │
│  └────────────────────────────────────────────────────┘     │
│                           ↓                                  │
│  ┌────────────────────────────────────────────────────┐     │
│  │      ApiGatewayClient (NEW)                        │     │
│  │  - WebSocket connection management                 │     │
│  │  - Token authentication                            │     │
│  │  - Message sending                                 │     │
│  │  - Response listening                              │     │
│  │  - Connection pooling (per context)                │     │
│  └────────────────────────────────────────────────────┘     │
│                           ↓                                  │
│  ┌────────────────────────────────────────────────────┐     │
│  │      TargetConnection                              │     │
│  │  - Context resolution                              │     │
│  │  - Gateway URL discovery                           │     │
│  │  - Token acquisition                               │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
                           ↓ WebSocket (wss://)
┌─────────────────────────────────────────────────────────────┐
│               API Gateway (EXISTING)                         │
│  ┌────────────────────────────────────────────────────┐     │
│  │  WebSocket Server (/ws/v1)                         │     │
│  │  - Bearer token auth                               │     │
│  │  - IngressManager (message → InternalEventV2)      │     │
│  │  - EgressManager (InternalEventV2 → WebSocket)     │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
                           ↓ NATS/Pub/Sub
┌─────────────────────────────────────────────────────────────┐
│              BitBrat Platform Services                       │
│   event-router → auth → llm-bot → tool-gateway              │
│                    ↓ internal.egress.v1                      │
│                  api-gateway                                 │
│                    ↓ WebSocket                               │
│              Dev MCP (response)                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow

#### Simple Chat Message Flow
```
1. Agent calls message.send({ text: "Hello", context: "agent-dev-test" })
2. Dev MCP resolves context → gateway URL: http://localhost:3008
3. ApiGatewayClient establishes WebSocket: ws://localhost:3008/ws/v1
4. Client sends InboundFrame:
   {
     type: "chat.message.v1",
     payload: { text: "Hello", channel: "test" },
     metadata: { id: "msg-123", timestamp: "..." }
   }
5. IngressManager builds InternalEventV2:
   - type: chat.message.v1
   - correlationId: msg-123
   - connector: api (hardcoded)
   - source: api-gateway
   - message.text: "Hello"
6. Event published to internal.ingress.v1
7. Platform processing (router → auth → llm-bot → ...)
8. Response published to internal.egress.v1
9. EgressManager delivers to WebSocket
10. ApiGatewayClient receives response
11. Tool returns response to agent
```

#### Full Event with Platform Emulation
```
1. Agent calls event.send({
     type: "chat.message.v1",
     emulate: "discord",
     identity: { id: "user-123", displayName: "TestUser" },
     message: { text: "!help" },
     context: "agent-dev-test"
   })
2. ApiGatewayClient sends InboundFrame with extended payload
3. CHALLENGE: IngressManager hardcodes connector: 'api'
   SOLUTION OPTIONS:
   a) Extend IngressManager to respect payload.connector override
   b) Create new InboundFrame type: "event.inject.v2"
   c) Send pre-built InternalEventV2 (bypass IngressManager)
```

**RECOMMENDATION**: Option B - Introduce `event.inject.v2` frame type that bypasses IngressManager normalization.

## 4. Detailed Component Design

### 4.1 ApiGatewayClient

**Location**: `tools/brat/src/dev-mcp/api-gateway-client.ts`

**Responsibilities**:
- Establish/maintain WebSocket connections per context
- Authenticate with Bearer tokens
- Send InboundFrame messages
- Listen for egress responses
- Correlate requests/responses
- Handle reconnection

**Interface**:
```typescript
interface ApiGatewayClientOptions {
  gatewayUrl: string;         // ws://localhost:3008 or wss://...
  authToken?: string;         // Bearer token (optional for anonymous)
  userId?: string;            // Override userId (for brat-chat:* pattern)
  logger: Logger;
  autoReconnect?: boolean;    // Default: false (single-use connections)
}

interface SendMessageOptions {
  type: string;               // chat.message.v1, etc.
  payload: Record<string, any>;
  metadata?: {
    id?: string;              // Auto-generated if omitted
    timestamp?: string;
  };
  waitForResponse?: boolean;  // Default: true
  timeoutMs?: number;         // Default: 10000
}

interface SendEventOptions {
  event: Partial<InternalEventV2>;  // Pre-built event structure
  waitForResponse?: boolean;
  timeoutMs?: number;
}

class ApiGatewayClient {
  constructor(options: ApiGatewayClientOptions);

  async connect(): Promise<void>;
  async disconnect(): Promise<void>;

  async sendMessage(options: SendMessageOptions): Promise<InternalEventV2 | null>;
  async sendEvent(options: SendEventOptions): Promise<InternalEventV2 | null>;

  on(event: 'message', handler: (msg: InternalEventV2) => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
  on(event: 'close', handler: () => void): void;

  isConnected(): boolean;
}
```

**Connection Pooling**:
- Single WebSocket connection per context
- Reuse connection across multiple tool calls
- Cleanup on DevMcpServer shutdown
- Store in TargetConnection.gateway.client

**Response Correlation**:
- Track pending requests by correlationId
- Timeout handling (reject promise after N seconds)
- Support for fire-and-forget (waitForResponse: false)

### 4.2 Messaging Tools

**Location**: `tools/brat/src/dev-mcp/tools/messaging.ts`

#### Tool 1: message.send

**Purpose**: Simple chat message interface for quick testing

**Schema**:
```typescript
const messageSendSchema = z.object({
  text: z.string().describe('Message text to send'),
  channel: z.string().optional().describe('Channel or room name (default: "test")'),
  emulate: z.enum(['api', 'discord', 'twitch', 'twilio', 'slack']).optional()
    .describe('Platform to emulate (affects identity/connector metadata)'),
  identity: z.object({
    id: z.string().optional(),
    displayName: z.string().optional(),
    roles: z.array(z.string()).optional(),
  }).optional().describe('Override identity metadata'),
  context: z.string().optional().describe('Execution context (local, agent-dev-*, etc.)'),
  waitForResponse: z.boolean().optional().default(true)
    .describe('Wait for platform response'),
  timeoutMs: z.number().optional().default(10000)
    .describe('Response timeout in milliseconds'),
});
```

**Example Usage**:
```typescript
// Simple chat
await message.send({ text: "Hello BitBrat!" })

// Emulate Discord user
await message.send({
  text: "!help",
  emulate: "discord",
  identity: { id: "123456", displayName: "TestUser" },
  channel: "#general"
})

// Fire and forget
await message.send({
  text: "Test message",
  waitForResponse: false
})
```

**Handler Implementation**:
```typescript
async function messageSendHandler(
  args: z.infer<typeof messageSendSchema>,
  connection: TargetConnection
): Promise<CallToolResult> {
  // 1. Get or create ApiGatewayClient
  const client = await getOrCreateClient(connection);

  // 2. Build InboundFrame with emulation
  const frame = buildMessageFrame(args);

  // 3. Send and wait for response
  const response = await client.sendMessage({
    type: 'chat.message.v1',
    payload: frame.payload,
    metadata: frame.metadata,
    waitForResponse: args.waitForResponse,
    timeoutMs: args.timeoutMs,
  });

  // 4. Format response
  return {
    content: [{
      type: 'text',
      text: formatMessageResponse(response, args)
    }]
  };
}
```

#### Tool 2: event.send

**Purpose**: Full control over InternalEventV2 event construction

**Schema**:
```typescript
const eventSendSchema = z.object({
  type: z.string().describe('Event type (chat.message.v1, etc.)'),
  message: z.object({
    role: z.enum(['user', 'assistant', 'system', 'tool']).optional(),
    text: z.string().optional(),
    language: z.string().optional(),
  }).optional().describe('Message payload'),
  ingress: z.object({
    source: z.string().optional(),
    connector: z.enum(['twitch', 'discord', 'twilio', 'slack', 'webhook', 'api', 'system']).optional(),
    channel: z.string().optional(),
  }).optional().describe('Ingress metadata'),
  identity: z.object({
    external: z.object({
      id: z.string(),
      platform: z.string(),
      displayName: z.string().optional(),
      roles: z.array(z.string()).optional(),
    }),
  }).optional().describe('Identity metadata'),
  egress: z.object({
    destination: z.string().optional(),
    type: z.enum(['chat', 'dm', 'event']).optional(),
    connector: z.enum(['twitch', 'discord', 'twilio', 'slack', 'webhook', 'api', 'system']).optional(),
    channel: z.string().optional(),
  }).optional().describe('Egress metadata'),
  payload: z.record(z.any()).optional().describe('Custom payload'),
  annotations: z.array(z.any()).optional().describe('Pre-built annotations'),
  qos: z.object({
    tracer: z.boolean().optional(),
    persistenceTtlSec: z.number().optional(),
  }).optional().describe('QoS settings'),
  context: z.string().optional().describe('Execution context'),
  waitForResponse: z.boolean().optional().default(true),
  timeoutMs: z.number().optional().default(10000),
});
```

**Example Usage**:
```typescript
// Full Discord emulation
await event.send({
  type: "chat.message.v1",
  message: { role: "user", text: "!ping" },
  ingress: {
    source: "ingress.discord",
    connector: "discord",
    channel: "#bot-testing"
  },
  identity: {
    external: {
      id: "987654321",
      platform: "discord",
      displayName: "DevAgent",
      roles: ["moderator"]
    }
  },
  egress: {
    type: "chat",
    connector: "discord",
    channel: "#bot-testing"
  },
  qos: { tracer: true },
  context: "agent-dev-mytest"
})
```

**Handler Implementation**:
```typescript
async function eventSendHandler(
  args: z.infer<typeof eventSendSchema>,
  connection: TargetConnection
): Promise<CallToolResult> {
  // 1. Get or create ApiGatewayClient
  const client = await getOrCreateClient(connection);

  // 2. Build partial InternalEventV2
  const event = buildEventFromArgs(args);

  // 3. Send via event.inject.v2 frame type (bypasses normalization)
  const response = await client.sendEvent({
    event,
    waitForResponse: args.waitForResponse,
    timeoutMs: args.timeoutMs,
  });

  // 4. Format response
  return {
    content: [{
      type: 'text',
      text: formatEventResponse(response, args)
    }]
  };
}
```

#### Tool 3: session.create (Optional Enhancement)

**Purpose**: Establish persistent session for multiple messages

**Schema**:
```typescript
const sessionCreateSchema = z.object({
  context: z.string().describe('Execution context'),
  emulate: z.enum(['api', 'discord', 'twitch', 'twilio', 'slack']).optional(),
  identity: z.object({
    id: z.string(),
    displayName: z.string().optional(),
    roles: z.array(z.string()).optional(),
  }).optional(),
  channel: z.string().optional(),
});
```

**Use Case**: Avoid reconnecting for each message in a test sequence

## 5. Platform Emulation Strategy

### 5.1 Challenge: IngressManager Hardcoded Connector

Current IngressManager code (src/services/api-gateway/ingress.ts:44-79):
```typescript
const event: InternalEventV2 = {
  // ...
  ingress: {
    ingressAt: new Date().toISOString(),
    source: 'api-gateway',          // HARDCODED
    connector: 'api',                // HARDCODED
    channel: frame.payload.channel || frame.payload.room,
  },
  identity: {
    external: {
      id: userId,
      platform: 'api-gateway',       // HARDCODED
    }
  },
  egress: {
    destination: this.egressDestinationTopic || 'api-gateway',
    type: 'chat',
    connector: 'api',                // HARDCODED
    channel: frame.payload.channel || frame.payload.room
  },
  // ...
};
```

### 5.2 Security Model for event.inject.v2

**CRITICAL SECURITY REQUIREMENT**: The `event.inject.v2` frame type MUST be restricted to authenticated api-gateway connections only.

**Why this matters**:
- Prevents identity spoofing (claiming to be another user)
- Prevents connector forgery (claiming to come from Discord when not)
- Prevents bypass of platform-specific authentication
- Ensures audit trail integrity

**Security Architecture**:

```
┌─────────────────────────────────────────────────────────────┐
│  External Platforms (Discord, Twitch, etc.)                 │
│  ✗ Cannot use event.inject.v2                               │
│  ✓ Use dedicated ingress paths (ingress-egress service)     │
│  ✓ Platform-specific authentication (OAuth, webhook sigs)   │
└─────────────────────────────────────────────────────────────┘
                          ↓ Platform-specific APIs
┌─────────────────────────────────────────────────────────────┐
│  ingress-egress Service                                      │
│  - Discord: Ed25519 signature verification                  │
│  - Twitch: HMAC signature verification                      │
│  - Each platform has hardcoded connector metadata           │
└─────────────────────────────────────────────────────────────┘
                          ↓ internal.ingress.v1

┌─────────────────────────────────────────────────────────────┐
│  api-gateway (WebSocket /ws/v1)                             │
│  ✓ CAN use event.inject.v2                                  │
│  ✓ Requires Bearer token authentication                     │
│  ✓ Requires "event:inject" permission                       │
│  ✓ Only available to dev-tools/admin users                  │
└─────────────────────────────────────────────────────────────┘
                          ↓ WebSocket + Bearer token
┌─────────────────────────────────────────────────────────────┐
│  Dev MCP Tools (brat-dev-mcp)                               │
│  - ApiGatewayClient with Bearer token                       │
│  - User has "event:inject" permission                       │
│  - Used for testing/debugging only                          │
└─────────────────────────────────────────────────────────────┘
```

**Permission Model**:

| User Type | event.inject.v2 | chat.message.v1 | Notes |
|-----------|-----------------|-----------------|-------|
| Dev MCP (with token) | ✅ Allowed | ✅ Allowed | Has "event:inject" permission |
| Anonymous WebSocket | ❌ Denied | ✅ Allowed | No permission check |
| External platforms | ❌ N/A | ❌ N/A | Use dedicated ingress paths |
| Production users | ❌ Denied | ✅ Allowed | Requires explicit grant |

### 5.3 Solution: Authenticated Extended InboundFrame

**Introduce new frame type**: `event.inject.v2` (restricted access)

**Modified IngressManager**:
```typescript
export class IngressManager {
  constructor(
    private readonly publishers: PublisherResource,
    private readonly logger: Logger,
    private readonly egressDestinationTopic?: string,
    private readonly authService?: AuthService  // NEW: For permission checks
  ) {}

  public async handleMessage(
    userId: string,
    data: string,
    permissions?: string[]  // NEW: Pass permissions from WebSocket handler
  ): Promise<void> {
    const frame: InboundFrame = JSON.parse(data);

    // NEW: Handle event.inject.v2 frame type (RESTRICTED)
    if (frame.type === 'event.inject.v2') {
      return this.handleEventInject(userId, frame, permissions);
    }

    // Existing logic for chat.message.v1, etc.
    // ...
  }

  private async handleEventInject(
    userId: string,
    frame: InboundFrame,
    permissions?: string[]
  ): Promise<void> {
    // SECURITY: Check for event:inject permission
    if (!permissions || !permissions.includes('event:inject')) {
      this.logger.warn('ingress.event_inject_denied', {
        userId,
        reason: 'missing_permission',
        requiredPermission: 'event:inject',
        userPermissions: permissions || []
      });

      throw new Error(
        'Permission denied: event.inject.v2 requires "event:inject" permission. ' +
        'This frame type is restricted to authenticated dev-tools and admin users.'
      );
    }

    // SECURITY: Validate userId is not anonymous (must be authenticated)
    if (userId === 'anonymous') {
      this.logger.warn('ingress.event_inject_denied', {
        userId,
        reason: 'anonymous_user',
      });

      throw new Error(
        'Permission denied: event.inject.v2 is not available for anonymous connections. ' +
        'Authenticate with a Bearer token that has "event:inject" permission.'
      );
    }

    // Extract pre-built event from payload
    const event: Partial<InternalEventV2> = frame.payload.event;

  // Merge with defaults
  const fullEvent: InternalEventV2 = {
    v: '2',
    correlationId: event.correlationId || frame.metadata?.id || uuidv4(),
    traceId: event.traceId || uuidv4(),
    type: event.type || 'chat.message.v1',

    // Use provided ingress or defaults
    ingress: event.ingress || {
      ingressAt: new Date().toISOString(),
      source: 'api-gateway',
      connector: 'api',
    },

    // Use provided identity or defaults
    identity: event.identity || {
      external: {
        id: userId,
        platform: 'api-gateway',
      }
    },

    // Use provided egress or defaults
    egress: event.egress || {
      destination: this.egressDestinationTopic || 'api-gateway',
      type: 'chat',
      connector: 'api',
    },

    message: event.message,
    payload: event.payload || frame.payload,
    annotations: event.annotations || [],
    candidates: event.candidates || [],
    qos: event.qos,
    routing: event.routing || {
      stage: 'initial',
      slip: [],
      history: [],
    },
    errors: event.errors,
    metadata: event.metadata,
  };

  // Publish to internal.ingress.v1
  const publisher = this.publishers.create(INTERNAL_INGRESS_V1);
  const attrs = busAttrsFromEvent(fullEvent);
  await publisher.publishJson(fullEvent, attrs);

  this.logger.info('ingress.event_injected', {
    userId,
    type: fullEvent.type,
    correlationId: fullEvent.correlationId,
    connector: fullEvent.ingress.connector,
  });
}
```

    // SECURITY: Audit log for event injection
    this.logger.info('ingress.event_injected', {
      userId,
      type: fullEvent.type,
      correlationId: fullEvent.correlationId,
      emulatedConnector: fullEvent.ingress.connector,
      emulatedSource: fullEvent.ingress.source,
      emulatedIdentity: fullEvent.identity.external.id,
      actualUserId: userId,
    });
  }
}
```

**Benefits**:
- ✅ Backward compatible (existing chat.message.v1 unchanged)
- ✅ Full platform emulation control
- ✅ **SECURE: Permission-gated access to event.inject.v2**
- ✅ **AUDITED: All injections logged with both real and emulated identity**
- ✅ No breaking changes to existing code
- ✅ Clear semantic distinction (inject vs. send)

**Security Guarantees**:
1. Only authenticated users can use event.inject.v2 (no anonymous)
2. User must have explicit "event:inject" permission
3. All injections are audit logged with real userId + emulated metadata
4. External platforms (Discord, Twitch) cannot access this path (use ingress-egress)
5. Errors return clear permission denial messages

### 5.4 API Gateway WebSocket Handler Changes

**Update WebSocket message handler to pass permissions**:

```typescript
// In ApiGatewayServer (src/apps/api-gateway.ts)

this.wss.on('connection', (ws: WebSocket, request: http.IncomingMessage) => {
  // ... existing auth logic ...

  let permissions: string[] = [];

  // For authenticated users, load permissions from token
  if (userId !== 'anonymous') {
    const userPermissions = await this.authService?.getUserPermissions(userId);
    permissions = userPermissions || [];

    // Dev MCP tokens automatically get event:inject permission
    if (userId.startsWith('brat-dev-mcp:') || userId.startsWith('dev-tools:')) {
      if (!permissions.includes('event:inject')) {
        permissions.push('event:inject');
      }
    }

    this.logger.info('api_gateway.websocket_authenticated', {
      userId,
      permissions,
      remoteAddress: request.socket.remoteAddress,
    });
  }

  ws.on('message', async (data: Buffer) => {
    try {
      // Pass permissions to IngressManager
      await this.ingressManager?.handleMessage(
        userId,
        data.toString(),
        permissions  // NEW: Pass permissions for event.inject.v2 check
      );
    } catch (err: any) {
      // Send error back to client
      ws.send(JSON.stringify({
        type: 'error',
        error: {
          code: 'INGRESS_ERROR',
          message: err.message,
        },
        timestamp: new Date().toISOString(),
      }));

      this.logger.error('api_gateway.ingress_error', {
        userId,
        error: err.message,
        stack: err.stack,
      });
    }
  });
});
```

**Permission Source**:
- Dev MCP tokens: Automatically granted "event:inject" when userId matches pattern
- Admin users: Stored in database (api_gateway_tokens.permissions column)
- Regular users: No event:inject permission by default
- Anonymous: No permissions (cannot use event.inject.v2)

### 5.5 Platform Emulation Presets

**Helper function in messaging tools**:
```typescript
function buildPlatformPreset(platform: string, identity?: any): Partial<InternalEventV2> {
  const presets = {
    discord: {
      ingress: {
        source: 'ingress.discord',
        connector: 'discord' as const,
      },
      identity: {
        external: {
          id: identity?.id || 'discord-user-123',
          platform: 'discord',
          displayName: identity?.displayName || 'TestUser',
          roles: identity?.roles || ['member'],
        }
      },
      egress: {
        type: 'chat' as const,
        connector: 'discord' as const,
      }
    },
    twitch: {
      ingress: {
        source: 'ingress.twitch',
        connector: 'twitch' as const,
      },
      identity: {
        external: {
          id: identity?.id || 'twitch-user-123',
          platform: 'twitch',
          displayName: identity?.displayName || 'testuser',
          roles: identity?.roles || ['viewer'],
        }
      },
      egress: {
        type: 'chat' as const,
        connector: 'twitch' as const,
      }
    },
    // ... other platforms
  };

  return presets[platform] || presets.api;
}
```

## 6. Authentication & Token Management

### 6.1 Token Acquisition Strategy

**For agent-dev contexts**:
1. Check if api-gateway is running (fleet.info)
2. Query PostgreSQL for existing dev tokens:
   ```sql
   SELECT * FROM api_gateway_tokens
   WHERE user_id LIKE 'brat-dev-mcp:%'
   ORDER BY created_at DESC LIMIT 1
   ```
3. If no token exists, create one with event:inject permission:
   ```sql
   INSERT INTO api_gateway_tokens (user_id, token, permissions, created_at, expires_at)
   VALUES (
     'brat-dev-mcp:' || generate_random_id(),
     generate_secure_token(),
     '["event:inject"]',  -- NEW: Auto-grant permission
     NOW(),
     NOW() + INTERVAL '30 days'
   )
   ```
4. Cache token in TargetConnection.gateway.authToken

**For production contexts**:
1. Require MCP_AUTH_TOKEN environment variable
2. Use existing token (no auto-creation)
3. Token MUST have "event:inject" permission for platform emulation
4. Error if token missing or lacks permission

### 6.2 Permission Management

**Permission Model**:

| Permission | Grants Access To | Automatically Assigned To |
|------------|------------------|---------------------------|
| `event:inject` | event.inject.v2 frame type | Dev MCP tokens (brat-dev-mcp:*), Admin users |
| (none) | chat.message.v1 only | Anonymous users, Regular users |

**Permission Storage**:
```sql
-- PostgreSQL schema
CREATE TABLE api_gateway_tokens (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  permissions JSONB DEFAULT '[]',  -- NEW: Store permissions array
  created_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP,
  revoked BOOLEAN DEFAULT FALSE
);

-- Example rows
INSERT INTO api_gateway_tokens (user_id, token, permissions)
VALUES
  ('brat-dev-mcp:abc123', 'token-xyz', '["event:inject"]'),
  ('admin-user', 'token-admin', '["event:inject", "admin"]'),
  ('regular-user', 'token-user', '[]');  -- No event:inject
```

**Permission Check Flow**:
```
1. WebSocket connection established with Bearer token
2. AuthService.validateToken(token) → userId
3. AuthService.getUserPermissions(userId) → ['event:inject', ...]
4. If userId matches 'brat-dev-mcp:*' → auto-add 'event:inject'
5. Permissions passed to IngressManager.handleMessage()
6. If frame.type === 'event.inject.v2' → check permissions
7. Reject if missing 'event:inject' permission
```

### 6.3 Anonymous Mode Fallback

**For local development**:
- If API_GATEWAY_ALLOW_ANONYMOUS_WS=true, skip token
- Connect as userId: 'anonymous'
- **IMPORTANT**: Anonymous users CANNOT use event.inject.v2
- Can only send chat.message.v1 (standard messages)
- Log warning about anonymous access and limited capabilities

## 7. Integration Points

### 7.1 TargetConnection Enhancement

**Add gateway client cache**:
```typescript
export interface TargetConnection {
  // ... existing fields
  gateway?: {
    url: string;
    authToken?: string;
    client?: ApiGatewayClient;  // NEW: Cached WebSocket client
  };
}
```

### 7.2 Target Manager Responsibilities

**Enhance getActiveConnection()**:
- Discover api-gateway URL from architecture.yaml or fleet registry
- Acquire authentication token (if not provided)
- Initialize but don't connect ApiGatewayClient
- Cache client in connection object

### 7.3 Cleanup Lifecycle

**On DevMcpServer shutdown**:
```typescript
async cleanup(): Promise<void> {
  for (const connection of this.activeConnections.values()) {
    if (connection.gateway?.client) {
      await connection.gateway.client.disconnect();
    }
  }
}
```

## 8. Error Handling & Debugging

### 8.1 Common Error Scenarios

| Error | Cause | Solution |
|-------|-------|----------|
| `Gateway unreachable` | Api-gateway not running | Start api-gateway or check context |
| `Authentication failed` | Invalid/missing token | Acquire new token or enable anonymous |
| `Permission denied: event.inject.v2 requires "event:inject" permission` | User lacks permission | Use authenticated token with event:inject, or use message.send instead |
| `Permission denied: event.inject.v2 is not available for anonymous connections` | Anonymous user tried event.inject.v2 | Authenticate with Bearer token, or use message.send |
| `Response timeout` | Platform hung/slow | Increase timeoutMs or check logs |
| `Connection refused` | Wrong gateway URL | Verify architecture.yaml or fleet.info |
| `Invalid event structure` | Malformed InternalEventV2 | Validate against schema |

### 8.2 Debug Mode Support

**Enable verbose logging**:
```typescript
await event.send({
  text: "Test",
  qos: { tracer: true },  // Enables platform-wide debug logging
  context: "agent-dev-test"
})
```

**Leverage existing debug infrastructure**:
- Debug mode (Sprint 371) real-time feedback
- Fleet trace tools for correlation tracking
- Loki logs for troubleshooting

## 9. Testing Strategy

### 9.1 Unit Tests

**ApiGatewayClient**:
- Connection lifecycle (connect, disconnect, reconnect)
- Message sending (success, timeout, error)
- Response correlation (match by correlationId)
- Token authentication (Bearer header)

**Messaging Tools**:
- Frame construction (simple chat, full event)
- Platform emulation presets
- Argument validation (Zod schemas)
- Error handling (missing gateway, timeout)

### 9.2 Integration Tests

**End-to-End Flow** (similar to agent-dev e2e):
```typescript
describe('Dev MCP Messaging Integration', () => {
  it('should send chat message and receive response', async () => {
    // 1. Provision agent-dev context
    await agent_dev.provision({ name: 'agent-dev-msg-test' });

    // 2. Deploy api-gateway
    await bit.deploy({ bit: 'api-gateway', context: 'agent-dev-msg-test' });

    // 3. Send message via dev-mcp tool
    const result = await message.send({
      text: 'Hello BitBrat!',
      context: 'agent-dev-msg-test',
    });

    // 4. Verify response
    expect(result).toMatchObject({
      type: 'chat.message.v1',
      message: { text: expect.stringContaining('Hello') }
    });

    // 5. Cleanup
    await agent_dev.destroy({ name: 'agent-dev-msg-test', confirm: true });
  });
});
```

### 9.3 Manual Validation Workflow

**Agent-driven testing pattern**:
```bash
# 1. Provision test environment
agent_dev.provision({ name: "agent-dev-messaging-test" })

# 2. Deploy full stack
bit.deploy({ all: true, context: "agent-dev-messaging-test" })

# 3. Send test message
message.send({
  text: "!help",
  emulate: "discord",
  context: "agent-dev-messaging-test"
})

# 4. Verify in logs
fleet.logs({
  bit: "llm-bot",
  context: "agent-dev-messaging-test",
  limit: 10
})

# 5. Send complex event
event.send({
  type: "chat.message.v1",
  message: { text: "!status" },
  ingress: { connector: "twitch", channel: "#bitbrat" },
  qos: { tracer: true },
  context: "agent-dev-messaging-test"
})

# 6. Trace full flow
fleet.trace({
  correlationId: "<from-response>",
  context: "agent-dev-messaging-test"
})

# 7. Cleanup
agent_dev.destroy({ name: "agent-dev-messaging-test", confirm: true })
```

## 10. Success Criteria

### Functional Requirements
- ✅ Agent can send simple chat message with 1 tool call
- ✅ Agent can construct full InternalEventV2 with platform emulation
- ✅ Response correlation works (sent message → received response)
- ✅ Works across local, agent-dev, and production contexts
- ✅ Authentication handled automatically for agent-dev
- ✅ Error messages are clear and actionable

### Performance Requirements
- ✅ Message send latency < 500ms (local network)
- ✅ WebSocket connection reuse (no reconnect per message)
- ✅ Response timeout configurable (default 10s)

### Developer Experience Requirements
- ✅ Single command to send message: `message.send({ text: "..." })`
- ✅ Platform emulation via simple enum: `emulate: "discord"`
- ✅ Integrates with existing agent-dev workflow
- ✅ Works in Claude Code without manual setup

### Documentation Requirements
- ✅ CLAUDE.md pattern added (Section 10: Messaging Tools for Agent Testing)
- ✅ Tool usage examples in technical-architecture.md
- ✅ Integration test demonstrates full workflow

## 11. Implementation Phases

### Phase 1: Core Infrastructure (Milestone 1)
**Files**:
- `tools/brat/src/dev-mcp/api-gateway-client.ts` (NEW)
- `tools/brat/src/dev-mcp/types.ts` (UPDATE: add interfaces)

**Tasks**:
1. Implement ApiGatewayClient class
2. WebSocket connection management
3. Bearer token authentication
4. Message sending (basic InboundFrame)
5. Response listening and correlation
6. Unit tests for ApiGatewayClient

**Validation**: Client can connect to api-gateway and send/receive basic frames

### Phase 2: Messaging Tools (Milestone 2)
**Files**:
- `tools/brat/src/dev-mcp/tools/messaging.ts` (NEW)
- `tools/brat/src/dev-mcp/server.ts` (UPDATE: register tools)

**Tasks**:
1. Implement message.send tool
2. Implement event.send tool
3. Platform emulation presets
4. Token acquisition logic
5. Unit tests for tools

**Validation**: Tools callable via dev-mcp, basic messages sent

### Phase 3: IngressManager Enhancement + Security (Milestone 3)
**Files**:
- `src/services/api-gateway/ingress.ts` (UPDATE: add event.inject.v2)
- `src/apps/api-gateway.ts` (UPDATE: permission handling)
- `src/services/api-gateway/auth.ts` (UPDATE: add getUserPermissions)

**Tasks**:
1. Add permissions column to api_gateway_tokens table (migration)
2. Implement AuthService.getUserPermissions() method
3. Update WebSocket handler to load and pass permissions
4. Add handleEventInject method with permission checks
5. Support for event.inject.v2 frame type
6. Preserve ingress/identity/egress from payload
7. Add audit logging (real + emulated identity)
8. Unit tests for event injection (with/without permission)
9. Security tests (anonymous rejection, permission denial)

**Validation**:
- ✅ Full platform emulation works, events have correct metadata
- ✅ Anonymous users are rejected from event.inject.v2
- ✅ Users without permission are rejected
- ✅ Audit logs contain both real and emulated identity
- ✅ Dev MCP tokens automatically get event:inject permission

### Phase 4: Integration & Testing (Milestone 4)
**Files**:
- `tools/brat/src/dev-mcp/__tests__/messaging-integration.test.ts` (NEW)
- `documentation/guides/dev-mcp-messaging.md` (NEW)
- `CLAUDE.md` (UPDATE: add pattern)

**Tasks**:
1. End-to-end integration tests
2. Agent-dev workflow validation
3. Documentation
4. CLAUDE.md pattern section

**Validation**: Full workflow passes, documentation complete

## 12. Security Considerations

### 12.1 event.inject.v2 Permission Model (CRITICAL)

**Threat Model**:
- **Identity Spoofing**: Attacker claims to be another user (admin, moderator)
- **Connector Forgery**: Attacker claims to be from Discord/Twitch when they're not
- **Platform Bypass**: Attacker bypasses platform-specific authentication
- **Audit Trail Tampering**: Attacker hides their real identity

**Mitigations**:

| Threat | Mitigation | Implementation |
|--------|------------|----------------|
| Identity Spoofing | Permission-gated access | Only users with "event:inject" can use event.inject.v2 |
| Anonymous Abuse | Require authentication | Anonymous users cannot use event.inject.v2 (hard reject) |
| External Platform Bypass | Path separation | Discord/Twitch use ingress-egress service (not api-gateway) |
| Audit Trail Tampering | Dual logging | Log both real userId AND emulated identity |
| Token Theft | Scoped permissions | Tokens only grant specific permissions (event:inject, not admin) |

**Defense in Depth**:
1. **Authentication Layer**: Bearer token required (no anonymous)
2. **Authorization Layer**: "event:inject" permission required
3. **Validation Layer**: InternalEventV2 structure validated
4. **Audit Layer**: All injections logged with real + emulated identity
5. **Path Separation**: External platforms cannot access api-gateway

**Permission Assignment Rules**:
```typescript
// Auto-grant event:inject permission
if (userId.startsWith('brat-dev-mcp:') || userId.startsWith('dev-tools:')) {
  permissions.push('event:inject');
}

// Explicit grant for admin users (stored in database)
// Regular users: NO auto-grant (must be explicit)
// Anonymous users: NEVER granted (hard-coded rejection)
```

### 12.2 Token Security
- ✅ Never log full tokens (truncate in logs)
- ✅ Store tokens in TargetConnection (memory only, not persisted)
- ✅ Auto-generated tokens use crypto.randomBytes() or crypto.randomUUID()
- ✅ Token scopes limited to dev operations (event:inject only)
- ✅ Tokens include permissions field (JSONB in PostgreSQL)
- ✅ Token validation includes permission check (not just userId)
- ✅ Expired tokens rejected (check expires_at field)
- ✅ Revoked tokens rejected (check revoked flag)

**Token Creation Security**:
```typescript
// SECURE: Use crypto module for token generation
import { randomBytes } from 'crypto';

function generateSecureToken(): string {
  return randomBytes(32).toString('base64url');  // 256-bit entropy
}

// INSECURE: Don't use predictable tokens
// BAD: 'token-' + Date.now()  // Predictable!
// BAD: Math.random().toString(36)  // Low entropy!
```

### 12.3 Input Validation
- ✅ All tool arguments validated via Zod schemas
- ✅ InternalEventV2 structure validated before sending
- ✅ Platform emulation limited to known connectors (enum validation)
- ✅ No arbitrary code execution in event payloads
- ✅ Frame type validated (only known types accepted)
- ✅ correlationId validated (must be UUID format)
- ✅ Timestamps validated (must be ISO 8601 format)

**Additional Validations for event.inject.v2**:
```typescript
// Validate connector is in allowed list
const ALLOWED_CONNECTORS = ['twitch', 'discord', 'twilio', 'slack', 'webhook', 'api', 'system'];
if (event.ingress?.connector && !ALLOWED_CONNECTORS.includes(event.ingress.connector)) {
  throw new Error(`Invalid connector: ${event.ingress.connector}`);
}

// Validate no malicious routing slip manipulation
if (event.routing?.slip && event.routing.slip.length > 0) {
  logger.warn('Rejecting event with pre-populated routing slip', {
    userId,
    correlationId: event.correlationId,
  });
  throw new Error('Cannot inject events with pre-populated routing slips');
}
```

### 12.4 Context Isolation
- ✅ Agent-dev contexts use isolated databases
- ✅ Production contexts require explicit authentication
- ✅ No cross-context message leakage
- ✅ WebSocket connections scoped to context
- ✅ Tokens are context-specific (agent-dev tokens don't work in prod)
- ✅ Permission checks apply per-context

### 12.5 Audit Logging

**What Gets Logged**:
```typescript
// GOOD: Log both real and emulated identity
logger.info('ingress.event_injected', {
  // Real identity
  actualUserId: userId,
  actualPermissions: permissions,
  actualRemoteAddress: request.socket.remoteAddress,

  // Emulated identity
  emulatedConnector: event.ingress.connector,
  emulatedSource: event.ingress.source,
  emulatedIdentityId: event.identity.external.id,
  emulatedPlatform: event.identity.external.platform,

  // Event metadata
  correlationId: event.correlationId,
  eventType: event.type,
  timestamp: new Date().toISOString(),
});
```

**Audit Trail Requirements**:
1. Every event.inject.v2 call MUST be logged
2. Log MUST include both real and emulated identity
3. Logs MUST be searchable by correlationId
4. Logs MUST be retained according to compliance requirements
5. Log failures MUST NOT block event processing (fail-open for logging)

### 12.6 Production Deployment Considerations

**Production Safeguards**:
1. **Require Explicit Context Selection**: Prevent accidental prod testing
   ```typescript
   if (context === 'prod' && !args.confirmProduction) {
     throw new Error('Production context requires confirmProduction: true');
   }
   ```

2. **Rate Limiting**: Prevent abuse via excessive message sending
   ```typescript
   // In api-gateway: rate limit by userId
   // Limit: 10 messages/second, 100 messages/minute per user
   ```

3. **Alerting**: Monitor for suspicious event.inject.v2 usage
   ```typescript
   // Alert if:
   // - Non-dev user attempts event.inject.v2
   // - >100 injections/hour from single user
   // - Emulated identity doesn't match user's permissions
   ```

4. **Permission Audit**: Regularly review who has event:inject
   ```sql
   -- Find all users with event:inject permission
   SELECT user_id, permissions, created_at
   FROM api_gateway_tokens
   WHERE permissions @> '["event:inject"]';
   ```

**Recommended Production Config**:
```yaml
# agent-dev contexts: Permissive (for testing)
API_GATEWAY_ALLOW_ANONYMOUS_WS=true
EVENT_INJECT_ENABLED=true

# Production contexts: Strict
API_GATEWAY_ALLOW_ANONYMOUS_WS=false  # No anonymous
EVENT_INJECT_ENABLED=true  # But requires permission
EVENT_INJECT_REQUIRE_MFA=true  # Optional: Require MFA for injection
EVENT_INJECT_ALERT_THRESHOLD=10  # Alert after 10 injections/hour
```

## 13. Future Enhancements

### Phase 2+ Features (Post-Sprint)
1. **Batch Messaging**: Send multiple messages in sequence
2. **Conversation Simulation**: Multi-turn chat with state
3. **Load Testing**: Stress test with configurable concurrency
4. **Response Validation**: Assert expected responses
5. **Platform Webhooks**: Simulate webhook delivery (not via api-gateway)
6. **Message History**: Track sent/received messages for debugging
7. **Session Recording**: Capture full conversation for replay
8. **Performance Metrics**: Latency tracking, throughput analysis

### Potential Integrations
- **Test Framework**: Jest matchers for message validation
- **Monitoring**: Prometheus metrics for message counts
- **Observability**: OpenTelemetry tracing integration

## 14. Appendix

### A. Key File Locations

| Component | File Path |
|-----------|-----------|
| ApiGatewayClient | `tools/brat/src/dev-mcp/api-gateway-client.ts` |
| Messaging Tools | `tools/brat/src/dev-mcp/tools/messaging.ts` |
| IngressManager | `src/services/api-gateway/ingress.ts` |
| Dev MCP Server | `tools/brat/src/dev-mcp/server.ts` |
| Integration Tests | `tools/brat/src/dev-mcp/__tests__/messaging-integration.test.ts` |
| Documentation | `documentation/guides/dev-mcp-messaging.md` |

### B. Related Sprints

- **Sprint 366**: Runtime context switching in dev-mcp
- **Sprint 371**: Debug mode real-time feedback
- **Sprint 358**: Agent-dev context provisioning
- **Sprint 24**: Claim check event retrieval

### C. Open Questions

1. **Q**: Should we support binary message payloads (images, etc.)?
   **A**: Out of scope for initial implementation. Focus on text/JSON.

2. **Q**: How to handle api-gateway rate limiting?
   **A**: ✅ RESOLVED: Section 12.6 covers rate limiting strategy (10 msg/sec, 100 msg/min per user).

3. **Q**: Should responses be cached for repeated correlationId queries?
   **A**: No. Use claim check for event retrieval if needed.

4. **Q**: How to test against production without creating spam?
   **A**: Require explicit production context selection. Add safety confirmation for prod.

5. **Q**: Can external integrations bypass platform authentication using event.inject.v2?
   **A**: ✅ RESOLVED: Section 5.2 and 12.1 establish comprehensive security model. event.inject.v2 is:
      - Only available via api-gateway (not ingress-egress)
      - Requires Bearer token authentication (no anonymous)
      - Requires explicit "event:inject" permission
      - Audit logged with real + emulated identity
      - External platforms (Discord/Twitch) use separate ingress paths

### D. Security Summary

**Key Security Guarantees**:
1. ✅ **Path Separation**: External platforms use ingress-egress (not api-gateway)
2. ✅ **Authentication**: Bearer token required for event.inject.v2 (no anonymous)
3. ✅ **Authorization**: "event:inject" permission required
4. ✅ **Audit Trail**: Dual logging (real userId + emulated metadata)
5. ✅ **Defense in Depth**: 5 layers (auth, authz, validation, audit, path separation)

**Attack Surface Analysis**:
- ❌ Anonymous users: CANNOT use event.inject.v2 (hard reject)
- ❌ Regular users: CANNOT use event.inject.v2 (no permission)
- ❌ External platforms: CANNOT access api-gateway (wrong path)
- ✅ Dev MCP tokens: CAN use event.inject.v2 (auto-granted permission)
- ✅ Admin users: CAN use event.inject.v2 (explicit grant)

**Audit Coverage**: 100% of event.inject.v2 calls are logged with both real and emulated identity.

---

**Document Status**: ✅ Ready for Implementation
**Security Review**: ✅ Comprehensive security model addresses bypass concerns
**Next Steps**: User approval, then begin Phase 1 implementation
