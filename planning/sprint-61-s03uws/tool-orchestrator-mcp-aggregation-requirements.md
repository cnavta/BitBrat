# Tool-Orchestrator MCP Aggregation Requirements

**Sprint 61: Composition RBAC Validation**
**Date**: 2026-11-13
**Status**: Planning

## Executive Summary

This document outlines the required changes to tool-orchestrator service to enable MCP tool aggregation, based on lessons learned from fixing tool-gateway's aggregation bugs during Sprint 61 staging deployment.

**Context**: During Sprint 61 staging deployment, we discovered that tool-gateway was only exposing its own direct tools (18 tools) instead of aggregated tools from upstream services (100+ tools). The root cause was the base class `getMcpServer()` only serving tools from `this.registeredTools`, not from the aggregated registry. This document ensures tool-orchestrator doesn't repeat these mistakes.

## Background: Tool-Gateway Bugs Fixed

### Bug 1: Base Class getMcpServer() Doesn't Serve Aggregated Tools
**Problem**: Base class `Bit.getMcpServer()` only serves tools from `this.registeredTools` (the service's own direct tools), not from aggregated registries.

**Impact**: llm-bot connected to tool-gateway but only saw 18 direct tools (bit.*, composition.*, agent.sendProgressUpdate) instead of 100+ aggregated tools from upstream services.

**Solution**: Override `getMcpServer()` in aggregator services to serve tools from the aggregated registry.

### Bug 2: MCP Protocol Schema Violations
**Problem**: MCP SDK v2.0 enforces strict schema validation. Two violations discovered:

1. **Extra fields in inputSchema**: Zod to JSON Schema conversion produced objects with `$schema`, `definitions`, `$defs` fields that violated MCP protocol
2. **Undefined description field**: Including `description: undefined` instead of omitting the field

**Impact**: MCP SDK rejected tools/list response with `INVALID_RESULT` error, preventing tool discovery.

**Solution**: Clean inputSchema to only include MCP-compliant fields, omit optional fields if undefined.

### Bug 3: Feature Flag Not Actually Used
**Problem**: `ENABLE_TOOL_ORCHESTRATOR` flag was logged but never used to change which service llm-bot connects to.

**Impact**: Flag appeared to work (logs showed `enabled: true`) but llm-bot still connected to tool-gateway.

**Solution**: McpClientProfile now checks flag and derives correct URL based on provider selection.

## Tool-Orchestrator Implementation Checklist

### 1. Override getMcpServer() for Aggregation

**File**: `src/apps/tool-orchestrator-service.ts`

**Current State** (line 425):
```typescript
protected getMcpServer(): any {
  // TODO Sprint 61+: Load aggregated tools from this.toolRegistry.queryTools({})
  // Requires async initialization to load from PostgreSQL

  // Current implementation: Delegate to base class (serves admin tools only)
  return super.getMcpServer();
}
```

**Required Changes**:

```typescript
protected getMcpServer(): McpServer {
  const logger = this.getLogger();
  const baseThis = this as any; // Access private members from base class

  // Load ALL tools from PostgreSQL registry (not just admin tools)
  // CRITICAL: This must include tools from all registered MCP servers and Bits
  const allTools = this.getAllToolsFromRegistry(); // See implementation below

  logger.debug('mcp_server.initializing', {
    service: 'tool-orchestrator',
    aggregatedTools: allTools.length,
    ownTools: baseThis.registeredTools.size,
  });

  // Create MCP server
  const server = new McpServer(
    { name: 'tool-orchestrator', version: '1.0.0' },
    { capabilities: { tools: allTools.length > 0 ? {} : undefined } }
  );

  // Register aggregated tools from PostgreSQL registry (NOT this.registeredTools)
  for (const tool of allTools) {
    const cleanInputSchema = this.cleanInputSchema(tool.inputSchema);

    server.registerTool(tool.id, {
      ...(tool.description && { description: tool.description }), // Omit if undefined
      inputSchema: cleanInputSchema, // MCP-compliant schema only
    }, async (args: any, ctx: ServerContext) => {
      if (!tool.execute) {
        throw new Error(`Tool ${tool.id} has no execute function`);
      }

      const combinedExtra = {
        ...ctx,
        userId: (args as any)._meta?.userId || (ctx as any)?.http?.req?.headers?.['x-user-id'],
        userRoles: (args as any)._meta?.userRoles || (ctx as any)?.http?.req?.headers?.['x-roles'],
        modelId: 'tool-orchestrator',
      };

      return await this.traceMcpOperation(
        `tool:${tool.id}`,
        () => tool.execute!(args, combinedExtra as any),
        combinedExtra
      );
    });
  }

  // Register resources and prompts from base class (no change)
  for (const [uri, resource] of baseThis.registeredResources.entries()) {
    server.registerResource(resource.name, uri, {
      description: resource.description,
    }, async (uriParam: URL, ctx: ServerContext) => {
      // ... resource handler
    });
  }

  logger.info('mcp_server.initialized_with_aggregation', {
    aggregatedTools: allTools.length,
  });

  return server;
}
```

### 2. Implement getAllToolsFromRegistry()

**Challenge**: PostgreSQL registry requires async access, but `getMcpServer()` is synchronous.

**Solution**: Eager-load tools during service startup into in-memory cache.

```typescript
private toolCache: ToolRegistration[] = [];

/**
 * Load all tools from PostgreSQL registry into in-memory cache.
 * Called during service startup (async context available).
 */
private async loadToolsFromRegistry(): Promise<void> {
  if (!this.toolRegistry) {
    this.logger.warn('tool_orchestrator.no_registry', {
      message: 'ToolRegistry not initialized, skipping tool load'
    });
    return;
  }

  try {
    // Query ALL tools from PostgreSQL (no filters)
    const tools = await this.toolRegistry.queryTools({});

    this.toolCache = tools;

    this.logger.info('tool_orchestrator.tools_loaded', {
      count: tools.length,
      sources: [...new Set(tools.map(t => t.source))],
    });
  } catch (err) {
    this.logger.error('tool_orchestrator.tools_load_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Fail-open: Continue with empty cache
    this.toolCache = [];
  }
}

/**
 * Get all tools from in-memory cache (synchronous).
 * Used by getMcpServer() to serve aggregated tools via MCP.
 */
private getAllToolsFromRegistry(): ToolRegistration[] {
  return this.toolCache;
}

async setup(): Promise<void> {
  // ... existing setup code

  // CRITICAL: Load tools from PostgreSQL BEFORE starting MCP server
  await this.loadToolsFromRegistry();

  // Register for tool updates to keep cache fresh
  if (this.toolRegistry) {
    // TODO: Implement cache invalidation when tools are registered/updated
    // Option 1: Periodic refresh (simple, works for most cases)
    // Option 2: PostgreSQL LISTEN/NOTIFY (real-time, more complex)
  }
}
```

### 3. Implement cleanInputSchema()

**Purpose**: Ensure inputSchema conforms to MCP protocol strict requirements.

**MCP Protocol Requirements**:
```typescript
{
  type: "object",        // MUST be literal "object"
  properties?: {...},    // Optional
  required?: string[],   // Optional
  // catchall allowed for additionalProperties
}
```

**Implementation**:

```typescript
/**
 * Clean inputSchema to conform to MCP protocol requirements.
 *
 * Sprint 61: MCP SDK v2.0 enforces strict schema validation.
 * Zod to JSON Schema conversion produces extra fields ($schema, definitions, $defs)
 * that violate the protocol and cause INVALID_RESULT errors.
 *
 * This method strips non-compliant fields and ensures type is "object".
 */
private cleanInputSchema(inputSchema: any): any {
  const cleanSchema: any = { type: 'object' };

  if (!inputSchema || typeof inputSchema !== 'object') {
    return cleanSchema;
  }

  // Only copy MCP-compliant fields
  if (inputSchema.type === 'object') {
    cleanSchema.type = 'object';
  }

  if (inputSchema.properties) {
    cleanSchema.properties = inputSchema.properties;
  }

  if (inputSchema.required) {
    cleanSchema.required = inputSchema.required;
  }

  // Preserve additionalProperties if present (MCP allows catchall)
  if ('additionalProperties' in inputSchema) {
    cleanSchema.additionalProperties = inputSchema.additionalProperties;
  }

  return cleanSchema;
}
```

### 4. Session-Based MCP Endpoint

**Current State**: tool-orchestrator likely uses base class MCP endpoint setup.

**Required**: Implement session-based MCP endpoint similar to tool-gateway (src/apps/tool-gateway.ts:1821-1877).

**Why**: Session-based endpoints allow per-connection context extraction for RBAC.

```typescript
private setupSessionBasedMcpEndpoint(): void {
  const logger = this.getLogger();
  const app = (this as any).app;

  const authMiddleware = (req: Request, res: Response, next: any) => {
    const authToken = process.env.MCP_AUTH_TOKEN;
    if (authToken) {
      let providedToken = req.headers["x-mcp-token"] || req.query.token;
      const authHeader = req.headers["authorization"];
      if (!providedToken && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        providedToken = authHeader.substring(7);
      }
      if (providedToken !== authToken) {
        logger.warn("mcp_server.auth_failed", { path: req.path, ip: req.ip });
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }
    next();
  };

  app.all("/mcp", authMiddleware, async (req: Request, res: Response) => {
    try {
      const sessionServer = await this.getMcpServerForConnection(req);
      const handler = toNodeHandler(createMcpHandler(() => sessionServer));
      handler(req, res, req.body);
    } catch (error: any) {
      logger.error('tool_orchestrator.mcp_endpoint.error', {
        error: error.message,
        stack: error.stack,
        path: req.path
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  logger.info("mcp_endpoint.session_based_registered", {
    endpoint: "/mcp",
    mode: "session-based-aggregation"
  });
}

/**
 * Create unique MCP server instance per connection.
 * Enables per-connection RBAC context extraction.
 */
private async getMcpServerForConnection(req: Request): Promise<McpServer> {
  const context = this.extractSessionContext(req);

  // Create session-specific server with RBAC filtering
  const server = this.getMcpServer(); // Calls our overridden method

  // Store session context for tools/list handler
  // (Used for RBAC filtering based on connection identity)

  return server;
}

/**
 * Extract session context from HTTP request.
 * Used for RBAC filtering in tools/list handler.
 */
private extractSessionContext(req: Request): SessionContext {
  const agentName = req.headers['x-agent-name'] as string || 'unknown';
  const roles = (req.headers['x-roles'] as string || '').split(',').filter(Boolean);
  const userId = req.headers['x-user-id'] as string;

  return {
    agentName,
    roles,
    userId,
  };
}
```

### 5. RBAC-Filtered tools/list Handler

**Current State**: Base class or simple implementation likely doesn't filter by RBAC.

**Required**: Implement RBAC filtering in tools/list handler.

```typescript
// Inside getMcpServerForConnection() or similar:
sessionServer.setRequestHandler('tools/list', async (request, ctx) => {
  logger.trace('Handling ListToolsRequestSchema', {
    agentName: context.agentName,
    roles: context.roles,
  });

  // Trusted discovery: llm-bot and users with 'discovery' role see all tools
  const trustedDiscovery = (context.agentName === 'llm-bot') ||
                          (Array.isArray(context.roles) && context.roles.includes('discovery'));

  const rawTools = this.getAllToolsFromRegistry();

  // Apply RBAC filtering
  const visibleTools = trustedDiscovery
    ? rawTools
    : rawTools.filter((t) => {
        // Compositions available to all roles/agents (full RBAC scoped for later)
        if (t.source === 'composition') return true;

        // Check tool-level RBAC permissions
        return this.rbac.isAllowedTool(t, context);
      });

  // Transform to MCP-compliant format
  const tools = visibleTools.map((t) => {
    const cleanInputSchema = this.cleanInputSchema(t.inputSchema);

    return {
      name: t.id,
      ...(t.description && { description: t.description }), // Omit if undefined
      inputSchema: cleanInputSchema,
    };
  });

  logger.trace(`Returning ${tools.length} tools (trustedDiscovery=${trustedDiscovery})`);

  return { tools };
});
```

### 6. Cache Invalidation Strategy

**Challenge**: PostgreSQL registry is mutable - tools can be registered/updated/deleted at runtime.

**Options**:

#### Option 1: Periodic Refresh (Simple, Good Enough)
```typescript
async setup(): Promise<void> {
  // Initial load
  await this.loadToolsFromRegistry();

  // Refresh every 60 seconds
  setInterval(async () => {
    await this.loadToolsFromRegistry();
  }, 60000);
}
```

**Pros**: Simple, works for most cases
**Cons**: Up to 60s stale data, unnecessary DB queries
**Use When**: Tool registry changes infrequently (most deployments)

#### Option 2: PostgreSQL LISTEN/NOTIFY (Real-time, Complex)
```typescript
async setup(): Promise<void> {
  await this.loadToolsFromRegistry();

  // Listen for tool registry changes
  const pgClient = await this.getPgClient();
  await pgClient.query('LISTEN tool_registry_changes');

  pgClient.on('notification', async (msg) => {
    if (msg.channel === 'tool_registry_changes') {
      this.logger.info('tool_orchestrator.registry_changed', { payload: msg.payload });
      await this.loadToolsFromRegistry();
    }
  });
}

// In ToolRegistry.registerTool():
async registerTool(tool: ToolRegistryDocument): Promise<void> {
  await this.pool.query('INSERT INTO tools ...'); // Existing code
  await this.pool.query("NOTIFY tool_registry_changes, 'tool_registered'");
}
```

**Pros**: Real-time cache updates, no unnecessary queries
**Cons**: Requires PostgreSQL NOTIFY triggers, more complex
**Use When**: Tool registry changes frequently, real-time updates critical

#### Recommendation: Start with Option 1, upgrade to Option 2 if needed.

### 7. Integration Testing

**File**: `src/apps/__tests__/mcp-aggregation.integration.test.ts`

**Add Test Case**:

```typescript
describe('tool-orchestrator aggregation', () => {
  it('should expose aggregated tools from PostgreSQL registry via MCP endpoint', async () => {
    const orchestratorUrl = process.env.TEST_TOOL_ORCHESTRATOR_URL || 'http://localhost:3018/mcp';

    const transport = new StreamableHTTPClientTransport(new URL(orchestratorUrl), {
      requestInit: {
        headers: {
          'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
          'x-agent-name': 'test-client'
        }
      }
    });

    const client = new Client({
      name: 'test-client',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    await client.connect(transport);

    // List all tools
    const result = await client.listTools();
    const toolNames = result.tools.map((t: any) => t.name);

    // Verify we see admin tools
    const expectedAdminTools = ['tool.list', 'tool.get', 'model.list', 'model.get'];
    const hasAdminTools = expectedAdminTools.every((tool: string) => toolNames.includes(tool));
    expect(hasAdminTools).toBe(true);

    // Verify we see aggregated tools from PostgreSQL registry
    // (Exact tools depend on what's been registered)
    expect(result.tools.length).toBeGreaterThan(20); // More than just admin tools

    // Verify schema compliance (no INVALID_RESULT errors)
    for (const tool of result.tools) {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('inputSchema');
      expect(tool.inputSchema).toHaveProperty('type', 'object');

      // Verify no invalid fields in inputSchema
      expect(tool.inputSchema).not.toHaveProperty('$schema');
      expect(tool.inputSchema).not.toHaveProperty('definitions');
      expect(tool.inputSchema).not.toHaveProperty('$defs');
    }

    await client.close();
  }, 30000);
});
```

### 8. Feature Flag Integration

**File**: `env/staging/global.yaml`, `env/local/global.yaml`

**Current State**:
```yaml
ENABLE_TOOL_ORCHESTRATOR: false
TOOL_ORCHESTRATOR_URL: "http://tool-orchestrator:3000"
```

**Testing Steps**:

1. **Baseline (flag disabled)**:
   - Set `ENABLE_TOOL_ORCHESTRATOR: false`
   - Deploy llm-bot, verify it connects to tool-gateway
   - Check logs: `llm_bot.tool_provider_selected` should show `provider: tool-gateway`

2. **Cutover (flag enabled)**:
   - Set `ENABLE_TOOL_ORCHESTRATOR: true`
   - Deploy llm-bot, verify it connects to tool-orchestrator
   - Check logs: `llm_bot.tool_provider_selected` should show `provider: tool-orchestrator`

3. **Validation**:
   - Verify llm-bot discovers tools from tool-orchestrator
   - Check log: `mcp.client_manager.tool_registered` should show tools
   - No `INVALID_RESULT` errors
   - Tool count should match PostgreSQL registry

**Verification Command**:
```bash
# Check which provider llm-bot is using
ssh root@bitbrat.lan "docker logs bitbrat-staging-llm-bot-1 2>&1 | grep 'tool_provider_selected'"

# Count tools discovered
ssh root@bitbrat.lan "docker logs bitbrat-staging-llm-bot-1 2>&1 | grep 'mcp.client_manager.tool_registered' | wc -l"

# Check for errors
ssh root@bitbrat.lan "docker logs bitbrat-staging-llm-bot-1 2>&1 | grep 'INVALID_RESULT'"
```

## Implementation Order

**Phase 1: Core Aggregation** (Critical Path)
1. ✅ Implement `getAllToolsFromRegistry()` with in-memory cache
2. ✅ Implement `loadToolsFromRegistry()` called during setup
3. ✅ Override `getMcpServer()` to serve aggregated tools
4. ✅ Implement `cleanInputSchema()` for MCP compliance

**Phase 2: Session & RBAC** (Required for Multi-Tenant)
5. ✅ Implement session-based MCP endpoint
6. ✅ Implement RBAC-filtered tools/list handler
7. ✅ Implement `extractSessionContext()`

**Phase 3: Cache Management** (Optional, Performance)
8. 🔄 Implement periodic cache refresh (Option 1)
9. 🔄 OR implement LISTEN/NOTIFY (Option 2) if real-time needed

**Phase 4: Testing & Validation** (Critical)
10. ✅ Add integration test for MCP aggregation
11. ✅ Test feature flag cutover (staging environment)
12. ✅ Validate tool count matches PostgreSQL registry
13. ✅ Verify no INVALID_RESULT errors

## Success Criteria

- [ ] llm-bot connects to tool-orchestrator when `ENABLE_TOOL_ORCHESTRATOR=true`
- [ ] llm-bot discovers **all tools** from PostgreSQL registry (not just admin tools)
- [ ] No `INVALID_RESULT` errors in llm-bot logs
- [ ] Tool count in llm-bot matches `SELECT COUNT(*) FROM tool_registry.tools`
- [ ] Integration test passes: `npm test -- mcp-aggregation.integration.test.ts`
- [ ] RBAC filtering works: non-admin users see filtered tool list
- [ ] Session-based endpoint works: multiple concurrent connections supported

## Common Pitfalls to Avoid

### ❌ Don't: Use base class getMcpServer()
**Why**: Base class only serves `this.registeredTools` (direct tools), not aggregated tools.
**Do**: Override `getMcpServer()` to serve tools from PostgreSQL registry.

### ❌ Don't: Return raw Zod schemas as inputSchema
**Why**: Zod to JSON Schema produces `$schema`, `definitions`, `$defs` fields that violate MCP protocol.
**Do**: Use `cleanInputSchema()` to strip non-compliant fields.

### ❌ Don't: Include `description: undefined`
**Why**: MCP protocol requires optional fields to be **omitted**, not set to `undefined`.
**Do**: Use spread operator: `...(t.description && { description: t.description })`

### ❌ Don't: Synchronously query PostgreSQL in getMcpServer()
**Why**: `getMcpServer()` is synchronous, PostgreSQL queries are async.
**Do**: Eager-load tools during `setup()` into in-memory cache.

### ❌ Don't: Skip integration testing
**Why**: Schema violations and missing tools aren't caught by unit tests.
**Do**: Write integration test that creates real MCP client connection and validates response.

### ❌ Don't: Assume feature flag works without testing
**Why**: Sprint 61 bug showed flag can be logged but not actually used.
**Do**: Test both flag states and verify llm-bot connects to correct provider.

## Reference Implementation

**Working Example**: `src/apps/tool-gateway.ts`
- Lines 2407-2474: RBAC-filtered tools/list handler with schema cleaning
- Lines 1821-1877: Session-based MCP endpoint setup
- Lines 2602+: Overridden getMcpServer() for aggregation

**Working Test**: `src/apps/__tests__/mcp-aggregation.integration.test.ts`
- Lines 19-91: tool-gateway aggregation test (reference for tool-orchestrator test)

## Related Documents

- [Sprint 61 Implementation Summary](./IMPLEMENTATION_SUMMARY.md)
- [MCP Aggregation Integration Test](../../src/apps/__tests__/mcp-aggregation.integration.test.ts)
- [CLAUDE.md - Pattern 11: Building MCP Aggregator Services](../../CLAUDE.md#11-building-mcp-aggregator-services-tool-gateway-tool-orchestrator)

## Questions & Decisions

### Q: Should tool-orchestrator use in-memory cache or always query PostgreSQL?
**Decision**: In-memory cache with periodic refresh.
**Rationale**:
- PostgreSQL queries are async, `getMcpServer()` is sync
- Tool registry changes infrequently (minutes/hours, not seconds)
- Periodic refresh (60s) acceptable latency for most use cases
- Can upgrade to LISTEN/NOTIFY if real-time updates become critical

### Q: Should RBAC filtering happen in tools/list or at tool execution time?
**Decision**: Both (defense in depth).
**Rationale**:
- tools/list: Pre-filter to hide unauthorized tools from LLM (reduce token usage, improve UX)
- Execution time: Re-validate before execution (security, handle stale cache)

### Q: How to handle tool registry cache staleness?
**Decision**: Accept up to 60s staleness, refresh on interval.
**Rationale**:
- Tool registration is rare (deployment time, admin actions)
- 60s latency acceptable for new tools becoming visible
- Simpler than PostgreSQL LISTEN/NOTIFY
- Can be upgraded later if needed

---

**Document Version**: 1.0
**Last Updated**: 2026-11-13
**Author**: Claude (Sprint 61)
