# PostgreSQL Tools Schema Problem - Analysis & Solutions

**Date**: 2026-11-18
**Sprint**: 65
**Status**: Active Issue
**Severity**: Medium (System functional, but LLM tool calling suboptimal)

---

## Executive Summary

PostgreSQL-backed tools (323 tools) are registered in the tool-orchestrator MCP server **without inputSchema**, preventing the LLM from understanding tool parameters. This results in the LLM sending empty argument objects `{}`, causing validation errors at upstream MCP servers.

**Current Status**: System is functional with schema-less registration, but LLM cannot determine required parameters for tools.

**Attempted Fix**: Using `jsonSchema()` helper from AI SDK failed due to API incompatibility with MCP SDK v2.

**Root Cause**: Format mismatch between PostgreSQL storage (JSON Schema) and MCP SDK v2 requirements (Zod schemas).

---

## Problem Statement

### The Issue

When tool-orchestrator registers PostgreSQL-backed tools via `getMcpServer()`, it omits the `inputSchema`:

```typescript
// Current code (line 1489-1493)
server.registerTool(sanitizedToolName, {
  description: tool.description || `Tool: ${tool.id}`,
  // inputSchema omitted - MCP SDK v2 requires Zod, PostgreSQL stores JSON Schema
}, async (args: any, ctx: any) => {
```

### Impact

**Without schemas, the LLM**:
- Cannot determine what parameters a tool accepts
- Cannot determine which parameters are required
- Cannot determine parameter types
- Sends empty objects `{}` by default

**Result**:
```
Error: Input validation error: Invalid arguments for tool generate_image:
prompt: Invalid input: expected string, received undefined
```

### Evidence

**Trace 52383d0d-dd46-4982-8d0b-c5b73697fab4**:
```json
{
  "msg": "tool_gateway.execute_mcp.start",
  "toolId": "mcp:generate_image",
  "inputPreview": "{}"  // ← Empty arguments!
}

{
  "error": "prompt: Invalid input: expected string, received undefined"
}
```

**Database Schema (Correct)**:
```json
{
  "inputSchema": {
    "jsonSchema": {
      "type": "object",
      "required": ["prompt"],
      "properties": {
        "prompt": {
          "type": "string",
          "description": "The descriptive prompt for the image."
        }
      }
    }
  }
}
```

---

## Architecture Overview

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. PostgreSQL (platform_tool_registry)                          │
│    Storage: JSON Schema format                                  │
│    { jsonSchema: { type: 'object', properties: {...} } }        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. Tool-Orchestrator getMcpServer()                             │
│    Registration: MCP SDK v2 server.registerTool()               │
│    Requires: Zod schemas or raw Zod shapes                      │
│    Currently: No schema provided (omitted)                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. llm-bot (MCP Client)                                         │
│    Receives: Tool list via tools/list RPC                       │
│    Tool definitions without inputSchema                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. AI SDK Tool Registration                                     │
│    llm-bot registers tools with OpenAI/Anthropic                │
│    Uses: jsonSchema() helper from AI SDK                        │
│    Result: LLM sees tools without schemas                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. LLM Decision                                                 │
│    Without schema: Sends empty args {}                          │
│    With schema: Sends proper args {prompt: "..."}               │
└─────────────────────────────────────────────────────────────────┘
```

### Key Systems

**1. PostgreSQL Storage**:
- **Format**: JSON Schema (OpenAPI/JSON Schema Draft 2020-12)
- **Location**: `platform_tool_registry.data.inputSchema.jsonSchema`
- **Example**: Standard JSON Schema with `type`, `properties`, `required`

**2. MCP SDK v2 (tool-orchestrator)**:
- **API**: `server.registerTool(name, { inputSchema }, handler)`
- **Requires**: Zod schemas (`z.object({...})`) or raw Zod shapes
- **Rejects**: AI SDK JSON Schema wrappers, plain JSON Schema objects

**3. AI SDK (llm-bot)**:
- **API**: Tool registration with OpenAI/Anthropic
- **Helper**: `jsonSchema()` to wrap JSON Schema for LLM providers
- **Compatible**: Works with plain JSON Schema objects

---

## Failed Approach: Direct jsonSchema() Usage

### What Was Tried (Commit 70ea81de)

```typescript
import { jsonSchema } from 'ai';

// Extract schema from database
const schemaData = (tool.inputSchema as any).jsonSchema || tool.inputSchema;

// Attempt to use jsonSchema() helper
inputSchemaForRegistration = jsonSchema(schemaData);

// Register with MCP server
server.registerTool(sanitizedToolName, {
  description: tool.description,
  inputSchema: inputSchemaForRegistration,  // ❌ FAILED
}, handler);
```

### Why It Failed

**Type Mismatch**:
```typescript
// MCP SDK v2 expects:
type InputSchema = ZodSchema | RawZodShape;

// jsonSchema() returns:
type JsonSchemaWrapper = {
  type: 'json-schema',
  jsonSchema: JSONSchema7
}

// Result: TypeError at registration
Error: inputSchema must be a Standard Schema (e.g. z.object({...}))
```

**Fundamental Issue**: `jsonSchema()` is designed for the **AI SDK** (Vercel AI SDK), not for the **MCP SDK v2**. These are different APIs with incompatible type systems.

### Evidence of Failure

```json
{
  "msg": "mcp_server.tool_registration_failed",
  "tool": "mcp:claim-check/bit.readiness",
  "error": "inputSchema/outputSchema/argsSchema must be a Standard Schema..."
}

{
  "msg": "mcp.client_manager.connect_error",
  "error": {
    "status": 500,
    "statusText": "Internal Server Error"
  }
}
```

**Impact**: Crashed tool-orchestrator, llm-bot unable to connect, NO tools available.

---

## Potential Solutions

### Solution 1: JSON Schema → Zod Conversion

**Approach**: Convert JSON Schema from PostgreSQL to Zod schemas at registration time.

**Implementation**:
```typescript
import { z } from 'zod';

function jsonSchemaToZod(jsonSchema: any): z.ZodTypeAny {
  if (!jsonSchema || jsonSchema.type !== 'object') {
    return z.object({});
  }

  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(jsonSchema.properties || {})) {
    const p = prop as any;

    // Convert JSON Schema types to Zod types
    let zodType: z.ZodTypeAny;
    switch (p.type) {
      case 'string':
        zodType = p.enum ? z.enum(p.enum) : z.string();
        break;
      case 'number':
        zodType = z.number();
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'array':
        zodType = z.array(jsonSchemaToZod(p.items || {}));
        break;
      case 'object':
        zodType = jsonSchemaToZod(p);
        break;
      default:
        zodType = z.any();
    }

    // Add description
    if (p.description) {
      zodType = zodType.describe(p.description);
    }

    // Handle optional/required
    if (!jsonSchema.required?.includes(key)) {
      zodType = zodType.optional();
    }

    shape[key] = zodType;
  }

  return z.object(shape);
}

// Usage in getMcpServer()
const schemaData = (tool.inputSchema as any).jsonSchema || tool.inputSchema;
const zodSchema = jsonSchemaToZod(schemaData);

server.registerTool(sanitizedToolName, {
  description: tool.description,
  inputSchema: zodSchema,
}, handler);
```

**Pros**:
- ✅ Works with MCP SDK v2 requirements
- ✅ Preserves type information
- ✅ Proper validation at MCP server level
- ✅ LLM receives complete schemas

**Cons**:
- ⚠️ Complex conversion logic (requires comprehensive type mapping)
- ⚠️ May not support all JSON Schema features (oneOf, anyOf, $ref, etc.)
- ⚠️ Maintenance burden if JSON Schema spec changes
- ⚠️ Performance overhead on every tool registration

**Complexity**: High
**Reliability**: Medium (depends on conversion completeness)
**Recommendation**: ⭐⭐⭐ Feasible but requires careful implementation

---

### Solution 2: Schema-less Registration + llm-bot Schema Injection

**Approach**: Keep MCP registration schema-less, inject schemas at llm-bot level when registering with AI SDK.

**Implementation**:

**Tool-Orchestrator** (no change):
```typescript
// Keep current schema-less registration
server.registerTool(sanitizedToolName, {
  description: tool.description,
  // No inputSchema
}, handler);
```

**llm-bot** (add schema lookup):
```typescript
// In processor.ts where tools are registered with AI SDK
async function registerToolsWithAiSdk(mcpTools: any[]) {
  const toolsWithSchemas = await Promise.all(
    mcpTools.map(async (tool) => {
      // Fetch schema from tool registry for this tool
      const toolMetadata = await toolRegistry.getTool(tool.name);

      if (toolMetadata?.inputSchema) {
        // Extract JSON Schema
        const schema = toolMetadata.inputSchema.jsonSchema || toolMetadata.inputSchema;

        // Use jsonSchema() helper from AI SDK
        return {
          ...tool,
          parameters: jsonSchema(schema),  // ✅ Works here!
        };
      }

      return tool;
    })
  );

  // Register with OpenAI/Anthropic
  return toolsWithSchemas;
}
```

**Pros**:
- ✅ No changes to MCP registration (simpler)
- ✅ Uses jsonSchema() in correct context (AI SDK)
- ✅ Direct access to PostgreSQL tool metadata
- ✅ No type conversion needed
- ✅ Easier to maintain

**Cons**:
- ⚠️ Requires llm-bot to access tool registry (new dependency)
- ⚠️ Schema lookup adds latency to tool registration
- ⚠️ Duplicate schema storage (PostgreSQL + llm-bot process)

**Complexity**: Medium
**Reliability**: High
**Recommendation**: ⭐⭐⭐⭐ Clean separation of concerns

---

### Solution 3: Store Zod Schemas in PostgreSQL

**Approach**: Store both JSON Schema (for documentation) and Zod schema strings (for execution) in PostgreSQL.

**Implementation**:

**Database Schema**:
```sql
ALTER TABLE platform_tool_registry
ADD COLUMN zod_schema TEXT;

-- Store Zod schema as stringified code
UPDATE platform_tool_registry
SET zod_schema = 'z.object({ prompt: z.string().describe("...") })'
WHERE id = 'mcp:generate_image';
```

**Tool Registration**:
```typescript
// Extract and eval Zod schema from database
const zodSchemaString = tool.zodSchema;
const zodSchema = eval(zodSchemaString);  // ⚠️ UNSAFE!

server.registerTool(sanitizedToolName, {
  description: tool.description,
  inputSchema: zodSchema,
}, handler);
```

**Pros**:
- ✅ Direct Zod schema availability
- ✅ No conversion needed

**Cons**:
- ❌ Using `eval()` is a **major security risk**
- ❌ Duplicate schema storage (JSON Schema + Zod string)
- ❌ Schema sync issues (must update both formats)
- ❌ Difficult to generate Zod strings from existing JSON Schema
- ❌ Code-as-data anti-pattern

**Complexity**: Low
**Reliability**: Very Low
**Recommendation**: ⭐ Not recommended (security risk)

---

### Solution 4: Use json-schema-to-zod Library

**Approach**: Use existing library to convert JSON Schema → Zod at runtime.

**Implementation**:
```typescript
import { jsonSchemaToZod } from 'json-schema-to-zod';

const schemaData = (tool.inputSchema as any).jsonSchema || tool.inputSchema;

// Convert JSON Schema string to Zod schema code
const zodSchemaCode = jsonSchemaToZod(JSON.stringify(schemaData));

// Eval to get actual Zod schema (⚠️ still uses eval)
const zodSchema = eval(zodSchemaCode);

server.registerTool(sanitizedToolName, {
  description: tool.description,
  inputSchema: zodSchema,
}, handler);
```

**Pros**:
- ✅ Leverages existing library
- ✅ Handles complex JSON Schema features
- ✅ Maintained by community

**Cons**:
- ⚠️ Still requires `eval()` (security concern)
- ⚠️ Library generates code strings, not runtime objects
- ⚠️ Additional dependency
- ⚠️ May not support all edge cases

**Complexity**: Medium
**Reliability**: Medium
**Recommendation**: ⭐⭐ Better than custom conversion, but eval() issue remains

---

### Solution 5: Keep Schema-less + Document Limitation

**Approach**: Accept current limitation, document it, focus on tools that don't require complex schemas.

**Implementation**:
- Keep current schema-less registration
- Document that PostgreSQL tools don't have schema validation
- Rely on upstream tool validation (at MCP server level)
- Focus on tools with simple/no parameters

**Pros**:
- ✅ Zero implementation work
- ✅ System remains stable
- ✅ Upstream validation still works

**Cons**:
- ❌ LLM sends empty arguments for tools
- ❌ Poor LLM tool calling experience
- ❌ Validation errors bubble up to user
- ❌ Not a real solution

**Complexity**: Zero
**Reliability**: Current state
**Recommendation**: ⭐ Only viable as temporary state

---

## Recommended Solution

### Primary Recommendation: **Solution 2 (Schema Injection at llm-bot)**

**Rationale**:
1. **Correct API Usage**: Uses `jsonSchema()` where it's designed to work (AI SDK)
2. **Separation of Concerns**: MCP layer handles execution, AI SDK layer handles schema
3. **No Type Conversion**: Direct use of JSON Schema (no fragile conversion)
4. **Maintainable**: Clear separation, easy to debug
5. **Performance**: One-time lookup at tool registration (not per-call)

### Implementation Plan

**Phase 1: llm-bot Schema Injection**
1. Add tool registry access to llm-bot processor
2. Implement schema lookup for MCP tools
3. Inject schemas when registering with AI SDK
4. Validate with test traces

**Phase 2: Validation**
1. Deploy to staging
2. Verify LLM receives complete schemas
3. Test tool calls include proper arguments
4. Monitor for validation errors

**Phase 3: Documentation**
1. Update CLAUDE.md with schema injection pattern
2. Document tool registration flow
3. Add troubleshooting guide

### Fallback: **Solution 1 (JSON Schema → Zod Conversion)**

If llm-bot schema injection proves difficult, implement custom JSON Schema → Zod converter:

**Minimum Viable Converter**:
```typescript
function jsonSchemaToZod(schema: any): z.ZodTypeAny {
  // Support common types: string, number, boolean, object, array
  // Support required/optional
  // Support descriptions
  // Support enums
  // Fallback to z.any() for unsupported features
}
```

**Scope**: Cover 80% of common tool schemas, fallback gracefully for complex cases.

---

## Migration Path

### Short-term (Current)
- ✅ System operational with schema-less registration
- ✅ Tools execute successfully
- ⚠️ LLM sends empty args (validation fails at upstream)

### Medium-term (Next Sprint)
- 🔧 Implement Solution 2 (Schema Injection at llm-bot)
- 🔧 Validate with test cases
- 🔧 Deploy to staging → production

### Long-term (Future)
- 📋 Evaluate Solution 1 if needed (JSON Schema → Zod converter)
- 📋 Consider contributing to MCP SDK v2 (native JSON Schema support?)
- 📋 Standardize on single schema format across platform

---

## Testing Strategy

### Unit Tests
```typescript
describe('Schema Injection', () => {
  it('should inject JSON Schema for PostgreSQL tools', async () => {
    const mcpTools = [{ name: 'mcp_generate_image', description: '...' }];
    const toolsWithSchemas = await injectSchemasForMcpTools(mcpTools);

    expect(toolsWithSchemas[0].parameters).toBeDefined();
    expect(toolsWithSchemas[0].parameters.jsonSchema.required).toContain('prompt');
  });

  it('should handle tools without schemas', async () => {
    const mcpTools = [{ name: 'mcp_bit_info', description: '...' }];
    const toolsWithSchemas = await injectSchemasForMcpTools(mcpTools);

    expect(toolsWithSchemas[0]).toEqual(mcpTools[0]); // No change
  });
});
```

### Integration Tests
```typescript
describe('Tool Calling with Schemas', () => {
  it('should call generate_image with prompt argument', async () => {
    // Send user message: "Generate an image of a sunset"
    const event = await sendTestMessage('Generate an image of a sunset');

    // Verify LLM tool call includes arguments
    expect(event.toolCalls).toContainEqual({
      name: 'mcp_generate_image',
      arguments: { prompt: expect.stringContaining('sunset') }
    });
  });
});
```

### Staging Validation
1. Deploy schema injection to staging
2. Query tool-orchestrator tools list (verify schemas present/absent at MCP level)
3. Query llm-bot tool list (verify schemas injected)
4. Test tool calling with LLM
5. Monitor for validation errors

---

## References

### Code Locations

**PostgreSQL Tool Storage**:
- Table: `platform_tool_registry`
- Schema: `data.inputSchema.jsonSchema`

**Tool Registration (tool-orchestrator)**:
- File: `src/apps/tool-orchestrator-service.ts`
- Method: `getMcpServer()` (lines 1420-1700)
- Registration: Lines 1489-1493

**MCP Client (llm-bot)**:
- File: `src/services/llm-bot/processor.ts`
- Tool Registration: Lines 700-800 (approximate)

**Bridge Pattern (AI SDK usage)**:
- File: `src/common/mcp/bridge.ts`
- Schema Wrapping: Line 56 (`jsonSchema()` usage)

### Related Documentation

- MCP SDK v2: https://github.com/modelcontextprotocol/typescript-sdk
- AI SDK (Vercel): https://sdk.vercel.ai/docs
- JSON Schema: https://json-schema.org/
- Zod: https://zod.dev/

---

## Appendix: Type Definitions

### JSON Schema (PostgreSQL Storage)
```typescript
interface JsonSchema {
  type: string;
  properties?: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    items?: JsonSchema;
  }>;
  required?: string[];
}

interface ToolDocument {
  id: string;
  inputSchema: {
    jsonSchema: JsonSchema;
  };
  description: string;
  // ... other fields
}
```

### MCP SDK v2
```typescript
import { z } from 'zod';

interface McpToolDefinition {
  description?: string;
  inputSchema?: z.ZodTypeAny | Record<string, z.ZodTypeAny>;
}

server.registerTool(
  name: string,
  definition: McpToolDefinition,
  handler: (args: any, ctx: ServerContext) => Promise<CallToolResult>
);
```

### AI SDK (Vercel)
```typescript
import { jsonSchema } from 'ai';

interface ToolWithSchema {
  name: string;
  description: string;
  parameters: ReturnType<typeof jsonSchema>;
}

// jsonSchema() wraps JSON Schema for LLM providers
const schema = jsonSchema({
  type: 'object',
  properties: { ... },
  required: [ ... ]
});
```

---

**Document Version**: 1.0
**Author**: Claude (Sprint 65 Assistant)
**Last Updated**: 2026-11-18
**Status**: Active Issue Analysis
