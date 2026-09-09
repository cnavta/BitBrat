# Sprint 44 Key Learnings

**Sprint ID**: sprint-44-cbcszm
**Topic**: Fixing MCP Tool Parameter Validation Issues
**Date**: 2026-09-07

---

## Core Technical Learnings

### 1. MCP XML Protocol Array Serialization

**Problem**: MCP's XML protocol serializes array parameters as JSON strings

**Why**: XML cannot natively represent JavaScript arrays, so MCP serializes them as JSON strings

**Solution**: Add preprocessing in tool handlers to parse JSON strings before validation

**Pattern**:
```typescript
// Before Zod validation:
if (typeof args.parameterName === 'string') {
  try {
    const parsed = JSON.parse(args.parameterName);
    if (Array.isArray(parsed)) {
      args.parameterName = parsed;
    }
  } catch (e) {
    // Leave as string for Zod validation error
  }
}
```

**Applicability**: Use for any MCP tool accepting array parameters

---

### 2. Zod Has No Built-in Array Coercion

**Discovery**: `z.coerce` works for primitives but not arrays

**Why**:
- `z.coerce.number()` converts `"123"` → `123` ✅
- `z.coerce.array()` doesn't exist ❌
- `z.array()` requires native JavaScript array

**Workarounds**:
1. **Preprocessing** (chosen): Parse JSON before validation
2. **Custom Transform**: Use `z.union()` with `z.string().transform()`
3. **Pipe**: Use `z.preprocess()` (more complex)

**Recommendation**: Use preprocessing for clarity and maintainability

---

### 3. Graceful Error Handling for Preprocessing

**Pattern**: Let validation catch errors, don't throw in preprocessing

**Why**:
- Invalid JSON should produce clear Zod validation error
- Users understand "expected array" better than "JSON.parse failed"
- Fail-open pattern: preserve original value on parse failure

**Code**:
```typescript
try {
  const parsed = JSON.parse(args.level);
  if (Array.isArray(parsed)) {
    args.level = parsed;  // Only replace if valid array
  }
  // Non-array JSON: leave as string, Zod will catch it
} catch (e) {
  // Invalid JSON: leave as string, Zod will catch it
}
```

---

## Process Learnings

### 1. Test in Production First

**Traditional Approach**: Read code → hypothesize bug → test

**Better Approach**: Test first → observe failure → read code

**Why**:
- Real errors are more informative than theoretical analysis
- Saves time by focusing on actual problem
- Reveals edge cases you wouldn't think of

**This Sprint**: Testing in staging revealed exact error message, which led directly to root cause

---

### 2. Planning Time Is Development Time

**Observation**: 30 minutes of planning saved 2+ hours of debugging

**Process**:
1. Write detailed implementation plan
2. Document all test cases upfront
3. Evaluate solution approaches before coding

**Result**: Implementation went smoothly with no surprises

**Lesson**: "An hour of planning saves a day of debugging" - but 30 minutes is often enough

---

### 3. Unit Tests Validate MCP Tool Changes

**Discovery**: MCP tool changes can't be tested in staging

**Why**: Dev-mcp server runs as separate process with compiled code

**Solution**: Write comprehensive unit tests

**Pattern**:
- Mock dependencies (LogRetriever, FleetClient)
- Call handler function directly with test inputs
- Assert expected outputs

**This Sprint**: 6 new tests validated fix without needing staging deployment

---

### 4. Agent-Dev Is For Services, Not Dev Tools

**Realization**: Agent-dev context is for testing BitBrat *services*, not dev-mcp tools

**When to use agent-dev**:
- ✅ Testing message handlers
- ✅ Testing database queries
- ✅ Testing service integration
- ❌ Testing dev-mcp tools (use unit tests instead)

**Why**: Dev-mcp server is external to BitBrat services

---

## Reusable Patterns

### Pattern 1: MCP Array Parameter Preprocessing

**Use Case**: Any MCP tool accepting array parameters

**Implementation**:
```typescript
// Add before Zod validation in handler
if (typeof args.arrayParam === 'string') {
  try {
    const parsed = JSON.parse(args.arrayParam);
    if (Array.isArray(parsed)) {
      args.arrayParam = parsed;
    }
  } catch (e) {
    // Ignore, let Zod validation handle it
  }
}
```

**Files to Check**: Other tools in `tools/brat/src/dev-mcp/tools/`

---

### Pattern 2: Comprehensive Parameter Testing

**Use Case**: Testing complex parameter types

**Test Cases**:
1. Valid input (native type)
2. Valid input (string-serialized)
3. Invalid format (should fail)
4. Wrong type (should fail)
5. Edge cases (empty, single element)

**This Sprint**: 6 tests covered all scenarios for array parameter

---

### Pattern 3: Backward-Compatible Fixes

**Approach**: Preserve existing behavior, add new capability

**How**:
- Check type before converting
- Only transform if needed
- Validate after transformation

**Result**: Native arrays still work, JSON strings now work too

---

## Documentation Insights

### 1. Commit Messages Should Tell a Story

**Structure**:
1. What (one-line summary)
2. Why (root cause)
3. How (solution approach)
4. Tests (validation)
5. Impact (before/after)

**This Sprint**: Comprehensive commit message helps future developers understand the fix

---

### 2. Sprint Artifacts Are Learning Material

**Created**:
- issues-discovered.md → Root cause analysis
- implementation-plan.md → Solution design
- verification-report.md → Test results
- retro.md → Process improvements
- key-learnings.md → Reusable patterns

**Value**: Future sprints can reference these as examples

---

## Recommendations for Future Work

### Short Term

1. **Search for Similar Issues**: Check other MCP tools for array parameters
2. **Add Dev-MCP Testing Guide**: Document unit test requirements
3. **Create Preprocessing Utility**: Reusable function for array preprocessing

### Long Term

1. **MCP SDK Update**: Request built-in JSON parsing for array parameters
2. **Custom Zod Schemas**: Create reusable `z.coerce.jsonArray()` helper
3. **Automated Testing**: Add CI check for MCP tool parameter types

---

## Takeaways

### For Developers

1. Always test MCP tools with both native and string-serialized parameters
2. Use preprocessing for complex type conversions
3. Write comprehensive unit tests for parameter handling

### For Architects

1. MCP XML protocol has serialization limitations
2. Consider preprocessing layer for all MCP tools
3. Document parameter handling patterns

### For Process

1. Plan before coding (30 min planning saves hours)
2. Test in production first (real errors guide investigation)
3. Document learnings (helps future sprints)

---

**Key Learnings Documented**: 2026-09-07
**Applicable To**: All MCP tool development
**Status**: ✅ READY FOR REFERENCE
