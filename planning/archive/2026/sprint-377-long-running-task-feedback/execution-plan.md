# Sprint 377: Long-Running Task Feedback - Execution Plan

**Sprint ID:** 377
**Author:** Lead Implementor
**Date:** 2026-07-31
**Status:** READY FOR EXECUTION
**Revised:** 2026-07-31 (Deferred Phase 4, Simplified Service Integration)

---

## Executive Summary

This execution plan breaks down the Sprint 377 technical architecture into **43 discrete, trackable tasks** organized across **4 implementation phases** spanning **7-8 days**. The plan prioritizes infrastructure foundation first (derived events, middleware), then progressive enhancement (LLM generation, annotation validation), and finally service integration and production readiness.

**Critical Path:** Derived Event Utility → Feedback Middleware → Event-Router Rule → LLM-Bot Integration

**Key Simplifications:**
- **User preferences deferred** to future sprint (holistic user settings system)
- **Progress tracking only at llm-bot level** (avoids nested timeout complexity)
- **LLM leverages original message** for contextual progress generation

**Risk Areas:**
- LLM latency impacting UX (mitigated with fast model, fallback templates)
- Event-router rule misconfiguration (mitigated with comprehensive seed tests)
- Feedback failures blocking operations (mitigated with try-catch isolation)

---

## Nested Progress Handling Strategy

### Sprint 377 Approach: Single-Level Tracking

**Problem:** The llm-bot → tool-gateway → image-gen-mcp call chain creates nested operations. Adding progress tracking at multiple levels causes:
- Duplicate progress messages
- Timeout complexity (already an issue)
- Confusing user experience
- correlationId tracking complexity

**Solution for Sprint 377:** **Track only at llm-bot (highest level)**

```
User Request → llm-bot adds operation_context
                  ↓
            Feedback middleware watches elapsed time
                  ↓
            Progress: "🤔 Thinking about your request..."
                  ↓
            llm-bot → tool-gateway → image-gen-mcp (no progress tracking)
                  ↓
            Final response delivered
```

**Why this works:**
- Covers all request types (LLM-only and tool-using)
- Simple implementation
- Avoids nested timeout issues
- LLM can generate contextual messages using original user message

**Example:**
```
User: !image a sunset over mountains
[2s] Bot: 🎨 Working on your sunset over mountains image...
[5s] Bot: 🎨 Still creating your image...
[12s] Bot: Image generated! https://...
```

The LLM generates contextual progress because the derived progress event **includes the original message**, allowing the LLM to reference the user's intent.

---

### Future Sprint Consideration: Smart Nested Detection

**Concept:** Allow multiple services to annotate with operation_context, but middleware detects nested operations and suppresses duplicate progress.

**How it would work:**
1. Check if event has `derived_from` annotation chain
2. If event is already derived (nested operation), skip progress tracking
3. Only track progress for "root" user-initiated events

**Benefits:**
- Flexibility to add leaf-level tracking (image-gen-mcp)
- Automatic suppression prevents duplicates
- Services can opt-in without coordination

**Implementation notes for future sprint:**
```typescript
// In feedback-middleware.ts (future enhancement)
private isNestedOperation(event: InternalEventV2): boolean {
  // Check if this event is derived from another event
  const derivedFrom = event.annotations?.find(a => a.kind === 'derived_from');
  return !!derivedFrom;
}

async beforeNext(event: InternalEventV2): Promise<void> {
  // Skip progress for nested operations
  if (this.isNestedOperation(event)) {
    this.logger.debug('Skipping progress for nested operation', {
      correlationId: event.correlationId,
      originalId: getOriginalCorrelationId(event),
    });
    return;
  }

  // Normal progress tracking
  // ...
}
```

**Defer to:** Sprint 378+ (Nested Progress Detection)

---

## Phase Breakdown

### Phase 1: Foundation (Days 1-3)
**Goal:** Core infrastructure for progress feedback with template messages

**Key Deliverables:**
- Derived Event Utility (`src/common/events/derived-event.ts`)
- Feedback Middleware (`src/common/middleware/feedback-middleware.ts`)
- QoS extensions for progress preferences
- Unit test coverage >80%

**Dependencies:** None (foundational work)

**Validation Criteria:**
- Unit tests pass with >80% coverage
- Integration test: Template message sent after 2s threshold
- No impact on existing event flows

---

### Phase 2: LLM-Generated Progress (Days 4-5)
**Goal:** Contextual progress messages via existing pipeline

**Key Deliverables:**
- Event-router rule for `chat.progress.v1`
- Prompt template library leveraging original message context
- **llm-bot annotation handling updates** (NEW - critical)
- Seed data updates (Firestore/PostgreSQL)
- Integration test: chat.progress.v1 → llm-bot → egress

**Dependencies:** Phase 1 complete

**Validation Criteria:**
- Event-router correctly routes progress events to llm-bot
- **llm-bot correctly handles new annotation types** (prompt, progress_context, derived_from)
- LLM generates contextual messages <2s (p95)
- Messages reference original user intent
- Messages are concise (<100 chars) and relevant

---

### Phase 3: LLM-Bot Integration (Days 6-7)
**Goal:** Enable progress feedback in llm-bot for all user requests

**Key Deliverables:**
- llm-bot: Add operation_context annotation for all user requests
- Configuration flags: PROGRESS_ENABLED, PROGRESS_USE_CUSTOM
- Staging deployment
- Smoke tests

**Dependencies:** Phase 2 complete

**Validation Criteria:**
- LLM requests show progress after 2s
- Tool-using requests show progress during processing
- No errors in staging logs
- User feedback positive (informal testing)

**Note:** No progress tracking in tool-gateway or image-gen-mcp (avoids nested complexity)

---

### Phase 4: Monitoring & Production Readiness (Day 7-8)
**Goal:** Observability and production deployment

**Key Deliverables:**
- Structured logging for progress lifecycle
- Metrics: latency, failure rate
- Error handling: LLM timeout → template fallback
- Documentation: architecture, user guide, troubleshooting

**Dependencies:** Phase 3 complete

**Validation Criteria:**
- All metrics available in logs
- Error rate <1%
- Documentation complete and accurate
- Smoke tests pass on staging
- Production deployment successful

---

## Deferred Features (Future Sprints)

### Sprint 378+: User Preferences System
**Deferred from original Phase 4**

**Rationale:** User preferences should be handled holistically across the platform, not just for progress messages. A comprehensive user settings system should include:
- Progress message preferences (enabled/disabled)
- Notification preferences
- Personality preferences
- Platform-specific preferences
- Admin preferences

**Planned features:**
- User preference storage (PostgreSQL/Firestore)
- Preference enforcement in feedback middleware
- Chat command: `!settings progress on|off`
- Preference UI (web dashboard)
- Default preferences per platform

**Estimated effort:** 2-3 days (when addressed holistically)

---

### Sprint 379+: Nested Progress Detection
**Smart middleware detection of nested operations**

**Features:**
- Middleware detects derived_from annotation chains
- Suppresses progress for nested operations
- Allows leaf services (image-gen-mcp) to opt-in
- Prevents duplicate progress messages

**Estimated effort:** 1-2 days

---

### Sprint 380+: Platform-Specific Strategies
**Advanced platform features**

**Features:**
- Slack: Message editing (update same message)
- Discord: Typing indicators
- Twitch: Rate-limited sequential messages
- Progress percentage ("45% complete")
- Multi-step progress ("Step 1/3 ✅")

**Estimated effort:** 3-5 days

---

## Task Dependencies (Critical Path)

```
PHASE 1 FOUNDATION
├─ TASK-377-001: Derived Event Utility
│  ├─ TASK-377-002: createDerivedEvent() function
│  ├─ TASK-377-003: createProgressEvent() wrapper
│  └─ TASK-377-004: Traceability helpers
│
├─ TASK-377-005: QoS Type Extensions
│  └─ TASK-377-006: Update InternalEventV2 interface
│
├─ TASK-377-007: Feedback Middleware (foundation)
│  ├─ TASK-377-008: Threshold detection logic
│  ├─ TASK-377-009: Stage determination (initial/update/timeout)
│  ├─ TASK-377-010: Progress tracking state
│  └─ TASK-377-011: Template message generation
│
├─ TASK-377-012: Bit Integration
│  └─ TASK-377-013: Inject middleware into next()
│
└─ TASK-377-014: Unit Tests (Phase 1)
   ├─ TASK-377-015: Derived event tests
   ├─ TASK-377-016: Feedback middleware tests
   └─ TASK-377-017: Template message tests

PHASE 2 LLM GENERATION
├─ TASK-377-018: Prompt Template Library
│  ├─ TASK-377-019: Generic prompts leveraging original message
│  └─ TASK-377-020: Stage-specific prompt variations
│
├─ TASK-377-020a: llm-bot Annotation Handling (NEW - CRITICAL)
│  ├─ TASK-377-020a: Review llm-bot annotation handling logic
│  ├─ TASK-377-020b: Update llm-bot to handle new annotation types
│  └─ TASK-377-020c: Update prompt assembly for progress events
│
├─ TASK-377-021: Event-Router Rule
│  ├─ TASK-377-022: JsonLogic condition for chat.progress.v1
│  ├─ TASK-377-023: Routing slip configuration
│  └─ TASK-377-024: Annotation attachments
│
├─ TASK-377-025: Seed Data Updates
│  ├─ TASK-377-026: Add rule to seed-commands.json
│  └─ TASK-377-027: PostgreSQL migration (if needed)
│
└─ TASK-377-028: Integration Tests (Phase 2)
   ├─ TASK-377-029: chat.progress.v1 → llm-bot flow (depends on TASK-377-020c)
   └─ TASK-377-030: End-to-end with real LLM

PHASE 3 SERVICE INTEGRATION
├─ TASK-377-031: llm-bot Integration
│  └─ TASK-377-032: Add operation_context for all requests
│
└─ TASK-377-033: Staging Deployment
   ├─ TASK-377-034: Deploy to staging
   └─ TASK-377-035: Smoke tests

PHASE 4 MONITORING
├─ TASK-377-036: Structured Logging
├─ TASK-377-037: Metrics Collection
├─ TASK-377-038: Error Handling
├─ TASK-377-039: Documentation
└─ TASK-377-040: Production Validation
```

---

## Daily Schedule

### Day 1: Derived Events Foundation
- ✅ TASK-377-001 to TASK-377-004: Derived event utility
- ✅ TASK-377-015: Derived event tests
- **Milestone:** Reusable pattern for all future derived events

### Day 2: Feedback Middleware Core
- ✅ TASK-377-007 to TASK-377-011: Middleware implementation
- ✅ TASK-377-016: Middleware tests
- **Milestone:** Template messages working for long operations

### Day 3: Bit Integration + QoS
- ✅ TASK-377-005 to TASK-377-006: QoS extensions
- ✅ TASK-377-012 to TASK-377-013: Bit integration
- ✅ TASK-377-017: Phase 1 validation
- **Milestone:** Phase 1 complete

### Day 4: Prompt Engineering + llm-bot Annotation Handling
- ✅ TASK-377-018 to TASK-377-020: Prompt library
- ✅ TASK-377-020a to TASK-377-020c: **llm-bot annotation handling** (NEW - CRITICAL)
- ✅ TASK-377-021 to TASK-377-024: Event-router rule
- **Milestone:** Prompts ready, llm-bot can handle new annotations

### Day 5: Seed Data + Integration Tests
- ✅ TASK-377-025 to TASK-377-027: Seed data updates
- ✅ TASK-377-028 to TASK-377-030: Integration tests (validate annotation handling)
- **Milestone:** Phase 2 complete, LLM-generated messages working with correct annotation handling

### Day 6: LLM-Bot Integration
- ✅ TASK-377-031 to TASK-377-032: llm-bot operation_context
- **Milestone:** Service integration complete

### Day 7: Deployment + Monitoring
- ✅ TASK-377-033 to TASK-377-035: Staging deployment + smoke tests
- ✅ TASK-377-036 to TASK-377-038: Logging, metrics, error handling
- **Milestone:** Phase 3 complete

### Day 8: Documentation + Production
- ✅ TASK-377-039: Documentation
- ✅ TASK-377-040: Production validation and deployment
- **Milestone:** Sprint 377 complete

---

## Risk Mitigation Checklist

### LLM Latency Risk
- [ ] Use gpt-4o-mini (fast model)
- [ ] Set 3s timeout for LLM calls
- [ ] Implement fallback to template messages
- [ ] Measure p95 latency in staging

### Event-Router Misconfiguration Risk
- [ ] Comprehensive seed data tests
- [ ] Rule validation in brat setup
- [ ] Manual testing of routing logic
- [ ] Staging smoke tests before production

### Feedback Failure Risk
- [ ] Try-catch around all middleware code
- [ ] Log errors but continue operation
- [ ] Monitor error rate (<1% target)
- [ ] Alerting on high failure rate

### Nested Progress Risk
- [ ] Only llm-bot adds operation_context
- [ ] No tracking in tool-gateway or image-gen-mcp
- [ ] Document future nested detection strategy
- [ ] Test with tool-using requests

---

## Success Criteria

**Phase 1 Complete:**
- [ ] Unit tests pass with >80% coverage
- [ ] Template messages sent after 2s threshold
- [ ] No impact on existing flows

**Phase 2 Complete:**
- [ ] Event-router routes progress events correctly
- [ ] LLM generates contextual messages <2s (p95)
- [ ] Messages reference original user intent
- [ ] Messages concise and relevant

**Phase 3 Complete:**
- [ ] LLM requests show progress
- [ ] Tool-using requests show progress
- [ ] No errors in staging logs

**Phase 4 Complete:**
- [ ] All metrics available
- [ ] Error rate <1%
- [ ] Documentation complete
- [ ] Smoke tests pass

**Sprint 377 Success:**
- [ ] User satisfaction >80% (post-sprint survey)
- [ ] Progress message latency <500ms (p95)
- [ ] Feedback failure rate <1%
- [ ] Production deployment successful

---

## Rollback Plan

If critical issues arise during deployment:

1. **Disable via feature flag:**
   ```bash
   # env/staging/global.yaml
   PROGRESS_ENABLED: "false"
   ```

2. **Revert seed data:**
   ```bash
   npm run brat -- db:rollback --migration progress-rule
   ```

3. **Redeploy previous version:**
   ```bash
   git revert <commit-sha>
   npm run brat -- deploy services --all --context staging
   ```

---

## Updated Scope Summary

**Original Plan:** 49 tasks, 10 days, 88 hours
**Revised Plan:** 43 tasks, 7-8 days, 71 hours

**Removed:**
- Phase 4 (User Preferences): 7 tasks, ~15 hours → **Deferred to future sprint**
- image-gen-mcp integration: 2 tasks, ~4 hours → **Not needed (llm-bot only)**

**Added:**
- llm-bot annotation validation: 3 tasks, ~3 hours → **Validation and minimal changes**

**Simplified:**
- Service integration reduced to llm-bot only
- Monitoring moved earlier (Day 7-8)
- Focus on core feature delivery
- **llm-bot already handles "prompt" annotations** - just validate it works for progress events

**Key Addition:**
The llm-bot annotation tasks (TASK-377-020a, TASK-377-020b, TASK-377-020c) validate that llm-bot's EXISTING annotation handling works for progress events:

- **TASK-377-020a** (0.5h): Review current annotation handling
  - Confirm "prompt" annotation already works (✅ confirmed)
  - Assess if custom annotations (progress_context, derived_from) need handling

- **TASK-377-020b** (1.5h): Add support for custom annotations (if needed)
  - Likely can be SKIPPED if llm-bot safely ignores unknown annotations
  - Only add handling if necessary

- **TASK-377-020c** (1h): Validate with integration tests
  - Primarily a TEST task
  - Likely NO code changes needed

**Why This Works:**
Since llm-bot already handles "prompt" annotations correctly, we just need to validate it works for progress events. The custom annotations (progress_context, derived_from) likely don't need special handling - they can be safely ignored or optionally included in context.

---

**End of Execution Plan**
