# Schema Injection Architecture for Multi-Service LLM Usage

**Date**: 2026-11-18
**Sprint**: 65
**Context**: Follow-up to schema-problem-analysis.md
**Question**: How do other services use LLM + tools with schema injection approach?

---

## Problem Statement

**Recommended Solution** (from schema-problem-analysis.md):
- Keep tool-orchestrator MCP registration schema-less
- Inject schemas at llm-bot level when registering with AI SDK

**New Question**:
If other Bits (reflex, query-analyzer, future services) need LLM + tool access, how do they get schemas?

---

## Current LLM Usage in Platform

### Services Using LLM + Tools

**1. llm-bot** (primary):
- Role: Main conversational agent
- LLM: OpenAI GPT-4o, GPT-5.5, etc.
- Tools: Full catalog (323 tools from tool-orchestrator)
- Pattern: Connects to tool-orchestrator via MCP, registers tools with AI SDK

**2. query-analyzer** (analysis):
- Role: Analyze user queries for intent, entities, sentiment
- LLM: Lightweight model for classification
- Tools: Limited/none (mostly analysis, not tool execution)
- Pattern: May use few specialized tools

**3. reflex** (future):
- Role: Reactive agent for state mutations
- LLM: May need LLM for decision-making
- Tools: State-related tools only (filtered subset)
- Pattern: Would connect to tool-orchestrator for specific tools

**4. Future services**:
- Custom agents, specialized workflows, etc.
- Each may need different tool subsets
- Each may use different LLM providers

---

## Architecture Options

### Option 1: Shared Schema Injection Utility (RECOMMENDED)

**Approach**: Create a reusable utility that any service can use to fetch and inject schemas.

#### Implementation

**New File**: `src/common/mcp/schema-injector.ts`

```typescript
import { jsonSchema } from 'ai';
import { createDocumentStore } from '../persistence/factory';

export interface McpToolWithSchema {
  name: string;
  description?: string;
  parameters?: ReturnType<typeof jsonSchema>;
}

export class McpSchemaInjector {
  private toolStore: any;

  constructor() {
    // Connect to PostgreSQL tool registry
    this.toolStore = createDocumentStore({
      collection: 'platform_tool_registry',
      schema: { /* ... */ }
    });
  }

  /**
   * Inject schemas for MCP tools by looking them up in the tool registry.
   *
   * @param mcpTools - Tools from MCP server.listTools()
   * @returns Tools with schemas injected (ready for AI SDK)
   */
  async injectSchemas(mcpTools: Array<{ name: string; description?: string }>): Promise<McpToolWithSchema[]> {
    return Promise.all(
      mcpTools.map(async (tool) => {
        try {
          // Map MCP tool name back to registry ID
          // Examples:
          //   mcp_generate_image → mcp:generate_image
          //   mcp_mcp_bit_info → mcp:bit.info
          const toolId = this.mapMcpNameToRegistryId(tool.name);

          // Fetch from PostgreSQL
          const toolDoc = await this.toolStore.get(toolId);

          if (toolDoc?.inputSchema) {
            // Extract JSON Schema
            const schema = toolDoc.inputSchema.jsonSchema || toolDoc.inputSchema;

            // Inject using AI SDK jsonSchema() helper
            return {
              ...tool,
              parameters: jsonSchema(schema),
            };
          }

          // No schema available - return as-is
          return tool;
        } catch (err) {
          // Log but don't fail - return tool without schema
          console.warn(`Failed to inject schema for ${tool.name}:`, err);
          return tool;
        }
      })
    );
  }

  /**
   * Map sanitized MCP tool name back to registry ID.
   *
   * Tool name transformations:
   * - tool-orchestrator adds "mcp_" prefix
   * - Colons become underscores: ":" → "_"
   * - Dots become underscores: "." → "_"
   */
  private mapMcpNameToRegistryId(mcpName: string): string {
    // Remove mcp_ prefix if present
    let name = mcpName.startsWith('mcp_') ? mcpName.substring(4) : mcpName;

    // Handle double prefix: mcp_mcp_foo → mcp_foo
    if (name.startsWith('mcp_')) {
      name = name.substring(4);
    }

    // Check if this is a bit.* tool (platform tools)
    if (name.startsWith('bit_')) {
      // bit_info → bit.info
      return name.replace(/_/g, '.');
    }

    // Check if this is a qualified tool: service_tool → service/tool
    // Example: claim_check_bit_readiness → claim-check/bit.readiness
    // This is tricky - would need a mapping table

    // For most tools: mcp:toolname
    return `mcp:${name}`;
  }

  /**
   * Filter tools by name pattern (useful for services that only need specific tools).
   */
  filterTools(tools: McpToolWithSchema[], pattern: string | RegExp): McpToolWithSchema[] {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    return tools.filter(t => regex.test(t.name));
  }
}
```

#### Usage in llm-bot

```typescript
// src/services/llm-bot/processor.ts

import { McpSchemaInjector } from '../../common/mcp/schema-injector';

export class LlmBotProcessor {
  private schemaInjector = new McpSchemaInjector();

  async initializeTools() {
    // Get tools from tool-orchestrator MCP server
    const mcpClient = this.getMcpClient('tool-orchestrator');
    const toolsResponse = await mcpClient.listTools();

    // Inject schemas from PostgreSQL
    const toolsWithSchemas = await this.schemaInjector.injectSchemas(toolsResponse.tools);

    // Register with AI SDK
    this.registerToolsWithAiSdk(toolsWithSchemas);
  }
}
```

#### Usage in reflex (hypothetical)

```typescript
// src/apps/reflex-service.ts

import { McpSchemaInjector } from '../common/mcp/schema-injector';

export class ReflexService extends Bit {
  private schemaInjector = new McpSchemaInjector();

  async setup() {
    // Connect to tool-orchestrator
    const mcpClient = this.getMcpClient('tool-orchestrator');
    const toolsResponse = await mcpClient.listTools();

    // Inject schemas
    const allTools = await this.schemaInjector.injectSchemas(toolsResponse.tools);

    // Filter to only state-related tools
    const stateTools = this.schemaInjector.filterTools(allTools, /^mcp_(get_state|set_state|propose_mutation)/);

    // Register with LLM provider
    this.registerToolsWithLlm(stateTools);
  }
}
```

**Pros**:
- ✅ Reusable across all services
- ✅ Centralized schema injection logic
- ✅ Single source of truth for name mapping
- ✅ Easy to maintain and test
- ✅ Services can filter tools as needed

**Cons**:
- ⚠️ Each service needs to initialize McpSchemaInjector
- ⚠️ Each service needs PostgreSQL connection
- ⚠️ Name mapping logic can be complex

**Complexity**: Medium
**Recommendation**: ⭐⭐⭐⭐⭐ Best approach for multi-service usage

---

### Option 2: MCP Client Profile Enhancement

**Approach**: Enhance `mcp-client-profile` to automatically inject schemas when connecting to tool-orchestrator.

#### Implementation

**Enhanced File**: `src/common/profiles/mcp-client-profile.ts`

```typescript
import { McpSchemaInjector } from '../mcp/schema-injector';

export const McpClientProfile = {
  name: 'mcp-client',

  async install(bit: Bit) {
    const schemaInjector = new McpSchemaInjector();

    // Store injector on bit instance
    (bit as any)._mcpSchemaInjector = schemaInjector;

    // Add helper method to bit
    (bit as any).getMcpToolsWithSchemas = async function(serverName: string) {
      const client = this.getMcpClient(serverName);
      const tools = await client.listTools();
      return await schemaInjector.injectSchemas(tools.tools);
    };
  }
};
```

#### Usage in Any Service

```typescript
export class MyServiceWithLlm extends Bit {
  constructor() {
    super({
      name: 'my-service',
      profiles: ['core', 'mcp-client'],  // ← Includes schema injection
    });
  }

  async setup() {
    // Profile provides getMcpToolsWithSchemas() helper
    const tools = await this.getMcpToolsWithSchemas('tool-orchestrator');

    // Tools already have schemas injected!
    this.registerToolsWithLlm(tools);
  }
}
```

**Pros**:
- ✅ Automatic for all services using mcp-client profile
- ✅ Zero boilerplate in service code
- ✅ Profile handles all complexity
- ✅ Consistent pattern across platform

**Cons**:
- ⚠️ Hidden magic (less explicit)
- ⚠️ All services get schema injection even if not using LLM
- ⚠️ Harder to customize filtering per service

**Complexity**: Medium
**Recommendation**: ⭐⭐⭐⭐ Good for consistency, but less flexible

---

### Option 3: Per-Service Implementation

**Approach**: Each service implements its own schema injection logic.

#### Implementation

```typescript
// In llm-bot
export class LlmBotProcessor {
  async injectSchemas(tools) {
    const toolStore = createDocumentStore({ /* ... */ });
    return Promise.all(tools.map(async tool => {
      const doc = await toolStore.get(this.mapToolId(tool.name));
      return doc?.inputSchema ? { ...tool, parameters: jsonSchema(doc.inputSchema) } : tool;
    }));
  }
}

// In reflex (duplicated code)
export class ReflexService {
  async injectSchemas(tools) {
    const toolStore = createDocumentStore({ /* ... */ });
    return Promise.all(tools.map(async tool => {
      const doc = await toolStore.get(this.mapToolId(tool.name));
      return doc?.inputSchema ? { ...tool, parameters: jsonSchema(doc.inputSchema) } : tool;
    }));
  }
}
```

**Pros**:
- ✅ Full control per service
- ✅ No dependencies on shared utilities

**Cons**:
- ❌ Code duplication
- ❌ Inconsistent implementations
- ❌ Hard to maintain (fix bugs in multiple places)
- ❌ Name mapping logic duplicated

**Complexity**: Low per service, High overall
**Recommendation**: ⭐ Not recommended (DRY violation)

---

### Option 4: Hybrid (Shared Utility + Profile)

**Approach**: Combine Options 1 and 2 - shared utility with optional profile integration.

#### Implementation

**Utility**: `McpSchemaInjector` class (from Option 1)

**Profile**: Auto-initialization (from Option 2)

**Service Choice**:
```typescript
// Option A: Use profile (automatic)
export class ServiceA extends Bit {
  constructor() {
    super({ profiles: ['core', 'mcp-client'] });
  }

  async setup() {
    // Profile-provided helper
    const tools = await this.getMcpToolsWithSchemas('tool-orchestrator');
  }
}

// Option B: Use utility directly (explicit)
export class ServiceB extends Bit {
  private injector = new McpSchemaInjector();

  async setup() {
    const client = this.getMcpClient('tool-orchestrator');
    const tools = await client.listTools();
    const filtered = this.injector.filterTools(tools.tools, /^mcp_state/);
    const withSchemas = await this.injector.injectSchemas(filtered);
  }
}
```

**Pros**:
- ✅ Flexible - services choose their approach
- ✅ Profile for simple cases
- ✅ Direct utility for complex cases
- ✅ Reusable, maintainable, testable

**Cons**:
- ⚠️ Two ways to do the same thing (potential confusion)

**Complexity**: Medium
**Recommendation**: ⭐⭐⭐⭐⭐ Best of both worlds

---

## Recommended Architecture

### Primary: **Option 4 (Hybrid)**

**Core Component**: `McpSchemaInjector` utility class
**Optional Profile**: `mcp-client-profile` enhancement
**Service Choice**: Use profile for simple cases, utility for complex

### Design Principles

**1. Separation of Concerns**:
- MCP layer: Schema-less registration (tool-orchestrator)
- Transport layer: MCP protocol (no schemas)
- Application layer: Schema injection (service-side)
- LLM layer: AI SDK with schemas (OpenAI/Anthropic)

**2. Reusability**:
- Single `McpSchemaInjector` class used by all services
- Shared name mapping logic
- Consistent error handling

**3. Flexibility**:
- Services can use profile (automatic) or utility (explicit)
- Services can filter tools before injection
- Services can customize schema handling

**4. Performance**:
- Schema lookup parallelized (Promise.all)
- Results can be cached per service
- Only fetches schemas for tools the service uses

---

## Implementation Plan

### Phase 1: Create Shared Utility

**File**: `src/common/mcp/schema-injector.ts`

**Tasks**:
1. Create `McpSchemaInjector` class
2. Implement `injectSchemas()` method
3. Implement `mapMcpNameToRegistryId()` (tool name mapping)
4. Implement `filterTools()` helper
5. Add error handling and logging

**Complexity**: Medium
**Effort**: 2-4 hours

### Phase 2: Integrate into llm-bot

**File**: `src/services/llm-bot/processor.ts`

**Tasks**:
1. Import `McpSchemaInjector`
2. Call `injectSchemas()` after fetching MCP tools
3. Pass tools with schemas to AI SDK registration
4. Test with staging deployment

**Complexity**: Low
**Effort**: 1-2 hours

### Phase 3: Optional Profile Enhancement

**File**: `src/common/profiles/mcp-client-profile.ts`

**Tasks**:
1. Add `getMcpToolsWithSchemas()` helper method
2. Auto-initialize `McpSchemaInjector` in profile
3. Document usage pattern

**Complexity**: Low
**Effort**: 1-2 hours

### Phase 4: Documentation

**Files**:
- `CLAUDE.md` - Add pattern for LLM + tool usage
- `documentation/guides/llm-tool-integration.md` - New guide

**Tasks**:
1. Document `McpSchemaInjector` usage
2. Provide code examples
3. Document name mapping rules
4. Add troubleshooting section

**Complexity**: Low
**Effort**: 2-3 hours

---

## Tool Name Mapping Challenge

### The Problem

Tool names are transformed at multiple layers:

```
PostgreSQL:         mcp:generate_image
                           ↓
tool-orchestrator:  mcp_generate_image  (sanitize for MCP SDK)
                           ↓
llm-bot MCP client: mcp_generate_image  (via tools/list RPC)
                           ↓
AI SDK:             mcp_generate_image  (registered with OpenAI)
```

**But also**:
```
PostgreSQL:         mcp:claim-check/bit.readiness  (qualified tool)
                           ↓
tool-orchestrator:  mcp_claim_check_bit_readiness  (sanitize)
                           ↓
Need to reverse:    mcp:claim-check/bit.readiness
```

### Solution Options

**Option A: Mapping Table**:
```typescript
const NAME_MAPPINGS: Record<string, string> = {
  'mcp_claim_check_bit_readiness': 'mcp:claim-check/bit.readiness',
  'mcp_story_engine_mcp_bit_info': 'mcp:story-engine-mcp/bit.info',
  // ... 300+ entries
};
```

**Cons**: Hard to maintain, breaks on new tools

**Option B: Include Original ID in MCP Response**:
```typescript
// In tool-orchestrator getMcpServer()
server.registerTool(sanitizedToolName, {
  description: tool.description,
  // No inputSchema
}, handler);

// Also register tool annotations (MCP SDK v2 feature?)
server.setToolMetadata(sanitizedToolName, {
  originalId: tool.id,  // Store original: mcp:claim-check/bit.readiness
});
```

**Pros**: Accurate, automatic
**Cons**: May not be supported by MCP SDK v2

**Option C: Heuristic Mapping** (Recommended):
```typescript
private mapMcpNameToRegistryId(mcpName: string): string {
  // Remove mcp_ prefix
  let name = mcpName.replace(/^mcp_/, '');

  // Handle bit.* tools: bit_info → bit.info
  if (name.startsWith('bit_')) {
    return name.replace(/_/g, '.');
  }

  // Most tools: mcp:toolname
  // Note: This won't work for qualified tools (server/tool)
  return `mcp:${name}`;
}
```

**Fallback**: Query PostgreSQL with LIKE pattern:
```sql
SELECT * FROM platform_tool_registry
WHERE id LIKE '%generate_image%'
LIMIT 1;
```

**Pros**: Works for 90% of tools, graceful degradation
**Cons**: Ambiguous for qualified tools

---

## Testing Strategy

### Unit Tests

```typescript
describe('McpSchemaInjector', () => {
  it('should inject schemas for tools with schemas', async () => {
    const injector = new McpSchemaInjector();
    const tools = [
      { name: 'mcp_generate_image', description: '...' }
    ];

    const result = await injector.injectSchemas(tools);

    expect(result[0].parameters).toBeDefined();
    expect(result[0].parameters.jsonSchema.required).toContain('prompt');
  });

  it('should handle tools without schemas', async () => {
    const injector = new McpSchemaInjector();
    const tools = [
      { name: 'mcp_bit_info', description: '...' }
    ];

    const result = await injector.injectSchemas(tools);

    expect(result[0]).toEqual(tools[0]); // Unchanged
  });

  it('should map tool names correctly', async () => {
    const injector = new McpSchemaInjector();

    expect(injector['mapMcpNameToRegistryId']('mcp_bit_info'))
      .toBe('bit.info');

    expect(injector['mapMcpNameToRegistryId']('mcp_generate_image'))
      .toBe('mcp:generate_image');
  });
});
```

### Integration Tests

```typescript
describe('llm-bot with schema injection', () => {
  it('should call generate_image with arguments', async () => {
    // Deploy with schema injection
    // Send user message: "Generate image of sunset"
    // Verify tool call includes { prompt: "sunset" }
  });

  it('should work for multiple services', async () => {
    // Both llm-bot and reflex use schemas
    // Verify both get correct schemas
  });
});
```

---

## Migration Path

### Current State
- tool-orchestrator: Schema-less registration (working)
- llm-bot: No schema injection (LLM sends empty args)
- Other services: Not using LLM + tools

### Phase 1: Create Utility (1 sprint)
- Implement `McpSchemaInjector`
- Unit tests
- Documentation

### Phase 2: Integrate llm-bot (1 sprint)
- Use `McpSchemaInjector` in llm-bot
- Staging validation
- Production deployment

### Phase 3: Profile Enhancement (1 sprint)
- Add to `mcp-client-profile`
- Document pattern
- Example service

### Phase 4: Future Services
- New services use profile automatically
- Or use utility directly for custom needs

---

## Example: Future Reflex Service

```typescript
// src/apps/reflex-service.ts

import { Bit } from '../common/base-server';
import { McpSchemaInjector } from '../common/mcp/schema-injector';

export class ReflexService extends Bit {
  private schemaInjector = new McpSchemaInjector();

  constructor() {
    super({
      name: 'reflex',
      profiles: ['core', 'mcp-client'],
      // ... other config
    });
  }

  async setup(): Promise<void> {
    // 1. Connect to tool-orchestrator
    const client = this.getMcpClient('tool-orchestrator');
    const response = await client.listTools();

    // 2. Filter to only state-related tools
    const stateTools = response.tools.filter(t =>
      t.name.includes('state') || t.name.includes('mutation')
    );

    // 3. Inject schemas
    const toolsWithSchemas = await this.schemaInjector.injectSchemas(stateTools);

    // 4. Register with LLM (OpenAI, Anthropic, etc.)
    await this.initializeLlm(toolsWithSchemas);

    // 5. Subscribe to events that need LLM decisions
    await this.onMessage('internal.reflex.decision.v1', this.handleDecision);
  }

  private async handleDecision(event: any) {
    // Use LLM with tools to make reactive decisions
    const result = await this.llm.generateWithTools({
      prompt: `Analyze: ${event.context}`,
      tools: this.tools,  // Tools with schemas
    });

    // Execute chosen tool
    await this.executeTool(result.toolCall);
  }
}
```

---

## Conclusion

**Recommended Architecture**: **Option 4 (Hybrid)**

**Core Implementation**:
1. Create `McpSchemaInjector` utility class
2. Integrate into llm-bot first
3. Optionally add to `mcp-client-profile`
4. Document pattern for future services

**Benefits**:
- ✅ Reusable across all services
- ✅ Flexible (profile or direct usage)
- ✅ Maintainable (single source of truth)
- ✅ Scales to multiple LLM-using services

**Trade-offs**:
- ⚠️ Tool name mapping requires heuristics
- ⚠️ Each service needs PostgreSQL access
- ⚠️ Schema lookup adds initialization latency

**Next Steps**:
1. Implement `McpSchemaInjector` utility
2. Test with llm-bot
3. Deploy to staging
4. Document pattern

---

**Document Version**: 1.0
**Author**: Claude (Sprint 65 Assistant)
**Last Updated**: 2026-11-18
**Status**: Architectural Recommendation
