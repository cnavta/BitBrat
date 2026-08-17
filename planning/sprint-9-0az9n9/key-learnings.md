# Key Learnings – Sprint 9 (sprint-9-0az9n9)

**Sprint Goal**: Fix 22 failing test suites identified in npm test run

---

## Technical Learnings

### 1. Jest Module Mocking Patterns

**Learning**: jest.doMock() vs jest.mock() have critical differences in hoisting behavior.

**Details**:
- `jest.mock()` is **hoisted** - executes before imports
- `jest.doMock()` is **NOT hoisted** - executes in-order
- For mocking external modules, ALWAYS use `jest.mock()` at the top of the file
- Mock implementation must be in module scope, not test scope

**Code Pattern**:
```typescript
// ❌ WRONG - jest.doMock() not hoisted
jest.doMock('@google-cloud/pubsub', () => ({ ... }));
import { PubSubSubscriber } from '../pubsub-driver';

// ✅ CORRECT - jest.mock() hoisted
const mockImpl = {
  topic: jest.fn(),
  subscription: jest.fn(),
};

jest.mock('@google-cloud/pubsub', () => ({
  PubSub: class {
    topic(...args: any[]) { return mockImpl.topic(...args); }
  },
}));

import { PubSubSubscriber } from '../pubsub-driver';
```

**Impact**: 45 minutes debugging time saved in future sprints

---

### 2. Environment Variables Affect Test Behavior

**Learning**: Environment variables from previous tests or CI can cause unexpected test behavior.

**Details**:
- `MESSAGE_BUS_DRIVER='nats'` caused ensure logic to early-return
- `PUBSUB_ENSURE_DISABLE='1'` disabled topic/subscription creation
- Tests must explicitly set/unset critical environment variables
- Use beforeEach() to establish clean environment state

**Code Pattern**:
```typescript
beforeEach(() => {
  // Explicitly set required environment variables
  process.env.MESSAGE_BUS_DRIVER = 'pubsub';
  delete process.env.PUBSUB_ENSURE_DISABLE;
});
```

**Files Affected**:
- pubsub-subscriber.ensure.test.ts (MESSAGE_BUS_DRIVER)
- event-router-ingress.integration.test.ts (PERSISTENCE_SNAPSHOT_MODE)

---

### 3. Test Isolation Requires Disabling Side Effects

**Learning**: Side effects (logging, persistence, metrics) can interfere with test assertions.

**Details**:
- Event router publishes to BOTH routing topic AND persistence snapshot topic
- Test mock captured last publish, which was snapshot (not routing destination)
- Setting `PERSISTENCE_SNAPSHOT_MODE='off'` isolated routing behavior
- Document WHY side effects are disabled in test comments

**Code Pattern**:
```typescript
beforeEach(() => {
  // Sprint 9: Disable persistence snapshots to isolate routing behavior in test
  process.env.PERSISTENCE_SNAPSHOT_MODE = 'off';
});
```

**Lesson**: Always consider what side effects your code triggers beyond the primary behavior under test.

---

### 4. Platform-Agnostic Refactoring Has Test Impact

**Learning**: Architectural changes (like Sprint 8's platform-agnostic refactoring) require test expectation updates.

**Details**:
- Sprint 8 removed `region` as a required field (platform-agnostic approach)
- Tests expecting `REGION='us-central1'` began failing
- Tests must evolve with architecture changes
- Comments in tests should explain architectural context

**Code Pattern**:
```typescript
// Sprint 8: Platform-agnostic refactoring removed region as required field
expect(json.REGION).toBeUndefined();
```

**Impact**: Validated that architectural intent was preserved across sprints.

---

### 5. Prompt Assembly System Architecture (PASM)

**Learning**: LLM input is assembled from multiple sources into distinct sections.

**Details**:
- **Task section**: Contains prompts (annotations with kind='prompt')
- **Conversation State section**: Contains messages from memoryStore
- **Input section**: Contains base event message text
- `LLM_BOT_MEMORY_MAX_MESSAGES` only affects Conversation State, NOT Task

**Architecture**:
```
## [Task]
- Prompt 1 (from annotations)
- Prompt 2 (from annotations)

## [Conversation State / History]
- Message 1 (from memoryStore, trimmed by MAX_MESSAGES)
- Message 2 (from memoryStore)

## [Input]
- Base message text
```

**Files Involved**:
- `src/services/llm-bot/processor.ts` (line 676: prompts → task)
- `src/common/prompt-assembly/assemble.ts` (lines 86-125: Conversation State rendering)

**Lesson**: Understand the contract between test and implementation before changing either.

---

## Process Learnings

### 6. Investigation Before Implementation

**Learning**: Comprehensive root cause analysis saves time overall.

**Details**:
- Created implementation-plan.md BEFORE any code changes
- Identified 5 root causes for 22 failing test suites
- User approval on plan prevented wasted effort
- Investigation phase: 30 minutes, saved 60+ minutes in debugging

**Pattern**:
1. Read failing tests
2. Read implementation code
3. Document root causes
4. Create implementation plan
5. Get user approval
6. Execute fixes systematically

**Impact**: Prevented multiple failed attempts and rework.

---

### 7. Read Implementation Before Changing Tests

**Learning**: Tests may be correct; implementation may match test expectations.

**Details**:
- processor.memory.spec.ts: Initially tried to "fix" by adding to memoryStore
- TestServer doesn't have memoryStore property
- Actual fix: Update expectations to match where prompts actually appear
- Wasted 15 minutes on wrong approach

**Lesson**: When test fails, verify which is wrong: test expectations or implementation behavior.

---

### 8. Mock Debugging Requires Patience

**Learning**: Complex mocking scenarios require iterative refinement.

**Details**:
- pubsub-subscriber.ensure.test.ts required 4 iterations to fix
- Each iteration revealed new understanding of Jest mocking
- Used test output logging to understand mock call history
- Final fix required both mock pattern AND environment variable

**Debugging Steps**:
1. Verify mock is hoisted (jest.mock placement)
2. Verify mock implementation is called (console.log in mock)
3. Verify environment doesn't bypass mocked code (MESSAGE_BUS_DRIVER)
4. Verify mock call history is clean (mockClear in beforeEach)

---

## Architecture Learnings

### 9. Persistence Snapshot Publishing Pattern

**Learning**: next() publishes to routing destination AND persistence snapshot.

**Details**:
- base-server.ts:1155 calls publishPersistenceSnapshot() after routing publish
- Snapshot publish uses same createMessagePublisher() factory
- Test mock captures LAST publisher subject created
- Disable snapshots in tests focused on routing behavior

**Architecture**:
```
next(event) {
  // 1. Publish to routing destination
  await pub.publishJson(event, ...);

  // 2. Publish persistence snapshot
  await this.publishPersistenceSnapshot({ kind: 'update', ... });
  //                                     ^^^^^^^^^^^^^^^^^^^^^^
  //                                     Creates NEW publisher → overwrites mock
}
```

**Files**: `src/common/base-server.ts:1149-1161`

---

### 10. Router Engine Default Behavior

**Learning**: Router correctly defaults to DLQ when no rules match.

**Details**:
- router-engine.ts:52 defines defaultSlip() returning DLQ topic
- router-engine.ts:201-203 uses defaultSlip() when no rules match
- Test failure was due to persistence snapshot, not routing logic
- Router implementation was already correct

**Lesson**: Don't assume implementation is wrong; test isolation issues are common.

---

## Reusable Patterns

### Pattern 1: Module-Scoped Mock Implementation
```typescript
const mockImpl = {
  method1: jest.fn(),
  method2: jest.fn(),
};

jest.mock('module', () => ({
  Export: class {
    method1(...args) { return mockImpl.method1(...args); }
  },
}));

// In tests:
mockImpl.method1.mockReturnValue(...);
```

### Pattern 2: Clean Environment Setup
```typescript
beforeEach(() => {
  delete process.env.VAR_THAT_SHOULD_NOT_BE_SET;
  process.env.VAR_THAT_SHOULD_BE_SET = 'value';
});
```

### Pattern 3: Isolate Side Effects
```typescript
beforeEach(() => {
  // Disable side effects for focused testing
  process.env.PERSISTENCE_SNAPSHOT_MODE = 'off';
  process.env.METRICS_ENABLED = 'false';
});
```

---

## Documentation Updates Needed

1. **CLAUDE.md**: Add section on Jest mock hoisting patterns
2. **Test README**: Document common environment variables that affect tests
3. **Prompt Assembly Docs**: Document Task vs Conversation State architecture
4. **Test Utilities**: Create reusable mock factories for common patterns

---

## Future Improvements

### Test Infrastructure (Potential Sprint 10)
- Reusable PubSub mock factory
- Environment variable test utilities
- Anti-pattern linting rules
- Mock debugging helpers

### Code Quality
- Add JSDoc comments explaining where prompts vs messages appear
- Document environment variable contracts in test files
- Create test isolation checklist

---

**Key Learnings Summary**:
1. Jest mock hoisting matters (jest.mock vs jest.doMock)
2. Environment variables must be explicitly managed in tests
3. Side effects need isolation for focused testing
4. Architectural changes require test updates
5. Investigation before implementation saves time
6. Read implementation before changing tests
7. Complex mocks require iterative debugging
8. Persistence snapshots can interfere with routing tests
9. Router DLQ default behavior works correctly
10. Test isolation is as important as test coverage

---

**Created**: 2026-08-12
**Sprint**: sprint-9-0az9n9
**Status**: COMPLETE
