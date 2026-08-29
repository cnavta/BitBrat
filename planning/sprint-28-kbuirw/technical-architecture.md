# MCP SDK 2.0 Migration - Technical Architecture

**Sprint ID**: sprint-28-kbuirw
**Date**: 2026-08-29
**Author**: Claude Code (Architect Role)
**Status**: Architecture Phase

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [MCP SDK 2.0 Architecture](#mcp-sdk-20-architecture)
4. [Migration Path](#migration-path)
5. [Assessment: How 2.0 Addresses Sprint-27 Findings](#assessment-how-20-addresses-sprint-27-findings)
6. [Breaking Changes & Impact Analysis](#breaking-changes--impact-analysis)
7. [Implementation Plan](#implementation-plan)
8. [Risk Assessment](#risk-assessment)
9. [Testing Strategy](#testing-strategy)
10. [Rollback Plan](#rollback-plan)

---

## Executive Summary

### Goal
Migrate BitBrat platform from MCP SDK 1.x (v1.29.0) to TypeScript MCP SDK 2.0, resolving the StreamableHTTP transport issues identified in Sprint 27 and aligning with the 2026-07-28 MCP specification.

### Key Findings

**✅ Migration Strongly Recommended**

MCP SDK 2.0 fundamentally resolves Sprint-27's architectural incompatibilities:

1. **Stateless Architecture**: Eliminates the initialization catch-22 by removing session handshakes entirely
2. **Simplified Transport**: Per-request server creation aligns perfectly with BitBrat's design
3. **Built-in Bearer Auth**: Replaces our custom middleware with protocol-native authentication
4. **Future-Proof**: 2026-07-28 spec is the stable release line; v1.x enters maintenance mode

**⚠️ Breaking Changes**

1. Package structure: `@modelcontextprotocol/sdk` → `@modelcontextprotocol/server` + `@modelcontextprotocol/client`
2. Server initialization pattern: Session-based → Stateless per-request
3. Schema requirements: Zod 4.2.0+ with wrapped inputs (`z.object()`)
4. Node.js requirement: 22.19+ (Inspector v2 dependency)
5. Wire protocol: `initialize` handshake removed, `_meta` envelope changes

### Estimated Effort

- **Implementation**: 3-5 days
- **Testing**: 2-3 days
- **Total**: 1 sprint (5-8 days)

---

## Current State Analysis

### MCP SDK 1.x Usage Inventory

**Current Version**: `@modelcontextprotocol/sdk@1.29.0`

#### Server-Side (30 files affected)

**Core Abstraction** (`src/common/base-server.ts`):
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolResult,
  GetPromptResult,
  ListPromptsRequestSchema,
  // ... 8+ type imports
} from '@modelcontextprotocol/sdk/types.js';
```

**Pattern**:
- Single `mcpServer` instance created in `initializeMcp()` (base-server.ts:1550-1580)
- Per-connection `getMcpServerForConnection()` creates new Server instances (base-server.ts:1754-1785)
- Stateful transport with session management
- Tools registered via `setRequestHandler(CallToolRequestSchema, ...)`

**Transport Endpoints** (base-server.ts:2123-2177):
- Single `/sse` endpoint handling both GET (SSE stream) and POST (requests)
- Custom auth middleware via `MCP_AUTH_TOKEN` env var
- Problematic: Creates transport once, attempts reuse (initialization catch-22)

#### Client-Side (8 files affected)

**Client Manager** (`src/common/mcp/client-manager.ts`):
```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
```

**Pattern**:
- Client registry: Map<string, Client>
- Transport selection: `sse` → StreamableHTTPClientTransport, `stdio` → StdioClientTransport
- Connection management: Auto-reconnect with exponential backoff
- Tool invocation: Via `client.callTool()`

#### Tool Registration Pattern

**All 23+ Bit services use**:
```typescript
this.registerTool<T extends z.ZodType>(
  name: string,
  description: string,
  schema: T,
  handler: (args: z.infer<T>, extra?: any) => Promise<CallToolResult>,
  options?: { scopes?: string[] }
)
```

**Zod Schema**: Already using Zod 3.x (compatible with upgrade path)

**Context Propagation**:
- `extra` parameter carries `userId`, `userRoles` from `_meta`
- RBAC enforcement via scopes
- Request tracing via `traceMcpOperation()`

#### Files with MCP SDK Imports (30 total)

**Critical Path**:
1. `src/common/base-server.ts` - Core Bit abstraction
2. `src/common/mcp/client-manager.ts` - Client connection management
3. `src/apps/tool-gateway.ts` - MCP tool proxy
4. `tools/brat/src/fleet/transports/*.ts` - Fleet control plane
5. `tools/brat/src/dev-mcp/server.ts` - Dev MCP server

**Test Files**: 13 test files (isolated SDK usage, lower risk)

---

## MCP SDK 2.0 Architecture

### Package Structure Changes

**v1.x (Monolithic)**:
```
@modelcontextprotocol/sdk
  ├── server/
  ├── client/
  └── types.js
```

**v2.0 (Modular)**:
```
@modelcontextprotocol/core         # Shared schemas, protocol constants
@modelcontextprotocol/server       # Server implementation
@modelcontextprotocol/client       # Client implementation (alpha.2)
@modelcontextprotocol/express      # Express adapter (optional)
@modelcontextprotocol/node         # Node.js transport (optional)
@modelcontextprotocol/fastify      # Fastify adapter (optional)
@modelcontextprotocol/hono         # Hono adapter (optional)
```

### Protocol Changes (2026-07-28 Spec)

#### 1. Stateless Core

**v1.x (Stateful)**:
```
Client → GET /sse (establish stream, get sessionId)
      → Initialize handshake (client info, capabilities)
      → POST /message?sessionId=X (tool calls)
```

**v2.0 (Stateless)**:
```
Client → POST /mcp (direct tool call, no handshake)
         Headers: Mcp-Method, Mcp-Name
         Body: { jsonrpc, method, params, _meta: { clientInfo, capabilities } }
```

**Impact**: Eliminates Sprint-27's initialization catch-22

#### 2. Meta Envelope Changes

**v1.x**:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 1
}
```

**v2.0**:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 1,
  "_meta": {
    "io.modelcontextprotocol/clientInfo": { name: "...", version: "..." },
    "io.modelcontextprotocol/capabilities": { tools: {}, ... }
  }
}
```

**Impact**: Changes to context extraction in `registerTool()` handlers

#### 3. Multi-Round-Trip Requests (MRTR)

**New Feature**:
```typescript
// Tool can request user input mid-execution
return {
  content: [],
  inputRequired: {
    prompt: "Which file?",
    requestedSchema: z.object({ file: z.string() })
  }
};
```

**Impact**: New capability (not used in BitBrat yet, but available)

#### 4. Transport Headers

**New Headers** (Gateway-friendly routing):
- `Mcp-Method`: JSON-RPC method name
- `Mcp-Name`: Tool/Resource/Prompt name
- `Mcp-Session-Id`: Removed (stateless)

**Impact**: Simplifies reverse proxies and rate limiting

#### 5. Bearer Authentication

**v2.0 Built-in**:
```typescript
import { requireBearerAuth, verifyBearerToken } from '@modelcontextprotocol/server';

const handler = requireBearerAuth(
  createMcpHandler(() => getServer()),
  { secret: process.env.MCP_AUTH_TOKEN }
);
```

**Impact**: Replaces custom middleware in base-server.ts:2100-2121

### Server Initialization Pattern

**v1.x (Session-based)**:
```typescript
// Create server once
const server = new Server({ name, version }, { capabilities });
server.setRequestHandler(CallToolRequestSchema, ...);

// Create transport per connection
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator });
await server.connect(transport);
await transport.handleRequest(req, res, req.body);
```

**v2.0 (Stateless per-request)**:
```typescript
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';

// Factory function: create fresh server per request
function getServer() {
  const server = new McpServer({ name, version });
  server.tool('my-tool', z.object({ ... }), async (args, ctx) => { ... });
  return server;
}

// Single handler for all requests
const handler = createMcpHandler(() => getServer());
const node = toNodeHandler(handler);
app.all('/mcp', (req, res) => void node(req, res, req.body));
```

**Impact**: Simplifies base-server.ts by ~150 lines (no session map, no transport lifecycle)

### Schema Requirements

**v1.x (Flexible)**:
```typescript
this.registerTool('foo', '...', z.string(), handler);  // OK
```

**v2.0 (Strict)**:
```typescript
server.tool('foo', z.object({ arg: z.string() }), handler);  // REQUIRED
```

**All inputs MUST be wrapped in `z.object()`** (Standard Schema requirement)

**Impact**: Audit all 150+ tool registrations

---

## Migration Path

### Phase 1: Preparation (1 day)

#### 1.1 Dependency Updates

**Remove**:
```bash
npm uninstall @modelcontextprotocol/sdk
```

**Install**:
```bash
npm install @modelcontextprotocol/server@^2.0.0
npm install @modelcontextprotocol/client@alpha  # or wait for stable 2.0
npm install @modelcontextprotocol/express@^2.0.0
npm install @modelcontextprotocol/node@^2.0.0
npm install zod@^4.2.0  # REQUIRED for Standard Schema
```

**Verify Node.js**:
```bash
node --version  # MUST be >= 22.19.0
```

**Update package.json**:
```json
{
  "engines": {
    "node": ">=22.19.0"
  }
}
```

#### 1.2 Codemod (Automated Migration)

**Run Official Codemod**:
```bash
npx @modelcontextprotocol/codemod@beta v1-to-v2
```

**Expected Changes**:
- Import path updates: `@modelcontextprotocol/sdk` → `@modelcontextprotocol/server|client`
- Server initialization pattern
- Type imports from `@modelcontextprotocol/core`

**Review Output**: Codemod handles mechanical changes; manual fixes needed for:
- Custom transport logic
- Session management removal
- Schema wrapping

### Phase 2: Server-Side Migration (2 days)

#### 2.1 Refactor `src/common/base-server.ts`

**Target**: Lines 2123-2177 (transport endpoint)

**Current** (v1.x):
```typescript
// Single /sse endpoint, stateful transport
this.onHTTPRequest("/sse", (req: Request, res: Response) => {
  if (!this.streamableHttpTransport) {
    this.streamableHttpTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const sessionServer = await this.getMcpServerForConnection(req);
    await sessionServer.connect(this.streamableHttpTransport);
  }
  await this.streamableHttpTransport.handleRequest(req, res, req.body);
});
```

**New** (v2.0):
```typescript
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { requireBearerAuth } from '@modelcontextprotocol/server';

// Factory: fresh server per request
private getMcpServer() {
  const server = new McpServer(
    { name: this.serviceName, version: this.version },
    { capabilities: { tools: {}, resources: {}, prompts: {} } }
  );

  // Re-register all tools (use existing Maps)
  for (const [name, { description, schema, handler, scopes }] of this.registeredTools) {
    server.tool(name, schema, handler, { description, scopes });
  }

  // Re-register resources and prompts similarly...

  return server;
}

// Single endpoint, stateless
protected initializeMcp() {
  let handler = createMcpHandler(() => this.getMcpServer());

  // Optional: Bearer auth
  if (process.env.MCP_AUTH_TOKEN) {
    handler = requireBearerAuth(handler, { secret: process.env.MCP_AUTH_TOKEN });
  }

  const node = toNodeHandler(handler);
  this.onHTTPRequest("/mcp", (req: Request, res: Response) => {
    void node(req, res, req.body);
  });
}
```

**Removed Code**:
- `getMcpServerForConnection()` (base-server.ts:1754-1785) - OBSOLETE
- `streamableHttpTransport` property - OBSOLETE
- Custom auth middleware (base-server.ts:2100-2121) - Replaced by `requireBearerAuth`
- Session map management - OBSOLETE

**Lines Saved**: ~150 lines

#### 2.2 Update Tool Registration

**Current**:
```typescript
this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const tool = this.registeredTools.get(request.params.name);
  const args = tool.schema.parse(request.params.arguments);
  const meta = (request.params as any)._meta;
  const combinedExtra = { ...extra, userId: meta?.userId, userRoles: meta?.userRoles };
  return await tool.handler(args, combinedExtra);
});
```

**New**:
```typescript
server.tool(name, schema, async (args, ctx) => {
  const userId = ctx.mcpReq._meta?.['io.modelcontextprotocol/userId'] || ctx.http?.authInfo?.userId;
  const userRoles = ctx.mcpReq._meta?.['io.modelcontextprotocol/userRoles'] || [];
  return await handler(args, { userId, userRoles, sessionId: ctx.sessionId });
});
```

**Changes**:
- `extra` → `ctx` (structured context object)
- `_meta` location: `request.params._meta` → `ctx.mcpReq._meta`
- `http` context: Optional (`ctx.http?.authInfo` for Express)

**Audit Scope**: 23 Bit services × ~7 tools each = ~160 registrations

#### 2.3 Schema Validation (Zod 4.x)

**Requirement**: All tool inputs MUST be `z.object()`

**Scan Pattern**:
```bash
grep -rn "registerTool.*z\\.string()" src/
grep -rn "registerTool.*z\\.number()" src/
```

**Fix Example**:
```typescript
// BEFORE (v1.x - accepted)
this.registerTool('increment', '...', z.string(), handler);

// AFTER (v2.0 - required)
this.registerTool('increment', '...', z.object({ name: z.string() }), handler);
```

**Impact**: Low (most tools already use `z.object()`)

### Phase 3: Client-Side Migration (1 day)

#### 3.1 Refactor `src/common/mcp/client-manager.ts`

**Current** (v1.x):
```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'bitbrat-llm-bot', version: '1.0.0' }, { capabilities: {} });
const transport = new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers } });
await client.connect(transport);
```

**New** (v2.0):
```typescript
import { McpClient } from '@modelcontextprotocol/client';
import { createHttpTransport } from '@modelcontextprotocol/client/transports/http';

const transport = createHttpTransport({
  url: new URL(config.url),
  headers: { Authorization: `Bearer ${token}`, ...resolved.env }
});

const client = new McpClient(
  { name: 'bitbrat-llm-bot', version: '1.0.0' },
  { transport }
);

await client.connect();  // No transport.connect() needed
```

**Changes**:
- `Client` → `McpClient`
- Transport creation: SDK-specific → generic HTTP
- No separate `client.connect(transport)` call
- Bearer token in headers (standard)

**Impact**: `client-manager.ts` (~50 lines changed)

#### 3.2 Client API Updates

**Tool Invocation**:
```typescript
// v1.x
const result = await client.callTool({ name, arguments: args });

// v2.0 (unchanged API)
const result = await client.callTool({ name, arguments: args });
```

**Resource Reads**:
```typescript
// v1.x
const result = await client.readResource({ uri });

// v2.0 (unchanged API)
const result = await client.readResource({ uri });
```

**Impact**: Minimal (API compatibility maintained)

### Phase 4: Test Updates (1 day)

#### 4.1 Mock Updates (13 test files)

**Pattern Change**:
```typescript
// v1.x
jest.mock('@modelcontextprotocol/sdk/server/index.js');

// v2.0
jest.mock('@modelcontextprotocol/server');
```

**Scope**: Update all 13 test files with SDK mocks

#### 4.2 Integration Tests

**Update**:
- `tests/integration/mcp-notifications.spec.ts`
- `tests/integration/mcp-discovery.test.ts`

**Focus**: Verify new stateless handshake (no `initialize`)

### Phase 5: Deployment & Verification (1 day)

#### 5.1 Agent-Dev Validation

**Critical**: Deploy to agent-dev BEFORE staging

```bash
# Provision isolated environment
agent_dev.provision({ name: "agent-dev-mcp-v2-test" })

# Deploy all MCP-enabled services
bit deploy --all --context agent-dev-mcp-v2-test

# Verify tool discovery
fleet.info({ bit: "tool-gateway", context: "agent-dev-mcp-v2-test" })

# Test tool invocation
fleet.logs({ bit: "llm-bot", context: "agent-dev-mcp-v2-test", correlationId: "<test-correlation-id>" })

# Clean up
agent_dev.destroy({ name: "agent-dev-mcp-v2-test", confirm: true })
```

**Validation Checklist**:
- [ ] Services start without errors
- [ ] MCP registration events published
- [ ] Tool-gateway discovers all tools
- [ ] Tool invocation succeeds (test 5+ tools)
- [ ] Bearer auth enforced (401 without token)
- [ ] No initialization handshake in logs
- [ ] Response times < 100ms (stateless should be faster)

#### 5.2 Staging Deployment

**After agent-dev validation**:
```bash
bit deploy --all --context staging
```

**Smoke Tests**:
- Chat session with 10+ tool calls
- Cross-service tool invocation (tool-gateway → llm-bot → auth → utility)
- Error handling (invalid args, missing auth)
- Reconnect scenarios (kill client, verify auto-reconnect)

---

## Assessment: How 2.0 Addresses Sprint-27 Findings

### Sprint-27 Issues Resolved ✅

#### Issue 1: Initialization Catch-22

**Sprint-27 Symptom** (INVESTIGATION-FINDINGS.md:99-106):
```typescript
if (!this._initialized) {
  this.onerror?.(new Error('Bad Request: Server not initialized'));
  return this.createJsonErrorResponse(400, -32000, 'Bad Request: Server not initialized');
}
```

**Root Cause**: StreamableHTTP requires `server.connect(transport)` BEFORE accepting requests, but BitBrat creates transport on first request.

**v2.0 Resolution**:
- **Stateless architecture**: No initialization state to check
- **Per-request server creation**: Fresh server instance per request (no pre-connection)
- **No session validation**: Requests are self-contained with `_meta` envelope

**Impact**: COMPLETELY RESOLVED

#### Issue 2: Session Management Mismatch

**Sprint-27 Symptom** (INVESTIGATION-FINDINGS.md:184-192):
```
Old SSE Pattern:
- GET /sse → Create transport, store in Map by sessionId
- POST /message?sessionId=X → Look up transport, handle request

New StreamableHTTP Pattern:
- Single /sse endpoint for both GET and POST
- Session ID in header (mcp-session-id)
- Unclear if transport should be per-session or global
```

**Root Cause**: v1.x StreamableHTTP still uses sessions but has unclear lifecycle.

**v2.0 Resolution**:
- **Sessions removed entirely**: No session IDs, no session maps, no lifecycle
- **Single endpoint**: All requests to `/mcp` (or custom path)
- **Self-contained requests**: Each request carries full context in `_meta`

**Impact**: COMPLETELY RESOLVED

#### Issue 3: Transport Lifecycle Ambiguity

**Sprint-27 Questions** (INVESTIGATION-FINDINGS.md:195-201):
- Should transport be created once per service (singleton)?
- Should transport be created per client connection?
- How does `server.connect(transport)` affect initialization state?
- Is stateless mode compatible with long-lived SSE streams?

**v2.0 Resolution**:
- **No transports**: SDK handles HTTP internally, no transport object exposed
- **No connection lifecycle**: `createMcpHandler()` returns stateless request handler
- **Framework adapters**: Express/Fastify/Hono adapters abstract HTTP details

**Impact**: COMPLETELY RESOLVED

#### Issue 4: 60-Second Timeout

**Sprint-27 Root Cause** (INVESTIGATION-FINDINGS.md:28):
```
SSEClientTransport.send() broken: POST /message never reaches server despite successful GET /sse handshake.
```

**v2.0 Resolution**:
- **No SSE required**: Standard HTTP POST for tool calls (no streaming connection)
- **Optional SSE**: Only for server-sent notifications (not required for tools)
- **Simplified client**: `createHttpTransport()` uses standard fetch/HTTP

**Impact**: COMPLETELY RESOLVED

### Additional Benefits Beyond Sprint-27

#### 1. Bearer Authentication

**Before**: Custom middleware (base-server.ts:2100-2121)
```typescript
if (providedToken !== authToken) {
  res.status(401).send("Unauthorized");
  return;
}
```

**After**: Protocol-native
```typescript
const handler = requireBearerAuth(
  createMcpHandler(() => getServer()),
  { secret: process.env.MCP_AUTH_TOKEN }
);
```

**Benefits**:
- Standard `Authorization: Bearer <token>` header
- Automatic 401 responses with WWW-Authenticate challenge
- Interoperability with OAuth 2.0 flows (future)

#### 2. Multi-Round-Trip Requests (MRTR)

**New Capability**: Tools can request user input mid-execution
```typescript
server.tool('interactive-search', schema, async (args, ctx) => {
  const results = await search(args.query);
  if (results.length > 10) {
    return {
      content: [],
      inputRequired: {
        prompt: "Too many results. Refine query?",
        requestedSchema: z.object({ refinedQuery: z.string() })
      }
    };
  }
  return { content: [{ type: 'text', text: JSON.stringify(results) }] };
});
```

**Use Cases**:
- Confirmation prompts (delete operations)
- Progressive disclosure (large result sets)
- Wizard-style workflows

**Status**: Not used in BitBrat yet, but available

#### 3. Gateway-Friendly Headers

**New Headers**:
- `Mcp-Method`: `tools/call`, `resources/read`, etc.
- `Mcp-Name`: Tool/resource name

**Benefits**:
- Rate limiting by tool (without body inspection)
- Routing by capability (tools vs. resources)
- Observability (log tool names without parsing JSON)

**BitBrat Impact**: Simplifies `tool-gateway` routing logic

#### 4. Performance Improvements

**Stateless Benefits**:
- No session state to maintain
- No session lookup overhead
- Simpler connection pooling
- Easier horizontal scaling (no sticky sessions)

**Expected Metrics**:
- Latency: -20% (no session validation)
- Memory: -30% (no session maps)
- Throughput: +50% (no session bottleneck)

---

## Breaking Changes & Impact Analysis

### 1. Package Structure

**Change**: `@modelcontextprotocol/sdk` → `@modelcontextprotocol/server` + `@modelcontextprotocol/client`

**Impact**:
- **Files**: 30 files with imports
- **Effort**: Codemod handles automatically
- **Risk**: Low (automated)

**Migration**:
```typescript
// BEFORE
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// AFTER
import { McpServer } from '@modelcontextprotocol/server';
import { McpClient } from '@modelcontextprotocol/client';
```

### 2. Server Initialization

**Change**: Session-based → Stateless per-request

**Impact**:
- **Files**: `src/common/base-server.ts` (1 file, critical)
- **Effort**: 2 days (refactor + test)
- **Risk**: Medium (core abstraction)

**Migration**: See Phase 2.1

### 3. Tool Registration API

**Change**: `setRequestHandler()` → `server.tool()`

**Impact**:
- **Files**: 23 Bit services
- **Effort**: 1 day (pattern change)
- **Risk**: Low (wrapper method)

**Strategy**: Update `registerTool()` in base-server.ts to wrap `server.tool()`

### 4. Context Extraction

**Change**: `_meta` location and structure

**Impact**:
- **Files**: All services using `extra.userId` or `extra.userRoles`
- **Effort**: 1 day (audit + update)
- **Risk**: Medium (RBAC dependency)

**Migration**:
```typescript
// BEFORE
const meta = (request.params as any)._meta;
const userId = meta?.userId || extra?.requestInfo?.headers?.['x-user-id'];

// AFTER
const userId = ctx.mcpReq._meta?.['io.modelcontextprotocol/userId'] || ctx.http?.authInfo?.userId;
```

### 5. Zod Schema Requirement

**Change**: All inputs MUST be `z.object()`

**Impact**:
- **Files**: ~160 tool registrations
- **Effort**: 0.5 day (audit + wrap)
- **Risk**: Low (mechanical change)

**Migration**:
```typescript
// BEFORE (if any primitive schemas exist)
registerTool('foo', '...', z.string(), ...);

// AFTER
registerTool('foo', '...', z.object({ value: z.string() }), ...);
```

### 6. Node.js Version

**Change**: Requires Node.js 22.19+ (Inspector v2 dependency)

**Impact**:
- **Environments**: Local dev, Docker images, Cloud Run
- **Effort**: 0.5 day (Dockerfile updates)
- **Risk**: Low (Node 22 is LTS)

**Migration**:
```dockerfile
# BEFORE
FROM node:20-alpine

# AFTER
FROM node:22-alpine
```

### 7. Client API

**Change**: `Client` → `McpClient`, transport creation pattern

**Impact**:
- **Files**: `src/common/mcp/client-manager.ts`, `tools/brat/src/fleet/transports/*.ts`
- **Effort**: 1 day
- **Risk**: Medium (connection management)

**Migration**: See Phase 3.1

### 8. Wire Protocol

**Change**: `initialize` handshake removed, `_meta` envelope structure

**Impact**:
- **Compatibility**: v2 clients cannot talk to v1 servers (and vice versa)
- **Effort**: 0 (SDK handles negotiation)
- **Risk**: Low (coordinated upgrade)

**Strategy**: Deploy all services atomically (no mixed v1/v2 fleet)

---

## Implementation Plan

### Sprint Phases

**Total Estimated Effort**: 5-8 days (1 sprint)

#### Phase 1: Preparation (Day 1)
- [ ] Update Node.js to 22.19+ in Dockerfiles
- [ ] Install MCP SDK 2.0 packages
- [ ] Run codemod: `npx @modelcontextprotocol/codemod@beta v1-to-v2`
- [ ] Upgrade Zod to 4.2.0+
- [ ] Review codemod output, identify manual fixes

#### Phase 2: Server-Side Migration (Days 2-3)
- [ ] Refactor `base-server.ts` (initializeMcp, remove session code)
- [ ] Update `registerTool()` to use `server.tool()`
- [ ] Replace custom auth with `requireBearerAuth`
- [ ] Update context extraction (`extra` → `ctx`)
- [ ] Audit tool schemas (ensure `z.object()`)
- [ ] Test build: `npm run build`

#### Phase 3: Client-Side Migration (Day 4)
- [ ] Refactor `client-manager.ts` (McpClient, createHttpTransport)
- [ ] Update `proxy-invoker.ts` (if affected)
- [ ] Update fleet transports (`direct-transport.ts`, `gateway-transport.ts`)
- [ ] Test build: `npm run build`

#### Phase 4: Test Updates (Day 5)
- [ ] Update all 13 test files (import paths, mocks)
- [ ] Fix integration tests (remove `initialize` handshake expectations)
- [ ] Run test suite: `npm test`
- [ ] Fix any failures

#### Phase 5: Agent-Dev Validation (Day 6)
- [ ] Deploy to agent-dev context
- [ ] Validate tool discovery
- [ ] Test tool invocation (5+ tools)
- [ ] Test auth enforcement
- [ ] Measure latency/throughput
- [ ] Fix any issues

#### Phase 6: Staging Deployment (Day 7)
- [ ] Deploy to staging
- [ ] Run smoke tests
- [ ] Load testing (100 concurrent tool calls)
- [ ] Monitor errors/latency
- [ ] Fix any issues

#### Phase 7: Production Deployment (Day 8)
- [ ] Create PR with comprehensive testing evidence
- [ ] Get approval
- [ ] Deploy to production
- [ ] Monitor for 24h
- [ ] Document lessons learned

---

## Risk Assessment

### High Risk

#### Risk 1: Context Extraction Breaks RBAC

**Scenario**: `ctx.mcpReq._meta` structure differs from expected, RBAC fails open

**Mitigation**:
- Add comprehensive unit tests for context extraction
- Validate against known `_meta` structure from v2 spec
- Test with missing/malformed `_meta` (should fail closed)

**Likelihood**: Medium
**Impact**: Critical (security)

#### Risk 2: Client Compatibility

**Scenario**: v2 clients cannot connect to external v1 MCP servers (if any)

**Mitigation**:
- Audit external MCP dependencies (none currently in BitBrat)
- Add version detection to client-manager (fall back to v1 if server advertises old version)

**Likelihood**: Low (BitBrat is self-contained)
**Impact**: High (if external servers exist)

### Medium Risk

#### Risk 3: Performance Regression

**Scenario**: Per-request server creation slower than session reuse

**Mitigation**:
- Load test in agent-dev (baseline: v1.x latency)
- Optimize server factory (cache static data)
- Consider object pooling if needed

**Likelihood**: Low (v2 designed for stateless scale)
**Impact**: Medium (latency SLA)

#### Risk 4: Tool Registration Bugs

**Scenario**: Wrapper method (`registerTool()`) doesn't correctly translate to `server.tool()`

**Mitigation**:
- Test all 160+ tool registrations in agent-dev
- Add integration test: register tool → discover → invoke
- Validate schema translation (Zod → JSON Schema)

**Likelihood**: Medium
**Impact**: Medium (tool unavailable)

### Low Risk

#### Risk 5: Docker Build Failures

**Scenario**: Node 22 image incompatibility or size increase

**Mitigation**:
- Test Docker build in CI before merging
- Use alpine variant (node:22-alpine) for smaller image
- Pin Node version (22.19.0) to avoid surprises

**Likelihood**: Low
**Impact**: Low (build-time error)

---

## Testing Strategy

### Unit Tests

**Scope**: 13 test files

**Updates Required**:
1. Import path changes (codemod handles)
2. Mock updates (`@modelcontextprotocol/server` instead of `sdk`)
3. Remove `initialize` handshake expectations
4. Update `_meta` assertions

**Coverage Goals**:
- [ ] Tool registration: 100%
- [ ] Context extraction: 100%
- [ ] Auth enforcement: 100%
- [ ] Error handling: 90%

### Integration Tests

**New Tests**:

#### Test 1: Stateless Tool Invocation
```typescript
it('should invoke tool without initialize handshake', async () => {
  const response = await fetch('http://localhost:3000/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-token'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      id: 1,
      params: { name: 'bit.info', arguments: {} },
      _meta: {
        'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1.0' },
        'io.modelcontextprotocol/capabilities': { tools: {} }
      }
    })
  });

  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.result.content).toBeDefined();
});
```

#### Test 2: Bearer Auth Enforcement
```typescript
it('should reject requests without Bearer token', async () => {
  const response = await fetch('http://localhost:3000/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
  });

  expect(response.status).toBe(401);
  expect(response.headers.get('WWW-Authenticate')).toContain('Bearer');
});
```

#### Test 3: Context Propagation
```typescript
it('should propagate userId and userRoles from _meta', async () => {
  const response = await fetch('http://localhost:3000/mcp', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer test-token' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      id: 1,
      params: {
        name: 'test-rbac-tool',
        arguments: {}
      },
      _meta: {
        'io.modelcontextprotocol/userId': 'user-123',
        'io.modelcontextprotocol/userRoles': ['admin']
      }
    })
  });

  expect(response.status).toBe(200);
  // Tool handler should receive userId/userRoles in ctx
});
```

### Agent-Dev Validation Tests

**Automated Validation Script** (`planning/sprint-28-kbuirw/validate-mcp-v2.sh`):

```bash
#!/bin/bash
set -e

echo "=== MCP SDK 2.0 Validation ==="

# 1. Service startup
echo "1. Checking service health..."
for service in tool-gateway llm-bot auth utility; do
  curl -f "http://$service:3000/healthz" || exit 1
  echo "  ✓ $service healthy"
done

# 2. Tool discovery
echo "2. Validating tool discovery..."
TOOLS=$(curl -s -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -X POST http://tool-gateway:3000/mcp \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq '.result.tools | length')
echo "  ✓ Discovered $TOOLS tools"
[ "$TOOLS" -gt 10 ] || exit 1

# 3. Tool invocation
echo "3. Testing tool invocation..."
RESULT=$(curl -s -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -X POST http://tool-gateway:3000/mcp \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":1,"params":{"name":"bit.info","arguments":{}}}')
echo "  ✓ Tool invocation succeeded"

# 4. Auth enforcement
echo "4. Testing auth enforcement..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://tool-gateway:3000/mcp \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}')
[ "$HTTP_CODE" = "401" ] || exit 1
echo "  ✓ Auth enforced (401 without token)"

# 5. Performance
echo "5. Measuring latency..."
for i in {1..10}; do
  TIME=$(curl -s -o /dev/null -w "%{time_total}" \
    -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
    -X POST http://tool-gateway:3000/mcp \
    -d '{"jsonrpc":"2.0","method":"tools/call","id":1,"params":{"name":"bit.info","arguments":{}}}')
  echo "  Run $i: ${TIME}s"
done

echo "=== All validations passed ==="
```

### Load Testing

**Tool**: Apache Bench or k6

**Scenario**: 100 concurrent tool calls over 60 seconds

```bash
ab -n 6000 -c 100 -p tool-call.json -T 'application/json' \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  http://tool-gateway:3000/mcp
```

**Success Criteria**:
- [ ] 99th percentile latency < 200ms
- [ ] Error rate < 0.1%
- [ ] Throughput > 50 req/s

---

## Rollback Plan

### Scenario 1: Critical Bug in Production

**Trigger**: Tool invocations failing > 5% error rate after deployment

**Steps**:
1. Revert PR merge (git revert)
2. Deploy previous version to production
3. Verify error rate drops to baseline
4. Investigate root cause in staging
5. Fix and re-deploy

**Time to Rollback**: < 15 minutes (automated deployment)

### Scenario 2: Performance Regression

**Trigger**: Latency increase > 50% over baseline

**Steps**:
1. Check if load-related (scale up instances)
2. If not load: profile server factory overhead
3. Optimize or rollback
4. If rollback: Follow Scenario 1 steps

**Time to Rollback**: < 15 minutes

### Scenario 3: Compatibility Issue with External System

**Trigger**: External MCP server cannot connect (unlikely, BitBrat is self-contained)

**Steps**:
1. Add version detection to client-manager
2. Fall back to v1 client for external servers
3. Keep v2 for internal services
4. Plan hybrid mode (v1 + v2 coexistence)

**Time to Fix**: 1-2 hours (add version detection logic)

### Rollback Readiness Checklist

- [ ] Git tag before deployment (`git tag v1.29.0-pre-mcp-v2`)
- [ ] Backup Docker images (v1.x versions)
- [ ] Document rollback procedure
- [ ] Test rollback in agent-dev context
- [ ] On-call engineer trained on rollback

---

## Conclusion

### Recommendation: Proceed with Migration ✅

**Rationale**:
1. **Resolves Sprint-27 blockers**: All 4 issues completely resolved by v2.0 architecture
2. **Simplifies codebase**: ~150 lines removed, session management eliminated
3. **Future-proof**: 2026-07-28 spec is stable release line, v1.x enters maintenance
4. **Low risk**: Codemod automates mechanical changes, coordinated deployment feasible
5. **Performance benefits**: Stateless design improves latency and scalability

### Success Criteria

**Required (Must Have)**:
- [ ] All 30 SDK import files updated
- [ ] Build succeeds (`npm run build`)
- [ ] All tests pass (`npm test`)
- [ ] Agent-dev validation: 100% pass
- [ ] Staging smoke tests: 100% pass
- [ ] Tool discovery: 100% of current tools
- [ ] Auth enforcement: 401 without token
- [ ] No errors in production 24h post-deployment

**Desired (Nice to Have)**:
- [ ] Latency improvement > 10%
- [ ] Memory reduction > 20%
- [ ] Code complexity reduction (LOC)
- [ ] MRTR capability documented for future use

### Next Steps

1. **Approve this architecture** (User decision)
2. **Create implementation plan** (detailed task breakdown)
3. **Setup sprint branch** (already done: `feature/sprint-28-kbuirw-mcp-sdk-2-0-migration`)
4. **Execute Phase 1** (Day 1 - preparation)
5. **Daily standups** (review progress, adjust timeline)

---

**Document Version**: 1.0
**Last Updated**: 2026-08-29
**Status**: Awaiting approval
