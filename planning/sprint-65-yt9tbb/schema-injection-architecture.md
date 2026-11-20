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

### Option 0: Base Class Integration via LlmProfile (RECOMMENDED - Seamless)

**Approach**: Integrate schema injection directly into the `LlmProfile` capability so it's completely transparent to service implementations.

**Key Insight**: The base `Bit` class uses composable profiles (LlmProfile, McpClientProfile) that add capabilities. Schema injection should be a capability method that services call, not manual utility code they must write.

#### Current Bootstrap Pattern

**How services currently use LLM + tools**:

```typescript
// src/services/llm-bot/processor.ts (line 755-798)

// 1. Get tools from MCP registry
const allTools = deps?.registry?.getTools() || {};

// 2. Filter tools (RBAC, scope, behavioral)
const filteredTools: Record<string, any> = {};
for (const [name, tool] of Object.entries(allTools)) {
  // ... filtering logic ...

  if (allowed && scopeAllowed && behavioralDecision.allowed) {
    // 3. Register with AI SDK (line 798: inputSchema used directly)
    filteredTools[name] = {
      description: tool.description,
      inputSchema: tool.inputSchema,  // ⚠️ MISSING for PostgreSQL tools!
      execute: tool.execute ? async (args: any) => {
        // ... execution wrapper ...
      } : undefined,
    };
  }
}

// 4. Call LLM with tools
const result = await generateText({
  model: provider,
  messages: coreMessages,
  tools: filteredTools,  // AI SDK needs schemas!
  stopWhen: stepCountIs(5),
});
```

**Problem**: Line 798 sets `inputSchema: tool.inputSchema` directly, which is undefined for PostgreSQL tools.

#### Proposed Solution: Add `bit.llm.prepareToolsForLlm()`

**Extend LlmCapability interface** (`src/common/profiles/llm-profile.ts`):

```typescript
export interface LlmCapability {
  getModel(): { provider: string; model: string };
  setModel(next: { provider?: string; model?: string }): { provider: string; model: string };
  resolveProvider(kind?: 'language' | 'embedding'): unknown;
  getConfigKnobs(): LlmConfigKnobs;
  toolFilter: { mode: 'off' | 'allow' | 'deny'; list: string[] };

  // NEW: Prepare tools for LLM usage (injects schemas + converts to AI SDK format)
  prepareToolsForLlm(tools: Record<string, RegisteredTool>): Promise<Record<string, AiSdkTool>>;
}
```

**Implementation in LlmProfile.install()**:

```typescript
// src/common/profiles/llm-profile.ts (new method in install function)

import { jsonSchema } from 'ai';
import { createDocumentStore } from '../persistence/factory';

export const LlmProfile: BitProfile = {
  name: 'llm',
  install(bit: Bit): void {
    const anyBit = bit as any;

    // ... existing getModel, setModel, resolveProvider, getConfigKnobs ...

    // NEW: Schema injection from PostgreSQL tool registry
    let toolStore: any = null;  // Lazy-initialized on first use

    const prepareToolsForLlm = async (
      tools: Record<string, RegisteredTool>
    ): Promise<Record<string, any>> => {
      const logger = bit.getLogger();
      const enrichedTools: Record<string, any> = {};

      // Lazy-init tool store (only when needed)
      if (!toolStore) {
        try {
          const documentStore = anyBit.getResource?.('documentStore');
          if (documentStore) {
            toolStore = documentStore; // Use existing PostgreSQL connection
          } else {
            logger.warn('bit.llm.prepareToolsForLlm.no_store', {
              message: 'No documentStore available, schema injection disabled'
            });
          }
        } catch (err) {
          logger.error('bit.llm.prepareToolsForLlm.init_failed', {
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }

      // Process each tool
      for (const [name, tool] of Object.entries(tools)) {
        let inputSchema = tool.inputSchema;

        // If tool missing schema, try to fetch from PostgreSQL
        if (!inputSchema && toolStore) {
          try {
            // Map tool name to registry ID (handle sanitization reversal)
            const toolId = mapToolNameToRegistryId(tool.id);

            // Query PostgreSQL tool registry
            const toolDoc = await toolStore.query('platform_tool_registry', {
              where: [['id', '==', toolId]],
              limit: 1
            });

            if (toolDoc?.[0]?.data?.inputSchema) {
              const schema = toolDoc[0].data.inputSchema;
              const schemaData = schema.jsonSchema || schema;

              // Convert to AI SDK format using jsonSchema() helper
              inputSchema = jsonSchema(schemaData);

              logger.debug('bit.llm.prepareToolsForLlm.schema_injected', {
                toolName: name,
                toolId: tool.id,
                registryId: toolId,
                schemaFound: true
              });
            }
          } catch (err) {
            // Fail-open: Missing schemas should not block tool usage
            logger.warn('bit.llm.prepareToolsForLlm.schema_fetch_failed', {
              toolName: name,
              toolId: tool.id,
              error: err instanceof Error ? err.message : String(err)
            });
          }
        }

        // Return tool with schema (original or injected)
        enrichedTools[name] = {
          description: tool.description,
          inputSchema,  // ✅ Now has schema (direct or injected)
          execute: tool.execute,
        };
      }

      logger.info('bit.llm.prepareToolsForLlm.complete', {
        totalTools: Object.keys(tools).length,
        withSchema: Object.values(enrichedTools).filter(t => t.inputSchema).length,
        withoutSchema: Object.values(enrichedTools).filter(t => !t.inputSchema).length
      });

      return enrichedTools;
    };

    // Helper: Map sanitized MCP tool names back to registry IDs
    function mapToolNameToRegistryId(toolId: string): string {
      // Handle mcp:namespace/tool.name format
      if (toolId.startsWith('mcp:')) {
        return toolId;  // Already correct format
      }

      // Handle sanitized format: mcp_namespace_tool_name
      // Need to restore: mcp:namespace/tool.name or mcp:tool-name

      // Pattern 1: mcp_namespace_tool_name → mcp:namespace/tool.name
      const withSlashMatch = toolId.match(/^mcp_([a-z0-9_]+?)_([a-z0-9_]+)$/);
      if (withSlashMatch) {
        const namespace = withSlashMatch[1].replace(/_/g, '-');
        const toolName = withSlashMatch[2].replace(/_/g, '.');
        return `mcp:${namespace}/${toolName}`;
      }

      // Pattern 2: mcp_tool_name → mcp:tool-name
      const simpleMatch = toolId.match(/^mcp_([a-z0-9_]+)$/);
      if (simpleMatch) {
        const toolName = simpleMatch[1].replace(/_/g, '-');
        return `mcp:${toolName}`;
      }

      // Fallback: Return as-is and log warning
      bit.getLogger().warn('bit.llm.prepareToolsForLlm.name_mapping_fallback', {
        toolId,
        message: 'Could not map tool name to registry ID'
      });
      return toolId;
    }

    const capability: LlmCapability = {
      getModel,
      setModel,
      resolveProvider,
      getConfigKnobs,
      toolFilter: { mode: 'off', list: [] },
      prepareToolsForLlm,  // ✅ NEW: Schema injection method
    };
    anyBit.llm = capability;

    // ... rest of install() (MCP admin tools) ...
  },
};
```

#### Updated Service Usage Pattern

**Before (manual schema handling)**:

```typescript
// src/services/llm-bot/processor.ts (current)

const allTools = deps?.registry?.getTools() || {};
const filteredTools: Record<string, any> = {};

for (const [name, tool] of Object.entries(allTools)) {
  // ... filtering ...
  filteredTools[name] = {
    description: tool.description,
    inputSchema: tool.inputSchema,  // ⚠️ Undefined for PostgreSQL tools
    execute: tool.execute,
  };
}

const result = await generateText({
  model: provider,
  messages: coreMessages,
  tools: filteredTools,
  stopWhen: stepCountIs(5),
});
```

**After (seamless schema injection)**:

```typescript
// src/services/llm-bot/processor.ts (updated)

const allTools = deps?.registry?.getTools() || {};

// Apply RBAC/scope/behavioral filtering first
const filteredTools: Record<string, any> = {};
for (const [name, tool] of Object.entries(allTools)) {
  // ... filtering logic (RBAC, scope, behavioral) ...
  if (allowed && scopeAllowed && behavioralDecision.allowed) {
    filteredTools[name] = tool;  // Keep tools in registry format
  }
}

// ✅ NEW: Inject schemas from PostgreSQL (seamless!)
const enrichedTools = await (server as any).llm.prepareToolsForLlm(filteredTools);

// Wrap execute methods for error handling
const wrappedTools: Record<string, any> = {};
for (const [name, tool] of Object.entries(enrichedTools)) {
  wrappedTools[name] = {
    description: tool.description,
    inputSchema: tool.inputSchema,  // ✅ Now has schema (direct or injected)!
    execute: tool.execute ? async (args: any) => {
      const startTime = Date.now();
      try {
        // ... existing execution wrapper ...
      } catch (e) {
        // ... existing error handling ...
      }
    } : undefined,
  };
}

const result = await generateText({
  model: provider,
  messages: coreMessages,
  tools: wrappedTools,  // ✅ All tools now have schemas!
  stopWhen: stepCountIs(5),
});
```

#### Benefits of Base Class Integration

1. **✅ Seamless**: Services call one method, don't manage schema injection logic
2. **✅ Consistent**: All LLM-using services get same behavior automatically
3. **✅ Maintainable**: Schema injection logic lives in one place (LlmProfile)
4. **✅ Discoverable**: IntelliSense shows `bit.llm.prepareToolsForLlm()` to developers
5. **✅ Testable**: Profile can be tested independently
6. **✅ Fail-open**: Missing schemas don't break tool execution
7. **✅ Lazy-init**: PostgreSQL connection only created when needed
8. **✅ Reusable**: Works for llm-bot, reflex, query-analyzer, future services

#### Multi-Service Usage Example

**llm-bot** (full tool catalog):
```typescript
const allTools = deps?.registry?.getTools() || {};
const filteredTools = applyRbacScopeBehavioralFiltering(allTools, ...);
const enrichedTools = await (this as any).llm.prepareToolsForLlm(filteredTools);
// Use all 323 tools with schemas
```

**reflex** (filtered subset):
```typescript
const allTools = deps?.registry?.getTools() || {};
const stateTools = Object.fromEntries(
  Object.entries(allTools).filter(([_, t]) => t.id.startsWith('state.'))
);
const enrichedTools = await (this as any).llm.prepareToolsForLlm(stateTools);
// Use only state-related tools with schemas
```

**query-analyzer** (analysis tools only):
```typescript
const allTools = deps?.registry?.getTools() || {};
const analysisTools = Object.fromEntries(
  Object.entries(allTools).filter(([_, t]) => t.scopes?.includes('analysis'))
);
const enrichedTools = await (this as any).llm.prepareToolsForLlm(analysisTools);
// Use only analysis-scoped tools with schemas
```

#### Implementation Phases

**Phase 1: Add capability to LlmProfile**
- Extend LlmCapability interface
- Implement prepareToolsForLlm() in install()
- Add tool name mapping helper
- Add logging and error handling

**Phase 2: Update llm-bot to use capability**
- Modify processor.ts to call bit.llm.prepareToolsForLlm()
- Remove manual inputSchema handling
- Verify schemas are injected correctly

**Phase 3: Validate in staging**
- Deploy llm-bot with new pattern
- Verify PostgreSQL queries work
- Confirm LLM receives schemas
- Monitor performance impact

**Phase 4: Document pattern**
- Update CLAUDE.md with new pattern
- Add code examples for future services
- Document tool name mapping challenges

---

### Option 1: Manual Schema Injection Utility (Alternative)

**Approach**: Create a reusable utility that services manually instantiate and use.

**Note**: This option is LESS RECOMMENDED than Option 0 because it requires each service to manually manage schema injection instead of using the base class capability.

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

### ⭐ PRIMARY: **Option 0 (Base Class Integration via LlmProfile)**

**Why This is Best**:
- **Seamless**: Services just call `bit.llm.prepareToolsForLlm()` - no manual setup
- **Consistent**: All LLM-using services automatically get schema injection
- **Maintainable**: One place for schema injection logic (LlmProfile)
- **Discoverable**: TypeScript IntelliSense shows the method
- **Future-proof**: Works for all current and future LLM-using services

**Core Implementation**:
- Extend `LlmCapability` interface with `prepareToolsForLlm()` method
- Implement in `LlmProfile.install()` function
- Lazy-init PostgreSQL connection when first needed
- Fail-open design (missing schemas don't break execution)

**Service Usage**:
```typescript
// Step 1: Get and filter tools
const allTools = deps?.registry?.getTools() || {};
const filteredTools = applyFiltering(allTools);

// Step 2: Inject schemas (ONE LINE!)
const enrichedTools = await (this as any).llm.prepareToolsForLlm(filteredTools);

// Step 3: Use with AI SDK
const result = await generateText({ model, messages, tools: enrichedTools });
```

---

### Alternative: **Option 1 (Manual Utility)**

**Use Only If**: You need custom schema transformation logic beyond standard injection.

**Core Component**: `McpSchemaInjector` utility class
**Service Choice**: Manual instantiation and usage

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
