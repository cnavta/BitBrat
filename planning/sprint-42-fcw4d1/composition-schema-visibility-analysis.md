# Composition Schema Visibility Analysis

**Sprint**: sprint-42-fcw4d1
**Date**: 2026-09-05
**Status**: Investigation Complete - Future Sprint Recommended
**Priority**: Medium (Functionality works, UX impacted)

---

## Executive Summary

Sprint 42 successfully fixed composition loading from the database and implemented hot-reload capability. However, during validation, we discovered that **LLMs cannot see composition input schemas** because of an impedance mismatch between MCP SDK 2.0 (requires Zod schemas) and BitBrat compositions (use JSON Schema).

**Current State**: Compositions register and execute correctly, but LLMs receive `z.any()` as the input schema, preventing them from knowing what parameters to provide.

**Recommended Action**: Dedicate a future sprint to implement JSON Schema → Zod conversion for composition tools.

---

## Problem Statement

### User-Reported Issue

**Trace**: `6f9c78c9-9751-4ac4-8dcb-dcbbcc10c21c` (staging)

User asked LLM to use the `grockle` composition tool. LLM reported:
> "While the grockle tool is visible, it does not have any input defined"

### Investigation Timeline

1. **Initial Fix (Sprint 42)**: Changed `registerCompositionTool()` to use `z.any()` instead of passing JSON Schema directly
   - **Result**: Fixed registration errors (compositions no longer crash MCP server)
   - **Side Effect**: Removed schema visibility from LLM

2. **Attempted Fix #1**: Pass JSON Schema directly via `composition.spec.inputSchema`
   - **Result**: MCP SDK silently rejected the schema (not a Zod schema)
   - **Evidence**: Tool appeared in tool-gateway logs but NOT in llm-bot's discovered tools

3. **Attempted Fix #2**: Cast JSON Schema to `any` to bypass TypeScript checking
   - **Result**: Same behavior - SDK validates schema format at runtime

4. **Root Cause Identified**: MCP SDK 2.0 requires schemas conforming to Standard Schema format (Zod, Valibot, etc.), not plain JSON Schema

---

## Root Cause Analysis

### Technical Details

**File**: `src/apps/tool-gateway.ts:1211-1224`

```typescript
private async registerCompositionTool(composition: any): Promise<void> {
  const toolId = composition.metadata.name;
  const description = composition.metadata.description || `Composition: ${toolId}`;

  try {
    // Register in ToolRegistry (uses JSON Schema - works fine)
    this.registry.registerTool({
      id: toolId,
      displayName: toolId,
      description,
      inputSchema: composition.spec.inputSchema,  // ✅ JSON Schema accepted here
      source: 'composition',
      execute: async (args: unknown, extra?: any) => {
        return await this.executeComposition(composition, args, extra);
      },
    });

    // Register via Bit MCP interface (requires Zod schema)
    this.registerTool(
      toolId,
      description,
      z.any(),  // ❌ Current workaround - no schema info for LLM
      async (args: unknown, extra?: any) => {
        return await this.executeComposition(composition, args, extra);
      }
    );
  }
}
```

**The Problem**:
- `this.registerTool()` (Bit base class) expects a Zod schema
- This calls `server.registerTool()` (MCP SDK) which validates schema format
- Compositions define schemas in JSON Schema format (not Zod)

**Why JSON Schema?**:
- Industry standard for declarative validation
- Compositions are YAML/JSON documents, not TypeScript code
- Easier for users to author without TypeScript knowledge
- Compatible with OpenAPI, AsyncAPI, and other specs

**Why Zod in MCP?**:
- TypeScript-native validation
- Type inference at compile time
- Rich ecosystem of utilities
- Standard Schema interface for interoperability

### Verification

**Evidence from logs**:

```bash
# tool-gateway registers grockle successfully
{"msg":"mcp_server.tool_registered","name":"grockle"}
{"msg":"tool_gateway.composition.registered","toolId":"grockle","version":1}

# But llm-bot only sees 18 tools from tool-gateway (grockle missing)
{"msg":"mcp.client_manager.tools_discovered","server":"tool-gateway","count":18,
 "toolNames":["bit.info","bit.health",...,"composition.list_tools"]}
# Note: "grockle" is NOT in this list

# llm-bot has 280 total tools
{"msg":"llm_bot.generate_text.start","allToolCount":280,"filteredToolCount":280}
# But none named "grockle" or "mcp_grockle"
```

**Conclusion**: Tool registration succeeds in tool-gateway but fails when llm-bot connects to tool-gateway's MCP server.

---

## Current State

### What Works

1. **Composition Loading**: Database-stored compositions load and compile correctly
2. **Hot-Reload**: CompositionWatcher detects changes every 30 seconds
3. **Tool Registration**: Compositions register in ToolRegistry (internal routing)
4. **Execution**: CompositionExecutor validates inputs against JSON Schema and runs compositions
5. **Security**: Input validation still enforced via JSON Schema in executor

### What Doesn't Work

1. **Schema Visibility**: LLMs see `z.any()` instead of actual input schema
2. **Parameter Discovery**: LLMs don't know what parameters to pass
3. **Type Hints**: No autocomplete or validation hints for LLM tool calls

### Current Workaround

**Option 1: Document parameters in description field**

```yaml
metadata:
  name: grockle
  version: 1
  description: |
    Generate an image based on a text prompt.

    Parameters:
    - prompt (string, required): Description of the image to generate
    - style (string, optional): Art style (realistic, cartoon, abstract)
    - size (string, optional): Image size (256x256, 512x512, 1024x1024)
```

**Limitations**:
- LLM must parse natural language to understand schema
- No type enforcement at LLM tool-calling layer
- Prone to parameter naming errors

**Option 2: Use `composition.list_tools` MCP tool**

LLM can call `composition.list_tools` to retrieve schema programmatically, but this requires:
- Extra LLM call before using composition
- Increased latency and token usage
- LLM must choose to make this call

---

## Attempted Solutions

### Approach 1: Pass JSON Schema Directly

**Code**:
```typescript
this.registerTool(
  toolId,
  description,
  composition.spec.inputSchema,  // Plain JSON Schema object
  handler
);
```

**Result**: MCP SDK rejected schema silently

**Error**: No error logged, but tool doesn't appear in `tools_discovered` event

**Why It Failed**: MCP SDK 2.0 validates that `inputSchema` conforms to Standard Schema interface (has `~standard` property or is a Zod schema)

---

### Approach 2: Cast to `any` to Bypass TypeScript

**Code**:
```typescript
this.registerTool(
  toolId,
  description,
  (composition.spec.inputSchema || z.any()) as any,
  handler
);
```

**Result**: Same behavior - schema still rejected

**Why It Failed**: TypeScript cast only affects compile-time checking, not runtime validation in MCP SDK

---

### Approach 3: Use Zod `.describe()` with JSON

**Code**:
```typescript
const schema = composition.spec.inputSchema
  ? z.object({}).passthrough().describe(JSON.stringify(composition.spec.inputSchema))
  : z.any();
```

**Result**: Not tested (abandoned before deployment)

**Why It Wouldn't Work**:
- `.describe()` sets schema description, not the actual validation rules
- LLM sees `z.object({}).passthrough()` schema (any object), not the JSON Schema
- Only moves the problem to a different layer

---

## Industry Research: MCP SDK 2.0 + JSON Schema

### MCP Specification Findings

**Key Discovery**: The MCP protocol **officially uses JSON Schema 2020-12** as the wire format for tool input schemas, not Zod.

**Source**: [SEP-2106: JSON Schema 2020-12 Support](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/seps/2106-json-schema-2020-12.md)

**Quote from Specification**:
> "Tools have a JSON Schema 2020-12 input schema and are invoked via tools/call. When a schema does not include a $schema field, it defaults to JSON Schema 2020-12, and implementations MUST support at least 2020-12."

**Implications**:
- BitBrat compositions already use the correct format (JSON Schema)
- The issue is NOT with our schema format choice
- The issue is with how we expose schemas to the MCP SDK

---

### Standard Schema Interface Discovery

**Key Discovery**: MCP TypeScript SDK 2.0 uses the [Standard Schema](https://standardschema.dev/) interface, which supports ANY schema library that implements it (Zod, Valibot, ArkType, or custom implementations).

**How Standard Schema Works**:

Standard Schema defines TWO separate interfaces:

1. **Standard Schema (Validation)**:
   ```typescript
   {
     "~standard": {
       version: 1,
       vendor: "library-name",
       validate: (value: unknown) => { value: T } | { issues: Issue[] }
     }
   }
   ```

2. **Standard JSON Schema (Conversion)**:
   ```typescript
   {
     "~standard": {
       jsonSchema: {
         input: (opts: { target: "draft-2020-12" }) => JSONSchema,
         output: (opts: { target: "draft-2020-12" }) => JSONSchema
       }
     }
   }
   ```

**How MCP SDK Uses This**:
1. SDK accepts any schema object with `~standard` property
2. Calls `schema["~standard"].validate()` for runtime validation
3. Calls `schema["~standard"].jsonSchema.input()` to get JSON Schema for the wire protocol
4. Sends JSON Schema to LLM clients via `tools/list` endpoint

**Source**: [Standard Schema Spec](https://standardschema.dev/) and [Standard JSON Schema](https://standardschema.dev/json-schema)

---

### Zod's Role in the Ecosystem

**Zod v4+ Integration**:
- Zod v4 implements BOTH Standard Schema and Standard JSON Schema interfaces
- Has native `z.toJSONSchema()` method for JSON Schema generation
- This is why most MCP examples use Zod (convenience, not requirement)

**The Conversion Flow**:
```
Zod Schema → Standard Schema Interface → JSON Schema (wire format)
    ↑                                          ↓
    Tool definition                      Sent to LLM
```

**Our Current Problem**:
```
JSON Schema (stored) → ??? → Standard Schema Interface → JSON Schema (wire)
    ↑                                                        ↓
    Composition                                        Sent to LLM
```

We're missing the bridge: JSON Schema → Standard Schema Interface

---

### How Other Projects Handle This

**Pattern 1: Code-First (Most Common)**:
- Tools defined in TypeScript/JavaScript using Zod
- Zod provides both validation and JSON Schema generation
- Example: Most MCP server tutorials

**Pattern 2: Schema-First (Rare - Our Use Case)**:
- Schemas stored as JSON/YAML (our approach with compositions)
- Need adapter to convert JSON Schema → Standard Schema
- **No widely-used libraries found** for this direction

**Pattern 3: Dual Schema Storage**:
- Store both Zod schema (for MCP) and JSON Schema (for docs)
- High maintenance burden, prone to drift
- Not recommended

---

### Why `json-schema-to-zod` Exists

The `json-schema-to-zod` library converts JSON Schema → Zod schema **code strings**, which then need to be evaluated to create Zod instances.

**Use Case**: Generating TypeScript validation code from OpenAPI schemas
**Our Use Case**: Runtime schema conversion for dynamic tool registration

**Limitation**: Requires `eval()` or `Function()` constructor to instantiate Zod schemas, which is a security and performance concern.

---

## Recommended Solution

### Approach: Custom Standard Schema Adapter

**Insight**: Instead of converting JSON Schema → Zod → JSON Schema (lossy round-trip), we can create a **Standard Schema wrapper** that uses JSON Schema directly.

**Advantages over `json-schema-to-zod`**:
- ✅ No lossy conversion (preserves all JSON Schema features)
- ✅ No code evaluation (`eval()` or `Function()` constructor)
- ✅ Direct use of stored schema (no transformation)
- ✅ Industry-standard validation (Ajv for JSON Schema)
- ✅ Simpler implementation
- ✅ Better performance (no conversion overhead)

---

### Architecture

```
┌─────────────────────┐
│ Composition (YAML)  │
│ - metadata          │
│ - spec.inputSchema  │ ← JSON Schema 2020-12 (already correct format!)
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│ CompositionRegistry │
│ .list()             │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│ registerComposition │
│ Tool()              │
│                     │
│ 1. Store JSON       │
│    Schema in        │
│    ToolRegistry     │ ← For routing/lookup
│                     │
│ 2. Wrap JSON Schema │
│    in Standard      │
│    Schema adapter   │ ← Creates Standard Schema interface
│                     │
│ 3. Register MCP     │
│    tool with        │
│    wrapped schema   │ ← SDK sees Standard Schema, extracts JSON Schema
└──────────┬──────────┘
           │
           ↓
    ┌─────┴─────┐
    ↓           ↓
┌────────┐  ┌────────┐
│ LLM    │  │ Exec   │
│ sees   │  │ uses   │
│ JSON   │  │ JSON   │
│ Schema │  │ Schema │
└────────┘  └────────┘
  (via MCP)  (via Ajv)
```

**Flow**:
1. Composition loaded with JSON Schema
2. JSON Schema wrapped in Standard Schema adapter (validation via Ajv, JSON Schema passthrough)
3. MCP SDK calls `adapter["~standard"].jsonSchema.input()` → returns original JSON Schema
4. LLM sees JSON Schema (no conversion, no data loss)

---

### Alternative Approach: JSON Schema → Zod Conversion

**Why Keep This Approach**: Some teams may prefer Zod-based validation throughout their stack.

**Concerns**:
- Requires code evaluation (`Function()` constructor)
- Potential for lossy conversion
- Additional dependency
- Security considerations with dynamic code execution

---

## Implementation Plan

### Phase 1: Create Standard Schema Adapter (3-5 hours)

**Tasks**:
1. Install Ajv for JSON Schema validation
   ```bash
   npm install ajv ajv-formats
   ```

2. Create `JsonSchemaStandardAdapter` class
   ```typescript
   // src/common/schemas/json-schema-standard-adapter.ts
   import Ajv, { ValidateFunction } from 'ajv';
   import addFormats from 'ajv-formats';

   export interface StandardSchemaV1 {
     readonly version: 1;
     readonly vendor: string;
     readonly validate: (value: unknown) =>
       | { value: unknown; issues?: undefined }
       | { issues: Array<{ message: string; path?: string[] }> };
   }

   export interface StandardJSONSchemaV1 {
     readonly jsonSchema: {
       input: (options?: { target?: string }) => unknown;
       output: (options?: { target?: string }) => unknown;
     };
   }

   export interface StandardSchemaWithJSON {
     readonly "~standard": StandardSchemaV1 & StandardJSONSchemaV1;
   }

   export class JsonSchemaStandardAdapter implements StandardSchemaWithJSON {
     private validator: ValidateFunction;

     constructor(
       private schema: unknown,
       private vendor: string = 'bitbrat-json-schema'
     ) {
       const ajv = new Ajv({
         strict: false,
         allErrors: true,
         verbose: true
       });
       addFormats(ajv);

       // Compile validator once at construction time
       this.validator = ajv.compile(schema);
     }

     readonly "~standard" = {
       version: 1 as const,
       vendor: this.vendor,

       validate: (value: unknown) => {
         const valid = this.validator(value);

         if (valid) {
           return { value };
         }

         // Convert Ajv errors to Standard Schema issues
         const issues = (this.validator.errors || []).map(err => ({
           message: err.message || 'Validation failed',
           path: err.instancePath?.split('/').filter(Boolean),
         }));

         return { issues };
       },

       jsonSchema: {
         // Return the original JSON Schema directly
         input: (options?: { target?: string }) => {
           // Optionally add $schema field if not present
           const schema = this.schema as any;
           if (options?.target && !schema.$schema) {
             return {
               ...schema,
               $schema: options.target === 'draft-07'
                 ? 'http://json-schema.org/draft-07/schema#'
                 : 'https://json-schema.org/draft/2020-12/schema'
             };
           }
           return this.schema;
         },

         // For compositions, input and output schemas are the same
         output: (options?: { target?: string }) => {
           return this.jsonSchema.input(options);
         }
       }
     };
   }
   ```

3. Create unit tests for adapter
   ```typescript
   // src/common/schemas/json-schema-standard-adapter.test.ts
   describe('JsonSchemaStandardAdapter', () => {
     it('validates correct input', () => {
       const schema = {
         type: 'object',
         properties: { name: { type: 'string' } },
         required: ['name']
       };

       const adapter = new JsonSchemaStandardAdapter(schema);
       const result = adapter["~standard"].validate({ name: 'Alice' });

       expect(result).toEqual({ value: { name: 'Alice' } });
     });

     it('rejects invalid input', () => {
       const schema = {
         type: 'object',
         properties: { age: { type: 'number' } }
       };

       const adapter = new JsonSchemaStandardAdapter(schema);
       const result = adapter["~standard"].validate({ age: 'not-a-number' });

       expect(result.issues).toBeDefined();
       expect(result.issues?.length).toBeGreaterThan(0);
     });

     it('returns original JSON Schema', () => {
       const schema = {
         type: 'object',
         properties: { id: { type: 'string' } }
       };

       const adapter = new JsonSchemaStandardAdapter(schema);
       const result = adapter["~standard"].jsonSchema.input();

       expect(result).toEqual(schema);
     });

     it('adds $schema field when target specified', () => {
       const schema = { type: 'object' };

       const adapter = new JsonSchemaStandardAdapter(schema);
       const result = adapter["~standard"].jsonSchema.input({
         target: 'draft-2020-12'
       });

       expect(result).toHaveProperty('$schema');
       expect((result as any).$schema).toContain('2020-12');
     });
   });
   ```

**Validation Criteria**:
- ✅ Adapter implements Standard Schema interface correctly
- ✅ Validation works for all JSON Schema features (objects, arrays, enums, nested)
- ✅ JSON Schema returned unchanged via `jsonSchema.input()`
- ✅ All tests passing

---

### Phase 2: Integrate Adapter with Tool Gateway (3-4 hours)

**Files to Modify**:

1. **`src/apps/tool-gateway.ts`** (primary changes)

```typescript
import { JsonSchemaStandardAdapter } from '../common/schemas/json-schema-standard-adapter';
import { z } from 'zod';

private wrapJsonSchemaWithAdapter(jsonSchema: any, toolId: string): any {
  if (!jsonSchema) {
    // No schema provided - use z.any() as before
    return z.any();
  }

  try {
    // Wrap JSON Schema in Standard Schema adapter
    const adapter = new JsonSchemaStandardAdapter(
      jsonSchema,
      `bitbrat-composition-${toolId}`
    );

    this.getLogger().debug('composition.schema.wrapped', {
      toolId,
      vendor: adapter["~standard"].vendor,
      hasValidation: typeof adapter["~standard"].validate === 'function',
      hasJsonSchema: typeof adapter["~standard"].jsonSchema === 'object',
    });

    return adapter;
  } catch (err: any) {
    this.getLogger().warn('composition.schema.wrap_failed', {
      toolId,
      error: err.message,
      fallback: 'z.any()',
    });

    // Fail-open: If wrapping fails, use z.any() so tool still works
    return z.any();
  }
}

private async registerCompositionTool(composition: any): Promise<void> {
  const toolId = composition.metadata.name;
  const description = composition.metadata.description || `Composition: ${toolId}`;

  try {
    // Register in ToolRegistry (keeps JSON Schema for executor)
    this.registry.registerTool({
      id: toolId,
      displayName: toolId,
      description,
      inputSchema: composition.spec.inputSchema,  // JSON Schema (unchanged)
      source: 'composition',
      execute: async (args: unknown, extra?: any) => {
        return await this.executeComposition(composition, args, extra);
      },
    });

    // Wrap JSON Schema in Standard Schema adapter for MCP registration
    const standardSchema = this.wrapJsonSchemaWithAdapter(
      composition.spec.inputSchema,
      toolId
    );

    // Register via Bit MCP interface with Standard Schema
    this.registerTool(
      toolId,
      description,
      standardSchema,  // ✅ Standard Schema adapter (exposes JSON Schema to LLM)
      async (args: unknown, extra?: any) => {
        return await this.executeComposition(composition, args, extra);
      }
    );

    this.getLogger().debug('tool_gateway.composition.registered', {
      toolId,
      version: composition.metadata.version,
      hasStandardSchema: standardSchema !== z.any(),
    });
  } catch (err) {
    this.getLogger().error('tool_gateway.composition.registration_failed', {
      toolId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

2. **`package.json`** (add dependencies)

```json
{
  "dependencies": {
    "ajv": "^8.12.0",
    "ajv-formats": "^2.1.1"
  }
}
```

3. **`src/apps/tool-gateway.test.ts`** (add integration tests)

```typescript
import { JsonSchemaStandardAdapter } from '../common/schemas/json-schema-standard-adapter';

describe('Composition Tool Registration with Standard Schema', () => {
  it('wraps JSON Schema in Standard Schema adapter', () => {
    const jsonSchema = {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        size: { type: 'number', minimum: 256, maximum: 1024 },
      },
      required: ['prompt'],
    };

    const adapter = new JsonSchemaStandardAdapter(jsonSchema);

    // Verify Standard Schema interface
    expect(adapter["~standard"]).toBeDefined();
    expect(adapter["~standard"].version).toBe(1);
    expect(adapter["~standard"].validate).toBeInstanceOf(Function);
    expect(adapter["~standard"].jsonSchema).toBeDefined();
  });

  it('validates input using JSON Schema', () => {
    const jsonSchema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    };

    const adapter = new JsonSchemaStandardAdapter(jsonSchema);

    // Valid input
    const validResult = adapter["~standard"].validate({ name: 'Alice' });
    expect(validResult).toHaveProperty('value');

    // Invalid input (missing required field)
    const invalidResult = adapter["~standard"].validate({});
    expect(invalidResult).toHaveProperty('issues');
    expect(invalidResult.issues?.length).toBeGreaterThan(0);
  });

  it('returns original JSON Schema via jsonSchema.input()', () => {
    const jsonSchema = {
      type: 'object',
      properties: { id: { type: 'string' } }
    };

    const adapter = new JsonSchemaStandardAdapter(jsonSchema);
    const result = adapter["~standard"].jsonSchema.input();

    expect(result).toEqual(jsonSchema);
  });

  it('falls back to z.any() when no schema provided', () => {
    const gateway = new ToolGateway();
    const result = gateway['wrapJsonSchemaWithAdapter'](undefined, 'test');

    expect(result).toBe(z.any());
  });
});
```

**Error Handling**:
- Wrapping failures should log warnings but NOT prevent registration
- Use `z.any()` as fallback (fail-open strategy)
- Track wrapping success rate via metrics

---

### Phase 3: Testing and Validation (2-3 hours)

**Test Cases**:

1. **Simple Schema**:
   ```yaml
   inputSchema:
     type: object
     properties:
       prompt:
         type: string
         description: Text prompt for image generation
     required:
       - prompt
   ```
   - ✅ Converts to `z.object({ prompt: z.string() })`
   - ✅ LLM sees required parameter `prompt`

2. **Complex Schema** (grockle example):
   ```yaml
   inputSchema:
     type: object
     properties:
       prompt:
         type: string
       style:
         type: string
         enum: [realistic, cartoon, abstract]
       size:
         type: string
         enum: [256x256, 512x512, 1024x1024]
         default: 512x512
     required:
       - prompt
   ```
   - ✅ Converts enums to `z.enum()`
   - ✅ Preserves default values
   - ✅ LLM sees all options

3. **Edge Cases**:
   - No input schema (undefined) → `z.any()`
   - Empty schema ({}) → `z.object({})`
   - Invalid JSON Schema → `z.any()` with warning

**Validation Steps**:

```bash
# 1. Deploy to agent-dev context
agent_dev.provision({ name: "agent-dev-schema-test" })
bit deploy tool-gateway --context agent-dev-schema-test

# 2. Register test composition with complex schema
composition.register({
  name: "test-complex-schema",
  inputSchema: { /* complex schema */ }
})

# 3. Check llm-bot sees schema
fleet.logs({ bit: "llm-bot", context: "agent-dev-schema-test" })
# Look for: "tools_discovered" with "test-complex-schema" in toolNames

# 4. Send test message
message.send({
  context: "agent-dev-schema-test",
  text: "@bitbrat_the_ai use test-complex-schema with prompt 'hello'",
  waitForResponse: true
})

# 5. Verify LLM used correct parameters
fleet.trace({ correlationId: "..." })
```

**Success Criteria**:
- ✅ LLM sees composition tools in `tools_discovered` event
- ✅ LLM correctly infers required vs optional parameters
- ✅ LLM respects enum constraints
- ✅ Composition execution validates against JSON Schema (unchanged)
- ✅ No regression in tool-gateway performance (<10ms conversion overhead)

---

### Phase 4: Deployment and Monitoring (1-2 hours)

**Rollout Plan**:
1. Deploy to `agent-dev` context first
2. Monitor adapter wrapping success rate for 24 hours
3. Deploy to `staging`
4. Monitor LLM tool call success rate and schema visibility
5. Deploy to `production` after validation

**Metrics to Track**:
- `composition.schema.wrapped` (count, by toolId)
- `composition.schema.wrap_failed` (count, by toolId, with error)
- `llm.tool_call.composition` (count, success rate)
- `mcp.tools_discovered` (verify composition tools appear)

**Monitoring Queries**:

```bash
# Adapter wrapping success rate
fleet.logs({ bit: "tool-gateway", level: ["debug", "warn"] }) \
  | grep "composition.schema" \
  | jq '.msg' \
  | sort | uniq -c

# LLM tool discovery
fleet.logs({ bit: "llm-bot", level: ["debug"] }) \
  | grep "tools_discovered" \
  | jq '.toolNames | .[] | select(. == "grockle")'

# LLM tool call patterns
fleet.logs({ bit: "llm-bot", level: ["debug"] }) \
  | grep "tool_call.*grockle" \
  | jq '{tool, args, success}'
```

---

## Alternative Approaches

### Option A: JSON Schema → Zod Conversion

**Concept**: Use `json-schema-to-zod` library to convert JSON Schema to Zod at runtime

**Library**: [`json-schema-to-zod`](https://www.npmjs.com/package/json-schema-to-zod)

**How It Works**:
```typescript
import { jsonSchemaToZod } from 'json-schema-to-zod';

// Returns Zod schema code as a STRING
const zodCode = jsonSchemaToZod(jsonSchema);
// Example output: "z.object({ prompt: z.string(), size: z.number().min(256).max(1024) })"

// Must evaluate to get actual Zod schema instance
const zodSchemaFn = new Function('z', `return ${zodCode}`);
const zodSchema = zodSchemaFn(z);
```

**Pros**:
- Existing library with 100k+ weekly downloads
- Supports most JSON Schema features
- Results in native Zod schemas (full Zod ecosystem compatibility)

**Cons**:
- ❌ Requires code evaluation (`Function()` constructor or `eval()`)
- ❌ Security concerns with dynamic code execution
- ❌ Potential for lossy conversion (JSON Schema features → Zod approximations)
- ❌ Additional build/runtime overhead
- ❌ Two-step process: JSON Schema → Zod code → Zod instance

**Verdict**: ⚠️ Viable alternative, but Standard Schema adapter is cleaner and safer

---

### Option B: Dual Schema Storage

**Concept**: Store both JSON Schema and Zod schema in composition metadata

**Pros**:
- No runtime conversion overhead
- Guaranteed schema accuracy
- Users can provide both formats

**Cons**:
- Requires users to maintain two schemas
- High chance of drift between JSON Schema and Zod
- Increases composition file size

**Verdict**: ❌ Not recommended (too much user burden)

---

### Option C: Generate Zod from TypeScript Types

**Concept**: Use TypeScript compiler API to generate Zod from types

**Pros**:
- Full type safety at compile time
- Native TypeScript integration

**Cons**:
- Compositions are YAML/JSON, not TypeScript
- Requires TypeScript knowledge from users
- Breaks declarative composition model

**Verdict**: ❌ Not recommended (incompatible with composition philosophy)

---

### Option D: Switch Compositions to Zod

**Concept**: Require compositions to define schemas in Zod format

**Pros**:
- No conversion needed
- Full MCP SDK compatibility

**Cons**:
- Breaking change (all existing compositions invalid)
- Requires users to write TypeScript/JavaScript
- Loses JSON/YAML portability

**Verdict**: ❌ Not recommended (too disruptive)

---

## Risk Assessment

### High Risk

**Risk**: Ajv validation behavior differs from Zod validation for edge cases

**Likelihood**: Low (both implement JSON Schema spec)

**Impact**: Medium (could cause validation inconsistencies)

**Mitigation**:
- Use Ajv's strict mode and enable all validators
- Test extensively with composition schemas
- Compare validation results with Zod for common patterns
- Document any behavioral differences

**Fallback**: Use `z.any()` for problematic schemas (fail-open)

---

### Medium Risk

**Risk**: Adapter creation overhead impacts performance

**Likelihood**: Low (adapter created once per composition registration)

**Impact**: Low (Ajv compilation is fast, <5ms typically)

**Mitigation**:
- Adapter compiles validator once at construction time
- No re-compilation on subsequent validations
- Monitor adapter creation duration

**Performance Target**: <5ms per adapter creation

---

### Low Risk

**Risk**: Standard Schema interface changes in future versions

**Likelihood**: Very Low (spec is stable, version 1)

**Impact**: Low (adapter would need updates)

**Mitigation**:
- Monitor Standard Schema specification changes
- Version adapter implementation
- Maintain backward compatibility

---

## Success Metrics

### Functional Metrics

- **Schema Visibility**: 100% of compositions with valid JSON Schema appear with Standard Schema in MCP
- **Wrapping Success Rate**: >99% of compositions wrap successfully (fail only on invalid JSON Schema)
- **Tool Discovery**: LLMs see all registered composition tools in `tools_discovered`
- **Validation Accuracy**: 100% match between Ajv and expected JSON Schema behavior

### Performance Metrics

- **Adapter Creation Overhead**: <5ms per composition (Ajv compilation)
- **Registration Time**: <50ms total for composition registration (including adapter creation)
- **Memory Overhead**: <50KB per registered composition (adapter + compiled validator)

### User Experience Metrics

- **LLM Tool Call Success Rate**: Increase from baseline (measure before/after)
- **Parameter Error Rate**: Decrease in LLM tool calls with invalid parameters
- **User Satisfaction**: Qualitative feedback from composition authors

---

## Testing Strategy

### Unit Tests

**File**: `src/apps/tool-gateway.test.ts`

```typescript
describe('convertJsonSchemaToZod', () => {
  it('converts string property', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } } };
    const zod = convertJsonSchemaToZod(schema, 'test');
    expect(() => zod.parse({ name: 'Alice' })).not.toThrow();
  });

  it('converts number property with constraints', () => {
    const schema = {
      type: 'object',
      properties: {
        age: { type: 'number', minimum: 0, maximum: 120 }
      }
    };
    const zod = convertJsonSchemaToZod(schema, 'test');
    expect(() => zod.parse({ age: 25 })).not.toThrow();
    expect(() => zod.parse({ age: -1 })).toThrow();
    expect(() => zod.parse({ age: 150 })).toThrow();
  });

  it('handles required fields', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    };
    const zod = convertJsonSchemaToZod(schema, 'test');
    expect(() => zod.parse({ name: 'Alice' })).not.toThrow();
    expect(() => zod.parse({})).toThrow();
  });

  it('handles enum values', () => {
    const schema = {
      type: 'object',
      properties: {
        size: { type: 'string', enum: ['small', 'medium', 'large'] }
      }
    };
    const zod = convertJsonSchemaToZod(schema, 'test');
    expect(() => zod.parse({ size: 'medium' })).not.toThrow();
    expect(() => zod.parse({ size: 'xlarge' })).toThrow();
  });

  it('handles nested objects', () => {
    const schema = {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' }
          }
        }
      }
    };
    const zod = convertJsonSchemaToZod(schema, 'test');
    expect(() => zod.parse({ config: { enabled: true } })).not.toThrow();
  });

  it('handles arrays', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } }
      }
    };
    const zod = convertJsonSchemaToZod(schema, 'test');
    expect(() => zod.parse({ tags: ['a', 'b'] })).not.toThrow();
    expect(() => zod.parse({ tags: [1, 2] })).toThrow();
  });

  it('falls back to z.any() on invalid schema', () => {
    const schema = { type: 'invalid' };
    const zod = convertJsonSchemaToZod(schema, 'test');
    expect(zod).toBe(z.any());
  });

  it('falls back to z.any() on undefined schema', () => {
    const zod = convertJsonSchemaToZod(undefined, 'test');
    expect(zod).toBe(z.any());
  });
});
```

### Integration Tests

**File**: `src/apps/tool-gateway.integration.test.ts`

```typescript
describe('Composition Tool Registration with Schema Conversion', () => {
  let toolGateway: ToolGateway;

  beforeEach(async () => {
    toolGateway = new ToolGateway();
    await toolGateway.setup();
  });

  it('registers composition with converted schema', async () => {
    const composition = {
      metadata: {
        name: 'test-comp',
        version: 1,
        description: 'Test composition',
      },
      spec: {
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
          required: ['message'],
        },
        steps: [],
      },
    };

    await toolGateway.registerCompositionTool(composition);

    // Verify tool appears in MCP server
    const mcpServer = toolGateway.getMcpServer();
    const tools = await mcpServer.listTools();

    const testComp = tools.find(t => t.name === 'test-comp');
    expect(testComp).toBeDefined();
    expect(testComp.inputSchema).toBeDefined();
    expect(testComp.inputSchema).not.toBe(z.any());
  });

  it('handles composition without input schema', async () => {
    const composition = {
      metadata: { name: 'no-schema', version: 1 },
      spec: { steps: [] },
    };

    await toolGateway.registerCompositionTool(composition);

    const mcpServer = toolGateway.getMcpServer();
    const tools = await mcpServer.listTools();

    const noSchema = tools.find(t => t.name === 'no-schema');
    expect(noSchema).toBeDefined();
    expect(noSchema.inputSchema).toBe(z.any());
  });
});
```

### End-to-End Tests

**Scenario**: LLM discovers and uses composition with schema

```typescript
describe('LLM Composition Usage E2E', () => {
  it('allows LLM to see and use composition schema', async () => {
    // 1. Register composition with schema
    const grockle = {
      metadata: {
        name: 'grockle',
        version: 1,
        description: 'Generate an image',
      },
      spec: {
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Image prompt' },
            style: { type: 'string', enum: ['realistic', 'cartoon'] },
          },
          required: ['prompt'],
        },
        steps: [/* ... */],
      },
    };

    await compositionRegistry.save(grockle);
    await sleep(31000); // Wait for watcher poll

    // 2. Send message asking LLM to use grockle
    const result = await messageSend({
      context: 'staging',
      text: '@bitbrat_the_ai generate an image of a sunset using grockle',
      waitForResponse: true,
    });

    // 3. Verify LLM called grockle with correct parameters
    const trace = await fleetTrace({ correlationId: result.correlationId });

    const llmBotLogs = trace.filter(e => e.service === 'llm-bot');
    const toolCalls = llmBotLogs.filter(e => e.msg.includes('tool_call'));

    expect(toolCalls).toContainEqual(
      expect.objectContaining({
        msg: 'llm_bot.tool_call',
        tool: 'grockle',
        args: expect.objectContaining({
          prompt: expect.any(String),
        }),
      })
    );
  });
});
```

---

## Documentation Updates

### Files to Update

1. **`documentation/guides/compositions.md`**
   - Add section on input schema format
   - Explain JSON Schema → Zod conversion
   - Document supported JSON Schema features
   - Provide examples

2. **`documentation/reference/composition-schema.md`** (new file)
   - JSON Schema reference for compositions
   - Supported types and keywords
   - Examples for common patterns
   - Limitations and workarounds

3. **`CHANGELOG.md`**
   - Entry for schema visibility improvement
   - Breaking changes (if any)
   - Migration guide

---

## Open Questions

1. **Caching Strategy**: Should we cache converted Zod schemas?
   - **Pro**: Faster repeated registrations
   - **Con**: Memory overhead, cache invalidation complexity
   - **Recommendation**: Cache in memory, invalidate on composition update

2. **Error Reporting**: How should we surface conversion errors to users?
   - **Option A**: Log warnings, continue with `z.any()`
   - **Option B**: Reject composition registration
   - **Recommendation**: Option A (fail-open)

3. **Schema Evolution**: How do we handle JSON Schema version differences?
   - JSON Schema has multiple versions (draft-04, draft-07, 2019-09, 2020-12)
   - **Recommendation**: Document supported version, test with all versions

4. **Performance Optimization**: Should conversion happen at registration or runtime?
   - **Registration**: One-time cost, faster MCP server creation
   - **Runtime**: Deferred cost, slower MCP server creation
   - **Recommendation**: Registration time (current approach)

---

## Timeline Estimate

**Total**: 8-12 hours (1-1.5 days)

| Phase | Tasks | Estimate |
|-------|-------|----------|
| Phase 1: Adapter Creation | Create JsonSchemaStandardAdapter, unit tests | 3-5 hours |
| Phase 2: Integration | Integrate with tool-gateway, error handling | 3-4 hours |
| Phase 3: Testing | Integration, E2E tests, validation | 2-3 hours |
| Phase 4: Deployment | Rollout, monitoring, docs | 1-2 hours |

**Dependencies**:
- None (standalone work)

**Blockers**:
- None identified

---

## Acceptance Criteria

### Definition of Done

- ✅ `JsonSchemaStandardAdapter` implemented in `src/common/schemas/`
- ✅ All unit tests passing for adapter (>95% code coverage)
- ✅ Tool gateway integration complete with adapter wrapping
- ✅ Integration tests verify MCP registration with Standard Schema
- ✅ E2E test confirms LLM can discover and use composition schema
- ✅ Deployed to agent-dev and validated with grockle composition
- ✅ Deployed to staging with 24-hour monitoring period
- ✅ Documentation updated (guides + reference)
- ✅ No regression in existing composition functionality

### Success Criteria

**Primary**:
- LLMs see composition input schemas in `tools_discovered` event
- Wrapping success rate >99% for all registered compositions
- Grockle appears in llm-bot's discovered tools with full parameter schema

**Secondary**:
- Adapter creation overhead <5ms per composition
- Zero crashes or errors related to schema wrapping
- Validation behavior matches JSON Schema specification
- User feedback positive (if available)

---

## References

### Specifications

- **MCP Specification**: https://modelcontextprotocol.io/specification/
  - SEP-2106 (JSON Schema 2020-12): https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/seps/2106-json-schema-2020-12.md
  - Official MCP protocol documentation

- **Standard Schema**: https://standardschema.dev/
  - Standard Schema interface specification
  - Standard JSON Schema extension: https://standardschema.dev/json-schema
  - Implementation examples: https://github.com/standard-schema/standard-schema

### Libraries

- **Ajv (Another JSON Schema Validator)**: https://ajv.js.org/
  - Industry-standard JSON Schema validator
  - Supports JSON Schema draft-07, 2019-09, 2020-12
  - Fast compilation and validation
  - 12M+ weekly downloads

- **ajv-formats**: https://www.npmjs.com/package/ajv-formats
  - Format validation for Ajv (date, time, email, etc.)
  - Required for full JSON Schema spec compliance

- **@modelcontextprotocol/sdk**: https://www.npmjs.com/package/@modelcontextprotocol/sdk
  - MCP TypeScript SDK 2.0
  - Standard Schema support
  - Migration guide: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md

### Related Issues

- **Sprint 42**: Composition loading from database (completed)
- **Sprint 41**: Composition execution infrastructure (completed)

### Related Documents

- `planning/sprint-42-fcw4d1/implementation-plan.md`
- `planning/sprint-42-fcw4d1/key-learnings.md`
- `planning/sprint-42-fcw4d1/retro.md`

---

## Executive Summary: Research Findings

### Key Discoveries

1. **MCP Protocol Uses JSON Schema Natively**
   - The official MCP specification requires JSON Schema 2020-12 for tool input schemas
   - BitBrat compositions already use the correct format
   - The problem is NOT with our schema format choice

2. **Standard Schema Interface is the Bridge**
   - MCP SDK 2.0 uses Standard Schema interface (not Zod specifically)
   - Zod v4 is popular because it implements BOTH Standard Schema AND Standard JSON Schema
   - Any schema library (or custom adapter) can work if it implements the interface

3. **Two Approaches Identified**
   - **Option A**: Convert JSON Schema → Zod at runtime (requires `eval()`, security concern)
   - **Option B**: Wrap JSON Schema in Standard Schema adapter (cleaner, safer, recommended)

4. **Recommended Solution: Standard Schema Adapter**
   - Create `JsonSchemaStandardAdapter` class that implements Standard Schema interface
   - Use Ajv for JSON Schema validation (industry standard, 12M+ downloads/week)
   - Return original JSON Schema via `jsonSchema.input()` (no conversion, no data loss)
   - Simpler, safer, and more maintainable than conversion approach

5. **No Widely-Used Solutions Found**
   - Most MCP servers define tools in code using Zod (code-first approach)
   - BitBrat's schema-first approach (compositions in database) is uncommon
   - We need to build our own adapter, but the pattern is well-documented

### Why This Matters

**Current State**: LLMs can't see composition input schemas because we're using `z.any()` workaround.

**After Implementation**: LLMs will see full JSON Schema for compositions, enabling:
- ✅ Proper parameter discovery
- ✅ Type-aware tool calls
- ✅ Better LLM reasoning about composition capabilities
- ✅ Reduced parameter errors

**Effort**: 8-12 hours (1-1.5 days) - relatively small effort for significant UX improvement.

---

**Document Version**: 2.0
**Last Updated**: 2026-09-05
**Author**: Claude (Sprint 42 Implementor)
**Research Date**: 2026-09-05
**Next Review**: Before future sprint kickoff
