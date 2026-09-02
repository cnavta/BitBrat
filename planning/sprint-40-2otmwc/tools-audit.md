# MCP Dev Tools Audit - Type Coercion Requirements

**Sprint**: sprint-40-2otmwc
**Date**: 2026-09-02
**Purpose**: Document all MCP Dev Tools parameters requiring Zod type coercion

---

## Executive Summary

**Total Tools Audited**: 12
**Tools Requiring Changes**: 5
**Parameters Requiring Coercion**: 8
- **Boolean Parameters**: 3
- **Number Parameters**: 5

---

## Tools Requiring Coercion Changes

### 1. Messaging Tools (messaging.ts)

**File**: `tools/brat/src/dev-mcp/tools/messaging.ts`

#### message.send (2 parameters)

**Line 340**: `waitForResponse`
```typescript
// BEFORE
waitForResponse: z.boolean().optional()
  .describe('Wait for response from platform (default: true)'),

// AFTER
waitForResponse: z.coerce.boolean().optional()
  .describe('Wait for response from platform (default: true)'),
```

**Line 342**: `timeoutMs`
```typescript
// BEFORE
timeoutMs: z.number().optional()
  .describe('Timeout in milliseconds (default: 15000)'),

// AFTER
timeoutMs: z.coerce.number().optional()
  .describe('Timeout in milliseconds (default: 15000)'),
```

#### event.send (2 parameters)

**Line 497**: `waitForResponse`
```typescript
// BEFORE
waitForResponse: z.boolean().optional()
  .describe('Wait for response (default: true)'),

// AFTER
waitForResponse: z.coerce.boolean().optional()
  .describe('Wait for response (default: true)'),
```

**Line 499**: `timeoutMs`
```typescript
// BEFORE
timeoutMs: z.number().optional()
  .describe('Timeout in milliseconds (default: 15000)'),

// AFTER
timeoutMs: z.coerce.number().optional()
  .describe('Timeout in milliseconds (default: 15000)'),
```

---

### 2. Fleet Tools (fleet.ts)

**File**: `tools/brat/src/dev-mcp/tools/fleet.ts`

#### fleet.logs (1 parameter)

**Line 291**: `limit`
```typescript
// BEFORE
limit: z.number().default(100)
  .describe('Maximum number of log entries to return'),

// AFTER
limit: z.coerce.number().default(100)
  .describe('Maximum number of log entries to return'),
```

**Note**: Even though this parameter has `.default(100)`, coercion is still needed because validation happens BEFORE default application. String inputs will fail validation before reaching the default.

---

### 3. Agent-Dev Tools (agent-dev.ts)

**File**: `tools/brat/src/dev-mcp/tools/agent-dev.ts`

#### agent_dev.destroy (1 parameter)

**Line 306**: `confirm`
```typescript
// BEFORE
confirm: z.boolean().optional()
  .describe('Confirmation flag (must be true)'),

// AFTER
confirm: z.coerce.boolean().optional()
  .describe('Confirmation flag (must be true)'),
```

**CRITICAL**: This parameter controls destructive operations. Coercion must preserve safety defaults:
- Omitted → `undefined` → handler treats as false (safe, blocks destruction)
- `"true"` → `true` → handler permits destruction
- `"false"` → `false` → handler blocks destruction

---

### 4. Persistence Tools (persistence.ts)

**File**: `tools/brat/src/dev-mcp/tools/persistence.ts`

#### db.query (2 parameters)

**Line 220**: `limit`
```typescript
// BEFORE
limit: z.number().optional()
  .describe('Maximum number of documents to return'),

// AFTER
limit: z.coerce.number().optional()
  .describe('Maximum number of documents to return'),
```

**Line 221**: `offset`
```typescript
// BEFORE
offset: z.number().optional()
  .describe('Number of documents to skip'),

// AFTER
offset: z.coerce.number().optional()
  .describe('Number of documents to skip'),
```

---

## Tools NOT Requiring Changes

### Config Tools (config.ts)

**File**: `tools/brat/src/dev-mcp/tools/config.ts`

All config tools use only string and enum parameters:

| Tool | Parameters | Reason |
|------|-----------|---------|
| `config.show` | `format: z.enum(['yaml', 'json'])` | Enum, not boolean/number |
| `config.validate` | `context: z.string()` | String only |
| `config.doctor` | `context: z.string()` | String only |
| `schema.read` | `name: z.string()`, `context: z.string()` | Strings only |

**Result**: ✅ No changes needed

---

### Fleet Tools (fleet.ts) - Partial

**File**: `tools/brat/src/dev-mcp/tools/fleet.ts`

Tools with no boolean/number parameters:

| Tool | Parameters | Reason |
|------|-----------|---------|
| `fleet.list` | `context: z.string()` | String only |
| `fleet.info` | `bit: z.string()`, `context: z.string()` | Strings only |
| `fleet.trace` | `correlationId: z.string()`, `format: z.enum()` | String + enum |

**Result**: ✅ `fleet.logs` needs changes (documented above), others OK

---

### Agent-Dev Tools (agent-dev.ts) - Partial

**File**: `tools/brat/src/dev-mcp/tools/agent-dev.ts`

Tools with no boolean/number parameters:

| Tool | Parameters | Reason |
|------|-----------|---------|
| `agent_dev.provision` | All strings/enums | No boolean/number |
| `agent_dev.start` | `name: z.string()`, `service: z.string()` | Strings only |
| `agent_dev.stop` | `name: z.string()` | String only |

**Result**: ✅ `agent_dev.destroy` needs changes (documented above), others OK

---

### Persistence Tools (persistence.ts) - Partial

**File**: `tools/brat/src/dev-mcp/tools/persistence.ts`

Tools with no boolean/number parameters:

| Tool | Parameters | Reason |
|------|-----------|---------|
| `db.collections` | `context: z.string()` | String only |
| `db.get` | `collection: z.string()`, `id: z.string()` | Strings only |

**Result**: ✅ `db.query` needs changes (documented above), others OK

---

## Coercion Matrix

| Category | Tool | Parameter | Type | Line | Priority |
|----------|------|-----------|------|------|----------|
| Messaging | message.send | waitForResponse | boolean | 340 | 1 (HIGH) |
| Messaging | message.send | timeoutMs | number | 342 | 1 (HIGH) |
| Messaging | event.send | waitForResponse | boolean | 497 | 1 (HIGH) |
| Messaging | event.send | timeoutMs | number | 499 | 1 (HIGH) |
| Fleet | fleet.logs | limit | number | 291 | 2 |
| Agent-Dev | agent_dev.destroy | confirm | boolean | 306 | 2 |
| Persistence | db.query | limit | number | 220 | 2 |
| Persistence | db.query | offset | number | 221 | 2 |

**Priority Legend**:
- **1 (HIGH)**: Messaging tools - immediate user pain point from original issue
- **2**: Other tools - important for consistency but less frequently used

---

## Implementation Notes

### Zod Coercion Behavior

**Boolean Coercion** (`z.coerce.boolean()`):
- `"true"` → `true`
- `"false"` → `false`
- `"1"` → `true`
- `"0"` → `false`
- `1` → `true`
- `0` → `false`
- `true`/`false` → unchanged (pass-through)

**Number Coercion** (`z.coerce.number()`):
- `"123"` → `123`
- `"3.14"` → `3.14`
- `"-42"` → `-42`
- `"1e6"` → `1000000`
- `123` → unchanged (pass-through)
- `"abc"` → **throws error** (invalid input)

### Safety Considerations

1. **agent_dev.destroy.confirm**:
   - CRITICAL: Destructive operation gated by boolean
   - Handler checks `args.confirm === true` (strict equality)
   - Coercion preserves safety:
     - Omitted → `undefined` → handler rejects
     - `"false"` → `false` → handler rejects
     - `"true"` → `true` → handler permits

2. **Pagination parameters (limit, offset)**:
   - Coercion handles string inputs: `"50"` → `50`
   - Invalid inputs rejected: `"abc"` → error
   - Negative numbers: Coercion allows `-10`, handler validation may reject

3. **Timeout parameters**:
   - Coercion handles string inputs: `"15000"` → `15000`
   - Invalid inputs rejected: `"abc"` → error
   - Zero/negative: Coercion allows, runtime logic handles

### Optional Parameters

All parameters requiring coercion are `.optional()`. Zod coercion behavior:
- **Value provided**: Coerce and validate
- **Value omitted**: `undefined` (skip validation)
- **Invalid value**: Throw error (expected behavior)

### Default Values

One parameter has `.default()`: `fleet.logs.limit: z.number().default(100)`

**Change Required**: Must use `.coerce` BEFORE `.default`:
```typescript
// CORRECT
z.coerce.number().default(100)

// INCORRECT (coercion happens after default, won't fix string inputs)
z.number().default(100).coerce()
```

---

## Verification Checklist

After implementation, verify each change:

- [ ] `message.send.waitForResponse` accepts `"true"`/`"false"`
- [ ] `message.send.timeoutMs` accepts `"15000"`
- [ ] `event.send.waitForResponse` accepts `"true"`/`"false"`
- [ ] `event.send.timeoutMs` accepts `"15000"`
- [ ] `fleet.logs.limit` accepts `"100"` and defaults correctly
- [ ] `agent_dev.destroy.confirm` accepts `"true"` but preserves safety
- [ ] `db.query.limit` accepts `"50"`
- [ ] `db.query.offset` accepts `"100"`

**Verification Method**: Unit tests with string inputs (Phase 2-5 of backlog)

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Total tools in dev-mcp | 12 |
| Tools requiring changes | 5 |
| Total parameters changed | 8 |
| Boolean parameters | 3 |
| Number parameters | 5 |
| Lines of code modified | 8 |
| Files modified | 4 |

**Verification**: Matches implementation plan estimate (8 changes, 5 tools)

---

## Next Steps

1. ✅ Audit completed (Phase 1)
2. Implement changes per priority:
   - **Phase 2**: Messaging tools (HIGH priority)
   - **Phase 3**: Fleet tools
   - **Phase 4**: Agent-dev tools
   - **Phase 5**: Persistence tools
3. Add unit tests for each coerced parameter
4. Integration testing with XML invocation patterns
5. Manual validation in agent-dev context

---

## References

- **Implementation Plan**: `planning/sprint-40-2otmwc/implementation-plan.md`
- **Backlog**: `planning/sprint-40-2otmwc/backlog.yaml`
- **Zod Documentation**: https://zod.dev
- **Sprint 38**: JSON Schema conversion removed (Sprint 38 comment in tool-router.ts:6-8)
