# Architecture Brief: MCP SDK v2 Handler Migration

**Sprint**: 65
**Date**: 2026-11-18
**Author**: Claude (Architecture Role)
**Status**: Investigation Complete - Migration Required

---

## Executive Summary

**Root Cause Identified**: BitBrat services are using **MCP SDK v2.0.0** but implementing handlers with the **v1 API signature**. This API mismatch is the root cause of all `_meta` context passing failures, "Model not found" errors, and tool execution RBAC issues.

**Impact**: ALL services using `registerTool()` are affected. Tool handlers cannot access execution context (userId, modelId, userRoles, correlationId), causing authentication and authorization to fail.

**Recommendation**: **Immediate migration** to v2 API using `setRequestHandler()` for context-aware tools, or implement context injection middleware.

---

## 1. Discovery Timeline

### 1.1 Initial Symptoms
- **Error**: "Model not found: tool-orchestrator" (staging trace 4db52bc2)
- **Issue**: Tool execution failing with RBAC validation errors
- **Context**: _meta data not being passed from llm-bot → tool-orchestrator → ToolGateway

### 1.2 Investigation Path
1. **Traced execution flow**: llm-bot → proxy-invoker → tool-orchestrator → ToolGateway
2. **Examined ProxyInvoker** (src/common/mcp/proxy-invoker.ts:51-98): ✅ Correctly sends `_meta` as top-level field
3. **Analyzed debug logs**: Found handler receiving `{ sessionId, mcpReq, http }` where `args` should be
4. **Checked SDK version**: Confirmed running MCP SDK v2.0.0
5. **Researched v2 documentation**: Discovered complete handler signature change between v1 and v2

### 1.3 Root Cause
**Handler signature mismatch**:
- **Our code**: `async (args, ctx) => { const meta = args._meta; }`
- **SDK v2 expects**: `async ({ ...toolArgs }) => { }` (destructured args, NO ctx)
- **SDK v2 provides**: ServerContext as first param when it expects destructured args

This explains why:
- `args` contains `{ sessionId, mcpReq, http }` (ServerContext properties)
- `ctx` is `undefined` (no second parameter in v2)
- `args._meta` is `undefined` (not in ServerContext)
- `modelId` falls back to 'tool-orchestrator' instead of actual 'gpt-5.5'

---

## 2. MCP SDK v2 API Changes

### 2.1 Handler Registration Methods

MCP SDK v2 provides **two distinct handler registration APIs** with different signatures:

#### **Option A: `setRequestHandler()` - Full Context Access**
```typescript
server.setRequestHandler('tools/call', async (request, ctx) => {
  // ✅ Full ServerContext access
  const userId = ctx.http?.req?.headers.get('x-user-id');
  const meta = ctx.mcpReq._meta;
  const sessionId = ctx.sessionId;

  // Extract tool args from request
  const { name, arguments: toolArgs } = request.params;

  return { content: [{ type: 'text', text: 'Result' }] };
});
```

**Signature**: `async (request: CallToolRequest, ctx: ServerContext) => CallToolResult`

**ServerContext Properties**:
```typescript
interface ServerContext {
  sessionId: string;
  mcpReq: {
    signal: AbortSignal;      // Cancellation
    id: string | number;      // Request ID
    _meta?: {                 // ✅ Execution context
      userId?: string;
      userRoles?: string[];
      modelId?: string;
      correlationId?: string;
      sessionId?: string;
    };
    send(): Promise<void>;    // Send requests to client
    notify(): void;           // Send notifications
  };
  http?: {                    // Optional (HTTP transport only)
    req: Request;             // Web Standard Request
    authInfo?: AuthInfo;      // OAuth/Bearer auth
    closeSSE?: () => void;    // Close SSE streams
  };
}
```

**Use Case**: Tools that need execution context (userId, modelId, roles) for authentication, authorization, or audit logging.

#### **Option B: `registerTool()` - Convenience API**
```typescript
server.registerTool('toolName', {
  description: 'Tool description',
  inputSchema: z.object({
    param1: z.string(),
    param2: z.number()
  })
}, async ({ param1, param2 }) => {
  // ❌ NO ServerContext access
  // ❌ NO _meta, userId, modelId, etc.
  // ✅ ONLY validated input arguments

  return { content: [{ type: 'text', text: `Got ${param1}` }] };
});
```

**Signature**: `async (validatedArgs: z.infer<typeof inputSchema>) => CallToolResult`

**Use Case**: Simple stateless tools that don't need request context. Pure functions operating only on input arguments.

### 2.2 Migration Matrix: v1 to v2

| v1 API | v2 API | Notes |
|--------|--------|-------|
| `server.setRequestHandler(CallToolRequestSchema, handler)` | `server.setRequestHandler('tools/call', handler)` | Method string instead of schema |
| `async (request, extra)` | `async (request, ctx)` | Second param renamed, structured |
| `extra.signal` | `ctx.mcpReq.signal` | Moved into mcpReq |
| `extra.requestId` | `ctx.mcpReq.id` | Moved into mcpReq |
| `extra._meta` | `ctx.mcpReq._meta` | ✅ THIS IS WHERE _META LIVES |
| `extra.sessionId` | `ctx.sessionId` | Top-level on ctx |
| `extra.authInfo` | `ctx.http?.authInfo` | Optional (HTTP only) |
| `extra.requestInfo` | `ctx.http?.req` | Web Standard Request |
| `req.headers['x-user-id']` | `ctx.http?.req?.headers.get('x-user-id')` | Use `.get()` method |

---

## 3. Current Implementation Analysis

### 3.1 Affected Files

#### **src/apps/tool-orchestrator-service.ts (Lines 1488-1560)**
```typescript
// ❌ WRONG: v1 signature with v2 SDK
server.registerTool(sanitizedToolName, {
  description: tool.description || `Tool: ${tool.id}`,
  // inputSchema omitted (also problematic)
}, async (args: any, ctx: any) => {  // ❌ v1 signature
  // This receives ServerContext as 'args', not tool arguments!
  const meta = (args as any)._meta;              // ❌ undefined
  const metaFromCtx = (ctx as any)?._meta;        // ❌ ctx is undefined
  const metaFromMcpReq = (ctx as any)?.mcpReq?._meta;  // ❌ ctx is undefined

  const combinedExtra = {
    userId: meta?.userId || 'anonymous',         // ❌ Falls back
    userRoles: meta?.userRoles || [],            // ❌ Falls back
    modelId: meta?.modelId || 'tool-orchestrator', // ❌ WRONG - causes "Model not found"
  };

  // Tool execution with wrong context
  return await tool.execute!(args, combinedExtra);
});
```

**Issue**: Handler signature `async (args, ctx)` is from v1. SDK v2 passes ServerContext as first param because it expects destructured args pattern.

#### **src/common/base-server.ts (Lines 1748-1762)**
```typescript
// ❌ SAME ISSUE in base class
server.registerTool(name, {
  description: tool.description,
  inputSchema: tool.schema,
}, async (args, ctx) => {  // ❌ v1 signature
  const meta = (args as any)._meta;  // ❌ undefined
  const combinedExtra = {
    ...ctx,  // ❌ ctx is undefined
    userId: meta?.userId || (ctx as any)?.http?.req?.headers?.['x-user-id'],
    userRoles: meta?.userRoles || (ctx as any)?.http?.req?.headers?.['x-roles'],
  };
  return await this.traceMcpOperation(`tool:${name}`, () => tool.handler(args, combinedExtra), combinedExtra);
});
```

**Issue**: Base class `Bit.getMcpServer()` uses same wrong v1 signature. ALL services inheriting from Bit are affected.

#### **src/common/mcp/proxy-invoker.ts (Lines 51-98)**
```typescript
// ✅ CORRECT: ProxyInvoker properly sends _meta
return client.callTool({
  name: toolName,
  arguments: args,
  _meta: meta,  // ✅ Correctly sends _meta as top-level field
} as any);
```

**Status**: ProxyInvoker is NOT the issue. It correctly sends `_meta` to upstream MCP servers.

### 3.2 Execution Flow

**Current (Broken) Flow**:
```
1. llm-bot: Calls client.callTool({ arguments: {...}, _meta: {...} })
   ✅ Sends modelId: "gpt-5.5", userId, roles

2. tool-orchestrator MCP endpoint receives request
   ✅ _meta arrives in request

3. SDK v2 calls registered handler
   ❌ Expects: async ({ ...toolArgs }) => {}
   ❌ Finds: async (args, ctx) => {}
   ❌ Passes ServerContext as 'args' (wrong position)
   ❌ No 'ctx' parameter (v2 doesn't have it)

4. Handler attempts: const meta = args._meta
   ❌ args = ServerContext = { sessionId, mcpReq, http }
   ❌ args._meta = undefined
   ❌ Falls back to modelId: "tool-orchestrator"

5. ToolGateway.validateToolAccess(context)
   ❌ Receives modelId: "tool-orchestrator"
   ❌ Throws: "Model not found: tool-orchestrator"
```

**Expected (Correct) Flow**:
```
1. llm-bot: Calls client.callTool({ arguments: {...}, _meta: {...} })
   ✅ Sends modelId: "gpt-5.5", userId, roles

2. tool-orchestrator MCP endpoint receives request
   ✅ _meta arrives in request

3. SDK v2 calls handler registered with setRequestHandler
   ✅ Handler: async (request, ctx) => {}
   ✅ ctx.mcpReq._meta contains { modelId: "gpt-5.5", userId, roles }

4. Handler extracts: const meta = ctx.mcpReq._meta
   ✅ meta.modelId = "gpt-5.5"
   ✅ meta.userId = "actual-user-id"
   ✅ meta.userRoles = ["platform:admin"]

5. ToolGateway.validateToolAccess(context)
   ✅ Receives modelId: "gpt-5.5"
   ✅ Validates successfully
   ✅ Tool executes
```

---

## 4. Migration Strategy

### 4.1 Recommended Approach: **Hybrid Registration Pattern**

**Principle**: Use the right registration method for each tool's context needs.

#### **Strategy A: setRequestHandler for Context-Aware Tools**

For tools requiring execution context (userId, modelId, roles, correlationId):

```typescript
// BEFORE (v1 signature, broken in v2)
server.registerTool('myTool', {
  description: 'Tool that needs context',
  inputSchema: z.object({ query: z.string() })
}, async (args, ctx) => {  // ❌ WRONG
  const meta = args._meta;  // ❌ undefined
  // ...
});

// AFTER (v2 setRequestHandler)
server.setRequestHandler('tools/call', async (request, ctx) => {
  // Extract tool name and args
  const { name, arguments: toolArgs } = request.params;

  // ✅ Access execution context
  const meta = ctx.mcpReq._meta;
  const userId = meta?.userId || ctx.http?.req?.headers.get('x-user-id') || 'anonymous';
  const modelId = meta?.modelId || 'unknown';
  const userRoles = meta?.userRoles || [];

  // Route to appropriate tool handler
  if (name === 'myTool') {
    return await this.handleMyTool(toolArgs, {
      userId,
      userRoles,
      modelId,
      correlationId: meta?.correlationId,
      sessionId: ctx.sessionId,
    });
  }

  throw new Error(`Unknown tool: ${name}`);
});
```

**When to use**:
- ✅ Tools requiring authentication/authorization (RBAC)
- ✅ Tools needing audit logging with userId/modelId
- ✅ Tools accessing user-specific data
- ✅ ALL tools in aggregator services (tool-gateway, tool-orchestrator)

#### **Strategy B: registerTool for Stateless Tools**

For pure functions that only operate on input args:

```typescript
server.registerTool('calculate', {
  description: 'Stateless calculator',
  inputSchema: z.object({
    operation: z.enum(['add', 'subtract']),
    a: z.number(),
    b: z.number()
  })
}, async ({ operation, a, b }) => {  // ✅ CORRECT - destructured args only
  const result = operation === 'add' ? a + b : a - b;
  return { content: [{ type: 'text', text: `Result: ${result}` }] };
});
```

**When to use**:
- ✅ Stateless utility tools (math, formatting, parsing)
- ✅ Tools with no authentication/authorization requirements
- ✅ Tools that don't log user actions
- ❌ NOT for domain tools in production systems

### 4.2 Implementation for tool-orchestrator

**Current Problem**: tool-orchestrator registers 290 tools from PostgreSQL, all needing context access for RBAC.

**Solution**: Use single `setRequestHandler` to route all tool calls:

```typescript
protected getMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'tool-orchestrator', version: '1.0.0' },
    { capabilities: { tools: {} } }  // ✅ Still advertise tools capability
  );

  const logger = this.getLogger();

  // Register single handler for ALL tools
  server.setRequestHandler('tools/call', async (request, ctx) => {
    const { name: toolName, arguments: toolArgs } = request.params;

    // ✅ Extract execution context from v2 ServerContext
    const meta = ctx.mcpReq._meta;
    const userId = meta?.userId || ctx.http?.req?.headers.get('x-user-id') || 'anonymous';
    const userRoles = meta?.userRoles || ctx.http?.req?.headers.get('x-roles')?.split(',') || [];
    const modelId = meta?.modelId || 'tool-orchestrator';  // ⚠️ Fallback only for safety

    logger.debug('tool_call.context_extracted', {
      toolName,
      userId,
      modelId,
      hasRoles: userRoles.length > 0,
    });

    // Lookup tool from registry
    const tool = await this.toolRegistry?.getToolById(toolName);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Tool not found: ${toolName}` }]
      };
    }

    // Execute with proper context
    const executionContext = {
      userId,
      userRoles,
      modelId,
      correlationId: meta?.correlationId,
      sessionId: ctx.sessionId,
    };

    try {
      return await tool.execute!(toolArgs, executionContext);
    } catch (error) {
      logger.error('tool_execution_failed', { toolName, error });
      return {
        isError: true,
        content: [{ type: 'text', text: `Tool execution failed: ${error.message}` }]
      };
    }
  });

  // ✅ Still list tools via tools/list (separate handler)
  server.setRequestHandler('tools/list', async (request, ctx) => {
    const tools = await this.toolRegistry?.queryTools({});
    return {
      tools: tools.map(t => ({
        name: t.id,
        description: t.description || 'No description',
        inputSchema: t.inputSchema || {},
      }))
    };
  });

  return server;
}
```

**Key Changes**:
1. **Single handler** for all tool calls instead of registering each tool individually
2. **Context extraction** from `ctx.mcpReq._meta` (correct v2 location)
3. **Fallback headers** from `ctx.http.req.headers.get()` (HTTP transport)
4. **Tool lookup** from registry by name
5. **Separate `tools/list` handler** for tool discovery

**Benefits**:
- ✅ Fixes all _meta passing issues
- ✅ Correct modelId reaches ToolGateway
- ✅ RBAC validation works
- ✅ Single code path for all tools
- ✅ Easier debugging/logging
- ✅ No need to track sanitized names (uses original tool ID)

### 4.3 Implementation for base-server.ts

**Current Problem**: Base class `Bit.getMcpServer()` uses wrong v1 signature. All services inherit this bug.

**Solution**: Update base class to use v2 setRequestHandler:

```typescript
// src/common/base-server.ts (around line 1748)
protected getMcpServer(): McpServer {
  const server = new McpServer(
    { name: this.name, version: '1.0.0' },
    { capabilities: { tools: this.registeredTools.size > 0 ? {} : undefined } }
  );

  // Register single handler for all tools
  if (this.registeredTools.size > 0) {
    server.setRequestHandler('tools/call', async (request, ctx) => {
      const { name: toolName, arguments: toolArgs } = request.params;

      // ✅ Extract context from v2 ServerContext
      const meta = ctx.mcpReq._meta;
      const combinedExtra = {
        ...ctx,  // Include full context
        userId: meta?.userId || ctx.http?.req?.headers.get('x-user-id'),
        userRoles: meta?.userRoles || ctx.http?.req?.headers.get('x-roles')?.split(','),
        correlationId: meta?.correlationId,
        sessionId: ctx.sessionId,
        modelId: meta?.modelId,
      };

      // Lookup registered tool
      const tool = this.registeredTools.get(toolName);
      if (!tool) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Tool not found: ${toolName}` }]
        };
      }

      // Execute with traced operation
      return await this.traceMcpOperation(
        `tool:${toolName}`,
        () => tool.handler(toolArgs, combinedExtra),
        combinedExtra
      );
    });

    // List tools handler
    server.setRequestHandler('tools/list', async () => ({
      tools: Array.from(this.registeredTools.entries()).map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: tool.schema,
      }))
    }));
  }

  // Resources and prompts registration (no changes)
  // ...

  return server;
}
```

**Impact**: All services inheriting from `Bit` will automatically get correct v2 context access.

---

## 5. Testing Strategy

### 5.1 Unit Tests

**Test File**: `src/apps/__tests__/tool-orchestrator-mcp-v2.test.ts`

```typescript
describe('Tool Orchestrator MCP v2 Context Access', () => {
  it('should extract _meta from ctx.mcpReq._meta', async () => {
    const server = new ToolOrchestratorServer();
    await server.start();

    // Simulate MCP request with _meta
    const request = {
      params: {
        name: 'test_tool',
        arguments: { query: 'test' }
      }
    };

    const ctx = {
      sessionId: 'test-session',
      mcpReq: {
        id: 'req-1',
        signal: new AbortController().signal,
        _meta: {
          userId: 'user-123',
          userRoles: ['platform:admin'],
          modelId: 'gpt-5.5',
          correlationId: 'corr-456',
        }
      }
    };

    // Handler should extract context correctly
    const result = await server.handleToolCall(request, ctx);

    expect(result.isError).toBe(false);
    // Verify tool executed with correct context
  });

  it('should fall back to HTTP headers when _meta missing', async () => {
    const ctx = {
      sessionId: 'test-session',
      mcpReq: { id: 'req-1', signal: new AbortController().signal },
      http: {
        req: {
          headers: new Headers({
            'x-user-id': 'user-789',
            'x-roles': 'user,viewer'
          })
        }
      }
    };

    // Handler should extract from headers
    const result = await server.handleToolCall(request, ctx);

    expect(result.isError).toBe(false);
    // Verify userId extracted from header
  });
});
```

### 5.2 Integration Tests

**Test File**: `src/apps/__tests__/llm-bot-tool-orchestrator-v2.integration.test.ts`

```typescript
describe('LLM Bot → Tool Orchestrator _meta Passing (v2)', () => {
  it('should pass _meta through entire chain', async () => {
    // 1. Start tool-orchestrator with v2 handlers
    // 2. Start llm-bot with mcp-client connecting to tool-orchestrator
    // 3. Send chat message with authentication
    // 4. Verify tool execution receives correct modelId
    // 5. Verify RBAC validation succeeds

    const result = await sendChatMessage({
      text: 'Test tool call',
      userId: 'user-123',
      modelId: 'gpt-5.5',
    });

    expect(result.error).toBeUndefined();
    expect(result.toolExecutions).toHaveLength(1);
    expect(result.toolExecutions[0].context.modelId).toBe('gpt-5.5');
  });
});
```

### 5.3 Staging Validation

**Procedure**:
1. Deploy v2-migrated services to staging
2. Retrieve trace 4db52bc2 (original failing trace)
3. Replay same request
4. Verify:
   - ✅ No "Model not found" errors
   - ✅ Tool executions succeed
   - ✅ Logs show correct modelId: "gpt-5.5"
   - ✅ RBAC validation passes

**Success Criteria**:
```bash
# Check logs for correct context extraction
fleet.logs({
  bit: 'tool-orchestrator',
  context: 'staging',
  correlationId: '<new-correlation-id>',
  format: 'json'
})

# Should show:
# "tool_call.context_extracted": {
#   "toolName": "tavily-search",
#   "userId": "actual-user-id",
#   "modelId": "gpt-5.5",  // ✅ NOT "tool-orchestrator"
#   "hasRoles": true
# }
```

---

## 6. Migration Checklist

### Phase 1: Critical Path (tool-orchestrator)
- [ ] Update `src/apps/tool-orchestrator-service.ts:getMcpServer()`
  - [ ] Replace `registerTool` loops with single `setRequestHandler('tools/call')`
  - [ ] Extract `_meta` from `ctx.mcpReq._meta` (not `args._meta`)
  - [ ] Add fallback header extraction from `ctx.http.req.headers.get()`
  - [ ] Add `tools/list` handler for tool discovery
- [ ] Write unit tests for context extraction
- [ ] Deploy to agent-dev context for testing
- [ ] Validate with test traces showing correct modelId
- [ ] Deploy to staging
- [ ] Verify staging trace 4db52bc2 scenario resolves

### Phase 2: Base Class (affects ALL services)
- [ ] Update `src/common/base-server.ts:getMcpServer()`
  - [ ] Convert from `registerTool` per-tool to single `setRequestHandler`
  - [ ] Extract context from `ctx.mcpReq._meta`
  - [ ] Update `combinedExtra` construction
- [ ] Update all services inheriting from `Bit`:
  - [ ] llm-bot (src/apps/llm-bot-service.ts)
  - [ ] tool-gateway (src/apps/tool-gateway.ts)
  - [ ] auth-service (src/apps/auth-service.ts)
  - [ ] All domain MCP services
- [ ] Write integration tests for each service
- [ ] Deploy to agent-dev, verify no regressions
- [ ] Deploy to staging

### Phase 3: Validation & Monitoring
- [ ] Add structured logging for context extraction
- [ ] Add metrics for _meta success/failure rates
- [ ] Create dashboard showing:
  - [ ] Tool calls with valid vs fallback modelId
  - [ ] RBAC validation success rate
  - [ ] Authentication failures (userId missing)
- [ ] Monitor for 48 hours in staging
- [ ] Deploy to production

---

## 7. Risk Assessment

### 7.1 High Risk: Breaking Tool Execution

**Risk**: Migration breaks all existing tool calls during transition period.

**Mitigation**:
1. Deploy to agent-dev first, full test suite
2. Staged rollout: tool-orchestrator → base class → individual services
3. Feature flag: `ENABLE_MCP_V2_HANDLERS=true` to control rollout
4. Keep v1 fallback path during migration:
   ```typescript
   if (process.env.ENABLE_MCP_V2_HANDLERS === 'true') {
     // Use setRequestHandler (v2)
   } else {
     // Use registerTool (v1 signature, broken but stable)
   }
   ```

### 7.2 Medium Risk: Header Fallback Inconsistency

**Risk**: Different behavior between _meta and HTTP header fallback paths.

**Mitigation**:
1. Prioritize `ctx.mcpReq._meta` always
2. Use headers only as fallback (stdio transport, legacy clients)
3. Log when fallback is used: `logger.warn('context.fallback_to_headers')`
4. Add metrics to track fallback usage, alert on high rates

### 7.3 Low Risk: Performance Impact

**Risk**: Single handler routing all tools adds latency.

**Mitigation**:
1. Measure current p50/p99 latencies
2. Compare after migration
3. Expected overhead: <1ms (simple Map lookup + property access)
4. If needed: Add tool handler caching/memoization

---

## 8. Alternative Approaches (Rejected)

### 8.1 Downgrade to MCP SDK v1
**Pros**: Code works as-is, no migration needed
**Cons**:
- Not forward-compatible
- Missing v2 features (inputRequired, structured content, etc.)
- Security updates only on v2
- **Verdict**: ❌ Rejected - not sustainable long-term

### 8.2 Middleware Context Injection
**Approach**: Inject context into tool args before handler
**Pros**: Keep using `registerTool`
**Cons**:
- SDK doesn't provide middleware hooks
- Would require forking/patching SDK
- Fragile, breaks on SDK updates
- **Verdict**: ❌ Rejected - too invasive

### 8.3 Per-Tool setRequestHandler
**Approach**: Register separate handler for each tool
**Pros**: Granular control per tool
**Cons**:
- 290+ tool registrations in tool-orchestrator
- Complex routing logic per tool
- Harder to maintain than single router
- **Verdict**: ❌ Rejected - doesn't scale

---

## 9. References

### Documentation
- **MCP SDK v2 Docs**: https://ts.sdk.modelcontextprotocol.io/v2/servers/tools
- **Migration Guide**: https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html
- **setRequestHandler API**: https://ts.sdk.modelcontextprotocol.io/v2/api/server

### Codebase Files
- **tool-orchestrator**: `src/apps/tool-orchestrator-service.ts` (lines 1445-1632)
- **base-server**: `src/common/base-server.ts` (lines 1748-1762)
- **proxy-invoker**: `src/common/mcp/proxy-invoker.ts` (lines 51-98)
- **tool-gateway**: `src/apps/tool-gateway.ts` (line 210 - RBAC validation)

### Sprint Artifacts
- **Sprint 65 Planning**: `planning/sprint-65-yt9tbb/`
- **Failing Trace**: staging 4db52bc2-cf7e-44d8-9884-eae7aae8d47a
- **Database Cleanup**: 441 duplicates removed (committed)

---

## 10. Recommended Action

**IMMEDIATE**:
1. ✅ **Approve this Architecture Brief**
2. ✅ **Begin Phase 1 migration** (tool-orchestrator only)
3. ✅ **Deploy to agent-dev** within 24 hours
4. ✅ **Validate** with test traces
5. ✅ **Deploy to staging** if successful

**Timeline**:
- **Phase 1** (tool-orchestrator): 1 day implementation + 1 day testing
- **Phase 2** (base class + services): 2 days implementation + 2 days testing
- **Phase 3** (monitoring + production): 2 days staging validation + rollout

**Total**: ~8 days to full production deployment

**Blocking Issues**: None. All investigation complete, path forward clear.

---

## Approval

- [ ] **Architecture Review**: _________________________
- [ ] **Security Review**: _________________________
- [ ] **Implementation Approval**: _________________________

**Date**: _______________
