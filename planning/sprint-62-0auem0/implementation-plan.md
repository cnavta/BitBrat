# Sprint 62 Implementation Plan: Tool-Orchestrator MCP Aggregation

**Sprint ID**: sprint-62-0auem0
**Status**: Planning
**Owner**: christophernavta
**Date**: 2026-11-13

---

## Executive Summary

This sprint implements MCP tool aggregation in tool-orchestrator service based on critical lessons learned from fixing tool-gateway's aggregation bugs during Sprint 61 staging deployment. The implementation enables llm-bot to connect to tool-orchestrator (instead of tool-gateway) when the `ENABLE_TOOL_ORCHESTRATOR` feature flag is enabled.

### Context: Sprint 61 Staging Deployment Findings

During Sprint 61 staging deployment, we discovered that tool-gateway was only exposing its own direct tools (18 tools) instead of aggregated tools from upstream services (100+ tools). Three critical bugs were identified:

1. **Base Class getMcpServer() Doesn't Serve Aggregated Tools** - Base class only serves tools from `this.registeredTools`, not from aggregated registries
2. **MCP Protocol Schema Violations** - MCP SDK v2.0 enforces strict schema validation; extra fields violated protocol
3. **Feature Flag Not Actually Used** - Flag was logged but never used to change which service llm-bot connects to

These bugs were fixed in tool-gateway and validated in staging. This sprint ports those fixes to tool-orchestrator to prevent repeating the same mistakes.

### Success Criteria

- [ ] llm-bot connects to tool-orchestrator when `ENABLE_TOOL_ORCHESTRATOR=true`
- [ ] llm-bot discovers **all tools** from PostgreSQL registry (not just admin tools)
- [ ] No `INVALID_RESULT` errors in llm-bot logs
- [ ] Tool count in llm-bot matches `SELECT COUNT(*) FROM tool_registry.tools`
- [ ] Integration test passes: `npm test -- mcp-aggregation.integration.test.ts`
- [ ] RBAC filtering works: non-admin users see filtered tool list
- [ ] Session-based endpoint works: multiple concurrent connections supported

---

## Implementation Phases

### Phase 1: Core Aggregation (Critical Path)

**Goal**: Enable tool-orchestrator to serve aggregated tools from PostgreSQL registry via MCP endpoint.

**Duration**: 2-3 days

#### Task 1.1: Implement Tool Cache and Eager Loading

**File**: `src/apps/tool-orchestrator-service.ts`

**Implementation**:
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
```

**Acceptance Criteria**:
- ✅ `loadToolsFromRegistry()` queries PostgreSQL and populates cache
- ✅ `getAllToolsFromRegistry()` returns cached tools synchronously
- ✅ Fail-open: Empty cache on error, service continues
- ✅ Logging: tool count and sources logged on successful load

---

#### Task 1.2: Override getMcpServer() for Aggregation

**File**: `src/apps/tool-orchestrator-service.ts` (line 425)

**Current State**:
```typescript
protected getMcpServer(): any {
  // TODO Sprint 61+: Load aggregated tools from this.toolRegistry.queryTools({})
  // Requires async initialization to load from PostgreSQL

  // Current implementation: Delegate to base class (serves admin tools only)
  return super.getMcpServer();
}
```

**New Implementation**:
```typescript
protected getMcpServer(): McpServer {
  const logger = this.getLogger();
  const baseThis = this as any; // Access private members from base class

  // Load ALL tools from PostgreSQL registry (not just admin tools)
  // CRITICAL: This must include tools from all registered MCP servers and Bits
  const allTools = this.getAllToolsFromRegistry();

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

**Acceptance Criteria**:
- ✅ MCP server serves tools from `getAllToolsFromRegistry()`, not `this.registeredTools`
- ✅ Tool count logged: aggregated vs own tools
- ✅ Tools registered with cleaned input schema
- ✅ Tool execution context includes userId, userRoles, modelId

---

#### Task 1.3: Implement cleanInputSchema() for MCP Compliance

**File**: `src/apps/tool-orchestrator-service.ts`

**Purpose**: Ensure inputSchema conforms to MCP protocol strict requirements (no `$schema`, `definitions`, `$defs` fields).

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

**Acceptance Criteria**:
- ✅ Removes `$schema`, `definitions`, `$defs` fields
- ✅ Ensures `type: "object"`
- ✅ Preserves `properties`, `required`, `additionalProperties`
- ✅ Handles null/undefined input gracefully

---

#### Task 1.4: Call loadToolsFromRegistry() During Setup

**File**: `src/apps/tool-orchestrator-service.ts`

**Implementation**:
```typescript
async setup(): Promise<void> {
  // ... existing setup code

  // CRITICAL: Load tools from PostgreSQL BEFORE starting MCP server
  await this.loadToolsFromRegistry();

  // Register for tool updates to keep cache fresh
  if (this.toolRegistry) {
    // TODO Phase 3: Implement cache invalidation when tools are registered/updated
    // Option 1: Periodic refresh (simple, works for most cases)
    // Option 2: PostgreSQL LISTEN/NOTIFY (real-time, more complex)
  }
}
```

**Acceptance Criteria**:
- ✅ `loadToolsFromRegistry()` called before MCP server starts
- ✅ Logging confirms tool count loaded
- ✅ Service continues on load failure (fail-open)

---

### Phase 2: Session & RBAC (Required for Multi-Tenant)

**Goal**: Implement session-based MCP endpoint with RBAC-filtered tool discovery.

**Duration**: 2-3 days

#### Task 2.1: Implement Session-Based MCP Endpoint

**File**: `src/apps/tool-orchestrator-service.ts`

**Reference**: `src/apps/tool-gateway.ts:1821-1877` (working example)

**Implementation**:
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

**Acceptance Criteria**:
- ✅ `/mcp` endpoint supports session-based connections
- ✅ Auth middleware validates `MCP_AUTH_TOKEN`
- ✅ Session context extracted from request headers
- ✅ Multiple concurrent connections supported

---

#### Task 2.2: Implement RBAC-Filtered tools/list Handler

**File**: `src/apps/tool-orchestrator-service.ts`

**Reference**: `src/apps/tool-gateway.ts:2407-2474` (working example)

**Implementation**:
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

**Acceptance Criteria**:
- ✅ `tools/list` handler filters by RBAC context
- ✅ Trusted discovery: llm-bot and 'discovery' role see all tools
- ✅ Non-trusted: RBAC enforced per tool
- ✅ Schemas cleaned before returning
- ✅ Description omitted if undefined

---

### Phase 3: Cache Management (Performance Optimization)

**Goal**: Keep tool cache fresh as registry changes.

**Duration**: 1-2 days

**Decision**: Start with Option 1 (Periodic Refresh), upgrade to Option 2 (LISTEN/NOTIFY) if real-time updates become critical.

#### Task 3.1: Implement Periodic Cache Refresh (Option 1)

**File**: `src/apps/tool-orchestrator-service.ts`

**Implementation**:
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

**Acceptance Criteria**:
- ✅ Tools refreshed every 60 seconds
- ✅ Refresh failures logged but don't crash service
- ✅ Stale data acceptable (60s max)

---

#### Task 3.2: Implement PostgreSQL LISTEN/NOTIFY (Option 2 - Future)

**File**: `src/apps/tool-orchestrator-service.ts`, `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts`

**Implementation** (future sprint):
```typescript
// In tool-orchestrator setup()
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

// In ToolRegistry.registerTool()
async registerTool(tool: ToolRegistryDocument): Promise<void> {
  await this.pool.query('INSERT INTO tools ...'); // Existing code
  await this.pool.query("NOTIFY tool_registry_changes, 'tool_registered'");
}
```

**Pros**: Real-time cache updates, no unnecessary queries
**Cons**: Requires PostgreSQL NOTIFY triggers, more complex
**Use When**: Tool registry changes frequently, real-time updates critical

**Acceptance Criteria** (future):
- ✅ PostgreSQL LISTEN/NOTIFY configured
- ✅ Tool registration triggers NOTIFY
- ✅ Cache updated in <1s after registry change

---

### Phase 4: Testing & Validation (Critical)

**Goal**: Ensure MCP aggregation works correctly and feature flag enables cutover.

**Duration**: 2-3 days

#### Task 4.1: Add Integration Test for MCP Aggregation

**File**: `src/apps/__tests__/mcp-aggregation.integration.test.ts`

**Reference**: Lines 19-91 (tool-gateway test - reference for tool-orchestrator test)

**Implementation**:
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

**Acceptance Criteria**:
- ✅ Test connects to tool-orchestrator via MCP
- ✅ Verifies admin tools present
- ✅ Verifies aggregated tools present (count > 20)
- ✅ Verifies schema compliance (no `$schema`, `definitions`, `$defs`)
- ✅ Test passes in CI/CD

---

#### Task 4.2: Test Feature Flag Cutover (Staging Environment)

**Files**: `env/staging/global.yaml`, `env/local/global.yaml`, `src/common/profiles/mcp-client-profile.ts`

**Current State** (mcp-client-profile.ts):
```typescript
// PROPOSED: Check feature flag to determine which aggregator to connect to
const useToolOrchestrator = process.env.ENABLE_TOOL_ORCHESTRATOR === 'true';
const toolProvider = useToolOrchestrator ? 'tool-orchestrator' : 'tool-gateway';

let gatewayUrl = bit.getConfig<string>('MCP_GATEWAY_URL', { required: false });

// Derive URL from tool provider if not explicitly configured
if (!gatewayUrl && useToolOrchestrator) {
  gatewayUrl = process.env.TOOL_ORCHESTRATOR_URL || 'http://tool-orchestrator:3000/mcp';
}

const cfg: McpServerConfig = {
  name: toolProvider, // Dynamic name based on provider
  transport: 'sse',
  url: gatewayUrl,
};

await manager.connectServer(cfg);
```

**Testing Steps**:

1. **Baseline (flag disabled)**:
   ```yaml
   # env/staging/global.yaml
   ENABLE_TOOL_ORCHESTRATOR: false
   TOOL_ORCHESTRATOR_URL: "http://tool-orchestrator:3000"
   ```
   - Deploy llm-bot, verify it connects to tool-gateway
   - Check logs: `llm_bot.tool_provider_selected` should show `provider: tool-gateway`

2. **Cutover (flag enabled)**:
   ```yaml
   # env/staging/global.yaml
   ENABLE_TOOL_ORCHESTRATOR: true
   TOOL_ORCHESTRATOR_URL: "http://tool-orchestrator:3000"
   ```
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

**Acceptance Criteria**:
- ✅ Flag `false`: llm-bot connects to tool-gateway
- ✅ Flag `true`: llm-bot connects to tool-orchestrator
- ✅ Tool discovery works in both modes
- ✅ No schema validation errors
- ✅ Tool counts match expectations

---

#### Task 4.3: Validate Tool Count Matches PostgreSQL Registry

**Purpose**: Ensure all tools from PostgreSQL are exposed via MCP.

**Verification**:
```bash
# 1. Query PostgreSQL for tool count
psql -U bitbrat -d bitbrat_platform -c "SELECT COUNT(*) FROM tool_registry.tools WHERE status = 'active';"

# 2. Query tool-orchestrator via MCP
npm run brat -- fleet info tool-orchestrator --json | jq '.tools | length'

# 3. Compare counts (should match)
```

**Acceptance Criteria**:
- ✅ PostgreSQL count matches MCP exposed tool count
- ✅ All tool sources represented (mcp, internal, composition)
- ✅ Disabled/deprecated tools excluded

---

#### Task 4.4: Verify No INVALID_RESULT Errors

**Purpose**: Ensure MCP schema compliance prevents protocol violations.

**Verification**:
```bash
# Deploy to staging
npm run brat -- bit deploy tool-orchestrator --context staging

# Connect llm-bot
# (Feature flag already enabled from Task 4.2)

# Monitor logs for INVALID_RESULT
npm run brat -- fleet logs llm-bot --context staging --follow | grep 'INVALID_RESULT'

# Should return no results
```

**Acceptance Criteria**:
- ✅ No `INVALID_RESULT` errors in llm-bot logs
- ✅ No `INVALID_RESULT` errors in tool-orchestrator logs
- ✅ MCP SDK validation passes
- ✅ All tools callable via MCP

---

## Implementation Order

Based on the requirements document and critical path analysis:

### Week 1: Core Aggregation
- **Day 1-2**: Tasks 1.1, 1.2 (Tool cache + getMcpServer override)
- **Day 3**: Tasks 1.3, 1.4 (cleanInputSchema + setup integration)

### Week 2: Session & RBAC
- **Day 4-5**: Task 2.1 (Session-based MCP endpoint)
- **Day 6**: Task 2.2 (RBAC-filtered tools/list handler)

### Week 3: Cache & Testing
- **Day 7**: Task 3.1 (Periodic cache refresh)
- **Day 8-9**: Task 4.1 (Integration test)
- **Day 10**: Tasks 4.2, 4.3, 4.4 (Feature flag testing & validation)

**Total Duration**: 10 working days (2 weeks)

---

## Success Metrics

### Implementation Success
- ✅ All 4 phases complete
- ✅ Integration test passes
- ✅ Feature flag cutover works
- ✅ Tool count matches PostgreSQL registry
- ✅ No INVALID_RESULT errors

### Operational Success (Post-Deployment)
- ✅ llm-bot connects to tool-orchestrator when flag enabled
- ✅ Tool discovery latency < 100ms
- ✅ Cache hit ratio > 90%
- ✅ RBAC filtering accurate
- ✅ Multiple concurrent MCP connections supported

---

## Risk Mitigation

### High Risk: Schema Validation Errors
- **Mitigation**: Comprehensive testing with real MCP client
- **Validation**: Integration test + staging deployment
- **Rollback**: Feature flag disable

### Medium Risk: Cache Staleness
- **Mitigation**: 60s refresh interval (Option 1)
- **Upgrade Path**: LISTEN/NOTIFY (Option 2) if needed
- **Monitoring**: Tool count metrics

### Low Risk: Performance Regression
- **Mitigation**: In-memory cache, <1ms lookups
- **Validation**: Load testing (1000 tool calls)
- **Baseline**: tool-gateway performance metrics

---

## Dependencies

### Services
- **tool-orchestrator**: Target service for implementation
- **llm-bot**: Consumer service (connects via MCP)
- **PostgreSQL**: Tool registry storage

### Libraries
- **@modelcontextprotocol/server**: MCP SDK v2.0
- **express**: HTTP server for /mcp endpoint

### Environment
- **ENABLE_TOOL_ORCHESTRATOR**: Feature flag (default: false)
- **TOOL_ORCHESTRATOR_URL**: MCP endpoint URL
- **MCP_AUTH_TOKEN**: Authentication token

---

## Rollback Plan

If issues are discovered post-deployment:

1. **Disable feature flag**: `ENABLE_TOOL_ORCHESTRATOR=false`
2. **Restart llm-bot**: Reconnects to tool-gateway
3. **Validate**: Verify tool discovery works
4. **Monitor**: Check logs for errors
5. **Fix forward**: Address issues, re-enable flag

---

## Documentation Updates

- [ ] Update `documentation/guides/tool-orchestrator.md` with MCP aggregation pattern
- [ ] Update `documentation/reference/mcp-tools.md` with tool-orchestrator tools
- [ ] Update `CLAUDE.md` with pattern #11 (Building MCP Aggregator Services)
- [ ] Add `documentation/guides/feature-flag-cutover.md` for ENABLE_TOOL_ORCHESTRATOR

---

## References

- **Sprint 61 Requirements**: `planning/sprint-61-s03uws/tool-orchestrator-mcp-aggregation-requirements.md`
- **Revised Implementation Plan**: `planning/REVISED-IMPLEMENTATION-PLAN.md`
- **Technical Architecture**: `planning/sprint-55-h17jpp/technical-architecture.md`
- **tool-gateway Reference**: `src/apps/tool-gateway.ts:1821-1877, 2407-2474, 2602+`
- **Integration Test Reference**: `src/apps/__tests__/mcp-aggregation.integration.test.ts:19-91`

---

**Plan Status**: Ready for Review
**Next Steps**: Get user approval, then begin implementation
**Sprint Protocol**: Unified worktree model - all code and planning in `.worktrees/sprint-62-0auem0/`
