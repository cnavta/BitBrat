# Execution Plan: MCP Tool Response Shortcuts

**Sprint**: sprint-50-mczu42
**Role**: Lead Implementor
**Created**: 2026-09-10
**Based on**: technical-architecture.md
**Total Estimated Effort**: 12-17 hours

---

## 1. Overview

### 1.1 Goal

Implement path shortcuts for MCP tool responses in mcp-compose to simplify composition authoring by:
1. Eliminating verbose `/content/0/text` paths → `/text`
2. Adding `/json` parsing for nested JSON property access
3. Maintaining 100% backwards compatibility

### 1.2 Success Criteria

- All shortcuts work correctly (text, image, resource, JSON)
- Existing compositions unchanged (backwards compatible)
- Performance overhead <1% (non-JSON), <5ms (JSON <10KB)
- Test coverage ≥95%
- Agent-dev validation successful

### 1.3 Files Modified

**Core Implementation** (1 file):
- `src/common/composition/executor.ts` (~180 LOC added)

**Tests** (1 file):
- `src/common/composition/executor.test.ts` (~250 LOC added)

**Examples** (1 file):
- `examples/compositions/grockle.yaml` (migrate to shortcuts)

**Documentation** (create if needed):
- `documentation/guides/composition-usage.md` or inline comments

---

## 2. Development Phases

### Phase 1: Core Implementation (5-7 hours)

**Goal**: Implement all helper functions and integrate into reference resolution

#### Task 1.1: Implement `isMcpEnvelope()` Helper
**File**: `src/common/composition/executor.ts`
**Lines**: ~600-610
**Estimated**: 30 minutes

**Implementation**:
```typescript
/**
 * Detect MCP CallToolResult envelope format
 */
private isMcpEnvelope(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;

  const envelope = value as any;
  return (
    Array.isArray(envelope.content) &&
    envelope.content.length > 0 &&
    typeof envelope.content[0] === 'object' &&
    'type' in envelope.content[0]
  );
}
```

**Verification**:
- Returns `true` for valid MCP envelope
- Returns `false` for empty content, null, non-objects
- No side effects

---

#### Task 1.2: Implement `parseJsonSafely()` Helper
**File**: `src/common/composition/executor.ts`
**Lines**: ~610-650
**Estimated**: 1 hour

**Implementation**:
```typescript
/**
 * Safely parse JSON with error handling
 *
 * @param value - String value to parse
 * @param pathSegments - Path segments (for logging)
 * @returns Parsed object or null if parse fails
 */
private parseJsonSafely(value: string, pathSegments: string[]): unknown | null {
  if (typeof value !== 'string') {
    this.logger.warn('json_parse_not_string', {
      pathSegments,
      valueType: typeof value,
    });
    return null;
  }

  try {
    const parsed = JSON.parse(value);

    this.logger.debug('json_parse_succeeded', {
      pathSegments,
      resultType: Array.isArray(parsed) ? 'array' : typeof parsed,
    });

    return parsed;
  } catch (error) {
    this.logger.warn('json_parse_failed', {
      pathSegments,
      error: error instanceof Error ? error.message : String(error),
      valueSample: value.substring(0, 100), // Log first 100 chars for debugging
    });
    return null;
  }
}
```

**Verification**:
- Parses valid JSON objects and arrays
- Returns `null` for invalid JSON (graceful degradation)
- Returns `null` for non-string input
- Logs warnings with contextual information
- No exceptions propagate

---

#### Task 1.3: Implement `expandMcpShortcut()` Helper (Base Structure)
**File**: `src/common/composition/executor.ts`
**Lines**: ~650-750
**Estimated**: 2 hours

**Implementation** (base structure):
```typescript
/**
 * Expand MCP shortcut paths
 *
 * @param envelope - MCP CallToolResult object
 * @param shortcut - First segment after stepId (e.g., 'text', 'image', 'content')
 * @param rest - Remaining path segments
 * @returns Resolved value or null if no expansion applies
 */
private expandMcpShortcut(
  envelope: any,
  shortcut: string,
  rest: string[]
): unknown | null {
  const content = envelope.content;
  if (!Array.isArray(content) || content.length === 0) {
    return null; // Invalid envelope
  }

  const firstItem = content[0];
  const itemType = firstItem.type;

  // Text content shortcuts (with /json support)
  if (shortcut === 'text') {
    if (itemType === 'text') {
      const value = firstItem.text;

      // Check for JSON parsing shortcut: /stepId/text/json/...
      if (rest.length > 0 && rest[0] === 'json') {
        const parsed = this.parseJsonSafely(value, rest);
        if (parsed !== null) {
          const remainingPath = rest.slice(1); // Remove 'json' segment
          return remainingPath.length > 0
            ? this.getByPointer(parsed, '/' + remainingPath.join('/'))
            : parsed;
        }
        return null; // JSON parse failed
      }

      return rest.length > 0 ? this.getByPointer(value, '/' + rest.join('/')) : value;
    }
    return null; // Not text type
  }

  // Image content shortcuts
  if (shortcut === 'image' || shortcut === 'data') {
    if (itemType === 'image') {
      const value = firstItem.data;
      return rest.length > 0 ? this.getByPointer(value, '/' + rest.join('/')) : value;
    }
    return null;
  }

  if (shortcut === 'mimeType') {
    if (itemType === 'image') {
      return firstItem.mimeType;
    }
    return null;
  }

  // Resource content shortcuts
  if (shortcut === 'uri' || shortcut === 'resource') {
    if (itemType === 'resource') {
      const resource = firstItem.resource;
      if (shortcut === 'uri') {
        return resource?.uri;
      } else {
        return rest.length > 0 ? this.getByPointer(resource, '/' + rest.join('/')) : resource;
      }
    }
    return null;
  }

  // Error flag (top-level field, no array indexing)
  if (shortcut === 'isError') {
    return envelope.isError;
  }

  // Not a recognized shortcut
  return null;
}
```

**Verification**:
- Text shortcuts work (basic `/text`)
- JSON shortcuts work (`/text/json/...`)
- Image shortcuts work (`/image`, `/data`, `/mimeType`)
- Resource shortcuts work (`/uri`, `/resource/*`)
- Error flag accessible (`/isError`)
- Returns `null` for unrecognized shortcuts (fallback)
- Returns `null` for wrong content types (fallback)

---

#### Task 1.4: Modify `resolveReference()` to Integrate Shortcuts
**File**: `src/common/composition/executor.ts`
**Lines**: ~524-600 (modify existing method)
**Estimated**: 1.5 hours

**Implementation** (modify existing method):
```typescript
private resolveReference(
  ref: Reference,
  input: unknown,
  context: unknown,
  stepState: StepState
): unknown {
  const { namespace, pointer } = ref.$ref;

  this.logger.trace('reference_resolution_started', {
    namespace,
    pointer,
  });

  // 1. Determine namespace target
  let target: unknown;
  if (namespace === 'input') target = input;
  else if (namespace === 'context') target = context;
  else if (namespace === 'steps') target = stepState;
  else {
    this.logger.error('reference_resolution_invalid_namespace', {
      namespace,
      pointer,
    });
    throw new ExecutionError(
      CompositionErrorCode.INVALID_NAMESPACE,
      `Invalid reference namespace: ${namespace}`,
      `reference`
    );
  }

  // 2. Parse pointer into segments
  const segments = pointer.split('/').filter(s => s.length > 0);

  // 3. Check if this is a step reference with potential shortcut
  if (namespace === 'steps' && segments.length >= 2) {
    const [stepId, shortcut, ...rest] = segments;
    const stepResult = (target as StepState)[stepId];

    // 4. Detect if stepResult is MCP envelope format
    if (this.isMcpEnvelope(stepResult)) {
      this.logger.trace('shortcut_expansion_attempted', {
        stepId,
        shortcut,
        restSegments: rest.length,
      });

      const expanded = this.expandMcpShortcut(stepResult, shortcut, rest);
      if (expanded !== null) {
        // Shortcut expansion succeeded
        this.logger.debug('shortcut_expansion_succeeded', {
          stepId,
          shortcut,
          hasValue: expanded !== undefined,
        });
        return expanded;
      }
      // Fall through to standard resolution if expansion failed
      this.logger.trace('shortcut_expansion_fallback', {
        stepId,
        shortcut,
      });
    }
  }

  // 5. Standard JSON Pointer traversal (fallback)
  const value = this.getByPointer(target, pointer);

  this.logger.trace('reference_resolution_succeeded', {
    namespace,
    pointer,
    hasValue: value !== undefined,
  });

  return value;
}
```

**Verification**:
- Shortcut expansion attempted for steps namespace
- Fallback to standard resolution works
- Existing non-shortcut paths unchanged
- Logging provides debugging visibility

---

#### Task 1.5: Add Comprehensive Logging
**File**: `src/common/composition/executor.ts`
**Integrated in**: Tasks 1.1-1.4
**Estimated**: Included in above tasks

**Logging Events**:
- `shortcut_expansion_attempted` (trace)
- `shortcut_expansion_succeeded` (debug)
- `shortcut_expansion_fallback` (trace)
- `json_parse_succeeded` (debug)
- `json_parse_failed` (warn)
- `json_parse_not_string` (warn)

**Verification**:
- All key decision points logged
- Warnings for failures (no errors)
- Trace logs for debugging

---

### Phase 2: Testing (4-5 hours)

**Goal**: Achieve ≥95% test coverage with comprehensive edge case handling

#### Task 2.1: Unit Tests for `isMcpEnvelope()`
**File**: `src/common/composition/executor.test.ts`
**Lines**: ~900-920
**Estimated**: 30 minutes

**Test Cases**:
1. Valid MCP envelope → `true`
2. Empty content array → `false`
3. Non-object input → `false`
4. Null/undefined → `false`
5. Object without `content` field → `false`
6. Content array with non-object items → `false`

**Verification**: All edge cases covered, 100% branch coverage

---

#### Task 2.2: Unit Tests for `parseJsonSafely()`
**File**: `src/common/composition/executor.test.ts`
**Lines**: ~920-950
**Estimated**: 45 minutes

**Test Cases**:
1. Valid JSON object → parsed object
2. Valid JSON array → parsed array
3. Invalid JSON → `null`
4. Non-string input → `null`
5. Empty string → `null`
6. Nested JSON → correctly parsed
7. Logging on parse failure → warning logged
8. Logging on success → debug logged

**Verification**: All edge cases covered, error handling tested

---

#### Task 2.3: Unit Tests for `expandMcpShortcut()` (Basic Shortcuts)
**File**: `src/common/composition/executor.test.ts`
**Lines**: ~950-1000
**Estimated**: 1 hour

**Test Cases**:
1. `/text` shortcut for text content → text value
2. `/image` shortcut for image content → data value
3. `/data` shortcut for image content → data value
4. `/mimeType` shortcut for image content → MIME type
5. `/uri` shortcut for resource content → URI value
6. `/resource/field` shortcut → nested resource field
7. `/isError` shortcut → error flag value
8. Wrong content type (text shortcut on image) → `null`
9. Unrecognized shortcut → `null`
10. Nested path segments → correct traversal

**Verification**: All shortcuts work, type mismatches handled

---

#### Task 2.4: Unit Tests for `/json` Shortcut
**File**: `src/common/composition/executor.test.ts`
**Lines**: ~1000-1050
**Estimated**: 1 hour

**Test Cases**:
1. `/text/json/field` for valid JSON object → field value
2. `/text/json/nested/field` for nested object → nested value
3. `/text/json/0/field` for JSON array → array item field
4. `/text/json` with no path → full parsed object
5. Invalid JSON in `/text/json/field` → `null`
6. Missing property in parsed JSON → `undefined`
7. `/text/json` on non-text content → `null`
8. Large JSON payload → parses successfully

**Verification**: JSON parsing works, edge cases handled

---

#### Task 2.5: Integration Tests for `resolveReference()`
**File**: `src/common/composition/executor.test.ts`
**Lines**: ~1050-1100
**Estimated**: 1 hour

**Test Cases**:
1. Text shortcut in step reference → resolved value
2. JSON shortcut in step reference → parsed + navigated value
3. Explicit path (no shortcut) → standard resolution
4. Non-MCP response → standard resolution (fallback)
5. Multiple shortcuts in same composition → all work
6. Input/context namespaces → unchanged behavior

**Verification**: End-to-end reference resolution works

---

#### Task 2.6: Backwards Compatibility Tests
**File**: `src/common/composition/executor.test.ts`
**Estimated**: 30 minutes

**Test Cases**:
1. Run existing test suite → all pass
2. Explicit `/content/0/text` paths → still work
3. Non-shortcut paths → unchanged behavior
4. Compositions without MCP envelopes → no regression

**Verification**: Zero breaking changes confirmed

---

### Phase 3: Validation (2-3 hours)

**Goal**: Validate in realistic environment and ensure performance requirements met

#### Task 3.1: Update Example Compositions
**File**: `examples/compositions/grockle.yaml`
**Estimated**: 30 minutes

**Changes**:
1. Replace `/content/0/text` with `/text`
2. Add comment showing old vs. new syntax
3. Verify composition still executes correctly

**Verification**: Example composition uses shortcuts, still works

---

#### Task 3.2: Deploy to Agent-Dev Context
**Estimated**: 1 hour

**Steps**:
1. Provision agent-dev context
2. Deploy all services with changes
3. Register `grockle` composition (with shortcuts)
4. Execute composition with test data
5. Verify output correct
6. Check logs for shortcut expansion events

**Verification**:
- Composition executes successfully
- Shortcuts work in production-like environment
- Logs show expected behavior

---

#### Task 3.3: Performance Validation
**Estimated**: 1 hour

**Benchmarks**:
1. Run existing composition suite → baseline timing
2. Run same suite with shortcuts → measure overhead
3. Verify overhead <1% for non-JSON shortcuts
4. Benchmark JSON parsing (1KB, 10KB, 100KB payloads)
5. Verify JSON parse <5ms for <10KB

**Verification**: Performance requirements met

---

### Phase 4: Documentation (1-2 hours)

**Goal**: Document shortcuts for composition authors

#### Task 4.1: Update Composition Guide
**File**: `documentation/guides/composition-usage.md` or create if needed
**Estimated**: 1 hour

**Content**:
1. Overview of shortcuts
2. Examples for each shortcut type
3. JSON parsing examples
4. When to use vs. explicit paths
5. Backwards compatibility note

**Verification**: Guide complete, examples runnable

---

#### Task 4.2: Add Inline Code Comments
**File**: `src/common/composition/executor.ts`
**Estimated**: 30 minutes

**Comments**:
1. JSDoc for `isMcpEnvelope()`
2. JSDoc for `parseJsonSafely()`
3. JSDoc for `expandMcpShortcut()`
4. Inline comments for complex logic

**Verification**: Code well-documented, intent clear

---

## 3. Task Dependencies

```
Phase 1 (Core Implementation):
  Task 1.1 (isMcpEnvelope) → Task 1.3, Task 1.4
  Task 1.2 (parseJsonSafely) → Task 1.3
  Task 1.3 (expandMcpShortcut) → Task 1.4
  Task 1.4 (resolveReference) → Phase 2

Phase 2 (Testing):
  Phase 1 complete → All Phase 2 tasks
  Task 2.1-2.5 can run in parallel
  Task 2.6 (backwards compat) → after 2.1-2.5

Phase 3 (Validation):
  Phase 2 complete → Task 3.1, 3.2
  Task 3.1 → Task 3.2
  Task 3.2 → Task 3.3

Phase 4 (Documentation):
  Phase 3 complete → Task 4.1, 4.2
  Task 4.1, 4.2 can run in parallel
```

---

## 4. Risk Mitigation

### Risk 1: Performance Regression
**Likelihood**: Low
**Impact**: Medium
**Mitigation**: Benchmark before/after, optimize if needed
**Contingency**: Add caching if >1% overhead detected

### Risk 2: Edge Cases in JSON Parsing
**Likelihood**: Medium
**Impact**: Low
**Mitigation**: Comprehensive test coverage, fail-soft design
**Contingency**: Add size limits if DoS risk identified

### Risk 3: Backwards Compatibility Break
**Likelihood**: Very Low
**Impact**: High
**Mitigation**: Extensive backwards compat tests, fallback design
**Contingency**: Revert changes, investigate, fix

---

## 5. Verification Checklist

**Before Merge**:
- [ ] All unit tests pass (≥95% coverage)
- [ ] Integration tests pass
- [ ] Backwards compatibility tests pass
- [ ] Agent-dev validation successful
- [ ] Performance benchmarks within requirements
- [ ] Documentation complete
- [ ] Code review approved
- [ ] No console errors or warnings in logs

**Deployment Readiness**:
- [ ] Feature branch rebased on main
- [ ] All conflicts resolved
- [ ] CI/CD pipeline green
- [ ] Sprint artifacts updated

---

## 6. Timeline

**Optimistic** (12 hours):
- Phase 1: 5 hours
- Phase 2: 4 hours
- Phase 3: 2 hours
- Phase 4: 1 hour

**Realistic** (14-15 hours):
- Phase 1: 6 hours
- Phase 2: 4.5 hours
- Phase 3: 2.5 hours
- Phase 4: 1.5 hours

**Pessimistic** (17 hours):
- Phase 1: 7 hours
- Phase 2: 5 hours
- Phase 3: 3 hours
- Phase 4: 2 hours

**Recommended**: Plan for 15 hours (realistic + buffer)

---

## 7. Success Metrics

**Code Quality**:
- Test coverage ≥95%
- Zero linting errors
- Zero TypeScript errors
- All tests green

**Functional**:
- All shortcuts work correctly
- JSON parsing handles edge cases
- Backwards compatibility maintained

**Performance**:
- Non-JSON overhead <1%
- JSON parsing <5ms for <10KB

**Documentation**:
- Guide complete with examples
- Code well-commented
- Migration path clear

---

**End of Execution Plan**

**Prepared by**: Claude Code (Lead Implementor role)
**Sprint**: sprint-50-mczu42
**Date**: 2026-09-10
**Status**: Ready for Implementation
