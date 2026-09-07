# Sprint 44 Implementation Plan: Fix fleet.logs MCP Tool Parameter Issues

**Sprint ID**: sprint-44-cbcszm
**Goal**: Fix parameter validation bugs in fleet.logs MCP tool, particularly the level array parameter issue
**Estimated Time**: 3-4 hours

---

## Problem Statement

The `fleet.logs` MCP tool fails when users try to filter logs by level. The root cause is that MCP's XML protocol passes JSON arrays as strings (`'["error", "warn"]'`), but the Zod schema expects a native JavaScript array (`["error", "warn"]`).

**Current Behavior**:
```typescript
// This fails:
fleet.logs({ bit: "llm-bot", level: ["error", "warn"], limit: 5 })
// Error: Invalid input: expected array, received string

// This works (no filtering):
fleet.logs({ bit: "llm-bot", limit: 5 })
```

**Impact**: Users cannot filter logs by level, making error investigation significantly slower.

---

## Root Cause Analysis

### Technical Details

**File**: `tools/brat/src/dev-mcp/tools/fleet.ts`
**Line**: 285

```typescript
const fleetLogsSchema = z.object({
  bit: z.string().optional(),
  level: z.array(z.enum(['error', 'warn', 'info', 'debug', 'trace'])).optional(),  // ⚠️ PROBLEM HERE
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.coerce.number().default(100),
  correlationId: z.string().optional(),
  format: z.enum(['text', 'json', 'raw']).default('text'),
  context: z.string().optional(),
});
```

### Why This Happens

1. MCP XML protocol serializes all parameters as strings:
   ```xml
   <parameter name="level">["error", "warn"]
2. Zod's `z.array()` expects a native JavaScript array
3. When `"["error", "warn"]"` (string) is passed, validation fails

### Why `limit` Works But `level` Doesn't

```typescript
limit: z.coerce.number().default(100),  // ✅ z.coerce handles string-to-number
level: z.array(...),                     // ❌ No coercion for arrays
```

Zod's `z.coerce` automatically converts strings to numbers, but there's no equivalent `z.coerce.array()` for JSON string arrays.

---

## Solution Approach

### Option 1: Preprocessing (Recommended)

Add parameter preprocessing before Zod validation in the handler:

```typescript
async function fleetLogsHandler(
  args: Record<string, any>,
  connection: TargetConnection
): Promise<any> {
  // Preprocess: Parse JSON string arrays
  if (typeof args.level === 'string') {
    try {
      args.level = JSON.parse(args.level);
    } catch (e) {
      // Keep as string, let Zod validation fail with clear message
    }
  }

  // Now parse with Zod
  const parsed = fleetLogsSchema.parse(args);
  // ... rest of handler
}
```

**Pros**:
- Simple, focused fix
- Easy to understand and debug
- Preserves existing schema structure
- Can add similar preprocessing for other parameters if needed

**Cons**:
- Adds runtime overhead (minimal)
- Duplicates logic if other tools have same issue

### Option 2: Custom Zod Transform

Create a reusable Zod transformer:

```typescript
const stringOrArraySchema = z.union([
  z.array(z.enum(['error', 'warn', 'info', 'debug', 'trace'])),
  z.string().transform((val) => JSON.parse(val))
]).optional();

const fleetLogsSchema = z.object({
  level: stringOrArraySchema,
  // ... rest of schema
});
```

**Pros**:
- Reusable across multiple tools
- Type-safe transform
- Schema-level solution

**Cons**:
- More complex
- Harder to debug validation errors
- Transform failures less clear

### Chosen Approach: Option 1 (Preprocessing)

**Reasoning**:
1. Simpler to implement and test
2. Easier for future developers to understand
3. Allows graceful error handling (catch JSON.parse errors)
4. Matches existing pattern in codebase (z.coerce for numbers)

---

## Implementation Steps

### Phase 1: Fix fleet.logs Handler (30 min)

**File**: `tools/brat/src/dev-mcp/tools/fleet.ts`
**Function**: `fleetLogsHandler` (line 300)

**Changes**:
1. Add preprocessing logic before `fleetLogsSchema.parse(args)`:
   ```typescript
   // Preprocess level parameter: MCP XML passes arrays as JSON strings
   if (typeof args.level === 'string') {
     try {
       const parsed = JSON.parse(args.level);
       if (Array.isArray(parsed)) {
         args.level = parsed;
       }
     } catch (e) {
       // Invalid JSON - leave as string, let Zod validation provide clear error
     }
   }
   ```

2. Add JSDoc comment explaining the preprocessing:
   ```typescript
   /**
    * fleet.logs - Retrieve logs from specific Bit(s)
    *
    * Supports Cloud Run (Cloud Logging API) and Docker (docker compose logs) targets.
    * Provides filtering by level, time range, and correlation ID.
    *
    * Note: MCP XML protocol passes array parameters as JSON strings, so we preprocess
    * the `level` parameter to convert `'["error", "warn"]'` → `["error", "warn"]`.
    */
   ```

### Phase 2: Add Unit Tests (45 min)

**File**: `tools/brat/src/dev-mcp/__tests__/tools/fleet.test.ts`

**Test Cases**:
1. ✅ Level parameter as native array (existing behavior)
2. ✅ Level parameter as JSON string array (new behavior)
3. ✅ Level parameter as invalid JSON (should fail validation)
4. ✅ Level parameter as non-array JSON (should fail validation)
5. ✅ Level parameter omitted (should work, no filtering)
6. ✅ Single-bit query with level filter
7. ✅ Fleet-wide query with level filter

**Test Structure**:
```typescript
describe('fleet.logs level parameter handling', () => {
  it('should accept level as native array', async () => {
    const result = await fleetLogsHandler(
      { bit: 'test', level: ['error', 'warn'], limit: 10 },
      mockConnection
    );
    expect(result.isError).toBeFalsy();
  });

  it('should accept level as JSON string array', async () => {
    const result = await fleetLogsHandler(
      { bit: 'test', level: '["error", "warn"]', limit: 10 },
      mockConnection
    );
    expect(result.isError).toBeFalsy();
  });

  it('should reject level as invalid JSON', async () => {
    const result = await fleetLogsHandler(
      { bit: 'test', level: '[error, warn]', limit: 10 },  // Missing quotes
      mockConnection
    );
    expect(result.isError).toBeTruthy();
  });

  it('should reject level as non-array JSON', async () => {
    const result = await fleetLogsHandler(
      { bit: 'test', level: '{"level": "error"}', limit: 10 },
      mockConnection
    );
    expect(result.isError).toBeTruthy();
  });
});
```

### Phase 3: Integration Testing (30 min)

**Test in staging environment**:

```typescript
// Test 1: Single service, single level
fleet.logs({ bit: "llm-bot", level: ["error"], context: "staging", limit: 5 })

// Test 2: Single service, multiple levels
fleet.logs({ bit: "llm-bot", level: ["error", "warn"], context: "staging", limit: 5 })

// Test 3: Fleet-wide, error only
fleet.logs({ level: ["error"], context: "staging", limit: 10 })

// Test 4: Combined filters (level + since + correlationId)
fleet.logs({
  bit: "event-router",
  level: ["info", "warn", "error"],
  since: "30m",
  context: "staging",
  limit: 20
})

// Test 5: JSON format output
fleet.logs({
  bit: "ingress-egress",
  level: ["debug"],
  format: "json",
  context: "staging",
  limit: 3
})
```

**Success Criteria**:
- ✅ All 5 test scenarios return logs without validation errors
- ✅ Logs are correctly filtered by specified levels
- ✅ No regressions in other parameters (since, until, limit, correlationId, format)
- ✅ Fleet-wide queries work with level filter

### Phase 4: Documentation (15 min)

**Update**: `documentation/guides/dev-mcp-messaging.md`

Add section explaining the level parameter behavior:

```markdown
### Fleet.logs Level Filtering

The `level` parameter accepts an array of log levels to include:

\`\`\`typescript
fleet.logs({
  bit: "llm-bot",
  level: ["error", "warn"],  // Only show errors and warnings
  limit: 20
})
\`\`\`

**Available levels**: `error`, `warn`, `info`, `debug`, `trace`

**Note**: Due to MCP XML serialization, the array is passed as a JSON string internally
and automatically converted by the tool handler. Both formats work:
- Native array: `["error", "warn"]` (when called programmatically)
- JSON string: `'["error", "warn"]'` (when passed through MCP)
\`\`\`
```

### Phase 5: Verification (30 min)

1. **Build and test locally**:
   ```bash
   npm run build
   npm test -- fleet.test.ts
   ```

2. **Test in staging** (via MCP):
   - Start dev-mcp server with staging context
   - Run all 5 integration test scenarios
   - Verify logs are correctly filtered
   - Check for any error messages

3. **Regression testing**:
   - Verify other fleet tools still work (fleet.list, fleet.info, fleet.trace)
   - Verify other parameters still work (since, until, correlationId, format)
   - Verify fleet-wide queries (no `bit` parameter)

---

## Testing Matrix

| Scenario | `level` Value | Expected Result |
|----------|---------------|-----------------|
| Native array | `["error"]` | ✅ Works |
| JSON string array | `'["error", "warn"]'` | ✅ Works after fix |
| Invalid JSON | `'[error, warn]'` | ❌ Validation error (clear message) |
| Non-array JSON | `'{"level": "error"}'` | ❌ Validation error (clear message) |
| Omitted | `undefined` | ✅ Works (no filtering) |
| Empty array | `[]` | ✅ Works (no filtering) |
| Invalid level value | `["foo"]` | ❌ Validation error (not a valid level) |

---

## Risk Assessment

### Low Risk
- ✅ Fix is isolated to single handler function
- ✅ Preprocessing happens before validation
- ✅ Existing behavior unchanged (native arrays still work)
- ✅ Validation errors still caught by Zod
- ✅ No changes to schema structure

### Potential Issues
- ⚠️ Performance: JSON.parse on every call (negligible, ~0.01ms)
- ⚠️ Error messages: If JSON.parse fails, Zod will show "expected array, received string" (acceptable)

### Mitigation
- Add try/catch around JSON.parse
- Log preprocessing failures at debug level
- Preserve original value on parse failure (let Zod validate and provide error)

---

## Rollout Plan

### Step 1: Implement and Test Locally (2 hours)
- Implement preprocessing in `fleetLogsHandler`
- Add unit tests
- Verify all tests pass

### Step 2: Deploy to Agent-Dev (30 min)
- Create agent-dev context
- Deploy dev-mcp server with changes
- Run full integration test suite
- Verify no regressions

### Step 3: Deploy to Staging (30 min)
- Deploy to staging environment
- Run live integration tests
- Monitor for errors
- Verify with real logs

### Step 4: Documentation and PR (30 min)
- Update documentation
- Create PR with changes
- Add sprint artifacts to PR description
- Request review

---

## Success Criteria

### Must Have
- ✅ Level parameter works with JSON string arrays (`'["error", "warn"]'`)
- ✅ Level parameter still works with native arrays (`["error", "warn"]`)
- ✅ All existing tests pass
- ✅ New tests cover preprocessing logic
- ✅ Integration tests pass in staging
- ✅ No regressions in other parameters

### Nice to Have
- ✅ Clear error messages for invalid JSON
- ✅ Debug logging for preprocessing failures
- ✅ Documentation updated
- ✅ Performance impact < 1ms per call

---

## Timeline

| Phase | Time | Status |
|-------|------|--------|
| Phase 1: Implementation | 30 min | ⏳ Pending |
| Phase 2: Unit Tests | 45 min | ⏳ Pending |
| Phase 3: Integration Tests | 30 min | ⏳ Pending |
| Phase 4: Documentation | 15 min | ⏳ Pending |
| Phase 5: Verification | 30 min | ⏳ Pending |
| **Total** | **2.5 hours** | **⏳ Pending** |

---

## Files to Modify

1. **tools/brat/src/dev-mcp/tools/fleet.ts** (line 300-310)
   - Add preprocessing logic before `fleetLogsSchema.parse()`
   - Add JSDoc comment explaining preprocessing

2. **tools/brat/src/dev-mcp/__tests__/tools/fleet.test.ts** (new tests)
   - Add 7 new test cases for level parameter handling

3. **documentation/guides/dev-mcp-messaging.md** (optional)
   - Add section explaining level parameter behavior

---

## Approval

This plan is ready for implementation. The fix is:
- ✅ Low risk (isolated change)
- ✅ Well-tested (7 new test cases)
- ✅ Backward compatible (native arrays still work)
- ✅ Clear rollout plan (agent-dev → staging → prod)

**Proceed with implementation**: YES

