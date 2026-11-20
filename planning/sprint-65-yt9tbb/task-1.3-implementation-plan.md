# Task 1.3: Port Missing Internal Tools - Implementation Plan

**Created**: 2026-11-16
**Task**: Sprint 65, Task 1.3
**Priority**: P0 (Blocking)
**Estimated Duration**: 2 days

---

## Objective

Port all missing internal tools from tool-gateway to tool-orchestrator to achieve 100% feature parity for internal tool execution.

---

## Missing Internal Tools (from Gap Analysis)

### Composition Admin Tools (6 tools) - P0

1. **composition.register** - Register new composition from YAML/JSON
2. **composition.list** - List all compositions with filtering
3. **composition.get** - Get composition by name/version
4. **composition.delete** - Delete composition by name/version
5. **composition.stats** - Get composition registry statistics
6. **composition.list_tools** - List tools for composition authoring

### Enhanced Internal Tools - P1

7. **agent.sendProgressUpdate** - Needs enhancement with claim check integration

---

## Prerequisites

Before porting composition tools, we must initialize the composition subsystem:

### Step 1: Initialize Composition Subsystem

**Required Components**:
- PostgresCompositionStore (connects to PostgreSQL)
- CompositionRegistry (manages composition CRUD)
- CompositionExecutor (executes compositions)
- Load compositions on startup
- Register compositions as MCP tools

**Location**: `src/apps/tool-orchestrator-service.ts`

**Implementation**:
```typescript
// In setup() method, after ModelRegistry initialization

// Initialize Composition Subsystem (Sprint 65 Task 1.3)
const compositionsEnabled = process.env.ENABLE_COMPOSITIONS !== 'false';

if (compositionsEnabled) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL required for composition subsystem');
  }

  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString,
    max: parseInt(process.env.POSTGRES_POOL_SIZE || '10', 10),
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  const { PostgresCompositionStore } = require('../common/composition/postgres-composition-store');
  const { CompositionRegistry } = require('../common/composition/registry');
  const { CompositionExecutor } = require('../common/composition/executor');

  const compositionStore = new PostgresCompositionStore(pool);

  // Create adapter for ToolRegistry (composition needs tool lookup)
  const toolRegistryAdapter = {
    getTool: (toolId: string) => {
      const tool = this.toolRegistry!.getTool(toolId);
      if (!tool) return null;
      return {
        id: tool.id,
        inputSchema: tool.inputSchema,
        source: tool.source,
        execute: tool.execute,
      };
    },
  };

  this.compositionRegistry = new CompositionRegistry(
    compositionStore,
    toolRegistryAdapter,
    this.getLogger()
  );

  this.compositionExecutor = new CompositionExecutor(
    toolRegistryAdapter,
    this.getLogger()
  );

  this.getLogger().info('tool_orchestrator.composition_subsystem_initialized', {
    storeType: 'PostgresCompositionStore',
  });
}
```

### Step 2: Load Compositions on Startup

**Location**: `src/apps/tool-orchestrator-service.ts` (in `start()` or after setup)

**Implementation**:
```typescript
private async loadCompositions(): Promise<void> {
  if (!this.compositionRegistry) {
    this.getLogger().debug('tool_orchestrator.compositions.skipped', {
      reason: 'Composition subsystem not enabled',
    });
    return;
  }

  try {
    const compositions = await this.compositionRegistry.list();
    this.getLogger().info('tool_orchestrator.compositions.loaded', {
      count: compositions.length,
      names: compositions.map((c) => c.name),
    });

    // Register each composition as an MCP tool
    for (const record of compositions) {
      await this.registerCompositionTool(record.compiled);
    }

    this.getLogger().info('tool_orchestrator.compositions.registered', {
      count: compositions.length,
    });
  } catch (err) {
    this.getLogger().error('tool_orchestrator.compositions.load_failed', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Graceful degradation: Don't fail startup if compositions can't be loaded
  }
}

private async registerCompositionTool(composition: any): Promise<void> {
  const toolId = composition.metadata.name;
  const description = composition.metadata.description || `Composition: ${toolId}`;
  const jsonSchema = composition.spec.inputSchema;

  try {
    // Register in ToolRegistry
    await this.toolRegistry!.registerTool({
      id: toolId,
      canonicalName: toolId,
      displayName: toolId,
      description,
      inputSchema: jsonSchema,
      source: 'composition',
      status: 'active',
      sourceMetadata: {
        composition: {
          name: composition.metadata.name,
          version: composition.metadata.version,
          contentHash: composition.contentHash,
        },
      },
      config: {
        timeoutMs: 60000, // 1 minute default
      },
      rbac: {
        userRoles: {
          required: [],
          denied: [],
        },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    this.getLogger().debug('tool_orchestrator.composition.registered', {
      toolId,
      version: composition.metadata.version,
    });
  } catch (err) {
    this.getLogger().error('tool_orchestrator.composition.registration_failed', {
      toolId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

---

## Implementation Steps

### Phase 1: Composition Subsystem (Day 1, Morning)

**Files to Modify**:
- `src/apps/tool-orchestrator-service.ts`

**Tasks**:
1. Add imports for CompositionRegistry, CompositionExecutor, PostgresCompositionStore
2. Add class properties: `compositionRegistry?`, `compositionExecutor?`
3. Initialize composition subsystem in `setup()` method
4. Add `loadCompositions()` method
5. Add `registerCompositionTool()` method
6. Call `loadCompositions()` after setup completes
7. Build and validate (local deployment)

**Acceptance Criteria**:
- [ ] CompositionRegistry initialized successfully
- [ ] CompositionExecutor initialized successfully
- [ ] Log event: `tool_orchestrator.composition_subsystem_initialized`
- [ ] Compositions loaded on startup
- [ ] Log event: `tool_orchestrator.compositions.loaded`

---

### Phase 2: Port Composition Admin Tools (Day 1, Afternoon + Day 2 Morning)

**Files to Create/Modify**:
- `src/apps/tool-orchestrator-service.ts` (register tools in `registerMcpTools()`)

**Tool 1: composition.register**

```typescript
this.registerTool(
  'composition.register',
  `Register a new composition from YAML/JSON definition.

IMPORTANT: Tool IDs in composition steps MUST use CANONICAL names (e.g., 'get_state', 'generate_image'), NOT the MCP-prefixed names you see in the tools list (e.g., 'mcp_get_state', 'mcp_generate_image').

Use 'composition.list_tools' to discover canonical tool IDs for composition authoring.

Returns composition metadata (id, name, version, contentHash).`,
  z.object({
    definition: z.object({
      apiVersion: z.string(),
      kind: z.literal('Composition'),
      metadata: z.object({
        name: z.string(),
        description: z.string().optional(),
        version: z.number().optional(),
      }).passthrough(),
      spec: z.object({
        inputSchema: z.any(),
        steps: z.array(z.any()).optional(),
        return: z.any(),
      }).passthrough(),
    }).passthrough(),
  }),
  async (args) => {
    if (!this.compositionRegistry) {
      return {
        content: [{
          type: 'text',
          text: 'Error: Composition subsystem not enabled',
        }],
        isError: true,
      };
    }

    try {
      const compiled = await this.compositionRegistry.register(args.definition as any);
      await this.registerCompositionTool(compiled);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: compiled.id,
            name: compiled.metadata.name,
            version: compiled.metadata.version,
            contentHash: compiled.contentHash,
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${err instanceof Error ? err.message : 'Failed to register composition'}`,
        }],
        isError: true,
      };
    }
  }
);
```

**Tool 2: composition.list**

```typescript
this.registerTool(
  'composition.list',
  'List all registered compositions with optional filtering and pagination.',
  z.object({
    filter: z.object({
      name: z.string().optional(),
      status: z.enum(['active', 'draft', 'archived']).optional(),
    }).optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  }),
  async (args) => {
    if (!this.compositionRegistry) {
      return {
        content: [{
          type: 'text',
          text: 'Error: Composition subsystem not enabled',
        }],
        isError: true,
      };
    }

    try {
      const compositions = await this.compositionRegistry.list();
      let filtered = compositions;

      if (args.filter?.name) {
        filtered = filtered.filter((c) => c.name === args.filter!.name);
      }

      const offset = args.offset || 0;
      const limit = args.limit || filtered.length;
      const paginated = filtered.slice(offset, offset + limit);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            compositions: paginated.map((c) => ({
              id: c.id,
              name: c.name,
              version: c.version,
              contentHash: c.contentHash,
              createdAt: c.createdAt,
              updatedAt: c.updatedAt,
            })),
            total: filtered.length,
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${err instanceof Error ? err.message : 'Failed to list compositions'}`,
        }],
        isError: true,
      };
    }
  }
);
```

**Tool 3: composition.get**

```typescript
this.registerTool(
  'composition.get',
  'Retrieve a specific composition by name and optional version (latest if omitted).',
  z.object({
    name: z.string(),
    version: z.number().optional(),
  }),
  async (args) => {
    if (!this.compositionRegistry) {
      return {
        content: [{
          type: 'text',
          text: 'Error: Composition subsystem not enabled',
        }],
        isError: true,
      };
    }

    try {
      const composition = await this.compositionRegistry.get(args.name, args.version);

      if (!composition) {
        return {
          content: [{
            type: 'text',
            text: `Error: Composition not found: ${args.name}${args.version ? ` (version ${args.version})` : ''}`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(composition, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${err instanceof Error ? err.message : 'Failed to retrieve composition'}`,
        }],
        isError: true,
      };
    }
  }
);
```

**Tool 4: composition.delete**

```typescript
this.registerTool(
  'composition.delete',
  'Delete a specific composition version by name and version number.',
  z.object({
    name: z.string(),
    version: z.number(),
  }),
  async (args) => {
    if (!this.compositionRegistry) {
      return {
        content: [{
          type: 'text',
          text: 'Error: Composition subsystem not enabled',
        }],
        isError: true,
      };
    }

    try {
      await this.compositionRegistry.delete(args.name, args.version);

      // Unregister from ToolRegistry
      // Note: Need to find the tool ID (composition name) and remove it
      // This is a PostgreSQL operation, not in-memory
      await this.toolRegistry!.queryTools({ id: [args.name] }).then(async (tools) => {
        if (tools.length > 0) {
          // Delete tool from registry (implementation depends on ToolRegistry API)
          this.getLogger().info('tool_orchestrator.composition.unregistered', {
            name: args.name,
            version: args.version,
          });
        }
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Composition deleted: ${args.name} (version ${args.version})`,
            deleted: {
              name: args.name,
              version: args.version,
            },
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${err instanceof Error ? err.message : 'Failed to delete composition'}`,
        }],
        isError: true,
      };
    }
  }
);
```

**Tool 5: composition.stats**

```typescript
this.registerTool(
  'composition.stats',
  'Get composition registry statistics including total compositions, total versions, and compositions by name.',
  z.object({}),
  async (args) => {
    if (!this.compositionRegistry) {
      return {
        content: [{
          type: 'text',
          text: 'Error: Composition subsystem not enabled',
        }],
        isError: true,
      };
    }

    try {
      const stats = await this.compositionRegistry.getStats();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(stats, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${err instanceof Error ? err.message : 'Failed to get composition statistics'}`,
        }],
        isError: true,
      };
    }
  }
);
```

**Tool 6: composition.list_tools**

```typescript
this.registerTool(
  'composition.list_tools',
  'List all available tools with CANONICAL IDs for use in compositions. Returns tools with their canonical IDs (without mcp_ prefix), descriptions, and input schemas.',
  z.object({
    filter: z.string().optional(),
    limit: z.number().optional(),
  }),
  async (args) => {
    try {
      // Get all tools from ToolRegistry
      const allTools = await this.toolRegistry!.queryTools({ status: ['active'] });

      // Filter tools if pattern provided
      let filtered = allTools;
      if (args.filter) {
        const pattern = args.filter.toLowerCase();
        filtered = allTools.filter(t =>
          t.id.toLowerCase().includes(pattern) ||
          (t.displayName && t.displayName.toLowerCase().includes(pattern)) ||
          (t.description && t.description.toLowerCase().includes(pattern))
        );
      }

      // Apply limit (default 100)
      const limit = args.limit || 100;
      const limited = filtered.slice(0, limit);

      // Format output - normalize tool IDs to canonical form
      const tools = limited.map(t => {
        // Strip MCP prefixes to get canonical ID
        let canonicalId = t.canonicalName || t.id;

        // Remove 'mcp_' prefix (e.g., 'mcp_get_state' -> 'get_state')
        if (canonicalId.startsWith('mcp_')) {
          canonicalId = canonicalId.slice(4);
        }

        // Remove 'mcp:' prefix (e.g., 'mcp:generate_image' -> 'generate_image')
        if (canonicalId.startsWith('mcp:')) {
          const withoutPrefix = canonicalId.slice(4);
          const parts = withoutPrefix.split('/');
          canonicalId = parts[parts.length - 1];
        }

        return {
          id: canonicalId,
          displayName: t.displayName || canonicalId,
          description: t.description || '',
          source: t.source || 'unknown',
          hasInputSchema: !!t.inputSchema,
        };
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            totalAvailable: allTools.length,
            filtered: filtered.length,
            returned: tools.length,
            tools,
            hint: 'Use these canonical tool IDs in composition steps (e.g., steps[].call)',
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${err instanceof Error ? err.message : 'Failed to list tools'}`,
        }],
        isError: true,
      };
    }
  }
);
```

**Acceptance Criteria**:
- [ ] All 6 composition admin tools registered
- [ ] Tools return success responses (not error stubs)
- [ ] Tools integrate with CompositionRegistry
- [ ] Error handling for disabled composition subsystem
- [ ] Build succeeds with no TypeScript errors

---

### Phase 3: Enhance agent.sendProgressUpdate (Day 2, Afternoon)

**Current Implementation**: Returns acknowledgment string, doesn't deliver messages

**Required Enhancement**: Add claim check integration and Bit.next() routing

**Problem**: ToolGateway module is not a Bit, doesn't have `next()` method

**Solution**: Add callback pattern to ToolGateway constructor

**Implementation**:

1. **Modify ToolGateway constructor** to accept a `next()` callback:

```typescript
// src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts

constructor(
  toolRegistry: IToolRegistry,
  modelRegistry: IModelRegistry,
  config?: ToolGatewayConfig,
  mcpClientManager?: McpClientManager,
  logger?: any,
  nextCallback?: (event: any) => Promise<void>  // ✅ NEW
) {
  // ... existing code ...
  this.nextCallback = nextCallback;
}

private nextCallback?: (event: any) => Promise<void>;
```

2. **Enhance handleSendProgressUpdate** with claim check + routing:

```typescript
private async handleSendProgressUpdate(args, context) {
  const correlationId = context.correlationId;
  let sourceEvent: any = null;

  // 1. Try claim check retrieval (if correlationId available)
  // ... (implementation from tool-gateway.ts:374-416)

  // 2. Build egress info (fallback chain)
  // ... (implementation from tool-gateway.ts:418-523)

  // 3. Create progress event
  const progressEvent = {
    // ... (full event structure from tool-gateway.ts:526-586)
  };

  // 4. Route via callback
  if (this.nextCallback) {
    await this.nextCallback(progressEvent);
    return {
      content: [{
        type: 'text',
        text: `Progress update sent: "${progressMessage}"`,
      }],
    };
  } else {
    this.logger?.warn('No next callback configured - progress message not routed');
    return {
      content: [{
        type: 'text',
        text: 'Warning: Progress updates not configured for delivery',
      }],
    };
  }
}
```

3. **Pass callback from tool-orchestrator-service**:

```typescript
// src/apps/tool-orchestrator-service.ts (in setup())

this.toolGateway = new ToolGateway(
  this.toolRegistry,
  this.modelRegistry,
  { /* config */ },
  this.mcpClientManager,
  this.getLogger() as any,
  (event) => this.next(event)  // ✅ ADD: Callback for routing progress events
);
```

**Acceptance Criteria**:
- [ ] agent.sendProgressUpdate delivers messages via Bit.next()
- [ ] Claim check integration working (retrieves source event)
- [ ] Egress fallback chain implemented
- [ ] Progress messages delivered to users (verify in staging)

---

## Testing Strategy

### Unit Tests

**File**: `src/apps/tool-orchestrator-service/__tests__/composition-admin-tools.test.ts`

**Test Cases**:
1. composition.register - success
2. composition.register - invalid definition
3. composition.list - with filtering
4. composition.get - found
5. composition.get - not found
6. composition.delete - success
7. composition.stats - returns statistics
8. composition.list_tools - with filtering

### Integration Tests (Phase 2 - Week 2)

1. Register composition via MCP tool
2. Execute composition via tool-orchestrator
3. List compositions via MCP tool
4. Delete composition via MCP tool
5. Verify agent.sendProgressUpdate delivers messages

---

## Validation Plan

### Local Validation

1. Build succeeds: `npm run build`
2. Deploy to local: tool-orchestrator starts without errors
3. Check logs for `tool_orchestrator.composition_subsystem_initialized`
4. Check logs for `tool_orchestrator.compositions.loaded`
5. Verify 6 composition tools registered via MCP

### Staging Validation (per user request)

1. Deploy tool-orchestrator to staging context
2. Call composition.list via MCP → verify returns compositions
3. Call composition.register → create test composition
4. Execute test composition → verify execution succeeds
5. Call composition.delete → verify composition removed
6. Test agent.sendProgressUpdate → verify message delivered to user

---

## Success Criteria

- [ ] All 6 composition admin tools ported and working
- [ ] Composition subsystem initialized successfully
- [ ] Compositions load on startup
- [ ] agent.sendProgressUpdate enhanced with claim check + routing
- [ ] 100% feature parity with tool-gateway internal tools
- [ ] Zero regressions in existing functionality
- [ ] All unit tests passing
- [ ] Validated in staging environment

---

## Rollback Plan

If composition subsystem fails to initialize:
- Service continues without compositions (fail-open)
- Composition tools return "subsystem not enabled" errors
- Fix initialization issues and redeploy
- Risk: Compositions unavailable until fixed

If agent.sendProgressUpdate enhancement breaks:
- Revert to acknowledgment-only implementation
- Fix claim check integration separately
- Risk: Progress messages not delivered (UX degradation)

---

## Timeline

| Day | Phase | Tasks | Duration |
|-----|-------|-------|----------|
| Day 1 AM | Phase 1 | Composition subsystem init | 3 hours |
| Day 1 PM | Phase 2 | Port 3 composition tools | 4 hours |
| Day 2 AM | Phase 2 | Port 3 composition tools | 3 hours |
| Day 2 PM | Phase 3 | Enhance agent.sendProgressUpdate | 4 hours |

**Total**: 14 hours (1.75 days)

---

**Document Status**: Implementation Ready
**Next Action**: Begin Phase 1 - Initialize Composition Subsystem
**Last Updated**: 2026-11-16
