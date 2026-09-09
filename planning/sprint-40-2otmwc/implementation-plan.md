# Implementation Plan - Sprint 40
## MCP Type Coercion for XML Invocation Compatibility

**Sprint ID**: sprint-40-2otmwc
**Status**: Planning → In Progress
**Owner**: claude-code
**Created**: 2026-09-02

---

## Executive Summary

### Problem Statement
When invoking MCP Dev Tools from Claude Code via XML-based function calling, boolean and number parameters are serialized as strings, causing Zod schema validation failures. This creates poor UX and requires workarounds (omitting optional params or using JSON format).

**Example failure**:
```xml
<parameter name="waitForResponse">true</parameter>   <!-- String "true", not boolean -->
<parameter name="timeoutMs">15000</parameter>          <!-- String "15000", not number -->
```

**Error**:
```
Error: Invalid arguments for tool 'message.send': [
  { expected: "boolean", received: "string", path: ["waitForResponse"] },
  { expected: "number", received: "string", path: ["timeoutMs"] }
]
```

### Root Cause
- **Architecture**: Sprint 38 removed JSON Schema conversion, passing Zod schemas directly to MCP protocol
- **Protocol**: Zod v4 implements Standard Schema v1 natively, eliminating conversion overhead
- **Client**: Claude Code's XML serialization doesn't preserve type metadata
- **Validation**: Zod `parse()` strictly enforces types, rejecting string-encoded primitives

### Solution: Type Coercion
Implement Zod's `.coerce.boolean()` and `.coerce.number()` modifiers across all MCP Dev Tools to automatically convert string inputs to correct types during validation.

**Benefits**:
- ✅ Minimal code changes (1-2 lines per schema)
- ✅ Works with both XML and JSON clients
- ✅ Maintains strict validation (invalid inputs still rejected)
- ✅ Standard Zod feature (well-documented, no custom logic)

---

## Scope

### In Scope
1. **Messaging Tools** (Sprint 39)
   - `message.send` - 2 params (waitForResponse, timeoutMs)
   - `event.send` - 2 params (waitForResponse, timeoutMs)

2. **Fleet Tools**
   - `fleet.logs` - 1 param (limit)
   - `fleet.trace` - 0 params (no coercion needed)

3. **Agent-Dev Tools** (Sprint 358)
   - `agent_dev.provision` - 0 params (no coercion needed)
   - `agent_dev.start` - 0 params (no coercion needed)
   - `agent_dev.stop` - 0 params (no coercion needed)
   - `agent_dev.destroy` - 1 param (confirm)

4. **Persistence Tools**
   - `db.query` - 2 params (limit, offset)

5. **Config Tools**
   - `config.show` - 0 params (no coercion needed)
   - `config.validate` - 0 params (no coercion needed)
   - `config.doctor` - 0 params (no coercion needed)

6. **Test Coverage**
   - Unit tests for all coerced parameters
   - Integration tests for XML invocation patterns
   - Regression tests for existing JSON invocations

7. **Documentation**
   - Update tool documentation with coercion notes
   - Add troubleshooting guide for type issues
   - Update CLAUDE.md with invocation best practices

### Out of Scope
- JSON Schema conversion (Option 3) - deferred for future evaluation
- Custom preprocessing middleware (Option 2) - unnecessary with .coerce()
- Client-side fixes to Claude Code - not within our control
- Coercion for complex types (arrays, objects, enums) - not needed

---

## Implementation Strategy

### Phase 1: Audit & Analysis
**Goal**: Identify all tools with boolean/number parameters requiring coercion.

**Tasks**:
1. Read all tool definition files in `tools/brat/src/dev-mcp/tools/`
2. Extract Zod schemas and identify boolean/number fields
3. Document current state and required changes
4. Create coercion matrix (tool → params → types)

**Deliverable**: `tools-audit.md` with comprehensive coercion requirements

---

### Phase 2: Messaging Tools (High Priority)
**Goal**: Fix immediate pain point (message.send, event.send).

**Files**:
- `tools/brat/src/dev-mcp/tools/messaging.ts`

**Changes**:
```typescript
// Before (line 340-343)
waitForResponse: z.boolean().optional()
  .describe('Wait for response from platform (default: true)'),
timeoutMs: z.number().optional()
  .describe('Timeout in milliseconds (default: 15000)'),

// After
waitForResponse: z.coerce.boolean().optional()
  .describe('Wait for response from platform (default: true)'),
timeoutMs: z.coerce.number().optional()
  .describe('Timeout in milliseconds (default: 15000)'),
```

**Test Coverage**:
- Add tests for string-encoded booleans ("true", "false", "1", "0")
- Add tests for string-encoded numbers ("15000", "3.14")
- Verify invalid inputs still rejected ("abc" for number)

---

### Phase 3: Fleet Tools
**Goal**: Fix fleet.logs limit parameter.

**Files**:
- `tools/brat/src/dev-mcp/tools/fleet.ts`

**Changes**:
```typescript
// fleet.logs schema
limit: z.coerce.number().optional()
  .describe('Limit output to N lines/entries (default: 100)')
```

**Test Coverage**:
- Verify string "100" coerced to number 100
- Verify existing numeric invocations still work

---

### Phase 4: Agent-Dev Tools
**Goal**: Fix agent_dev.destroy confirm parameter.

**Files**:
- `tools/brat/src/dev-mcp/tools/agent-dev.ts`

**Changes**:
```typescript
// agent_dev.destroy schema
confirm: z.coerce.boolean().optional()
  .describe('Confirm destruction (default: false)')
```

**Test Coverage**:
- Verify string "true" enables destructive operations
- Verify safety defaults still work (false when omitted)

---

### Phase 5: Persistence Tools
**Goal**: Fix db.query pagination parameters.

**Files**:
- `tools/brat/src/dev-mcp/tools/persistence.ts`

**Changes**:
```typescript
// db.query schema
limit: z.coerce.number().optional()
  .describe('Limit results (default: 100)'),
offset: z.coerce.number().optional()
  .describe('Offset for pagination (default: 0)')
```

**Test Coverage**:
- Verify string pagination params work ("50", "100")
- Test boundary conditions (0, negative numbers)

---

### Phase 6: Integration Testing
**Goal**: Verify XML invocation works end-to-end.

**Test Scenarios**:
1. **XML Invocation (Claude Code pattern)**:
   ```xml
   <parameter name="text">test</parameter>
   <parameter name="waitForResponse">true</parameter>
   <parameter name="timeoutMs">5000</parameter>
   ```

2. **JSON Invocation (programmatic pattern)**:
   ```json
   {
     "text": "test",
     "waitForResponse": true,
     "timeoutMs": 5000
   }
   ```

3. **Mixed Invocation (edge case)**:
   ```json
   {
     "text": "test",
     "waitForResponse": "true",  // String
     "timeoutMs": 5000            // Number
   }
   ```

**Validation**:
- All patterns succeed without errors
- Type coercion logs debug info (optional)
- No regressions in existing tests

---

### Phase 7: Documentation & Cleanup
**Goal**: Update documentation and close knowledge gaps.

**Tasks**:
1. Update `documentation/guides/dev-mcp-messaging.md`:
   - Document type coercion behavior
   - Add troubleshooting section for type errors
   - Update examples with both XML and JSON patterns

2. Update `CLAUDE.md`:
   - Add note about automatic type coercion
   - Remove workaround guidance (no longer needed)
   - Document coercion limitations (complex types)

3. Create `planning/sprint-40-2otmwc/technical-architecture.md`:
   - Document coercion implementation details
   - Explain Zod .coerce() behavior
   - Include decision log (why Option 1 vs 2/3)

4. Update tool inline documentation:
   - Add JSDoc comments explaining coercion
   - Document supported string formats ("true", "1", "15000")

---

## Testing Strategy

### Unit Tests
**Location**: `tools/brat/src/dev-mcp/__tests__/tools/*.test.ts`

**Coverage**:
- ✅ Boolean coercion: "true" → true, "false" → false, "1" → true, "0" → false
- ✅ Number coercion: "123" → 123, "3.14" → 3.14, "-42" → -42
- ✅ Invalid inputs: "abc" throws error, null/undefined handled
- ✅ Optional params: omitted params use default behavior

### Integration Tests
**Location**: `tools/brat/src/dev-mcp/__tests__/integration/*.test.ts`

**Coverage**:
- ✅ End-to-end MCP tool invocation with string params
- ✅ Server-side validation and coercion
- ✅ Response format verification

### Regression Tests
**Strategy**: Run existing test suite to ensure no breakage.

```bash
npm test -- tools/brat/src/dev-mcp
```

**Success Criteria**: All existing tests pass without modification.

---

## Risk Assessment

### Low Risks
1. **Breaking existing JSON clients**: Mitigated by .coerce() accepting both types
2. **Performance overhead**: Negligible (Zod coercion is fast)
3. **Type safety degradation**: Coercion still validates after conversion

### Medium Risks
1. **False positives**: String "123" intended as string, coerced to number
   - **Mitigation**: Apply coercion only to params semantically numeric/boolean
   - **Example**: `userId` remains string, `timeout` coerced to number

2. **Edge case behavior**: "yes"/"no" not coerced to boolean
   - **Mitigation**: Document supported formats in tool descriptions
   - **Acceptable**: Zod .coerce.boolean() only handles "true"/"false"/"1"/"0"

### High Risks
None identified.

---

## Success Criteria

### Functional Requirements
- ✅ All MCP Dev Tools accept string-encoded boolean/number params
- ✅ XML invocations from Claude Code succeed without errors
- ✅ JSON invocations continue working (no regressions)
- ✅ Invalid inputs still rejected with clear error messages

### Test Coverage
- ✅ 100% of coerced parameters have unit tests
- ✅ Integration tests cover XML invocation patterns
- ✅ All existing tests pass (regression suite)

### Documentation
- ✅ Tool descriptions updated with coercion notes
- ✅ CLAUDE.md reflects automatic coercion behavior
- ✅ Technical architecture document created

### Validation
- ✅ Manual testing: Invoke message.send with XML params (success)
- ✅ CI/CD: All tests pass in GitHub Actions
- ✅ Agent-dev deployment: Full stack validation in isolated context

---

## Dependencies

### Internal
- Zod v4.5.2+ (already installed, supports .coerce())
- MCP SDK v2.0.0+ (already installed, supports Standard Schema v1)

### External
None.

### Blocking Issues
None identified.

---

## Timeline Estimate

| Phase | Estimated Time | Risk |
|-------|---------------|------|
| 1. Audit & Analysis | 30 minutes | Low |
| 2. Messaging Tools | 1 hour | Low |
| 3. Fleet Tools | 30 minutes | Low |
| 4. Agent-Dev Tools | 30 minutes | Low |
| 5. Persistence Tools | 30 minutes | Low |
| 6. Integration Testing | 1 hour | Medium |
| 7. Documentation | 1 hour | Low |
| **Total** | **5.5 hours** | **Low** |

**Buffer**: 1.5 hours for unexpected issues
**Total with buffer**: 7 hours

---

## Rollback Plan

If coercion causes unexpected issues:

1. **Immediate**: Revert commits in feature branch
2. **Testing**: Run regression suite to verify rollback success
3. **Analysis**: Document failure mode and root cause
4. **Alternative**: Evaluate Option 2 (preprocessing middleware) or Option 3 (JSON Schema)

**Risk of rollback**: Very low (changes are localized, non-breaking)

---

## Next Steps

1. ✅ Implementation plan approved by user
2. Create `backlog.yaml` with trackable tasks
3. Update sprint status to `in-progress`
4. Execute phases 1-7 sequentially
5. Validate in agent-dev context before completion
6. Create PR and complete sprint

---

## Approvals

**Lead Implementor**: claude-code
**Sprint Owner**: claude-code
**Status**: Awaiting user approval

---

## Appendix A: Zod Coercion Reference

### Supported Formats

**Boolean**:
- `"true"` → `true`
- `"false"` → `false`
- `"1"` → `true`
- `"0"` → `false`
- `1` → `true`
- `0` → `false`

**Number**:
- `"123"` → `123`
- `"3.14"` → `3.14`
- `"-42"` → `-42`
- `"1e6"` → `1000000`

**Invalid**:
- `"yes"`, `"no"`, `"on"`, `"off"` → **NOT** coerced to boolean (rejected)
- `"abc"`, `"12px"`, `"$100"` → **NOT** coerced to number (rejected)

### Zod API

```typescript
// Boolean coercion
z.coerce.boolean()  // Accepts string|number|boolean, coerces to boolean

// Number coercion
z.coerce.number()   // Accepts string|number, coerces to number

// Combined with optional
z.coerce.boolean().optional()  // Optional boolean with coercion

// Combined with default
z.coerce.number().default(100)  // Number with coercion and fallback
```

---

## Appendix B: Tools Audit Matrix

| Category | Tool Name | Boolean Params | Number Params | Total Changes |
|----------|-----------|---------------|---------------|---------------|
| Messaging | message.send | waitForResponse | timeoutMs | 2 |
| Messaging | event.send | waitForResponse | timeoutMs | 2 |
| Fleet | fleet.logs | - | limit | 1 |
| Fleet | fleet.trace | - | - | 0 |
| Agent-Dev | agent_dev.provision | - | - | 0 |
| Agent-Dev | agent_dev.start | - | - | 0 |
| Agent-Dev | agent_dev.stop | - | - | 0 |
| Agent-Dev | agent_dev.destroy | confirm | - | 1 |
| Persistence | db.query | - | limit, offset | 2 |
| Config | config.show | - | - | 0 |
| Config | config.validate | - | - | 0 |
| Config | config.doctor | - | - | 0 |
| **TOTAL** | **12 tools** | **3 params** | **5 params** | **8 changes** |

**Summary**: 8 parameter changes across 5 tools (out of 12 total tools).
