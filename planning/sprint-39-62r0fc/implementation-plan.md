# Implementation Plan: Dev MCP Messaging Tools

**Sprint**: sprint-39-62r0fc
**Author**: Lead Implementor (Claude Code)
**Date**: 2026-09-02
**Architecture**: planning/sprint-39-62r0fc/technical-architecture.md
**Backlog**: planning/sprint-39-62r0fc/backlog.yaml

## Executive Summary

This implementation plan executes the architecture defined in technical-architecture.md, delivering Dev MCP messaging tools that enable coding agents to send chat messages and InternalEventV2 events to any BitBrat execution context with platform emulation capabilities.

**Critical Security Requirement**: All implementation work MUST enforce the permission-gated security model for `event.inject.v2` to prevent identity spoofing and platform authentication bypass.

## Implementation Strategy

### Phased Delivery Approach

**Phase 1: Core Infrastructure** (Days 1-2)
- Build ApiGatewayClient WebSocket client
- Establish connection management patterns
- Enable basic message sending
- **Risk**: WebSocket protocol compatibility with api-gateway
- **Mitigation**: Early integration test against running api-gateway

**Phase 2: Messaging Tools** (Days 2-3)
- Implement MCP tools (message.send, event.send)
- Platform emulation presets
- Token acquisition logic
- **Risk**: Token management complexity
- **Mitigation**: Use existing agent-dev token patterns

**Phase 3: Security & IngressManager** (Days 3-4)
- Add permissions column to database
- Implement permission checks
- event.inject.v2 frame handler
- **Risk**: Breaking existing chat.message.v1 flow
- **Mitigation**: Comprehensive unit tests, backward compatibility validation

**Phase 4: Integration & Documentation** (Day 5)
- End-to-end tests
- Agent-dev workflow validation
- Documentation
- **Risk**: Uncaught edge cases
- **Mitigation**: Real agent-dev environment testing

### Dependencies & Prerequisites

**External Dependencies**:
- ✅ api-gateway service (exists)
- ✅ PostgreSQL with api_gateway_tokens table (exists)
- ✅ Dev MCP server framework (exists, Sprint 366)
- ✅ Agent-dev provisioning (exists, Sprint 358)

**Code Dependencies**:
- `src/apps/api-gateway.ts` - WebSocket server
- `src/services/api-gateway/ingress.ts` - Message normalization
- `src/services/api-gateway/auth.ts` - Token validation
- `tools/brat/src/dev-mcp/server.ts` - MCP tool registration
- `tools/brat/src/dev-mcp/types.ts` - Type definitions

**No Blockers Identified**: All prerequisites are met.

## Phase 1: Core Infrastructure (ApiGatewayClient)

**Goal**: Create robust WebSocket client for api-gateway communication

### Tasks

#### 1.1 Create ApiGatewayClient Class
**File**: `tools/brat/src/dev-mcp/api-gateway-client.ts`

**Implementation Steps**:
1. Create class skeleton with constructor
2. Add WebSocket connection logic (using `ws` package)
3. Implement connect/disconnect methods
4. Add connection state tracking (connected, connecting, disconnected)
5. Implement reconnection logic (optional, configurable)

**Key Design Decisions**:
- Use `ws` package (already in dependencies)
- Single connection per context (connection pooling)
- Explicit connect/disconnect (no auto-connect)
- Promise-based API for async operations

**Code Pattern**:
```typescript
import WebSocket from 'ws';
import { Logger } from '../../orchestration/logger';

export interface ApiGatewayClientOptions {
  gatewayUrl: string;
  authToken?: string;
  userId?: string;
  logger: Logger;
  autoReconnect?: boolean;
}

export class ApiGatewayClient {
  private ws?: WebSocket;
  private isConnected: boolean = false;
  private pendingResponses: Map<string, PendingResponse> = new Map();

  constructor(private options: ApiGatewayClientOptions) {}

  async connect(): Promise<void> {
    // Build WebSocket URL with auth
    const url = new URL(this.options.gatewayUrl);
    url.pathname = '/ws/v1';

    // Add userId query param if provided
    if (this.options.userId) {
      url.searchParams.set('userId', this.options.userId);
    }

    // Create WebSocket with auth header
    const headers: any = {};
    if (this.options.authToken) {
      headers['Authorization'] = `Bearer ${this.options.authToken}`;
    }

    this.ws = new WebSocket(url.toString(), { headers });

    // Setup event handlers
    await this.setupWebSocketHandlers();
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
      this.isConnected = false;
    }
  }

  // More methods...
}
```

**Testing**:
- Unit test: Connection succeeds with valid URL
- Unit test: Connection includes Bearer token in header
- Unit test: Disconnect cleans up resources
- Unit test: Multiple connect/disconnect cycles work

#### 1.2 Implement Message Sending
**File**: `tools/brat/src/dev-mcp/api-gateway-client.ts`

**Implementation Steps**:
1. Add `sendMessage()` method
2. Serialize InboundFrame to JSON
3. Send via WebSocket
4. Return correlationId for tracking

**Code Pattern**:
```typescript
async sendMessage(options: SendMessageOptions): Promise<string> {
  if (!this.isConnected) {
    throw new Error('Not connected to api-gateway');
  }

  const correlationId = options.metadata?.id || randomUUID();
  const frame: InboundFrame = {
    type: options.type,
    payload: options.payload,
    metadata: {
      id: correlationId,
      timestamp: new Date().toISOString(),
      ...options.metadata,
    },
  };

  this.ws!.send(JSON.stringify(frame));
  this.logger.debug('Message sent', { correlationId, type: options.type });

  return correlationId;
}
```

**Testing**:
- Unit test: Message serialization correct
- Unit test: correlationId auto-generated if not provided
- Unit test: Error thrown if not connected

#### 1.3 Implement Response Listening
**File**: `tools/brat/src/dev-mcp/api-gateway-client.ts`

**Implementation Steps**:
1. Register WebSocket 'message' handler
2. Parse incoming JSON
3. Match by correlationId to pending requests
4. Resolve promises for waiting callers
5. Implement timeout handling

**Code Pattern**:
```typescript
private setupWebSocketHandlers(): Promise<void> {
  return new Promise((resolve, reject) => {
    this.ws!.on('open', () => {
      this.isConnected = true;
      this.logger.info('Connected to api-gateway');
      resolve();
    });

    this.ws!.on('message', (data: Buffer) => {
      try {
        const event = JSON.parse(data.toString()) as InternalEventV2;
        this.handleIncomingMessage(event);
      } catch (err) {
        this.logger.error('Failed to parse message', { error: err });
      }
    });

    this.ws!.on('error', (err) => {
      this.logger.error('WebSocket error', { error: err });
      reject(err);
    });

    this.ws!.on('close', () => {
      this.isConnected = false;
      this.logger.info('Disconnected from api-gateway');
      this.cleanupPendingResponses();
    });
  });
}

private handleIncomingMessage(event: InternalEventV2): void {
  const pending = this.pendingResponses.get(event.correlationId);
  if (pending) {
    clearTimeout(pending.timeout);
    pending.resolve(event);
    this.pendingResponses.delete(event.correlationId);
  } else {
    // Unsolicited message (broadcast, etc.)
    this.emit('message', event);
  }
}
```

**Testing**:
- Unit test: Incoming messages matched by correlationId
- Unit test: Timeout triggers rejection
- Unit test: Unsolicited messages emitted as events

#### 1.4 Implement Request/Response Correlation
**File**: `tools/brat/src/dev-mcp/api-gateway-client.ts`

**Implementation Steps**:
1. Enhance `sendMessage()` to optionally wait for response
2. Store promise resolvers keyed by correlationId
3. Implement timeout logic (default 10s)
4. Clean up on disconnect

**Code Pattern**:
```typescript
async sendMessage(options: SendMessageOptions): Promise<InternalEventV2 | null> {
  const correlationId = await this.sendMessageNoWait(options);

  if (!options.waitForResponse) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      this.pendingResponses.delete(correlationId);
      reject(new Error(`Response timeout after ${options.timeoutMs}ms`));
    }, options.timeoutMs || 10000);

    this.pendingResponses.set(correlationId, { resolve, reject, timeout });
  });
}
```

**Testing**:
- Integration test: Send message and receive response
- Unit test: Timeout rejects promise
- Unit test: Multiple concurrent requests work

#### 1.5 Update Type Definitions
**File**: `tools/brat/src/dev-mcp/types.ts`

**Implementation Steps**:
1. Add `ApiGatewayClientOptions` interface
2. Add `SendMessageOptions` interface
3. Add `SendEventOptions` interface
4. Add `InboundFrame` interface (if not already defined)

**Testing**:
- Compile test: TypeScript compilation succeeds

#### 1.6 Unit Tests
**File**: `tools/brat/src/dev-mcp/__tests__/api-gateway-client.test.ts`

**Test Cases**:
1. Connection establishment with auth token
2. Connection establishment without auth token (anonymous)
3. Message sending serialization
4. Response correlation by correlationId
5. Timeout handling
6. Disconnect cleanup
7. Error handling (invalid JSON, connection errors)
8. Multiple concurrent requests

**Pattern**:
```typescript
describe('ApiGatewayClient', () => {
  let mockWs: any;
  let client: ApiGatewayClient;

  beforeEach(() => {
    // Mock WebSocket
    mockWs = new MockWebSocket();
    jest.spyOn(global, 'WebSocket').mockReturnValue(mockWs);

    client = new ApiGatewayClient({
      gatewayUrl: 'ws://localhost:3008',
      authToken: 'test-token',
      logger: createMockLogger(),
    });
  });

  it('should connect with Bearer token', async () => {
    await client.connect();
    expect(mockWs.options.headers['Authorization']).toBe('Bearer test-token');
  });

  it('should send message and wait for response', async () => {
    await client.connect();

    const responsePromise = client.sendMessage({
      type: 'chat.message.v1',
      payload: { text: 'Hello' },
      waitForResponse: true,
    });

    // Simulate response
    mockWs.emit('message', JSON.stringify({
      correlationId: 'expected-id',
      type: 'chat.message.v1',
      message: { text: 'Response' },
    }));

    const response = await responsePromise;
    expect(response.message?.text).toBe('Response');
  });

  // More tests...
});
```

### Phase 1 Validation Criteria

**Unit Tests**: 15+ tests passing
- ✅ Connection management (3 tests)
- ✅ Message sending (3 tests)
- ✅ Response correlation (3 tests)
- ✅ Timeout handling (2 tests)
- ✅ Error handling (2 tests)
- ✅ Cleanup (2 tests)

**Integration Test**:
- ✅ Connect to real api-gateway in agent-dev context
- ✅ Send basic chat.message.v1
- ✅ Receive response within 5 seconds

**Code Quality**:
- ✅ TypeScript strict mode passes
- ✅ ESLint passes
- ✅ No console.log (use logger)
- ✅ All public methods documented

## Phase 2: Messaging Tools

**Goal**: Expose MCP tools for agents to send messages

### Tasks

#### 2.1 Create Messaging Tools Module
**File**: `tools/brat/src/dev-mcp/tools/messaging.ts`

**Implementation Steps**:
1. Create file with tool definitions array
2. Import necessary types and dependencies
3. Define Zod schemas for each tool
4. Implement helper functions (platform presets, etc.)

**Structure**:
```typescript
import { z } from 'zod';
import { ToolDefinition } from '../types.js';
import { ApiGatewayClient } from '../api-gateway-client.js';

// Export tool definitions array
export const messagingTools: ToolDefinition[] = [
  messageSendTool,
  eventSendTool,
];

// Helper functions
function buildPlatformPreset(platform: string, identity?: any) { ... }
function getOrCreateClient(connection: TargetConnection): Promise<ApiGatewayClient> { ... }
```

#### 2.2 Implement message.send Tool
**File**: `tools/brat/src/dev-mcp/tools/messaging.ts`

**Implementation Steps**:
1. Define Zod schema for arguments
2. Implement handler function
3. Platform emulation logic
4. Response formatting

**Zod Schema**:
```typescript
const messageSendSchema = z.object({
  text: z.string().describe('Message text to send'),
  channel: z.string().optional().default('test')
    .describe('Channel or room name'),
  emulate: z.enum(['api', 'discord', 'twitch', 'twilio', 'slack']).optional()
    .describe('Platform to emulate'),
  identity: z.object({
    id: z.string().optional(),
    displayName: z.string().optional(),
    roles: z.array(z.string()).optional(),
  }).optional().describe('Override identity metadata'),
  context: z.string().optional()
    .describe('Execution context (local, agent-dev-*, etc.)'),
  waitForResponse: z.boolean().optional().default(true),
  timeoutMs: z.number().optional().default(10000),
});
```

**Handler**:
```typescript
async function messageSendHandler(
  args: z.infer<typeof messageSendSchema>,
  connection: TargetConnection
): Promise<CallToolResult> {
  // 1. Get or create client
  const client = await getOrCreateClient(connection);

  // 2. Build payload with platform emulation
  const preset = args.emulate ? buildPlatformPreset(args.emulate, args.identity) : {};

  const payload = {
    text: args.text,
    channel: args.channel,
    ...preset.payload,
  };

  // 3. Send message
  const response = await client.sendMessage({
    type: 'chat.message.v1',
    payload,
    metadata: preset.metadata,
    waitForResponse: args.waitForResponse,
    timeoutMs: args.timeoutMs,
  });

  // 4. Format response
  return {
    content: [{
      type: 'text',
      text: formatMessageResponse(response, args),
    }],
  };
}
```

**Testing**:
- Unit test: Schema validation
- Unit test: Platform preset applied correctly
- Unit test: Response formatted correctly
- Integration test: Message sent to agent-dev

#### 2.3 Implement event.send Tool
**File**: `tools/brat/src/dev-mcp/tools/messaging.ts`

**Implementation Steps**:
1. Define Zod schema for full InternalEventV2
2. Implement handler function
3. Build event.inject.v2 frame
4. Response formatting

**Zod Schema**: (See technical-architecture.md section 4.2)

**Handler**:
```typescript
async function eventSendHandler(
  args: z.infer<typeof eventSendSchema>,
  connection: TargetConnection
): Promise<CallToolResult> {
  const client = await getOrCreateClient(connection);

  // Build partial InternalEventV2
  const event: Partial<InternalEventV2> = {
    type: args.type,
    message: args.message,
    ingress: args.ingress,
    identity: args.identity,
    egress: args.egress,
    payload: args.payload,
    annotations: args.annotations,
    qos: args.qos,
  };

  // Send via event.inject.v2 frame
  const response = await client.sendEvent({
    event,
    waitForResponse: args.waitForResponse,
    timeoutMs: args.timeoutMs,
  });

  return {
    content: [{
      type: 'text',
      text: formatEventResponse(response, args),
    }],
  };
}
```

**Testing**:
- Unit test: Complex event structure validated
- Unit test: Platform emulation preserved
- Integration test: Full event injection works

#### 2.4 Implement Platform Emulation Presets
**File**: `tools/brat/src/dev-mcp/tools/messaging.ts`

**Implementation**: (See technical-architecture.md section 5.5)

**Testing**:
- Unit test: Discord preset correct
- Unit test: Twitch preset correct
- Unit test: All platforms have valid schemas

#### 2.5 Implement Token Acquisition
**File**: `tools/brat/src/dev-mcp/tools/messaging.ts`

**Implementation Steps**:
1. Check connection.gateway.authToken
2. If missing, query PostgreSQL for existing token
3. If not found, create new token with event:inject permission
4. Cache in connection object

**Code Pattern**:
```typescript
async function acquireAuthToken(connection: TargetConnection): Promise<string> {
  // Check if already cached
  if (connection.gateway?.authToken) {
    return connection.gateway.authToken;
  }

  // Query PostgreSQL
  const store = connection.store;
  const userId = `brat-dev-mcp:${randomUUID()}`;

  // Check for existing token
  const existing = await store.query(
    `SELECT token FROM api_gateway_tokens
     WHERE user_id LIKE 'brat-dev-mcp:%'
     AND revoked = false
     AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC LIMIT 1`
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].token;
  }

  // Create new token
  const token = randomBytes(32).toString('base64url');
  await store.query(
    `INSERT INTO api_gateway_tokens (user_id, token, permissions, created_at)
     VALUES ($1, $2, $3, NOW())`,
    [userId, token, JSON.stringify(['event:inject'])]
  );

  // Cache in connection
  if (!connection.gateway) {
    connection.gateway = { url: '', authToken: token };
  } else {
    connection.gateway.authToken = token;
  }

  return token;
}
```

**Testing**:
- Unit test: Token cached after first acquisition
- Unit test: Existing token reused
- Integration test: Token works with api-gateway

#### 2.6 Register Tools in Dev MCP Server
**File**: `tools/brat/src/dev-mcp/server.ts`

**Implementation Steps**:
1. Import messagingTools
2. Register in constructor
3. Update tool count logging

**Code**:
```typescript
import { messagingTools } from './tools/messaging.js';

// In registerTools()
for (const tool of messagingTools) {
  this.toolRouter.registerTool(tool);
}

this.logger.info({
  messaging: messagingTools.length,
  total: totalTools,
}, 'Registered dev tools');
```

**Testing**:
- Integration test: Tools appear in tools/list
- Integration test: Tools callable via MCP

#### 2.7 Unit Tests
**File**: `tools/brat/src/dev-mcp/__tests__/tools/messaging.test.ts`

**Test Cases**:
1. message.send schema validation
2. event.send schema validation
3. Platform preset generation
4. Token acquisition (mock PostgreSQL)
5. Error handling (no gateway URL, connection failed)
6. Response formatting

### Phase 2 Validation Criteria

**Unit Tests**: 20+ tests passing
- ✅ Schema validation (4 tests)
- ✅ Platform presets (6 tests)
- ✅ Token acquisition (4 tests)
- ✅ Handler logic (4 tests)
- ✅ Error handling (2 tests)

**Integration Test**:
- ✅ message.send callable via MCP
- ✅ Response received and formatted
- ✅ Platform emulation works

## Phase 3: Security & IngressManager Enhancement

**Goal**: Implement permission-gated event.inject.v2 with full security model

### Tasks

#### 3.1 Database Migration: Add Permissions Column
**File**: `src/services/api-gateway/migrations/add-permissions-column.sql` (or inline migration)

**Implementation**:
```sql
-- Add permissions column to api_gateway_tokens table
ALTER TABLE api_gateway_tokens
ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]';

-- Create index for permission queries
CREATE INDEX IF NOT EXISTS idx_api_gateway_tokens_permissions
ON api_gateway_tokens USING gin (permissions);

-- Add comment
COMMENT ON COLUMN api_gateway_tokens.permissions IS
'Array of permission strings (e.g., ["event:inject", "admin"])';
```

**Migration Strategy**:
- For existing installations: Run migration via `brat db migrate`
- For new installations: Include in schema
- Backward compatible: Default empty array

**Testing**:
- Migration test: Column added successfully
- Migration test: Index created
- Migration test: Existing rows have empty array

#### 3.2 Implement AuthService.getUserPermissions()
**File**: `src/services/api-gateway/auth.ts`

**Implementation**:
```typescript
async getUserPermissions(userId: string): Promise<string[]> {
  try {
    // Query database for user's permissions
    const result = await this.db.query(
      `SELECT permissions FROM api_gateway_tokens
       WHERE user_id = $1 AND revoked = false
       AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return [];
    }

    const permissions = result.rows[0].permissions || [];

    // Auto-grant event:inject for dev MCP tokens
    if (userId.startsWith('brat-dev-mcp:') || userId.startsWith('dev-tools:')) {
      if (!permissions.includes('event:inject')) {
        permissions.push('event:inject');
      }
    }

    return permissions;
  } catch (err) {
    this.logger.error('Failed to get user permissions', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
```

**Testing**:
- Unit test: Returns permissions from database
- Unit test: Auto-grants event:inject for dev tokens
- Unit test: Returns empty array for unknown user
- Unit test: Handles database errors gracefully

#### 3.3 Update WebSocket Handler for Permissions
**File**: `src/apps/api-gateway.ts`

**Implementation**: (See technical-architecture.md section 5.4)

**Key Changes**:
1. Load permissions after token validation
2. Pass permissions to IngressManager.handleMessage()
3. Handle permission errors and send to client

**Testing**:
- Integration test: Permissions loaded on connection
- Integration test: Permission errors sent to client
- Integration test: Dev MCP tokens get auto-grant

#### 3.4 Implement handleEventInject in IngressManager
**File**: `src/services/api-gateway/ingress.ts`

**Implementation**: (See technical-architecture.md section 5.3)

**Key Security Checks**:
1. Check permissions array includes 'event:inject'
2. Reject if userId === 'anonymous'
3. Validate event structure
4. Prevent routing slip manipulation
5. Audit log with dual identity

**Testing**:
- Unit test: Permission check enforced
- Unit test: Anonymous rejected
- Unit test: Valid event accepted
- Unit test: Audit logging correct
- Security test: Malicious routing slip rejected

#### 3.5 Add event.inject.v2 Frame Type Support
**File**: `src/services/api-gateway/ingress.ts`

**Implementation**:
```typescript
public async handleMessage(
  userId: string,
  data: string,
  permissions?: string[]
): Promise<void> {
  const frame: InboundFrame = JSON.parse(data);

  // Route to appropriate handler
  if (frame.type === 'event.inject.v2') {
    return this.handleEventInject(userId, frame, permissions);
  }

  // Existing chat.message.v1 logic
  // ...
}
```

**Testing**:
- Unit test: event.inject.v2 routed to handler
- Unit test: chat.message.v1 still works
- Integration test: Both frame types work simultaneously

#### 3.6 Update ApiGatewayClient for event.inject.v2
**File**: `tools/brat/src/dev-mcp/api-gateway-client.ts`

**Implementation**:
```typescript
async sendEvent(options: SendEventOptions): Promise<InternalEventV2 | null> {
  if (!this.isConnected) {
    throw new Error('Not connected to api-gateway');
  }

  const frame: InboundFrame = {
    type: 'event.inject.v2',
    payload: {
      event: options.event,
    },
    metadata: {
      id: options.event.correlationId || randomUUID(),
      timestamp: new Date().toISOString(),
    },
  };

  this.ws!.send(JSON.stringify(frame));

  if (!options.waitForResponse) {
    return null;
  }

  return this.waitForResponse(
    frame.metadata.id,
    options.timeoutMs || 10000
  );
}
```

**Testing**:
- Unit test: event.inject.v2 frame built correctly
- Integration test: Full event injection works

#### 3.7 Security Tests
**File**: `src/services/api-gateway/__tests__/ingress-security.test.ts`

**Test Cases**:
1. Anonymous user rejected from event.inject.v2
2. User without permission rejected
3. User with permission accepted
4. Dev MCP token auto-granted permission
5. Audit log contains dual identity
6. Malicious routing slip rejected
7. Invalid connector rejected
8. chat.message.v1 still works without permission

### Phase 3 Validation Criteria

**Unit Tests**: 25+ tests passing
- ✅ Permission checks (8 tests)
- ✅ Frame routing (3 tests)
- ✅ Event injection (6 tests)
- ✅ Security validations (6 tests)
- ✅ Backward compatibility (2 tests)

**Security Validation**:
- ✅ Anonymous cannot use event.inject.v2
- ✅ Regular users cannot use event.inject.v2
- ✅ Dev MCP can use event.inject.v2
- ✅ Audit logs capture real + emulated identity

**Integration Test**:
- ✅ Full platform emulation (Discord, Twitch)
- ✅ Events have correct metadata
- ✅ Existing chat flow unaffected

## Phase 4: Integration & Documentation

**Goal**: Validate end-to-end workflows and document usage

### Tasks

#### 4.1 End-to-End Integration Test
**File**: `tools/brat/src/dev-mcp/__tests__/messaging-integration.test.ts`

**Test Scenario**:
```typescript
describe('Dev MCP Messaging Integration', () => {
  let agentDevContext: string;

  beforeAll(async () => {
    // Provision agent-dev context
    agentDevContext = await agent_dev.provision({ name: 'agent-dev-msg-test' });

    // Deploy api-gateway
    await bit.deploy({ bit: 'api-gateway', context: agentDevContext });

    // Wait for api-gateway ready
    await waitForService('api-gateway', agentDevContext);
  });

  afterAll(async () => {
    await agent_dev.destroy({ name: agentDevContext, confirm: true });
  });

  it('should send simple chat message and receive response', async () => {
    const result = await message.send({
      text: 'Hello BitBrat!',
      context: agentDevContext,
    });

    expect(result).toMatchObject({
      type: 'chat.message.v1',
      message: { text: expect.any(String) },
    });
  });

  it('should emulate Discord platform', async () => {
    const result = await message.send({
      text: '!help',
      emulate: 'discord',
      identity: { id: '123', displayName: 'TestUser' },
      context: agentDevContext,
    });

    // Verify emulation worked
    expect(result.ingress.connector).toBe('discord');
    expect(result.identity.external.platform).toBe('discord');
  });

  it('should send full event with platform emulation', async () => {
    const result = await event.send({
      type: 'chat.message.v1',
      message: { text: '!status' },
      ingress: { connector: 'twitch', source: 'ingress.twitch' },
      qos: { tracer: true },
      context: agentDevContext,
    });

    expect(result.ingress.connector).toBe('twitch');
    expect(result.qos.tracer).toBe(true);
  });
});
```

**Validation**:
- ✅ All 3 scenarios pass
- ✅ Response times < 5 seconds
- ✅ No errors in logs

#### 4.2 Agent-Dev Workflow Documentation
**File**: `documentation/guides/dev-mcp-messaging.md`

**Content Structure**:
1. Overview & Use Cases
2. Quick Start (3-step example)
3. Tool Reference (message.send, event.send)
4. Platform Emulation Guide
5. Authentication & Permissions
6. Troubleshooting
7. Examples (Discord, Twitch, debugging)

**Testing**:
- ✅ Follow guide from scratch
- ✅ All examples run successfully

#### 4.3 CLAUDE.md Pattern Section
**File**: `CLAUDE.md`

**Add Section**: "10. Messaging Tools for Agent Testing"

**Content**:
```markdown
### 10. Messaging Tools for Agent Testing

**Pattern for sending test messages to any execution context.**

Dev MCP provides tools to send chat messages and InternalEventV2 events to any BitBrat environment for testing and debugging.

```typescript
// Simple chat message
await message.send({
  text: "Hello BitBrat!",
  context: "agent-dev-mytest"
})

// Platform emulation
await message.send({
  text: "!help",
  emulate: "discord",
  identity: { id: "123", displayName: "TestUser" },
  channel: "#bot-testing"
})

// Full event control
await event.send({
  type: "chat.message.v1",
  message: { text: "!status" },
  ingress: { connector: "twitch", source: "ingress.twitch" },
  qos: { tracer: true },
  context: "agent-dev-mytest"
})
```

**When to Use**:
- ✅ Testing new services in agent-dev
- ✅ Debugging message flow issues
- ✅ Validating platform emulation
- ✅ Verifying routing slip logic

**Security**: event.inject.v2 requires "event:inject" permission (auto-granted to dev MCP tokens).

**Examples**: See documentation/guides/dev-mcp-messaging.md
```

**Testing**:
- ✅ Pattern validates against architecture
- ✅ Examples run successfully

#### 4.4 Manual Validation Workflow
**Checklist**:

1. Provision agent-dev context: ✅
2. Deploy api-gateway: ✅
3. Send simple message via message.send: ✅
4. Verify response received: ✅
5. Send Discord emulation: ✅
6. Verify platform metadata correct: ✅
7. Send full event via event.send: ✅
8. Verify in fleet.logs: ✅
9. Check audit logs for dual identity: ✅
10. Cleanup agent-dev context: ✅

### Phase 4 Validation Criteria

**Integration Tests**: 3+ scenarios passing
- ✅ Simple chat message
- ✅ Platform emulation
- ✅ Full event injection

**Documentation**:
- ✅ User guide complete
- ✅ CLAUDE.md pattern added
- ✅ Examples validated

**Manual Testing**:
- ✅ Full workflow passes
- ✅ Works in Claude Code (end-to-end)

## Risk Management

### High Risk Items

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Breaking existing chat.message.v1 | Low | High | Comprehensive unit tests, backward compat checks |
| Permission bypass vulnerability | Low | Critical | Security tests, code review, audit logging |
| WebSocket connection instability | Medium | Medium | Reconnection logic, timeout handling |
| Token management complexity | Low | Medium | Reuse existing patterns, clear error messages |

### Medium Risk Items

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Response correlation failures | Medium | Medium | Timeout handling, clear error messages |
| Database migration issues | Low | Medium | Test migration on dev DB first |
| Platform preset bugs | Medium | Low | Unit tests for each preset |

## Testing Strategy

### Unit Test Coverage Targets

**Minimum Coverage**: 85%
- ApiGatewayClient: 90%
- Messaging tools: 85%
- IngressManager: 90%
- Security checks: 100%

### Integration Test Requirements

**Must Pass**:
1. ✅ ApiGatewayClient connects to real api-gateway
2. ✅ message.send works end-to-end
3. ✅ event.send with platform emulation works
4. ✅ Permission checks enforced
5. ✅ Audit logging captures events

### Manual Testing Checklist

- [ ] Provision agent-dev context
- [ ] Deploy api-gateway
- [ ] Send message via message.send
- [ ] Send event via event.send
- [ ] Verify platform emulation (Discord, Twitch)
- [ ] Check audit logs
- [ ] Verify chat.message.v1 still works
- [ ] Test permission denial
- [ ] Test anonymous rejection
- [ ] Cleanup

## Success Criteria (Definition of Done)

### Functional Requirements
- ✅ message.send tool works (simple chat)
- ✅ event.send tool works (full event control)
- ✅ Platform emulation works (Discord, Twitch, Slack, Twilio)
- ✅ Response correlation works
- ✅ Works across local, agent-dev, production contexts
- ✅ Authentication automatic for agent-dev
- ✅ Error messages clear and actionable

### Security Requirements
- ✅ event.inject.v2 permission-gated
- ✅ Anonymous users rejected
- ✅ Users without permission rejected
- ✅ Audit logs capture dual identity (real + emulated)
- ✅ External platforms cannot access api-gateway path
- ✅ No bypass of platform authentication

### Performance Requirements
- ✅ Message send latency < 500ms (local network)
- ✅ WebSocket connection reused (no reconnect per message)
- ✅ Response timeout configurable (default 10s)

### Testing Requirements
- ✅ 60+ unit tests passing
- ✅ 5+ integration tests passing
- ✅ 100% security test coverage
- ✅ Manual workflow validated

### Documentation Requirements
- ✅ User guide complete (documentation/guides/dev-mcp-messaging.md)
- ✅ CLAUDE.md pattern added
- ✅ API reference complete
- ✅ Examples validated

## Deployment Plan

### Local Deployment
1. Build: `npm run build`
2. Test: `npm test`
3. Validate: Run integration tests

### Agent-Dev Deployment
1. Provision context: `agent_dev.provision()`
2. Deploy api-gateway: `bit.deploy({ bit: 'api-gateway' })`
3. Test messaging tools
4. Validate end-to-end

### Production Deployment
**Not Recommended for Initial Release**
- Wait for beta testing feedback
- Require explicit production safeguards
- Add rate limiting before production

## Rollback Plan

If critical issues found:

1. **Immediate**: Disable event.inject.v2 via feature flag
   ```typescript
   if (process.env.EVENT_INJECT_ENABLED !== 'true') {
     throw new Error('event.inject.v2 is disabled');
   }
   ```

2. **Short-term**: Revert IngressManager changes
   - Keep chat.message.v1 working
   - Remove event.inject.v2 handler

3. **Long-term**: Remove messaging tools from dev-mcp
   - Unregister from tool router
   - Keep ApiGatewayClient for future use

## Post-Implementation Tasks

1. Monitor audit logs for event.inject.v2 usage
2. Collect feedback from agent users (Claude Code)
3. Review permission grants (who has event:inject)
4. Plan Phase 2 features (batch messaging, session recording)
5. Consider production deployment after 2 weeks beta

## Appendix: File Checklist

### New Files (11)
- [ ] `tools/brat/src/dev-mcp/api-gateway-client.ts`
- [ ] `tools/brat/src/dev-mcp/tools/messaging.ts`
- [ ] `tools/brat/src/dev-mcp/__tests__/api-gateway-client.test.ts`
- [ ] `tools/brat/src/dev-mcp/__tests__/tools/messaging.test.ts`
- [ ] `tools/brat/src/dev-mcp/__tests__/messaging-integration.test.ts`
- [ ] `src/services/api-gateway/__tests__/ingress-security.test.ts`
- [ ] `src/services/api-gateway/migrations/add-permissions-column.sql`
- [ ] `documentation/guides/dev-mcp-messaging.md`

### Modified Files (5)
- [ ] `tools/brat/src/dev-mcp/types.ts`
- [ ] `tools/brat/src/dev-mcp/server.ts`
- [ ] `src/apps/api-gateway.ts`
- [ ] `src/services/api-gateway/auth.ts`
- [ ] `src/services/api-gateway/ingress.ts`
- [ ] `CLAUDE.md`

### Total: 16 files

---

**Implementation Plan Status**: ✅ Ready for Execution
**Estimated Effort**: 5 days (40 hours)
**Risk Level**: Medium (security-critical changes)
**Blockers**: None
**Next Step**: Review backlog.yaml and begin Phase 1
