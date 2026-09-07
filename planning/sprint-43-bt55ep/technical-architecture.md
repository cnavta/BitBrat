# Technical Architecture: Composition Schema Visibility Fix

**Sprint**: sprint-42-fcw4d1
**Date**: 2026-09-05
**Author**: Architect
**Status**: Draft
**Priority**: Medium (Functionality works, UX impacted)

---

## Executive Summary

This document provides architectural guidance for implementing composition schema visibility in BitBrat's MCP tool ecosystem. The solution wraps JSON Schema in a Standard Schema adapter to expose composition input schemas to LLMs without requiring lossy conversion or code evaluation.

**Core Decision**: Implement `JsonSchemaStandardAdapter` as a bridge between BitBrat's declarative JSON Schema compositions and MCP SDK 2.0's Standard Schema interface.

**Impact Scope**:
- **Services**: `tool-gateway` (primary), `llm-bot` (validation)
- **Bits**: Any Bit registering dynamic tools from declarative schemas
- **Categories**: Platform (core infrastructure)

---

## 1. Architectural Context

### 1.1 BitBrat's Schema Philosophy

BitBrat follows a **declarative-first** approach to tool composition:

```yaml
# Compositions are YAML/JSON documents (not TypeScript code)
metadata:
  name: grockle
  version: 1
  description: Generate images from text prompts

spec:
  inputSchema:              # ← JSON Schema (industry standard)
    type: object
    properties:
      prompt:
        type: string
        description: Image prompt
      style:
        type: string
        enum: [realistic, cartoon, abstract]
    required: [prompt]

  steps:
    - tool: openai.images.generate
      args:
        prompt: "{{input.prompt}}"
        style: "{{input.style}}"
```

**Design Principles**:
1. **Accessibility**: Non-TypeScript users can author compositions
2. **Portability**: Compositions stored in database, version-controlled
3. **Industry Standards**: JSON Schema is universally understood
4. **Runtime Flexibility**: Hot-reload without code changes

### 1.2 MCP SDK 2.0 Requirements

MCP SDK 2.0 uses **Standard Schema** interface for tool registration:

```typescript
interface StandardSchemaWithJSON {
  "~standard": {
    version: 1;
    vendor: string;
    validate: (value: unknown) => { value: unknown } | { issues: Issue[] };
    jsonSchema: {
      input: (opts?: { target?: string }) => JSONSchema;
      output: (opts?: { target?: string }) => JSONSchema;
    };
  };
}
```

**Key Insight**: MCP protocol uses JSON Schema 2020-12 as the **wire format**. Zod is popular because it implements the Standard Schema interface, not because it's required. Any schema library (or custom adapter) can work.

### 1.3 The Impedance Mismatch

```
┌─────────────────────────────────────────────────────────────┐
│                    Current State (Sprint 42)                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Composition (DB)         Tool Gateway         MCP SDK      │
│  ┌──────────────┐        ┌────────────┐      ┌─────────┐   │
│  │ JSON Schema  │───────▶│ z.any()    │─────▶│ No Info │   │
│  │ (correct!)   │        │ (workaround)│      │ for LLM │   │
│  └──────────────┘        └────────────┘      └─────────┘   │
│                                                              │
│  Problem: LLM receives z.any(), loses parameter visibility  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Target State (This Sprint)                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Composition (DB)         Tool Gateway            MCP SDK   │
│  ┌──────────────┐        ┌────────────────┐    ┌─────────┐ │
│  │ JSON Schema  │───────▶│ Standard       │───▶│ JSON    │ │
│  │              │        │ Schema Adapter │    │ Schema  │ │
│  │              │        │ (wraps JSON    │    │ for LLM │ │
│  │              │        │  Schema + Ajv) │    │         │ │
│  └──────────────┘        └────────────────┘    └─────────┘ │
│                                                              │
│  Solution: Adapter implements Standard Schema interface     │
│           SDK calls .jsonSchema.input() → original schema   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Architectural Decision Records (ADRs)

### ADR-001: Use Standard Schema Adapter (Not Conversion)

**Status**: Recommended
**Date**: 2026-09-05

**Context**:
- Need to expose JSON Schema to MCP SDK 2.0
- Two approaches: (1) Convert JSON Schema → Zod, (2) Wrap JSON Schema in Standard Schema

**Decision**: Implement `JsonSchemaStandardAdapter` using Ajv for validation

**Rationale**:
- ✅ **No Lossy Conversion**: Preserves all JSON Schema features (conditionals, references, format validators)
- ✅ **No Code Evaluation**: Avoids `eval()` or `Function()` constructor (security risk)
- ✅ **Performance**: One-time Ajv compilation at registration, not per-validation
- ✅ **Industry Standard**: Ajv has 12M+ downloads/week, mature and battle-tested
- ✅ **Protocol Alignment**: MCP spec requires JSON Schema 2020-12 (we already have it)
- ✅ **Maintainability**: Single source of truth (stored JSON Schema)

**Alternatives Considered**:
1. **JSON Schema → Zod conversion**: Requires `eval()`, lossy, complex
2. **Dual schema storage**: High maintenance burden, schema drift risk
3. **Switch to Zod schemas**: Breaking change, requires TypeScript knowledge

**Consequences**:
- Need to add Ajv dependency (`ajv`, `ajv-formats`)
- Create new abstraction (`JsonSchemaStandardAdapter`)
- Slight memory overhead per composition (~50KB per adapter + compiled validator)

---

### ADR-002: Fail-Open Strategy for Adapter Creation

**Status**: Recommended
**Date**: 2026-09-05

**Context**:
- Adapter creation might fail (invalid JSON Schema, Ajv errors)
- Must decide: reject composition or degrade gracefully

**Decision**: Fail-open with fallback to `z.any()`

**Rationale**:
- ✅ **Availability**: Compositions remain executable even with schema errors
- ✅ **Backward Compatibility**: Existing behavior preserved (z.any() is current state)
- ✅ **Observability**: Log warnings for failed wrapping, track metrics
- ✅ **User Experience**: Better to have working tool with no schema than broken tool

**Implementation**:
```typescript
try {
  const adapter = new JsonSchemaStandardAdapter(schema, vendor);
  return adapter;
} catch (err) {
  logger.warn('composition.schema.wrap_failed', { toolId, error: err.message });
  return z.any(); // Fail-open fallback
}
```

**Monitoring**:
- Track `composition.schema.wrapped` (success count)
- Track `composition.schema.wrap_failed` (failure count + error types)
- Alert if failure rate >5%

---

### ADR-003: Validation Layer Separation

**Status**: Recommended
**Date**: 2026-09-05

**Context**:
- Compositions currently validated by CompositionExecutor using JSON Schema
- MCP SDK needs validation via Standard Schema interface
- Risk of validation inconsistency

**Decision**: Keep validation in both layers with different purposes

**Rationale**:

**Layer 1: MCP SDK (Standard Schema Adapter)**
- Purpose: **Type Discovery** for LLMs
- Validates: Tool call arguments from LLM
- Timing: Before composition execution
- Error handling: Return MCP error response to LLM

**Layer 2: CompositionExecutor (Ajv)**
- Purpose: **Security Boundary** for composition execution
- Validates: Final args after variable substitution
- Timing: Inside composition execution
- Error handling: Return error to routing slip

**Benefits**:
- ✅ **Defense in Depth**: Two validation checkpoints
- ✅ **Clear Separation**: MCP concerns vs execution concerns
- ✅ **Backward Compatibility**: CompositionExecutor behavior unchanged

**Risk Mitigation**:
- Both layers use Ajv (same validator, same behavior)
- Shared schema source (composition.spec.inputSchema)
- Integration tests verify consistency

---

### ADR-004: Adapter as Shared Infrastructure

**Status**: Recommended
**Date**: 2026-09-05

**Context**:
- Adapter useful beyond tool-gateway (any Bit registering dynamic tools)
- Future use cases: event schemas, webhook schemas, config schemas

**Decision**: Place adapter in `src/common/schemas/` as platform infrastructure

**Rationale**:
- ✅ **Reusability**: Available to all Bits
- ✅ **Discoverability**: Standard location for schema utilities
- ✅ **Testing**: Comprehensive unit tests independent of tool-gateway
- ✅ **Future-Proof**: Supports schema-first patterns across platform

**File Structure**:
```
src/common/schemas/
  ├── json-schema-standard-adapter.ts       # Adapter implementation
  ├── json-schema-standard-adapter.test.ts  # Unit tests (>95% coverage)
  └── index.ts                               # Public exports
```

**Public API**:
```typescript
// Clean, minimal API surface
export class JsonSchemaStandardAdapter implements StandardSchemaWithJSON {
  constructor(schema: unknown, vendor?: string);
  readonly "~standard": StandardSchemaV1 & StandardJSONSchemaV1;
}

export interface StandardSchemaV1 { /* ... */ }
export interface StandardJSONSchemaV1 { /* ... */ }
```

---

## 3. System Architecture

### 3.1 Component Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                        Tool Gateway (Bit)                       │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ CompositionWatcher (existing)                            │ │
│  │ - Polls database every 30s                               │ │
│  │ - Detects composition changes                            │ │
│  │ - Triggers reload                                        │ │
│  └───────────────────────┬──────────────────────────────────┘ │
│                          │                                     │
│                          ↓                                     │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ registerCompositionTool() (MODIFIED)                     │ │
│  │                                                          │ │
│  │  1. Register in ToolRegistry (JSON Schema)              │ │
│  │     └─→ For internal routing/execution                  │ │
│  │                                                          │ │
│  │  2. Wrap JSON Schema (NEW)                              │ │
│  │     ├─→ JsonSchemaStandardAdapter.new(schema, vendor)   │ │
│  │     └─→ Fail-open: z.any() on errors                    │ │
│  │                                                          │ │
│  │  3. Register MCP Tool (MODIFIED)                        │ │
│  │     └─→ this.registerTool(id, desc, adapter, handler)   │ │
│  └───────────────────────┬──────────────────────────────────┘ │
│                          │                                     │
│                          ↓                                     │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Bit.registerTool() → MCP Server                          │ │
│  │ - SDK validates Standard Schema interface                │ │
│  │ - Calls adapter["~standard"].jsonSchema.input()          │ │
│  │ - Exposes JSON Schema to MCP clients                     │ │
│  └───────────────────────┬──────────────────────────────────┘ │
│                          │                                     │
└──────────────────────────┼─────────────────────────────────────┘
                           │
                           │ MCP Protocol (JSON Schema 2020-12)
                           │
                           ↓
┌────────────────────────────────────────────────────────────────┐
│                       LLM Bot (Bit)                             │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ MCP Client Manager                                       │ │
│  │ - Connects to tool-gateway MCP server                    │ │
│  │ - Discovers tools via tools/list                         │ │
│  │ - Receives JSON Schema for each tool                     │ │
│  └───────────────────────┬──────────────────────────────────┘ │
│                          │                                     │
│                          ↓                                     │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ LLM Tool Discovery                                       │ │
│  │ - Sees "grockle" with full parameter schema              │ │
│  │ - Knows prompt (required), style (optional, enum)        │ │
│  │ - Can make informed tool calls                           │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Composition Storage (PostgreSQL)                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   compositions                                                   │
│   ┌──────────────────────────────────────────────────────────┐ │
│   │ name: grockle                                            │ │
│   │ version: 1                                               │ │
│   │ spec: {                                                  │ │
│   │   inputSchema: {                                         │ │
│   │     type: "object",                                      │ │
│   │     properties: {                                        │ │
│   │       prompt: { type: "string" },                        │ │
│   │       style: { type: "string", enum: [...] }             │ │
│   │     },                                                   │ │
│   │     required: ["prompt"]                                 │ │
│   │   }                                                      │ │
│   │ }                                                        │ │
│   └──────────────────────────────────────────────────────────┘ │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         │ CompositionWatcher polls (30s interval)
                         │
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. Tool Gateway Registration (MODIFIED)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   const jsonSchema = composition.spec.inputSchema;              │
│                                                                  │
│   // Create Standard Schema adapter                             │
│   const adapter = new JsonSchemaStandardAdapter(                │
│     jsonSchema,                                                 │
│     `bitbrat-composition-${toolId}`                             │
│   );                                                            │
│                                                                  │
│   // adapter["~standard"] = {                                   │
│   //   version: 1,                                              │
│   //   vendor: "bitbrat-composition-grockle",                   │
│   //   validate: (value) => { /* Ajv validation */ },           │
│   //   jsonSchema: {                                            │
│   //     input: () => jsonSchema,  // Returns original!         │
│   //     output: () => jsonSchema                               │
│   //   }                                                        │
│   // }                                                          │
│                                                                  │
│   this.registerTool("grockle", desc, adapter, handler);         │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         │ MCP Server exposes tools
                         │
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. MCP Protocol (tools/list)                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   SDK calls: adapter["~standard"].jsonSchema.input()            │
│                                                                  │
│   Returns:                                                      │
│   {                                                             │
│     name: "grockle",                                            │
│     description: "Generate images from text prompts",           │
│     inputSchema: {           // ← Original JSON Schema!         │
│       type: "object",                                           │
│       properties: {                                             │
│         prompt: { type: "string" },                             │
│         style: {                                                │
│           type: "string",                                       │
│           enum: ["realistic", "cartoon", "abstract"]            │
│         }                                                       │
│       },                                                        │
│       required: ["prompt"]                                      │
│     }                                                           │
│   }                                                             │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         │ LLM receives full schema
                         │
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. LLM Tool Call                                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   LLM generates tool call:                                      │
│   {                                                             │
│     name: "grockle",                                            │
│     arguments: {                                                │
│       prompt: "sunset over mountains",                          │
│       style: "realistic"                                        │
│     }                                                           │
│   }                                                             │
│                                                                  │
│   ✅ LLM knows prompt is required                               │
│   ✅ LLM knows style is optional                                │
│   ✅ LLM knows valid enum values for style                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Implementation Strategy

### 4.1 Phased Rollout

**Phase 1: Foundation (Hours 1-5)**
- Create `JsonSchemaStandardAdapter` in `src/common/schemas/`
- Implement Standard Schema interface with Ajv
- Write comprehensive unit tests (>95% coverage)
- Verify adapter works with MCP SDK standalone

**Phase 2: Integration (Hours 6-9)**
- Modify `tool-gateway.ts` to use adapter
- Add `wrapJsonSchemaWithAdapter()` helper
- Update `registerCompositionTool()` logic
- Add integration tests

**Phase 3: Validation (Hours 10-12)**
- Deploy to agent-dev context
- Test with grockle composition
- Verify LLM sees schema in `tools_discovered`
- End-to-end validation with real LLM calls

**Phase 4: Production (Hours 13-15)**
- Deploy to staging
- Monitor for 24 hours
- Deploy to production
- Update documentation

### 4.2 Testing Strategy

**Unit Tests** (`json-schema-standard-adapter.test.ts`):
```typescript
describe('JsonSchemaStandardAdapter', () => {
  describe('Standard Schema Interface', () => {
    test('implements version 1', () => { /* ... */ });
    test('has vendor string', () => { /* ... */ });
    test('has validate function', () => { /* ... */ });
    test('has jsonSchema methods', () => { /* ... */ });
  });

  describe('Validation (Ajv)', () => {
    test('validates valid input', () => { /* ... */ });
    test('rejects invalid input with issues', () => { /* ... */ });
    test('handles required fields', () => { /* ... */ });
    test('handles enums', () => { /* ... */ });
    test('handles nested objects', () => { /* ... */ });
    test('handles arrays', () => { /* ... */ });
    test('handles format validators (email, date, etc.)', () => { /* ... */ });
  });

  describe('JSON Schema Passthrough', () => {
    test('returns original schema via input()', () => { /* ... */ });
    test('returns original schema via output()', () => { /* ... */ });
    test('adds $schema field when target specified', () => { /* ... */ });
  });

  describe('Error Handling', () => {
    test('throws on invalid JSON Schema', () => { /* ... */ });
    test('handles empty schema', () => { /* ... */ });
    test('handles null/undefined schema', () => { /* ... */ });
  });
});
```

**Integration Tests** (`tool-gateway.test.ts`):
```typescript
describe('Composition Tool Registration with Standard Schema', () => {
  test('wraps JSON Schema in adapter', () => { /* ... */ });
  test('adapter appears in MCP server tools', () => { /* ... */ });
  test('MCP SDK extracts JSON Schema correctly', () => { /* ... */ });
  test('fails open to z.any() on adapter errors', () => { /* ... */ });
  test('logs success metrics', () => { /* ... */ });
  test('logs failure metrics', () => { /* ... */ });
});
```

**End-to-End Tests** (agent-dev validation):
```bash
# 1. Provision agent-dev context
agent_dev.provision({ name: "agent-dev-schema-test" })

# 2. Deploy tool-gateway
bit deploy tool-gateway --context agent-dev-schema-test

# 3. Register test composition
composition.register({
  name: "test-schema-visibility",
  spec: {
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Test message" },
        count: { type: "number", minimum: 1, maximum: 10 }
      },
      required: ["message"]
    },
    steps: [{ tool: "echo", args: { text: "{{input.message}}" } }]
  }
})

# 4. Check llm-bot discovers tool
fleet.logs({ bit: "llm-bot", context: "agent-dev-schema-test" })
# Expected: tools_discovered includes "test-schema-visibility"

# 5. Send test message
message.send({
  context: "agent-dev-schema-test",
  text: "@bitbrat use test-schema-visibility",
  waitForResponse: true
})

# 6. Verify LLM used correct parameters
fleet.trace({ correlationId: "..." })
# Expected: LLM called tool with message (required) and optional count

# 7. Clean up
agent_dev.destroy({ name: "agent-dev-schema-test", confirm: true })
```

### 4.3 Monitoring & Observability

**Key Metrics**:

| Metric | Type | Purpose | Alert Threshold |
|--------|------|---------|----------------|
| `composition.schema.wrapped` | Counter | Successful adapter creations | N/A (baseline) |
| `composition.schema.wrap_failed` | Counter | Failed adapter creations | >5% of total |
| `composition.schema.wrap_duration_ms` | Histogram | Adapter creation latency | P95 >10ms |
| `llm.tool_call.composition` | Counter | Composition tool usage | Decrease >20% |
| `llm.tool_call.composition.error` | Counter | Composition execution errors | Increase >10% |

**Log Events**:
```typescript
// Success
logger.debug('composition.schema.wrapped', {
  toolId: 'grockle',
  vendor: 'bitbrat-composition-grockle',
  hasValidation: true,
  hasJsonSchema: true,
  durationMs: 3.2
});

// Failure
logger.warn('composition.schema.wrap_failed', {
  toolId: 'broken-comp',
  error: 'Invalid JSON Schema: missing type field',
  fallback: 'z.any()',
  schema: { /* redacted for size */ }
});
```

**Dashboards** (monitoring queries):
```bash
# Adapter success rate
fleet.logs({ bit: "tool-gateway", level: ["debug", "warn"] })
  | grep "composition.schema"
  | jq -s 'group_by(.msg) | map({event: .[0].msg, count: length})'

# LLM tool discovery (verify compositions appear)
fleet.logs({ bit: "llm-bot", level: ["debug"] })
  | grep "tools_discovered"
  | jq '.toolNames | map(select(startswith("mcp_"))) | length'

# Tool call patterns (verify no increase in errors)
fleet.logs({ bit: "tool-gateway", level: ["error"] })
  | grep "composition.execution"
  | jq -s 'group_by(.toolId) | map({tool: .[0].toolId, errors: length})'
```

---

## 5. Platform Integration Points

### 5.1 Bit Base Class (No Changes Required)

`src/common/base-server.ts` already provides `registerTool()` method:

```typescript
protected registerTool<TInput = unknown, TOutput = unknown>(
  name: string,
  description: string,
  inputSchema: z.ZodType<TInput> | any,  // ← Accepts "any" (Standard Schema)
  handler: ToolHandler<TInput, TOutput>
): void {
  this.server.registerTool({ name, description, inputSchema }, handler);
}
```

**Key Insight**: The `| any` type already allows Standard Schema adapters. No base class changes needed.

### 5.2 Tool Gateway (Primary Changes)

**File**: `src/apps/tool-gateway.ts`

**Modified Methods**:
1. `registerCompositionTool()` - Add adapter wrapping logic
2. Add new helper: `wrapJsonSchemaWithAdapter()`

**Unchanged Methods**:
- `executeComposition()` - Still uses JSON Schema validation
- `setup()` - No changes to initialization
- `onMessage()` handlers - No changes

**Integration Pattern**:
```typescript
private async registerCompositionTool(composition: any): Promise<void> {
  const toolId = composition.metadata.name;
  const description = composition.metadata.description || `Composition: ${toolId}`;
  const jsonSchema = composition.spec.inputSchema;

  try {
    // 1. Register in ToolRegistry (unchanged - uses JSON Schema)
    this.registry.registerTool({
      id: toolId,
      displayName: toolId,
      description,
      inputSchema: jsonSchema,  // ← JSON Schema (for executor)
      source: 'composition',
      execute: async (args: unknown, extra?: any) => {
        return await this.executeComposition(composition, args, extra);
      },
    });

    // 2. Wrap JSON Schema for MCP registration (NEW)
    const standardSchema = this.wrapJsonSchemaWithAdapter(jsonSchema, toolId);

    // 3. Register via Bit MCP interface (modified - uses adapter)
    this.registerTool(
      toolId,
      description,
      standardSchema,  // ← Standard Schema adapter (for LLM)
      async (args: unknown, extra?: any) => {
        return await this.executeComposition(composition, args, extra);
      }
    );

    this.logger.debug('tool_gateway.composition.registered', {
      toolId,
      version: composition.metadata.version,
      hasStandardSchema: standardSchema !== z.any(),
    });
  } catch (err) {
    this.logger.error('tool_gateway.composition.registration_failed', {
      toolId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

private wrapJsonSchemaWithAdapter(
  jsonSchema: any,
  toolId: string
): any {
  if (!jsonSchema) {
    return z.any(); // No schema provided
  }

  try {
    const adapter = new JsonSchemaStandardAdapter(
      jsonSchema,
      `bitbrat-composition-${toolId}`
    );

    this.logger.debug('composition.schema.wrapped', {
      toolId,
      vendor: adapter["~standard"].vendor,
      hasValidation: typeof adapter["~standard"].validate === 'function',
      hasJsonSchema: typeof adapter["~standard"].jsonSchema === 'object',
    });

    return adapter;
  } catch (err: any) {
    this.logger.warn('composition.schema.wrap_failed', {
      toolId,
      error: err.message,
      fallback: 'z.any()',
    });

    return z.any(); // Fail-open fallback
  }
}
```

### 5.3 LLM Bot (Validation Only)

**File**: `src/apps/llm-bot-service.ts`

**No Code Changes Required**. Validation steps:

1. **Verify Tool Discovery**:
   - Check `tools_discovered` logs include composition tools
   - Verify tool count increases (should see grockle, etc.)

2. **Verify Schema Visibility**:
   - LLM should see parameter names, types, descriptions
   - LLM should respect required vs optional parameters

3. **Verify Tool Calls**:
   - Monitor `llm_bot.tool_call` events
   - Verify parameter accuracy increases

**Monitoring Query**:
```bash
# Before: LLM sees 280 tools, none are compositions
fleet.logs({ bit: "llm-bot" })
  | grep "tools_discovered"
  | jq '.toolNames | map(select(startswith("grockle")))'
# Expected: []

# After: LLM sees 280+ tools, including compositions
fleet.logs({ bit: "llm-bot" })
  | grep "tools_discovered"
  | jq '.toolNames | map(select(startswith("grockle")))'
# Expected: ["grockle"]
```

### 5.4 Composition Executor (No Changes)

**File**: `src/common/compositions/composition-executor.ts`

**Why No Changes**:
- CompositionExecutor already validates using JSON Schema (Ajv)
- This is the **security boundary** - unchanged
- Adapter adds **discovery layer** - separate concern

**Validation Flow**:
```
LLM Tool Call
    │
    ↓
[Standard Schema Adapter validates] ← NEW (discovery/type checking)
    │
    ↓
[CompositionExecutor validates]     ← EXISTING (security boundary)
    │
    ↓
Execute composition steps
```

---

## 6. Risk Analysis & Mitigation

### 6.1 High-Priority Risks

**Risk H-01: Validation Inconsistency Between Layers**

**Probability**: Low
**Impact**: High (security boundary bypassed)

**Scenario**: Adapter validation passes, executor validation fails (or vice versa)

**Mitigation**:
- ✅ Both layers use Ajv (same validator implementation)
- ✅ Both layers use same schema source (`composition.spec.inputSchema`)
- ✅ Integration tests verify validation consistency
- ✅ Add cross-validation test: "adapter.validate() === executor.validate()"

**Acceptance Criteria**:
- 100% validation agreement between layers for 1000+ test cases
- Zero cases where adapter passes and executor fails

---

**Risk H-02: Performance Degradation**

**Probability**: Medium
**Impact**: Medium (slower tool registration)

**Scenario**: Ajv compilation adds >50ms latency per composition registration

**Mitigation**:
- ✅ Adapter compiles validator once at construction (not per-validation)
- ✅ Monitor `composition.schema.wrap_duration_ms` histogram
- ✅ Set P95 alert at 10ms (2x expected)
- ✅ Cache adapters in memory (invalidate on composition update)

**Acceptance Criteria**:
- P95 adapter creation <5ms
- P99 adapter creation <10ms
- Zero user-reported latency issues

---

**Risk H-03: Memory Leak from Cached Adapters**

**Probability**: Low
**Impact**: High (tool-gateway OOM)

**Scenario**: Adapters accumulate without cleanup as compositions update

**Mitigation**:
- ✅ Adapters replaced on composition update (not accumulated)
- ✅ CompositionWatcher deregisters old tools before registering new
- ✅ Monitor tool-gateway memory usage (`process.memoryUsage()`)
- ✅ Add memory usage metrics to health checks

**Acceptance Criteria**:
- Memory growth <1MB per 100 composition updates
- No memory increase over 24-hour period with stable compositions

---

### 6.2 Medium-Priority Risks

**Risk M-01: Ajv Dependency Vulnerability**

**Probability**: Low
**Impact**: Medium (security vulnerability)

**Scenario**: Ajv or ajv-formats has known CVE

**Mitigation**:
- ✅ Use npm audit in CI/CD pipeline
- ✅ Dependabot alerts enabled
- ✅ Pin Ajv to specific version (not `^` range)
- ✅ Review Ajv changelogs before upgrades

---

**Risk M-02: JSON Schema Feature Gaps**

**Probability**: Medium
**Impact**: Low (some compositions can't use advanced features)

**Scenario**: Composition uses JSON Schema 2020-12 feature Ajv doesn't support

**Mitigation**:
- ✅ Use Ajv v8.12+ (full 2020-12 support)
- ✅ Add ajv-formats for format validators
- ✅ Document supported features in composition guide
- ✅ Fail-open to z.any() with clear warning

**Unsupported Features** (if any):
- Document in `documentation/reference/composition-schema.md`
- Provide workarounds where possible

---

**Risk M-03: Standard Schema Spec Evolution**

**Probability**: Low
**Impact**: Low (adapter needs update)

**Scenario**: Standard Schema v2 breaks v1 compatibility

**Mitigation**:
- ✅ Monitor https://standardschema.dev/ for spec changes
- ✅ Version adapter implementation (`JsonSchemaStandardAdapterV1`)
- ✅ MCP SDK will maintain backward compatibility (industry standard)

---

### 6.3 Low-Priority Risks

**Risk L-01: LLM Confusion from Complex Schemas**

**Probability**: Medium
**Impact**: Low (LLM makes suboptimal tool calls)

**Scenario**: Deeply nested or highly conditional schemas confuse LLM

**Mitigation**:
- ✅ Composition authoring guide recommends simple schemas
- ✅ Provide schema examples (flat objects, enums, simple arrays)
- ✅ Monitor LLM tool call error rates per composition

---

**Risk L-02: Adapter Creation Errors**

**Probability**: Medium
**Impact**: Very Low (falls back to z.any(), existing behavior)

**Scenario**: Malformed JSON Schema causes adapter constructor to throw

**Mitigation**:
- ✅ Fail-open strategy (z.any() fallback)
- ✅ Log warnings with schema details
- ✅ Alert if >5% of compositions fail to wrap

---

## 7. Performance Characteristics

### 7.1 Latency Profile

**Adapter Creation** (one-time cost):
```
┌─────────────────────────────────────────────────────────┐
│ JsonSchemaStandardAdapter Construction                  │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ 1. Ajv instance creation         ~0.5ms                 │
│ 2. Schema compilation (Ajv)      ~2-4ms (depends on     │
│                                            complexity)   │
│ 3. Adapter wrapper creation      ~0.1ms                 │
│                                                          │
│ Total (simple schema):            ~2-5ms                 │
│ Total (complex schema):           ~5-8ms                 │
└─────────────────────────────────────────────────────────┘
```

**Validation** (per tool call):
```
┌─────────────────────────────────────────────────────────┐
│ Standard Schema Validation                               │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ adapter["~standard"].validate(args)                      │
│                                                          │
│ Uses pre-compiled Ajv validator:  ~0.1-0.5ms            │
│                                                          │
│ (Comparable to Zod validation)                           │
└─────────────────────────────────────────────────────────┘
```

**Total Registration Time**:
```
Before:  ToolRegistry.register() + this.registerTool()
         ~1ms + ~0.5ms = ~1.5ms

After:   ToolRegistry.register() + adapter.new() + this.registerTool()
         ~1ms + ~3ms + ~0.5ms = ~4.5ms

Impact:  +3ms per composition (acceptable, one-time cost)
```

### 7.2 Memory Profile

**Per Adapter**:
```
┌─────────────────────────────────────────────────────────┐
│ JsonSchemaStandardAdapter Memory                         │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ 1. Original JSON Schema      ~5-10 KB (stored ref)      │
│ 2. Compiled Ajv validator    ~20-30 KB (code cache)     │
│ 3. Adapter wrapper           ~5 KB (closures)           │
│ 4. Standard Schema interface ~5 KB (methods)            │
│                                                          │
│ Total per composition:       ~35-50 KB                   │
│                                                          │
│ For 100 compositions:        ~3.5-5 MB (acceptable)     │
└─────────────────────────────────────────────────────────┘
```

**Comparison**:
- Current (z.any()): ~1 KB per composition
- Proposed (adapter): ~40 KB per composition
- Delta: ~39 KB per composition

**Justification**: Memory cost acceptable for schema visibility benefit.

### 7.3 Scalability

**Composition Count Limits**:

| Compositions | Adapter Creation | Total Memory | Registration Time |
|--------------|------------------|--------------|-------------------|
| 10           | ~30ms            | ~400 KB      | ~50ms             |
| 100          | ~300ms           | ~4 MB        | ~500ms            |
| 1000         | ~3s              | ~40 MB       | ~5s               |
| 10000        | ~30s             | ~400 MB      | ~50s              |

**Platform Limits**:
- Tool-gateway typical heap: 512 MB
- Recommended max compositions: 1000 (uses ~40 MB)
- Safety margin: 12x headroom

**If Limits Exceeded**:
- Implement lazy adapter creation (on-demand, not at registration)
- Add LRU cache for adapters (evict least-used)
- Consider sharding compositions across multiple tool-gateway instances

---

## 8. Security Considerations

### 8.1 Attack Vectors

**Vector S-01: Malicious JSON Schema**

**Threat**: Attacker uploads composition with schema designed to exploit Ajv

**Examples**:
- Deeply nested schemas (stack overflow)
- Regex DoS patterns in string validators
- Circular references causing infinite loops

**Mitigation**:
- ✅ Ajv strict mode enabled (rejects unsafe patterns)
- ✅ Schema size limits enforced at composition registration
- ✅ Timeout on Ajv compilation (5 seconds max)
- ✅ Fail-open: Invalid schemas fall back to z.any()

**Validation**:
```typescript
const MAX_SCHEMA_SIZE = 100_000; // 100 KB
const MAX_COMPILE_TIME_MS = 5_000; // 5 seconds

if (JSON.stringify(schema).length > MAX_SCHEMA_SIZE) {
  logger.warn('composition.schema.too_large', { toolId, size });
  return z.any();
}

const timeout = setTimeout(() => {
  throw new Error('Schema compilation timeout');
}, MAX_COMPILE_TIME_MS);

try {
  const adapter = new JsonSchemaStandardAdapter(schema, vendor);
  clearTimeout(timeout);
  return adapter;
} catch (err) {
  clearTimeout(timeout);
  logger.warn('composition.schema.wrap_failed', { toolId, error: err.message });
  return z.any();
}
```

---

**Vector S-02: Validation Bypass**

**Threat**: Attacker crafts input that passes adapter validation but fails executor validation

**Impact**: Could execute composition with unexpected args

**Mitigation**:
- ✅ **Defense in Depth**: Two validation layers (adapter + executor)
- ✅ **Same Validator**: Both use Ajv with identical config
- ✅ **Same Schema**: Both reference `composition.spec.inputSchema`
- ✅ **Executor as Security Boundary**: Final validation always enforced

**Test Coverage**:
```typescript
test('adapter and executor validation agree', () => {
  const schema = { /* test schema */ };
  const testCases = generateTestCases(schema); // 1000+ cases

  for (const testCase of testCases) {
    const adapterResult = adapter["~standard"].validate(testCase);
    const executorResult = executor.validate(schema, testCase);

    // Both should agree: valid or invalid
    expect(adapterResult.issues).toEqual(executorResult.issues);
  }
});
```

---

**Vector S-03: Dependency Vulnerability (Ajv)**

**Threat**: Known CVE in Ajv or ajv-formats

**Mitigation**:
- ✅ **Automated Scanning**: npm audit in CI/CD
- ✅ **Dependabot Alerts**: GitHub security alerts enabled
- ✅ **Version Pinning**: Lock to specific versions, not ranges
- ✅ **Update Process**: Review changelogs before updates

**Monitoring**:
```bash
# Weekly security audit
npm audit --audit-level=high

# Check for known CVEs
npm outdated | grep ajv
```

---

### 8.2 Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│ External Input (Untrusted)                                  │
│ - LLM-generated tool call arguments                         │
│ - User-provided composition schemas                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Trust Boundary 1: MCP Protocol                              │
│ - Tool call arrives via MCP tools/call                      │
│ - Arguments are JSON                                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Validation Layer 1: Standard Schema Adapter (NEW)           │
│ - Validates against JSON Schema (Ajv)                       │
│ - Rejects malformed input                                   │
│ - Purpose: Type discovery + early rejection                 │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Tool Gateway: CompositionExecutor                           │
│ - Validates AGAIN against JSON Schema (Ajv)                 │
│ - Security boundary - final enforcement                     │
│ - Applies variable substitution ({{input.foo}})             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Composition Execution (Trusted)                             │
│ - Args validated at TWO checkpoints                         │
│ - Safe to execute composition steps                         │
└─────────────────────────────────────────────────────────────┘
```

**Key Principle**: Never trust external input until validated at security boundary (CompositionExecutor).

---

## 9. Backward Compatibility

### 9.1 Compatibility Matrix

| Component | Impact | Breaking Change? | Migration Required? |
|-----------|--------|------------------|---------------------|
| Compositions (existing) | None | No | No |
| Tool Gateway | Enhanced | No | No |
| LLM Bot | Enhanced | No | No |
| Composition Executor | None | No | No |
| MCP Clients | Enhanced | No | No |
| Bit Base Class | None | No | No |

**Conclusion**: **100% backward compatible**. No breaking changes, no migrations.

### 9.2 Fallback Behavior

**Scenario 1: Invalid JSON Schema**
```typescript
Before:  registerTool(id, desc, z.any(), handler)
After:   wrapJsonSchemaWithAdapter() → z.any() (fail-open)
Result:  Identical behavior
```

**Scenario 2: No Input Schema**
```typescript
Before:  registerTool(id, desc, z.any(), handler)
After:   wrapJsonSchemaWithAdapter(undefined) → z.any()
Result:  Identical behavior
```

**Scenario 3: Adapter Creation Fails**
```typescript
Before:  registerTool(id, desc, z.any(), handler)
After:   try { new Adapter() } catch { z.any() }
Result:  Identical behavior (with warning log)
```

**Guarantee**: If adapter creation fails for ANY reason, behavior reverts to current state (z.any()).

---

## 10. Deployment Strategy

### 10.1 Deployment Checklist

**Pre-Deployment**:
- [ ] All unit tests passing (>95% coverage)
- [ ] Integration tests passing
- [ ] Performance benchmarks meet targets (<5ms P95)
- [ ] Security review complete
- [ ] Documentation updated

**Agent-Dev Validation**:
- [ ] Provision agent-dev context
- [ ] Deploy tool-gateway with adapter
- [ ] Register test compositions (simple, complex, edge cases)
- [ ] Verify LLM sees schemas in tools_discovered
- [ ] Test LLM tool calls with real prompts
- [ ] Monitor for 2 hours, check for errors
- [ ] Verify no memory leaks
- [ ] Destroy agent-dev context

**Staging Deployment**:
- [ ] Deploy to staging context
- [ ] Monitor adapter wrapping success rate (target >99%)
- [ ] Monitor LLM tool call patterns
- [ ] Check for validation inconsistencies
- [ ] 24-hour soak test
- [ ] Performance regression check

**Production Deployment**:
- [ ] Deploy during low-traffic window
- [ ] Gradual rollout (canary deployment if possible)
- [ ] Monitor error rates, latency, memory
- [ ] Alert on-call if issues detected
- [ ] Rollback plan ready (revert to z.any())

### 10.2 Rollback Plan

**Trigger Conditions**:
- Adapter wrapping success rate <95%
- Tool gateway memory >80% of limit
- Composition execution error rate increases >20%
- P95 latency increases >50ms

**Rollback Steps**:
1. **Immediate**: Set feature flag `ENABLE_STANDARD_SCHEMA_ADAPTER=false`
2. **Code Revert**:
   ```typescript
   // In tool-gateway.ts
   const standardSchema = process.env.ENABLE_STANDARD_SCHEMA_ADAPTER === 'true'
     ? this.wrapJsonSchemaWithAdapter(jsonSchema, toolId)
     : z.any();
   ```
3. **Deploy**: Redeploy tool-gateway with flag disabled
4. **Verify**: Confirm behavior returns to baseline
5. **Investigate**: Analyze logs, fix root cause
6. **Re-enable**: After fix validated in agent-dev

---

## 11. Documentation Requirements

### 11.1 User-Facing Documentation

**File**: `documentation/guides/compositions.md`

**New Sections**:
1. **Input Schema Format**
   - JSON Schema 2020-12 specification
   - Supported types, keywords, validators
   - Examples for common patterns

2. **How LLMs See Schemas**
   - Explanation of schema visibility
   - Impact on LLM tool selection
   - Best practices for schema design

3. **Troubleshooting**
   - Common schema errors
   - How to check if schema is valid
   - Fallback behavior (z.any())

**Example**:
```markdown
## Composition Input Schemas

Compositions use **JSON Schema 2020-12** to define input parameters.

### Simple Schema Example

```yaml
spec:
  inputSchema:
    type: object
    properties:
      prompt:
        type: string
        description: Text prompt for the operation
      temperature:
        type: number
        minimum: 0
        maximum: 1
        default: 0.7
    required:
      - prompt
```

When an LLM sees this composition, it knows:
- `prompt` is **required** and must be a string
- `temperature` is **optional** and defaults to 0.7
- `temperature` must be between 0 and 1

### Best Practices

1. **Keep schemas simple**: Flat objects work best for LLMs
2. **Use descriptions**: Help LLMs understand parameter purpose
3. **Provide defaults**: Make optional parameters truly optional
4. **Use enums**: Constrain choices for better LLM accuracy
```

---

**File**: `documentation/reference/composition-schema.md` (NEW)

**Sections**:
1. JSON Schema 2020-12 Reference
2. Supported Types and Keywords
3. Format Validators (email, date, uri, etc.)
4. Advanced Features (conditionals, references)
5. Limitations and Workarounds
6. Validation Error Messages

---

### 11.2 Developer Documentation

**File**: `src/common/schemas/README.md` (NEW)

**Sections**:
1. **JsonSchemaStandardAdapter Overview**
   - Purpose and design
   - Standard Schema interface explanation
   - When to use vs when to use Zod

2. **API Reference**
   - Constructor signature
   - Interface methods
   - Error handling

3. **Usage Examples**
   - Basic adapter creation
   - Integration with MCP servers
   - Testing patterns

---

**File**: `CHANGELOG.md`

**Entry**:
```markdown
## [0.41.0] - 2026-09-06

### Added
- **Composition Schema Visibility**: LLMs can now see composition input schemas
  - Implemented `JsonSchemaStandardAdapter` for JSON Schema → Standard Schema conversion
  - Compositions with JSON Schema now properly expose parameters to LLMs
  - Added comprehensive unit and integration tests
  - Dependencies: `ajv@^8.12.0`, `ajv-formats@^2.1.1`

### Fixed
- **Issue #XXX**: LLMs reported "tool has no input defined" for compositions
  - Root cause: MCP SDK 2.0 requires Standard Schema interface
  - Solution: Wrap JSON Schema in Standard Schema adapter using Ajv
  - Fallback: Fail-open to `z.any()` for invalid schemas

### Changed
- `tool-gateway`: Enhanced composition registration with schema adapter
  - New method: `wrapJsonSchemaWithAdapter()`
  - Fail-open strategy preserves backward compatibility

### Performance
- Adapter creation: ~3-5ms per composition (one-time cost)
- Validation: ~0.1-0.5ms per tool call (unchanged from current)
- Memory: ~40KB per composition (acceptable for schema visibility)

### Migration
- **No breaking changes**: Fully backward compatible
- Existing compositions work without modification
- Invalid schemas automatically fall back to current behavior
```

---

## 12. Success Criteria

### 12.1 Functional Requirements

| Requirement | Validation Method | Target |
|-------------|-------------------|--------|
| **FR-1**: LLMs see composition schemas | Inspect `tools_discovered` logs | 100% of valid compositions |
| **FR-2**: Adapter wrapping succeeds | Monitor `composition.schema.wrapped` | >99% success rate |
| **FR-3**: Validation consistency | Cross-validation tests | 100% agreement |
| **FR-4**: Fail-open for errors | Test invalid schemas | Falls back to z.any() |
| **FR-5**: No regressions | Existing composition execution | 0 new errors |

### 12.2 Non-Functional Requirements

| Requirement | Validation Method | Target |
|-------------|-------------------|--------|
| **NFR-1**: Adapter creation latency | Performance benchmark | P95 <5ms |
| **NFR-2**: Memory overhead | Memory profiling | <50KB per composition |
| **NFR-3**: Zero crashes | Error monitoring | 0 adapter-related crashes |
| **NFR-4**: Backward compatibility | Compatibility tests | 100% compatible |
| **NFR-5**: Documentation completeness | Peer review | All use cases documented |

### 12.3 User Experience Requirements

| Requirement | Validation Method | Target |
|-------------|-------------------|--------|
| **UX-1**: LLM tool call accuracy | Compare before/after metrics | Increase >10% |
| **UX-2**: Parameter error rate | Monitor invalid tool calls | Decrease >15% |
| **UX-3**: User satisfaction | Qualitative feedback | Positive feedback |
| **UX-4**: Schema author clarity | Documentation review | Clear guidance |

---

## 13. Open Questions & Decisions Needed

### Q1: Caching Strategy

**Question**: Should we cache Standard Schema adapters in memory?

**Options**:
1. **No caching**: Create adapter on every registration
   - Pro: Simple, no cache invalidation logic
   - Con: Repeated work if composition reloaded

2. **In-memory cache**: Map<compositionId, adapter>
   - Pro: Faster repeated registrations
   - Con: Memory overhead, invalidation complexity

3. **Lazy caching**: Cache on first use, evict on update
   - Pro: Memory-efficient
   - Con: Complex invalidation logic

**Recommendation**: **Option 1 (No caching)** initially. Add caching if performance issues detected.

**Rationale**: Composition registration is infrequent (30-second poll interval). Optimization premature.

---

### Q2: Error Reporting to Users

**Question**: How should composition authors know their schema is invalid?

**Options**:
1. **Logs only**: Warn in tool-gateway logs
   - Pro: Simple, no UI changes
   - Con: Users may not see warnings

2. **MCP tool**: Add `composition.validate_schema(name)` tool
   - Pro: Users can check schemas proactively
   - Con: Extra tool, more complexity

3. **Metrics endpoint**: Expose validation metrics via bit.info
   - Pro: Centralized monitoring
   - Con: Requires infrastructure

**Recommendation**: **Option 1 + Option 3 combination**
- Warn in logs (immediate feedback for developers)
- Expose `schemaValidationErrors` in `bit.info` output

**Implementation**:
```typescript
// In bit.info for tool-gateway
{
  "compositions": [
    {
      "name": "grockle",
      "version": 1,
      "schemaValidation": {
        "status": "valid",
        "hasStandardSchema": true
      }
    },
    {
      "name": "broken-comp",
      "version": 1,
      "schemaValidation": {
        "status": "invalid",
        "error": "Invalid JSON Schema: missing type field",
        "fallback": "z.any()"
      }
    }
  ]
}
```

---

### Q3: JSON Schema Version Support

**Question**: Which JSON Schema versions should we support?

**Options**:
1. **2020-12 only**: Latest spec, best features
   - Pro: Future-proof, full feature set
   - Con: May break existing compositions with older schemas

2. **Draft-07 + 2020-12**: Support both common versions
   - Pro: Backward compatible
   - Con: More complex validation

3. **Auto-detect**: Detect version from `$schema` field
   - Pro: Maximum flexibility
   - Con: Complex, potential inconsistencies

**Recommendation**: **Option 3 (Auto-detect)** with 2020-12 as default

**Rationale**: Ajv supports multiple versions. Let users specify via `$schema` field.

**Implementation**:
```typescript
const ajv = new Ajv({
  strict: false,  // Allow draft-07 and 2020-12
  allErrors: true,
  verbose: true
});
```

**Documentation**: Recommend 2020-12, but support draft-07 for compatibility.

---

## 14. Future Enhancements

### Phase 2 Considerations (Future Sprints)

**Enhancement E-01: Schema Validation UI**
- Web UI for testing composition schemas
- Real-time validation feedback
- Example inputs and outputs
- **Effort**: 2-3 days

**Enhancement E-02: Schema Library**
- Reusable schema fragments (common patterns)
- Composition-to-composition schema references
- **Effort**: 3-5 days

**Enhancement E-03: LLM-Aware Schema Optimization**
- Analyze which schema patterns LLMs understand best
- Provide "LLM-friendly" schema recommendations
- Auto-simplify complex schemas for better LLM comprehension
- **Effort**: 5-7 days

**Enhancement E-04: Performance Optimizations**
- Lazy adapter creation (on-demand)
- LRU cache for adapters
- Schema pre-compilation during composition save
- **Effort**: 2-3 days

---

## 15. Conclusion

### 15.1 Summary

This technical architecture provides a **minimal, backward-compatible solution** to composition schema visibility:

**Core Innovation**: `JsonSchemaStandardAdapter` bridges JSON Schema (BitBrat's declarative format) and Standard Schema (MCP SDK 2.0 requirement).

**Key Benefits**:
- ✅ LLMs see full composition schemas (better tool selection)
- ✅ No lossy conversion (preserves all JSON Schema features)
- ✅ No code evaluation (security-safe)
- ✅ Fail-open strategy (backward compatible)
- ✅ Industry-standard validation (Ajv, 12M+ downloads/week)

**Effort**: 12-15 hours (1.5-2 days)

**Risk**: Low (fail-open, backward compatible, comprehensive testing)

**Impact**: Medium-High UX improvement (LLMs can properly discover and use compositions)

### 15.2 Architect Approval

This architecture is **recommended for implementation** with the following conditions:

1. **Unit test coverage >95%** for JsonSchemaStandardAdapter
2. **Agent-dev validation** before staging deployment
3. **24-hour soak test** in staging before production
4. **Rollback plan** documented and rehearsed
5. **Monitoring dashboards** set up before deployment

**Approved**: Ready for sprint kickoff
**Architect**: Claude
**Date**: 2026-09-05

---

## Appendix A: Code Patterns

### Pattern A-01: Standard Schema Adapter Implementation

```typescript
// src/common/schemas/json-schema-standard-adapter.ts
import Ajv, { ValidateFunction, ErrorObject } from 'ajv';
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
  private readonly schema: unknown;
  private readonly vendorId: string;

  constructor(schema: unknown, vendor: string = 'bitbrat-json-schema') {
    if (!schema || typeof schema !== 'object') {
      throw new Error('Schema must be a valid object');
    }

    this.schema = schema;
    this.vendorId = vendor;

    // Initialize Ajv with strict mode disabled for compatibility
    const ajv = new Ajv({
      strict: false,       // Allow draft-07 and 2020-12
      allErrors: true,     // Return all errors, not just first
      verbose: true,       // Include schema info in errors
      coerceTypes: false,  // Strict type checking
    });

    // Add format validators (email, date, uri, etc.)
    addFormats(ajv);

    // Compile validator once at construction time
    try {
      this.validator = ajv.compile(schema);
    } catch (err) {
      throw new Error(
        `Failed to compile JSON Schema: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  readonly "~standard" = {
    version: 1 as const,

    get vendor(): string {
      return this.vendorId;
    },

    validate: (value: unknown) => {
      const valid = this.validator(value);

      if (valid) {
        return { value };
      }

      // Convert Ajv errors to Standard Schema issues
      const issues = (this.validator.errors || []).map((err: ErrorObject) => ({
        message: err.message || 'Validation failed',
        path: err.instancePath
          ? err.instancePath.split('/').filter(Boolean)
          : undefined,
      }));

      return { issues };
    },

    jsonSchema: {
      input: (options?: { target?: string }) => {
        // Return the original JSON Schema
        // Optionally add $schema field if not present
        const schema = this.schema as any;

        if (options?.target && !schema.$schema) {
          return {
            ...schema,
            $schema:
              options.target === 'draft-07'
                ? 'http://json-schema.org/draft-07/schema#'
                : 'https://json-schema.org/draft/2020-12/schema',
          };
        }

        return this.schema;
      },

      output: (options?: { target?: string }) => {
        // For compositions, input and output schemas are the same
        return this.jsonSchema.input(options);
      },
    },
  };
}
```

### Pattern A-02: Tool Gateway Integration

```typescript
// src/apps/tool-gateway.ts (additions)
import { JsonSchemaStandardAdapter } from '../common/schemas/json-schema-standard-adapter';
import { z } from 'zod';

export class ToolGateway extends Bit {
  // ... existing code ...

  private wrapJsonSchemaWithAdapter(
    jsonSchema: any,
    toolId: string
  ): any {
    if (!jsonSchema) {
      this.logger.debug('composition.schema.missing', { toolId });
      return z.any();
    }

    const startTime = Date.now();

    try {
      const adapter = new JsonSchemaStandardAdapter(
        jsonSchema,
        `bitbrat-composition-${toolId}`
      );

      const durationMs = Date.now() - startTime;

      this.logger.debug('composition.schema.wrapped', {
        toolId,
        vendor: adapter["~standard"].vendor,
        hasValidation: typeof adapter["~standard"].validate === 'function',
        hasJsonSchema: typeof adapter["~standard"].jsonSchema === 'object',
        durationMs,
      });

      return adapter;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;

      this.logger.warn('composition.schema.wrap_failed', {
        toolId,
        error: err.message,
        fallback: 'z.any()',
        durationMs,
      });

      // Fail-open: Use z.any() so composition remains usable
      return z.any();
    }
  }

  private async registerCompositionTool(composition: any): Promise<void> {
    const toolId = composition.metadata.name;
    const description =
      composition.metadata.description || `Composition: ${toolId}`;
    const jsonSchema = composition.spec.inputSchema;

    try {
      // 1. Register in ToolRegistry (unchanged - uses JSON Schema)
      this.registry.registerTool({
        id: toolId,
        displayName: toolId,
        description,
        inputSchema: jsonSchema,
        source: 'composition',
        execute: async (args: unknown, extra?: any) => {
          return await this.executeComposition(composition, args, extra);
        },
      });

      // 2. Wrap JSON Schema for MCP registration (NEW)
      const standardSchema = this.wrapJsonSchemaWithAdapter(jsonSchema, toolId);

      // 3. Register via Bit MCP interface (modified - uses adapter)
      this.registerTool(
        toolId,
        description,
        standardSchema,
        async (args: unknown, extra?: any) => {
          return await this.executeComposition(composition, args, extra);
        }
      );

      this.logger.debug('tool_gateway.composition.registered', {
        toolId,
        version: composition.metadata.version,
        hasStandardSchema: standardSchema !== z.any(),
      });
    } catch (err) {
      this.logger.error('tool_gateway.composition.registration_failed', {
        toolId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ... existing code ...
}
```

---

**End of Technical Architecture Document**

**Next Steps**:
1. Review and approve this architecture
2. Start sprint with implementation plan
3. Create `JsonSchemaStandardAdapter` (Phase 1)
4. Integrate with tool-gateway (Phase 2)
5. Validate in agent-dev (Phase 3)
6. Deploy to staging and production (Phase 4)
