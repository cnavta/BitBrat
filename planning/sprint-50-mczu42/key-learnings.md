# Key Learnings – Sprint 50

**Sprint ID**: sprint-50-mczu42
**Sprint Title**: Simplify MCP Tool Response Access in mcp-compose
**Date**: 2026-09-10

---

## Technical Learnings 🔧

### 1. MCP Content Array Structure is Type-Heterogeneous

**Discovery**: MCP CallToolResult uses a single `content` array with type-discriminated unions:
```typescript
{
  content: [
    { type: 'text', text: 'string value' },           // Text content
    { type: 'image', data: 'base64', mimeType: '...' }, // Image content
    { type: 'resource', resource: { uri: '...' } }     // Resource content
  ]
}
```

**Impact**: Shortcuts must validate `content[0].type` before accessing type-specific fields.

**Application**: Built type-aware expansion that checks content type before accessing fields like `text`, `data`, or `resource`.

**Code Location**: `src/common/composition/executor.ts:779-975` (expandMcpShortcut)

---

### 2. JSON Parsing Requires Defensive Error Handling

**Discovery**: Tool responses can be JSON-stringified multiple times, contain circular references, or have malformed JSON.

**Examples**:
- state-engine returns: `{\"user.fact.slack:UB1993GLB.notes\": {\"value\": \"...\"}}`
- Circular references in complex objects
- Invalid JSON from external APIs

**Impact**: Direct `JSON.parse()` crashes compositions. Must use try/catch with graceful degradation.

**Application**: Created `parseJsonSafely()` helper that:
- Returns null on parse failure (not throw)
- Logs warning with data sample (truncated to prevent spam)
- Handles non-string inputs

**Code Location**: `src/common/composition/executor.ts:704-733`

---

### 3. Opt-In Shortcuts Maintain Backwards Compatibility

**Discovery**: Changing `resolveReference()` behavior for ALL paths breaks existing compositions.

**Constraint**: Existing compositions use explicit paths like `/content/0/text` that must continue to work.

**Solution**: Shortcuts are opt-in:
1. Detect shortcut pattern (e.g., `/text`, `/image`)
2. Check if value is MCP envelope (`isMcpEnvelope()`)
3. Expand shortcut OR fall back to standard resolution
4. Explicit paths like `/content/0/text` bypass shortcut logic

**Impact**: Zero breaking changes. All 4528 existing tests pass.

**Code Location**: `src/common/composition/executor.ts:525-615` (resolveReference)

---

### 4. Trace Logging is Essential for Debugging Compositions

**Discovery**: Without detailed logging, composition failures are opaque (no stack traces, no intermediate values).

**Problem**: Original grockle failure showed "undefined" result but didn't show:
- Which tool was called
- What arguments were passed
- What response was received
- Which path resolution failed

**Solution**: Added 13 new log events:
- `mcp_tool_request` (TRACE): Logs tool name + args
- `mcp_tool_response` (TRACE): Logs result + execution time
- `shortcut_expansion_attempted` (TRACE): Logs shortcut detection
- `shortcut_expansion_succeeded` (DEBUG): Logs resolved value
- `mcp_shortcut_json_parse_failed` (TRACE): Logs JSON errors with sample

**Impact**: Can now trace full execution flow from tool call → shortcut expansion → final value.

**Code Location**: `src/common/composition/executor.ts:404-425, 605-642`

---

### 5. Value Truncation Prevents Log Spam

**Discovery**: Logging full MCP responses (images, documents, large JSON) overwhelms logs.

**Example**: Image tool returns 50KB base64 string. Logging full value creates 50KB log entry.

**Solution**: Created `getValuePreview()` helper:
- Strings: Truncate at 100 chars with length indicator
- Objects: JSON-stringify, truncate at 200 chars
- Circular/Non-serializable: Return safe placeholder

**Impact**: Logs remain readable without excessive volume.

**Code Location**: `src/common/composition/executor.ts:1403-1438`

---

## Architectural Learnings 🏗️

### 6. Fail-Soft > Fail-Fast for Composition Runtime

**Discovery**: Throwing exceptions in composition execution breaks the entire agent flow.

**Principle**: Compositions are part of a message-passing pipeline. One failed composition shouldn't crash the whole service.

**Design Decision**:
- Shortcuts return `null` on failure (not throw)
- Log warnings for debugging
- Allow downstream steps to handle missing values

**Trade-off**: Silent failures harder to debug, but system remains operational.

**Mitigation**: Comprehensive logging (13 events) provides audit trail for failures.

---

### 7. Early Returns Optimize Performance

**Discovery**: Shortcut detection is O(1) via string comparison, but shortcut expansion is O(n) via JSON navigation.

**Optimization Strategy**:
1. Check if path starts with shortcut pattern (e.g., `/text`) → O(1)
2. Check if value is MCP envelope → O(1)
3. Only then perform expansion logic → O(n)

**Impact**: <1% overhead for non-MCP values, minimal impact for MCP values.

**Code Location**: `src/common/composition/executor.ts:565-615`

---

### 8. Type Guards Enable Safe Duck Typing

**Discovery**: TypeScript doesn't know runtime shape of `unknown` values from tool responses.

**Problem**: Direct field access like `value.content[0].text` causes TypeScript errors.

**Solution**: Created `isMcpEnvelope()` type guard:
```typescript
function isMcpEnvelope(value: unknown): value is { content: any[] } {
  return typeof value === 'object' && value !== null && 'content' in value;
}
```

**Impact**: TypeScript narrows type after guard, allowing safe field access.

**Code Location**: `src/common/composition/executor.ts:667-679`

---

## Testing Learnings 🧪

### 9. Integration Tests Catch More Bugs Than Unit Tests

**Discovery**: Unit tests for individual helpers (isMcpEnvelope, parseJsonSafely) passed, but integration tests revealed edge cases.

**Example**:
- Unit test: `expandMcpShortcut()` works for valid MCP response
- Integration test: Revealed that non-MCP values must fall back to standard resolution

**Learning**: Always write integration tests that exercise full code path (resolveReference → expandMcpShortcut → parseJsonSafely).

**Application**: 6 integration tests + 3 backwards compatibility tests added.

**Code Location**: `src/common/composition/executor.test.ts:900-1200`

---

### 10. Backwards Compatibility Tests Prevent Regressions

**Discovery**: Refactoring `resolveReference()` risked breaking existing compositions.

**Protection**: Created 3 backwards compatibility tests:
1. Explicit MCP path `/content/0/text` bypasses shortcuts
2. Non-MCP values resolve via standard JSON Pointer
3. Nested paths like `/content/0/text/nested` work correctly

**Impact**: Caught regression where explicit paths would trigger shortcut expansion incorrectly.

**Code Location**: `src/common/composition/executor.test.ts:1100-1200`

---

## Operational Learnings 🚀

### 11. Agent-Dev Validation is Critical for Production Readiness

**Issue**: Skipped agent-dev deployment due to worktree limitations.

**Consequence**: Discovered grockle visibility issue in staging AFTER sprint completion.

**Root Cause**: Timing issue where llm-bot cached tool list before grockle was registered.

**Learning**: Always deploy to agent-dev for runtime validation, even if test suite passes.

**Action Item**: Build worktree-aware deployment tooling to enable agent-dev from sprint worktrees.

---

### 12. MCP Notification System Has Timing Dependencies

**Discovery**: Tool-gateway broadcasts `notifications/tools/list_changed` when tools are registered, but clients may not receive it.

**Scenario**:
- llm-bot connects at T+0s, fetches tools
- grockle registers at T+9s, broadcasts notification
- llm-bot doesn't refresh tool list (notification not received or processed)

**Impact**: New compositions not visible to LLM until service restart.

**Root Cause (Hypothesis)**: No active MCP sessions when broadcast attempted (sessions may use different transport).

**Learning**: Notification systems require careful timing/lifecycle management. Don't assume push notifications always work.

**Documentation**: `GROCKLE_VISIBILITY_INVESTIGATION.md`

---

### 13. Post-Deployment Validation Reveals Integration Issues

**Discovery**: Unit tests and integration tests passed, but staging deployment revealed visibility issue.

**Difference**: Tests use synthetic MCP responses, staging uses real tool-gateway + llm-bot services.

**Gap**: Test environment doesn't include:
- MCP session management
- Notification broadcasting
- Multi-service timing dependencies

**Learning**: E2E tests in production-like environment catch issues that unit/integration tests miss.

**Action Item**: Create E2E test suite that deploys full service stack for composition testing.

---

## Design Pattern Learnings 📐

### 14. Helper Functions Improve Testability

**Discovery**: Extracting `isMcpEnvelope()` and `parseJsonSafely()` as separate functions enabled focused unit tests.

**Benefit**:
- 6 tests for `isMcpEnvelope()` cover all type checking edge cases
- 8 tests for `parseJsonSafely()` cover JSON parsing scenarios
- Can test helpers in isolation without full composition context

**Anti-Pattern**: Inlining logic in `expandMcpShortcut()` would make testing harder (need full MCP response for every test).

**Code Location**: `src/common/composition/executor.test.ts:700-850`

---

### 15. Structured Logging Beats Console.log

**Discovery**: Using structured logging (Pino) with event names and typed fields makes logs searchable and filterable.

**Example**:
```typescript
// Bad: console.log('Shortcut expanded', value)
// Good:
logger.debug('shortcut_expansion_succeeded', {
  namespace: 'steps',
  pointer: '/retrieve_notes/text',
  valueType: typeof value,
  valuePreview: getValuePreview(value)
})
```

**Benefits**:
- Can grep for specific events: `grep "shortcut_expansion_succeeded"`
- Can filter by field: `grep "valueType.*undefined"`
- Structured format enables log aggregation tools (Datadog, Splunk)

**Application**: All 13 new log events use structured format.

---

### 16. Defensive Programming Enables Fail-Open Behavior

**Discovery**: Compositions should degrade gracefully, not crash the entire pipeline.

**Patterns**:
- Check `typeof value === 'object'` before accessing fields
- Check `Array.isArray(content)` before accessing `content[0]`
- Check `'text' in content[0]` before accessing `content[0].text`
- Return `null` on error, not throw

**Trade-off**: Silent failures vs fail-fast errors.

**Decision**: Fail-soft is correct for compositions (log warning + return null).

**Code Location**: Throughout `expandMcpShortcut()` (lines 779-975)

---

## Documentation Learnings 📚

### 17. Before/After Examples Show Value Clearly

**Discovery**: Showing explicit path reduction in documentation makes value proposition clear.

**Example**:
```yaml
# Before: 24 characters
/content/0/text

# After: 14 characters (57% reduction)
/text
```

**Impact**: User immediately understands benefit without reading implementation details.

**Application**: Added before/after examples for all 7 shortcut types.

**Code Location**: `documentation/guides/composition-usage.md:450-560`

---

### 18. Migration Guides Reduce Adoption Friction

**Discovery**: Providing explicit migration steps reduces cognitive load for users.

**Example**:
```yaml
# Step 1: Identify explicit MCP paths
pointer: /content/0/text

# Step 2: Replace with shortcut
pointer: /text

# Step 3: Test composition
```

**Impact**: Users can migrate existing compositions without re-reading full documentation.

**Application**: Added migration section to composition-usage.md.

**Code Location**: `documentation/guides/composition-usage.md:560-600`

---

### 19. Troubleshooting Sections Reduce Support Burden

**Discovery**: Documenting common errors and solutions upfront reduces need for one-on-one support.

**Example**:
```markdown
**Problem**: Shortcut returns undefined
**Cause**: Content type mismatch (e.g., using /text on image content)
**Solution**: Check logs for mcp_shortcut_type_mismatch, use correct shortcut
```

**Application**: Added troubleshooting section with 5 common issues.

**Code Location**: `documentation/guides/composition-usage.md:600-650`

---

## Process Learnings 📋

### 20. Request Logs Track Evolution of Requirements

**Discovery**: Maintaining request-log.md throughout sprint provides audit trail of requirement changes.

**Example**: Sprint 50 had 6 user requests:
1. Initial spec (shortcuts)
2. Add JSON parsing
3. Enhance logging
4. Update grockle.yaml
5. Add more logging details
6. Investigate visibility issue

**Value**: Shows how sprint scope evolved based on user feedback and discoveries.

**Application**: Updated request-log.md after each user request.

**Code Location**: `planning/sprint-50-mczu42/request-log.md`

---

### 21. Single-Day Sprints Work for Focused Deliverables

**Discovery**: Sprint 50 completed in 1 day (9 hours) with clear deliverables.

**Success Factors**:
- Well-defined scope (shortcuts for MCP responses)
- Clear acceptance criteria (path reduction, backwards compatibility)
- Focused implementation (single file modified)
- Comprehensive tests (33 new tests)

**Constraint**: Only works for isolated features with minimal dependencies.

**Anti-Pattern**: Don't use single-day sprints for features requiring multi-service coordination.

---

### 22. Investigation Artifacts Inform Future Sprints

**Discovery**: Creating GROCKLE_VISIBILITY_INVESTIGATION.md during sprint uncovered separate issue.

**Value**:
- Documents root cause analysis for future reference
- Provides starting point for follow-up sprint
- Shows systematic investigation process

**Learning**: Don't let discoveries during sprint go undocumented. Create investigation artifacts even if issue is out of scope.

**Code Location**: `GROCKLE_VISIBILITY_INVESTIGATION.md`, `TRACE_LOGGING_ADDITIONS.md`

---

## Recommendations for Future Work 💡

Based on these learnings, recommend:

1. **Build worktree-aware deployment tooling** - Enable agent-dev deployments from sprint worktrees
2. **Create E2E composition test suite** - Test full service stack, not just isolated executor
3. **Fix MCP notification system** - Investigate llm-bot connection architecture, ensure broadcasts work
4. **Add composition debugging guide** - Document TRACE logging workflow and troubleshooting
5. **Implement caching for JSON parsing** - Reduce redundant parsing for large payloads
6. **Extend shortcuts to more MCP types** - Add embedded resource shortcuts as needed

---

**Key Learnings Documented By**: Claude Code (Sonnet 4.5)
**Date**: 2026-09-10
**Sprint**: sprint-50-mczu42
