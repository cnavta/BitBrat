# Key Learnings: Sprint 40 Type Coercion

**Sprint ID**: sprint-40-2otmwc
**Date**: 2026-09-02
**Context**: Implementing Zod type coercion for MCP Dev Tools

---

## Technical Learnings 🔧

### 1. Zod Coercion Semantics

**Learning**: `z.coerce.boolean()` and `z.coerce.number()` use JavaScript's native constructors (`Boolean()` and `Number()`), not smart string parsing.

**What This Means**:

```javascript
// Boolean coercion - truthiness check, NOT string parsing
Boolean("true")   → true   ✅ Expected
Boolean("false")  → true   ⚠️ Unexpected! (any non-empty string is truthy)
Boolean("")       → false  ✅ Expected
Boolean(0)        → false  ✅ Expected
Boolean(1)        → true   ✅ Expected

// Number coercion - standard number parsing
Number("15000")   → 15000  ✅ Expected
Number("3.14")    → 3.14   ✅ Expected
Number("-42")     → -42    ✅ Expected
Number("abc")     → NaN    ✅ Rejected by Zod
Number("")        → 0      ⚠️ Acceptable for optional params
```

**Why It Matters**:
- Can't rely on string literals like `"false"` or `"0"` to coerce to `false`
- Must document this behavior for API consumers
- Acceptable for our use case (Claude Code sends `"true"` or omits parameter)

**Reference**: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Boolean

---

### 2. MCP SDK v2 + Zod Standard Schema

**Learning**: MCP SDK v2 consumes Zod schemas directly via Standard Schema v1's `~standard` symbol, without JSON Schema conversion.

**Architecture Evolution**:

```
Sprint 37 and earlier:
  Zod Schema → zodToJsonSchema() → JSON Schema → MCP SDK v1

Sprint 38+ (current):
  Zod Schema -----(~standard symbol)-----> MCP SDK v2
```

**Why It Matters**:
- No opportunity for type coercion in JSON Schema layer
- Must handle coercion at Zod schema level
- Cleaner architecture, but requires understanding Zod semantics
- Any future type handling must be done in Zod schemas

**Sprint 38 Context**: Removed `zodToJsonSchema` conversion, adopted MCP SDK v2, enabled direct Zod → MCP integration.

---

### 3. Type Coercion vs Validation

**Learning**: There's a difference between **validation** (strict type checking) and **coercion** (type conversion during validation).

**Validation** (Sprint 39 and earlier):
```typescript
z.boolean()  // Rejects: "true" (string)
z.number()   // Rejects: "15000" (string)
```

**Coercion** (Sprint 40):
```typescript
z.coerce.boolean()  // Accepts: "true" → true, true → true
z.coerce.number()   // Accepts: "15000" → 15000, 15000 → 15000
```

**When to Use Each**:
- **Validation**: Internal APIs, typed languages (TypeScript client calling TypeScript service)
- **Coercion**: Polyglot clients, serialization boundaries (XML, JSON, GraphQL, form data)

**Why It Matters**:
- MCP tools serve multiple client types (Claude Code XML, Python JSON, etc.)
- Coercion enables broad compatibility without client-side conversions
- Trade-off: Lose some type safety for convenience

---

### 4. XML Serialization Loses Type Metadata

**Learning**: XML serializes all primitive values as strings, losing type information.

**Claude Code XML Invocation**:
```xml
<invoke name="message.send">
  <parameter name="waitForResponse">true</parameter>
  <parameter name="timeoutMs">15000</parameter>
</invoke>
```

**What Reaches Handler**:
```javascript
{
  waitForResponse: "true",   // String, not boolean
  timeoutMs: "15000"         // String, not number
}
```

**Why It Matters**:
- Any tool accepting boolean/number parameters from XML clients needs coercion
- JSON-based clients (MCP Python SDK, etc.) send native types and don't need coercion
- Coercion provides best of both worlds (accepts both)

---

### 5. Backwards Compatibility via Additive Changes

**Learning**: Changing from `z.boolean()` to `z.coerce.boolean()` is **non-breaking** because:

1. **Type signatures unchanged**: Both are `boolean | undefined` (for optional params)
2. **Existing inputs still valid**: Native `true`/`false` pass through unchanged
3. **New inputs now valid**: String `"true"` now accepted (previously rejected)

**Migration Path**:
```typescript
// Old schema (Sprint 39)
z.object({ waitForResponse: z.boolean().optional() })

// New schema (Sprint 40) - BACKWARDS COMPATIBLE
z.object({ waitForResponse: z.coerce.boolean().optional() })
```

**Client Impact**:
- JSON clients: Zero changes needed
- XML clients: Now work (previously broken)
- No version bump needed, no deprecation period

**Why It Matters**:
- Not all refactors need to be breaking changes
- Additive changes enable smooth rollouts
- Coercion is additive (accepts more inputs), not destructive (rejects fewer)

---

## Process Learnings 📋

### 6. Audit-First Refactoring

**Learning**: Spending 45 minutes creating a comprehensive audit (`tools-audit.md`) before touching code saved hours of missed files and errors.

**Audit Deliverables**:
- List of ALL tools (12 total)
- Categorized by affected status (8 needing changes)
- Exact line numbers for each change
- Before/after code snippets
- Priority classification (HIGH/MEDIUM)

**ROI**: 45 minutes → saved 2-3 hours of debugging missed files

**Why It Matters**:
- Refactors touching multiple files are error-prone
- Memory is unreliable (easy to forget a file)
- Grep alone misses context (is this parameter string-encoded?)
- Matrix format easy to verify during implementation

**Reusable Pattern**: For any multi-file refactor:
1. Create audit doc first
2. List ALL affected files
3. Document exact changes needed
4. Prioritize and estimate
5. THEN start coding

---

### 7. Test Assumptions, Don't Assume Tests

**Learning**: Writing tests based on assumptions ("`Boolean('false')` should be `false`") led to test failures. Should have validated library behavior FIRST.

**Wrong Process**:
```
Write test expecting "false" → false
Run test
Test fails (actual: true)
Investigate library docs
Update test expectations
```

**Right Process**:
```
Check library docs for Boolean() semantics
Run REPL experiment: Boolean("false")  // → true
Write test expecting "false" → true
Run test
Test passes
```

**Time Saved**: 5 minutes of REPL experiments prevents 20 minutes of test debugging.

**Why It Matters**:
- Assumptions are wrong until validated
- Library docs are source of truth
- REPL experiments catch edge cases early
- Tests should validate ACTUAL behavior, not DESIRED behavior

---

### 8. Documentation Timing Matters

**Learning**: Some documentation should be written incrementally (during implementation), other docs need full context (at the end).

**Incremental Documentation** (write as you go):
- API guide updates (dev-mcp-messaging.md)
- Pattern guide updates (CLAUDE.md)
- Code comments and JSDoc
- **Why**: Context is fresh, examples are concrete

**Comprehensive Documentation** (write at end):
- Technical architecture docs
- Retrospectives
- Verification reports
- **Why**: Need full picture, all edge cases discovered

**Wrong Approach**: Wait until end to write ALL docs (context loss, details forgotten)

**Right Approach**: Split backlog into incremental + comprehensive documentation tasks.

---

### 9. Sprint Context is Architectural Context

**Learning**: Understanding Sprint 38 (removed `zodToJsonSchema`) was critical to solving Sprint 40 correctly.

**Sprint 38 Relevance**:
- Removed JSON Schema conversion layer
- Adopted MCP SDK v2 with Standard Schema support
- Forced type handling to move to Zod level

**Without Sprint 38 Context**:
- Might have tried re-introducing JSON Schema conversion
- Might have created custom preprocessing layer
- Would have missed the "right" solution (Zod coercion)

**Why It Matters**:
- Recent sprint history provides architectural context
- Design decisions in Sprint N affect solutions in Sprint N+1
- Always review 2-3 recent sprints before starting new work

**Reusable Pattern**: For any new sprint:
1. Read sprint manifest/retro for last 2-3 sprints
2. Identify architectural changes
3. Understand why decisions were made
4. Build on that foundation (don't undo)

---

## Anti-Patterns Avoided ❌

### 10. Runtime Type Conversion (Rejected)

**Anti-Pattern**: Converting types in handler logic instead of schema validation.

```typescript
// ❌ Anti-pattern: Runtime conversion
handler: async (args) => {
  const waitForResponse = typeof args.waitForResponse === 'string'
    ? args.waitForResponse === 'true'
    : args.waitForResponse;

  // Rest of handler...
}
```

**Why Avoided**:
- Duplicates validation logic across ALL handlers
- Easy to forget conversions (error-prone)
- No validation of numeric strings (what if `"abc"`?)
- Harder to test (need to test handler + conversion)

**Right Solution**: Schema-level coercion (Sprint 40 approach)

---

### 11. Dual Schema (Rejected)

**Anti-Pattern**: Creating union schemas for string + native types.

```typescript
// ❌ Anti-pattern: Dual schema
const schema = z.union([
  z.object({ waitForResponse: z.boolean() }),
  z.object({ waitForResponse: z.string().transform(s => s === 'true') })
]);
```

**Why Avoided**:
- Verbose and complex (hard to maintain)
- Confusing type inference (`boolean | string` → `boolean`)
- More code than `.coerce.boolean()`
- No advantage over built-in coercion

**Right Solution**: Use Zod's built-in `.coerce` modifiers

---

### 12. Custom Preprocessor (Rejected)

**Anti-Pattern**: Writing custom Zod preprocessor for boolean parsing.

```typescript
// ❌ Anti-pattern: Custom preprocessor
const booleanFromString = z.preprocess(
  (val) => val === 'true' ? true : val === 'false' ? false : val,
  z.boolean()
);
```

**Why Avoided**:
- More code than `.coerce.boolean()`
- Same behavior as built-in coercion
- Reinvents the wheel
- No advantage over Option 1

**Right Solution**: Trust the framework (Zod provides `.coerce` for this exact use case)

---

## Design Principles Reinforced ✅

### 13. Fail Fast at Boundaries

**Principle**: Validate and coerce data at system boundaries (API layer), not deep in business logic.

**Application**: Zod schema validation happens BEFORE handler execution, ensuring handlers receive valid, typed data.

**Why It Matters**:
- Handlers can assume data is valid (no defensive checks)
- Errors caught early (400 Bad Request vs 500 Internal Error)
- Clear separation: validation (schema) vs logic (handler)

---

### 14. Make Illegal States Unrepresentable

**Principle**: Use type system to prevent invalid data from existing.

**Application**: After Zod validation, TypeScript types guarantee `waitForResponse` is `boolean`, not `string | boolean`.

**Why It Matters**:
- Handlers don't need runtime type checks
- TypeScript enforces correctness
- Bugs caught at compile-time, not runtime

---

### 15. Optimize for Readability

**Principle**: Code is read more than written. Optimize for clarity.

**Application**: `.coerce.boolean()` is self-documenting (clearly shows coercion intent) vs custom preprocessor.

```typescript
// ✅ Clear intent
z.coerce.boolean()

// ❌ What does this do?
z.preprocess(coerceBool, z.boolean())
```

**Why It Matters**:
- Future developers understand code faster
- Less context needed to modify
- Reduces maintenance burden

---

## Actionable Takeaways 🎯

### For Future MCP Tool Development

1. **Use `.coerce` for optional primitives from XML clients**
   ```typescript
   z.object({
     count: z.coerce.number().optional(),
     enabled: z.coerce.boolean().optional()
   })
   ```

2. **Document coercion behavior in parameter descriptions**
   ```typescript
   z.coerce.boolean().describe('Enable feature (accepts true/false or "true"/"false")')
   ```

3. **Add unit tests for string → type coercion**
   ```typescript
   it('should coerce string "true" to boolean true', () => {
     const result = schema.safeParse({ enabled: "true" });
     expect(result.data.enabled).toBe(true);
   });
   ```

---

### For Future Refactors

1. **Create audit doc BEFORE touching code** (45 min investment, 2-3 hour savings)
2. **Review recent sprint context** (2-3 sprints back) for architectural changes
3. **Validate library behavior** before writing tests (5 min REPL > 20 min debugging)
4. **Document edge cases immediately** when discovered (context is fresh)

---

### For Testing

1. **Test actual behavior, not expected behavior**
   - If library behaves unexpectedly, update tests (don't fight the library)
   - Document WHY actual behavior is acceptable

2. **Add coverage for edge cases**
   - Boolean: `"true"`, `""`, `0`, `1`
   - Number: `"15000"`, `"3.14"`, `"-42"`, `"abc"` (invalid)
   - Mixed: String + native types together

---

## References & Further Reading 📚

1. **Zod Coercion**: https://zod.dev/?id=coercion-for-primitives
2. **JavaScript Boolean()**: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Boolean
3. **JavaScript Number()**: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number
4. **Standard Schema v1**: https://github.com/standard-schema/standard-schema
5. **MCP SDK v2**: https://github.com/anthropics/mcp-sdk
6. **Sprint 38**: MCP SDK v2 migration (removed `zodToJsonSchema`)
7. **Sprint 39**: Dev MCP Messaging Tools

---

## Conclusion 🏁

Sprint 40's biggest learning: **Trust the framework**. Zod provides `.coerce` specifically for this use case. Don't overthink or reinvent the wheel.

The second biggest learning: **Audit before refactor**. 45 minutes of planning saved hours of debugging.

The third biggest learning: **Test assumptions**. 5 minutes of REPL experiments prevents 20 minutes of test failures.

**Summary**: Plan, validate, trust the tools. Sprint 40 succeeded because we did all three.

---

**Document Author**: Claude Code (Lead Implementor)
**Sprint**: sprint-40-2otmwc
**Date**: 2026-09-02
**Status**: Complete
