# Implementation Plan: Test Suite Remediation
**Sprint**: sprint-9-0az9n9
**Goal**: Fix 22 failing test suites identified in npm test run
**Owner**: christophernavta
**Status**: Planning → Awaiting Approval

## Executive Summary

This sprint addresses 5 distinct test failures (appearing in 22 test suite instances across main repo and worktree locations):

1. **extract-config.test.ts**: REGION field extraction failure
2. **processor.memory.spec.ts**: Memory trimming logic not filtering oldest messages from conversation state
3. **event-router-ingress.integration.test.ts**: Wrong topic (snapshot vs DLQ) published when no routing rules match
4. **pubsub-subscriber.ensure.test.ts**: Jest mock hoisting issue with dynamic imports
5. **agent-dev-e2e.test.ts**: Missing duplicate context name validation

## Test Failure Analysis

### 1. extract-config.test.ts (2 instances)

**Location**:
- `infrastructure/scripts/extract-config.test.ts:14`
- `.worktrees/sprint-8-uhh8fj/infrastructure/scripts/extract-config.test.ts:14`

**Failure**:
```
expect(received).toBe(expected) // Object.is equality
Expected: "us-central1"
Received: undefined
```

**Root Cause**:
- Test expects `REGION` to be `'us-central1'` for `oauth-flow` service
- `architecture.yaml` has NO region defined for `oauth-flow` or in deployment defaults
- `extract-config.js` line 59 attempts to extract region from multiple sources but all are undefined
- Platform-agnostic refactoring (Sprint 8) removed region as a required field

**Fix Options**:
1. **Option A (Recommended)**: Update test to expect `undefined` for REGION (aligns with platform-agnostic approach)
2. **Option B**: Add region to architecture.yaml `deploymentDefaults.cloud-run` for backward compatibility

**Selected Approach**: Option A - Update test expectations to match platform-agnostic reality

---

### 2. processor.memory.spec.ts (2 instances)

**Location**:
- `src/services/llm-bot/processor.memory.spec.ts:114`
- `.worktrees/sprint-8-uhh8fj/src/services/llm-bot/processor.memory.spec.ts:114`

**Failure**:
```
expect(received).not.toContain(expected) // indexOf
Expected substring: not "one"
Received string: "## [Conversation State / History]..."
```

**Root Cause**:
- Test sets `LLM_BOT_MEMORY_MAX_MESSAGES='2'` to keep only last 2 messages
- Adds 3 prompts: "one" (oldest), "two", "three" (newest)
- Expects "one" to be trimmed from conversation state section
- Memory trimming logic is not properly excluding the oldest message

**Investigation Needed**:
- Read `src/services/llm-bot/processor.ts` to understand memory trimming implementation
- Identify where conversation history is constructed vs task prompts

**Expected Fix**:
- Update memory trimming to properly filter oldest messages when `MAX_MESSAGES` limit is reached
- Ensure conversation state section excludes trimmed messages while task section may still include them

---

### 3. event-router-ingress.integration.test.ts (1 instance)

**Location**:
- `.worktrees/sprint-8-uhh8fj/src/apps/__tests__/event-router-ingress.integration.test.ts:95`

**Failure**:
```
expect(received).toBe(expected) // Object.is equality
Expected: "dev.internal.router.dlq.v1"
Received: "dev.internal.persistence.snapshot.v1"
```

**Root Cause**:
- When no routing rules match, router should publish to DLQ topic
- Currently publishing to `internal.persistence.snapshot.v1` instead
- Mock returns empty rules (`{ docs: [] }`) which should trigger DLQ fallback
- Router logic is likely defaulting to snapshot topic instead of DLQ

**Investigation Needed**:
- Read `src/apps/event-router-service.ts` to understand routing logic
- Identify where default/fallback topic is selected when no rules match

**Expected Fix**:
- Update event router to publish to `INTERNAL_ROUTER_DLQ_V1` when no routing rules match
- Ensure snapshot topic is only used for actual persistence events, not routing fallbacks

---

### 4. pubsub-subscriber.ensure.test.ts (2 instances)

**Location**:
- `src/services/message-bus/__tests__/pubsub-subscriber.ensure.test.ts:49`
- `.worktrees/sprint-8-uhh8fj/src/services/message-bus/__tests__/pubsub-subscriber.ensure.test.ts:49`

**Failure**:
```
expect(jest.fn()).toHaveBeenCalledWith(...expected)
Expected: "internal.ingress.v1"
Number of calls: 0
```

**Root Cause**:
- Test uses `jest.doMock('@google-cloud/pubsub')` with dynamic import
- `jest.doMock()` is NOT hoisted, so mock may not apply to the import
- Mock `topic()` function is never called because `PubSub` class is not properly mocked

**Fix**:
- Replace `jest.doMock()` with `jest.mock()` at the top of file (before imports)
- Use `jest.mock()` which IS hoisted and applies before module resolution
- Ensure mock is reset between tests with `jest.resetModules()` in `beforeEach`

**Constraints**:
- Must use Jest's module mocking correctly for ES module dynamic imports
- Alternative: Use `jest.unstable_mockModule()` for ESM but this requires experimental flag

---

### 5. agent-dev-e2e.test.ts (1 instance)

**Location**:
- `tools/brat/src/dev-mcp/agent-dev-e2e.test.ts:193`

**Failure**:
```
expect(received).rejects.toThrow()
Received promise resolved instead of rejected
Resolved to value: {"gateway": {...}, "name": "agent-dev-test-duplicate", ...}
```

**Root Cause**:
- Test provisions context with name `'agent-dev-test-duplicate'`
- Then tries to provision again with same name
- Expects second call to throw `'already exists'` error
- Instead, second provision succeeds (returns resolved promise)

**Investigation Needed**:
- Read `tools/brat/src/dev-mcp/agent-dev-context-manager.ts`
- Check `provision()` method for duplicate name validation
- Verify ephemeral-contexts.yaml loading logic

**Expected Fix**:
- Add duplicate context name check in `AgentDevContextManager.provision()`
- Before creating env directory, check if context name already exists in ephemeral-contexts.yaml
- Throw descriptive error: `Context '<name>' already exists`

**Implementation Pattern**:
```typescript
async provision(opts?: ProvisionOptions): Promise<ProvisionResult> {
  const name = opts?.name || generateContextName();

  // Load existing contexts
  const existingContexts = await this.loadEphemeralContexts();
  if (existingContexts[name]) {
    throw new Error(`Context '${name}' already exists`);
  }

  // Continue with provisioning...
}
```

---

## Implementation Steps

### Phase 1: Investigation & Code Reading (30 min)
1. Read `src/services/llm-bot/processor.ts` - memory trimming logic
2. Read `src/apps/event-router-service.ts` - routing/DLQ logic
3. Read `tools/brat/src/dev-mcp/agent-dev-context-manager.ts` - provision() method
4. Document findings in request-log.md

### Phase 2: Test Fixes (60 min)
1. **Fix extract-config.test.ts** (10 min)
   - Update line 14: `expect(json.REGION).toBe(undefined);` or `expect(json.REGION).toBeUndefined();`
   - Add comment explaining platform-agnostic approach removed required region

2. **Fix pubsub-subscriber.ensure.test.ts** (15 min)
   - Move `jest.mock('@google-cloud/pubsub', () => {...})` to top of file (before imports)
   - Remove `jest.doMock()` calls
   - Update test to use proper module mocking pattern

3. **Fix processor.memory.spec.ts** (20 min)
   - Locate memory trimming logic in `src/services/llm-bot/processor.ts`
   - Update trimming to properly exclude oldest messages from conversation state
   - May require updating test expectations if trimming works differently than expected

4. **Fix event-router-ingress.integration.test.ts** (10 min)
   - Locate routing logic in `src/apps/event-router-service.ts`
   - Update default/fallback topic from snapshot to DLQ when no rules match
   - Or update test expectation if current behavior is correct

5. **Fix agent-dev-e2e.test.ts** (15 min)
   - Add duplicate validation in `AgentDevContextManager.provision()`
   - Load ephemeral contexts before provisioning
   - Throw error if context name already exists

### Phase 3: Validation (20 min)
1. Run full test suite: `npm test`
2. Verify all 22 failing tests now pass
3. Ensure no new failures introduced
4. Run specific test files individually to confirm fixes

### Phase 4: Documentation (15 min)
1. Update request-log.md with all changes
2. Create verification-report.md documenting:
   - Tests fixed
   - Root causes
   - Solutions implemented
   - Test results

---

## Success Criteria

- ✅ All 22 failing test suites pass
- ✅ No new test failures introduced
- ✅ Test changes align with platform-agnostic architecture
- ✅ Code changes maintain backward compatibility
- ✅ Request log documents all investigation and changes

---

## Risk Assessment

**Low Risk**:
- extract-config.test.ts fix (test expectation only)
- pubsub-subscriber.ensure.test.ts fix (test mocking only)
- agent-dev-e2e.test.ts fix (adds validation, no behavior change)

**Medium Risk**:
- processor.memory.spec.ts fix (may require logic change in processor)
- event-router-ingress.integration.test.ts fix (may change routing behavior)

**Mitigation**:
- Thoroughly test memory trimming with various scenarios
- Verify event routing behavior matches expected flow
- Run integration tests to ensure no downstream breakage

---

## Dependencies

**None** - All fixes are self-contained within test files or targeted implementation files.

---

## Estimated Effort

- Investigation: 30 min
- Implementation: 60 min
- Testing: 20 min
- Documentation: 15 min
- **Total**: ~2 hours

---

## Notes

- Some failures appear in both main repo and `.worktrees/sprint-8-uhh8fj/` - fixes will apply to both
- Sprint 8 architecture.yaml refactoring introduced platform-agnostic changes that broke region-dependent tests
- AgentDevContextManager missing validation is likely oversight in Sprint 358 implementation
- Memory trimming failure suggests logic doesn't distinguish between task prompts and conversation state
