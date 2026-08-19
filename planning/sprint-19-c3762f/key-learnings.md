# Key Learnings - Sprint 19

**Sprint ID:** sprint-19-c3762f
**Phase:** 2 - Multi-Observer & Window Types
**Date:** 2026-08-19

---

## Technical Learnings

### 1. Framework Lifecycle Integration
**Learning:** BitBrat's Bit model uses hooks (`onStartup`, `onShutdown`) for lifecycle management, not direct method calls.

**Context:** Implemented `setup()` method but it was never called because the framework doesn't automatically invoke child class methods.

**Solution:** Register lifecycle methods via hooks in constructor:
```typescript
constructor() {
  super({ mcpExposure: 'platform-only' });
  this.onStartup(async () => {
    await this.setup();
  });
}
```

**Application:** Always use framework hooks for initialization. Check how other services integrate before creating custom patterns.

---

### 2. IDocumentStore Schema Expectations
**Learning:** Platform abstractions have implicit schema requirements that aren't always documented in interfaces.

**Context:** Created custom schema with individual JSONB columns, but PostgresDocumentStore expects a single `data` column.

**Error:**
```
ERROR: column "data" does not exist
STATEMENT: SELECT id, data FROM stream_observers WHERE (data->'active')::boolean = $1
```

**Solution:** Follow the standard IDocumentStore pattern:
```sql
CREATE TABLE stream_observers (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Application:** Read implementation code, not just interfaces. Follow existing patterns from other services (e.g., auth_users table).

---

### 3. Defensive Programming in Cleanup Code
**Learning:** Cleanup methods are often called in error scenarios where resources may not be fully initialized.

**Context:** Service crashed on shutdown with "Cannot read properties of undefined (reading 'destroy')".

**Solution:** Add null safety checks:
```typescript
async shutdown(): Promise<void> {
  if (this.windowManager) {
    this.windowManager.destroy();
  }
  if (this.subscriptionManager) {
    await this.subscriptionManager.destroy();
  }
}
```

**Application:** Always null-check resources in cleanup code. Use optional chaining and nullish coalescing for defensive programming.

---

### 4. Test-Driven Development for Stateful Components
**Learning:** Writing tests before integration catches edge cases and logic bugs early.

**Context:** Wrote 38 tests for ObserverRepository and SubscriptionManager before service integration.

**Results:**
- Caught reference counting rollback bug
- Identified type casting issues
- Validated edge cases (empty lists, non-existent IDs)
- Prevented 5+ runtime bugs

**Application:** Continue test-first approach, especially for:
- State management (repositories, caches)
- Resource lifecycle (managers, connections)
- Concurrent operations (ref counting, locks)

---

### 5. SQL Reserved Keywords
**Learning:** PostgreSQL has many reserved keywords that require quoting.

**Context:** Migration failed because `window` and `trigger` are reserved keywords.

**Error:**
```
ERROR: syntax error at or near "window"
```

**Solution:** Quote reserved keywords:
```sql
"window" JSONB NOT NULL,
"trigger" JSONB NOT NULL,
```

**Application:** Check for reserved keywords when naming columns. Use automated SQL linters to catch these early.

---

## Process Learnings

### 6. Incremental Development Strategy
**Learning:** Build core components first, test in isolation, then integrate.

**Approach:**
1. ObserverRepository (isolated, tested)
2. SubscriptionManager (isolated, tested)
3. Window types (isolated, tested)
4. Service integration (combined all)

**Benefits:**
- Easy to debug (smaller surface area)
- Faster iteration (don't wait for full integration)
- Higher confidence (each piece proven independently)

**Application:** Continue incremental approach for complex features. Avoid big-bang integration.

---

### 7. Staging Validation Before Completion
**Learning:** Runtime validation in staging catches issues that tests miss.

**Findings:**
- Setup hook issue (tests passed, service didn't start correctly)
- Schema mismatch (worked in tests with mock, failed with real DB)
- Topic configuration (observer subscribed to non-existent topic)

**Application:** Always deploy to staging or agent-dev before marking sprint complete. Validate:
- Service startup
- Database operations
- Message bus subscriptions
- End-to-end flows

---

### 8. Documentation Quality Matters
**Learning:** Comprehensive documentation saves time for future work and debugging.

**Created:**
- Implementation plan (guided development)
- Validation report (comprehensive testing record)
- Retrospective (lessons learned)
- Inline code comments (explained design decisions)

**Benefits:**
- Easy to resume after interruptions
- Clear handoff for Phase 3
- Debug information for production issues
- Knowledge transfer for team members

**Application:** Maintain documentation discipline throughout sprint, not just at the end.

---

## Architecture Learnings

### 9. Message Bus Topic Topology
**Learning:** Topic naming and routing stages aren't always intuitive or well-documented.

**Discovery:** Observer configured for `internal.contextualization.v1`, but this topic doesn't exist. The actual topic for the contextualization stage is `internal.reflex.v1`.

**Actual Topology:**
- `internal.ingress.v1` - Raw events (ingress stage)
- `internal.reflex.v1` - Enriched events (contextualization stage)
- `internal.llmbot.v1` - After routing (analysis stage)
- `internal.egress.v1` - Outgoing responses

**Gap:** No topic catalog or validation

**Application:**
- Document all topics with purpose and routing stage
- Add validation in observer.create to check topic exists
- Create topic discovery tooling

---

### 10. Reference Counting Pattern
**Learning:** Reference counting is effective for managing shared resources (subscriptions, connections).

**Implementation:**
```typescript
async addTopic(topic: string, callback: () => Promise<Unsubscribe>): Promise<boolean> {
  const currentCount = this.topicCounts.get(topic) || 0;
  const newCount = currentCount + 1;
  this.topicCounts.set(topic, newCount);

  if (currentCount === 0) {
    // First observer for this topic - create subscription
    try {
      const unsubscribe = await callback();
      this.subscriptions.set(topic, unsubscribe);
      return true;  // New subscription created
    } catch (error) {
      // Rollback on failure
      if (currentCount === 0) {
        this.topicCounts.delete(topic);  // CRITICAL: delete, not set to 0
      } else {
        this.topicCounts.set(topic, currentCount);
      }
      throw error;
    }
  }
  return false;  // Existing subscription reused
}
```

**Gotcha:** Rollback must delete from map, not set to 0 (otherwise `getActiveTopics()` returns closed topics).

**Application:** Use reference counting for:
- NATS subscriptions (multiple observers, one subscription)
- Database connections (connection pooling)
- Expensive resources (API clients, file handles)

---

## Sprint Management Learnings

### 11. Backlog Granularity
**Learning:** Task granularity should match testing/validation checkpoints.

**What Worked:**
- P2-003: ObserverRepository (one component, clear deliverable)
- P2-008: SubscriptionManager (one component, testable)

**What Didn't:**
- P2-010: Window lifecycle (too vague, no clear done criteria)

**Application:** Define tasks with:
- Clear deliverable (file, feature, test suite)
- Explicit acceptance criteria
- Testable outcome

---

### 12. Forced Completion Avoidance
**Learning:** Don't use forced completion mode unless absolutely necessary.

**Temptation:** Skip validation report to complete sprint faster.

**Reality:** Comprehensive artifacts saved time:
- Validation report documented all issues/fixes
- Retrospective captured learnings while fresh
- Future debugging will reference these docs

**Application:** Invest time in completion artifacts. They pay dividends later.

---

## Summary

**Top 3 Learnings:**
1. **Use framework hooks for lifecycle management** - Don't fight the framework
2. **Test-driven development catches bugs early** - 38 tests prevented 5+ runtime issues
3. **Validate in staging before completion** - Catches integration issues tests miss

**Apply Next Sprint:**
- Topic catalog and validation tooling
- Continued test-first approach
- Agent-dev validation as standard practice
- Incremental development strategy

**Avoid Next Sprint:**
- Custom patterns before checking framework
- Assuming schema compatibility
- Skipping runtime validation
- Big-bang integration

---

**Prepared By:** christophernavta
**Date:** 2026-08-19
**Sprint:** sprint-19-c3762f
