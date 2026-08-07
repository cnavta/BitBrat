# Sprint 377: Architecture to Tasks Mapping (REVISED)

**Quick Reference:** Links technical architecture components to specific backlog tasks

**Revision Date:** 2026-07-31

**Key Changes:**
- Removed Phase 4 (User Preferences) - deferred to Sprint 378+
- Simplified Phase 3 to llm-bot only (no image-gen-mcp, no tool-gateway)
- Documented nested progress detection strategy for Sprint 379+
- Updated prompts to leverage original message context

---

## Component Implementation Matrix

| Architecture Component | Tasks | Files | Priority | Notes |
|------------------------|-------|-------|----------|-------|
| **Derived Event Utility** | TASK-377-001 to TASK-377-004 | `src/common/events/derived-event.ts` | P0 | Foundation for all derived events |
| **QoS Extensions** | TASK-377-005, TASK-377-006 | `src/types/events.ts` | P0 | Fields defined but enforcement deferred |
| **Feedback Middleware** | TASK-377-007 to TASK-377-011 | `src/common/middleware/feedback-middleware.ts` | P0 | Core progress tracking logic |
| **Bit Integration** | TASK-377-012, TASK-377-013 | `src/common/base-server.ts` | P0 | Inject middleware into all services |
| **Prompt Templates** | TASK-377-018 to TASK-377-020 | `src/common/middleware/progress-prompts.ts` | P0 | LLM prompts leveraging original message |
| **llm-bot Annotation Handling** | TASK-377-020a to TASK-377-020c | `src/apps/llm-bot-service.ts` | P0 | **NEW - CRITICAL** Handle new annotation types |
| **Event-Router Rule** | TASK-377-021 to TASK-377-024 | `documentation/seed-data/seed-commands.json` | P0 | Routes progress to llm-bot |
| **llm-bot Integration** | TASK-377-031, TASK-377-032 | `src/apps/llm-bot-service.ts` | P0 | ONLY service with progress tracking |
| **Observability** | TASK-377-035 to TASK-377-037 | `src/common/middleware/feedback-middleware.ts` | P0 | Logging, metrics, error handling |

---

## Architecture Section → Task Mapping

### 3.2.1. Feedback Middleware
**Architecture Reference:** Technical Architecture §3.2.1

| Task | Description | Estimate |
|------|-------------|----------|
| TASK-377-007 | Create FeedbackMiddleware class | 2h |
| TASK-377-008 | Implement threshold detection logic | 2h |
| TASK-377-009 | Implement stage determination logic | 3h |
| TASK-377-010 | Implement progress tracking state | 2h |
| TASK-377-011 | Implement template message generation | 2h |
| TASK-377-016 | Unit tests for FeedbackMiddleware | 4h |
| TASK-377-027 | Publish chat.progress.v1 events | 3h |

**Total Estimate:** 18 hours

**Key Changes:**
- TASK-377-027 added (publish LLM progress events)
- No user preference enforcement (deferred to Sprint 378+)

---

### 3.2.2. Derived Event Utility
**Architecture Reference:** Technical Architecture §3.2.2

| Task | Description | Estimate |
|------|-------------|----------|
| TASK-377-001 | Create derived-event.ts module | 1h |
| TASK-377-002 | Implement createDerivedEvent() function | 3h |
| TASK-377-003 | Implement createProgressEvent() wrapper | 2h |
| TASK-377-004 | Implement traceability helpers | 2h |
| TASK-377-015 | Unit tests for derived event utility | 3h |

**Total Estimate:** 11 hours

**Important:** TASK-377-004 includes `isNestedOperation()` helper for future Sprint 379+ usage (smart nested detection).

---

### 3.2.3. Progress Event Structure
**Architecture Reference:** Technical Architecture §3.2.3

**Implemented by:** TASK-377-002, TASK-377-003, TASK-377-027

The progress event structure is defined by:
- `createProgressEvent()` utility (TASK-377-003)
- Event publication logic (TASK-377-027)
- **Original message copied** for LLM context (TASK-377-002)
- Annotation schemas documented in technical architecture

**Key Insight:** The derived progress event includes the original user message, allowing the LLM to generate contextual progress messages that reference the user's specific intent.

---

### 3.2.4. QoS Extensions
**Architecture Reference:** Technical Architecture §3.2.4

| Task | Description | Estimate |
|------|-------------|----------|
| TASK-377-005 | Define QOSV1 progress extensions | 1h |
| TASK-377-006 | Update InternalEventV2 schema documentation | 1h |

**Total Estimate:** 2 hours

**Important:** QoS fields exist but are NOT enforced in Sprint 377. User preference enforcement deferred to Sprint 378+. All requests get progress feedback in Sprint 377.

---

### 3.2.4b. llm-bot Annotation Validation (NEW - SIMPLIFIED)
**Architecture Reference:** Technical Architecture §3.2.6 (implicit requirement)

| Task | Description | Estimate |
|------|-------------|----------|
| TASK-377-020a | Review llm-bot annotation handling logic | 0.5h |
| TASK-377-020b | Add support for custom annotations (if needed) | 1.5h |
| TASK-377-020c | Validate llm-bot works with progress events | 1h |

**Total Estimate:** 3 hours

**Simplified Approach:** llm-bot ALREADY handles "prompt" annotations correctly, so these tasks are primarily VALIDATION:

1. **`prompt` annotation**: ✅ **Already handled by llm-bot**
   - llm-bot uses this as system prompt
   - No changes needed
   - Just validate it works for progress events

2. **`progress_context` annotation**: **NEW - Custom annotation**
   - Contains operation details (stage, elapsedMs, parameters)
   - Likely doesn't need special handling (llm-bot can ignore)
   - MAY optionally include in LLM context for additional detail
   - Decision made in TASK-377-020a

3. **`derived_from` annotation**: **NEW - Custom annotation**
   - Traceability link to original event
   - Used for logging/debugging only
   - Should NOT be exposed to LLM
   - llm-bot can safely ignore this

**Current Understanding:**
Since llm-bot already handles "prompt" annotations, the existing code should "just work" for progress events:
- Prompt annotation → used as system instruction ✅
- Original message → included in context ✅
- Custom annotations → safely ignored (or optionally included) ✅

**Tasks Are Primarily:**
- Review existing behavior (0.5h)
- Minimal changes if needed (1.5h - may be skipped)
- Validation tests (1h)

**Backward Compatibility:** Existing annotation handling unchanged

---

### 3.2.5. Event-Router Rule
**Architecture Reference:** Technical Architecture §3.2.5

| Task | Description | Estimate |
|------|-------------|----------|
| TASK-377-021 | Create event-router rule for progress messages | 2h |
| TASK-377-022 | Test event-router rule matching | 1h |
| TASK-377-023 | Validate routing slip configuration | 0.5h |
| TASK-377-024 | Document annotation attachments | 0.5h |
| TASK-377-025 | Add progress rule to seed data | 1h |

**Total Estimate:** 5 hours

---

### 3.2.6. LLM-Bot Processing
**Architecture Reference:** Technical Architecture §3.2.6

**Code changes required** - annotation handling updates:
- TASK-377-020a: Review llm-bot annotation handling logic
- TASK-377-020b: Update llm-bot to handle new annotation types
- TASK-377-020c: Update prompt assembly for progress events

**Validated by integration tests:**
- TASK-377-029: Integration test - llm-bot processes progress
- TASK-377-030: Integration test - full progress flow

**Critical Requirement:** llm-bot must recognize and properly process three new annotation types:
1. `prompt`: System instructions for LLM (replaces or augments default system prompt)
2. `progress_context`: Operation details (stage, operation, elapsedMs, parameters)
3. `derived_from`: Traceability link to original event (for logging/debugging)

**Key Validation:** LLM generates contextual messages that reference original user intent.

---

### 3.2.7. Ingress-Egress Delivery
**Architecture Reference:** Technical Architecture §3.2.7

**No code changes required** - validated by integration tests:
- TASK-377-030: Integration test - full progress flow
- TASK-377-034: Staging smoke tests

---

## Nested Progress Handling (Sprint 377 vs. Future)

### Sprint 377 Approach: Single-Level Tracking
**Documented in:** execution-plan.md § Nested Progress Handling Strategy

**Implementation:** TASK-377-031 (llm-bot integration only)

**Strategy:**
- Only llm-bot adds operation_context annotation
- No tracking in tool-gateway or image-gen-mcp
- Avoids nested timeout complexity
- LLM generates contextual messages using original message

**Validation:** TASK-377-032 (manual testing), TASK-377-034 (staging smoke tests)

---

### Sprint 379+: Smart Nested Detection
**Deferred feature** documented for future implementation

**Prepared Foundation:**
- TASK-377-004: `isNestedOperation()` helper implemented
- execution-plan.md: Complete implementation strategy documented
- Code example provided for future sprint

**Implementation Notes:**
```typescript
// Already implemented in TASK-377-004 (for future use)
import { isNestedOperation } from '../../common/events/derived-event';

// Future enhancement in feedback-middleware.ts (Sprint 379+)
async beforeNext(event: InternalEventV2): Promise<void> {
  // Skip progress for nested operations
  if (isNestedOperation(event)) {
    this.logger.debug('Skipping progress for nested operation');
    return;
  }
  // Normal progress tracking...
}
```

---

## Phase Dependencies

### Phase 1 → Phase 2
**Dependency:** Feedback middleware must be functional before LLM integration

**Critical Tasks:**
- TASK-377-013: Inject middleware into Bit.next() ✅
- TASK-377-014: Integration test - Template messages ✅

**Validation:** Phase 1 validation (TASK-377-017) gates Phase 2 start

---

### Phase 2 → Phase 3
**Dependency:** Event-router rule must route progress events before llm-bot can use

**Critical Tasks:**
- TASK-377-025: Add progress rule to seed data ✅
- TASK-377-028: Integration test - chat.progress.v1 routing ✅
- TASK-377-030: Integration test - full progress flow ✅

**Validation:** Full progress flow working end-to-end, LLM generates contextual messages

---

### Phase 3 → Phase 4
**Dependency:** llm-bot integration must be working before production deployment

**Critical Tasks:**
- TASK-377-031: Add operation_context to llm-bot ✅
- TASK-377-033: Deploy to staging environment ✅
- TASK-377-034: Staging smoke tests ✅

**Validation:** Staging smoke tests pass, no nested timeout issues

---

## Testing Strategy Mapping

### Unit Tests
**Architecture Reference:** Technical Architecture §5.1

| Task | Component | Coverage Target |
|------|-----------|-----------------|
| TASK-377-015 | Derived event utility | >90% |
| TASK-377-016 | Feedback middleware | >85% |
| TASK-377-018 to TASK-377-020 | Prompt templates | >80% |

---

### Integration Tests
**Architecture Reference:** Technical Architecture §5.2

| Task | Scenario | Components Tested |
|------|----------|-------------------|
| TASK-377-014 | Template messages | Middleware → Egress |
| TASK-377-028 | Event-router routing | Event-router → Rule matching |
| TASK-377-029 | LLM processing | LLM-bot → Message generation (contextual) |
| TASK-377-030 | Full progress flow | Middleware → Router → LLM → Egress |

**Key Validation:** TASK-377-029 and TASK-377-030 verify that LLM generates contextual messages that reference original user intent.

---

### Manual Tests
**Architecture Reference:** Technical Architecture §5.3

| Task | Test Case | Expected Outcome |
|------|-----------|------------------|
| TASK-377-032 | llm-bot progress feedback | Progress messages at correct times, contextual to user intent |
| TASK-377-034 | Staging smoke tests | All scenarios working in staging, no nested timeouts |

---

## Configuration Reference

### Environment Variables
**Architecture Reference:** Technical Architecture Appendix B

| Variable | Default | Tasks | Notes |
|----------|---------|-------|-------|
| `PROGRESS_ENABLED` | `true` | TASK-377-008 | Global enable/disable |
| `PROGRESS_USE_CUSTOM_MESSAGES` | `true` | TASK-377-011, TASK-377-027 | LLM vs templates |
| `PROGRESS_THRESHOLD_MS` | `2000` | TASK-377-008 | When to trigger progress |
| `PROGRESS_UPDATE_INTERVAL_MS` | `5000` | TASK-377-009 | Time between updates |
| `PROGRESS_LLM_MODEL` | `gpt-4o-mini` | TASK-377-029 | Fast model for progress |
| `PROGRESS_LLM_TIMEOUT_MS` | `3000` | TASK-377-023 | LLM call timeout |

**Note:** User preferences (qos.progress.enabled) are NOT enforced in Sprint 377. Deferred to Sprint 378+.

---

## Annotation Schemas

### progress_context
**Architecture Reference:** Technical Architecture Appendix A

**Created by:** TASK-377-003 (createProgressEvent)

**Used by:**
- TASK-377-027: Published by feedback middleware
- TASK-377-029: Read by llm-bot integration test

**Fields:**
```typescript
{
  originalCorrelationId: string;
  originalMessage: string;      // IMPORTANT: For LLM context
  stage: 'initial' | 'update' | 'timeout';
  operation: string;            // 'llm_request' in Sprint 377
  parameters: Record<string, any>;
  startedAt: string;
  elapsedMs: number;
}
```

---

### operation_context
**Architecture Reference:** Technical Architecture Appendix A

**Created by:**
- TASK-377-031: llm-bot (ONLY service in Sprint 377)

**NOT created by** (deferred to avoid nested complexity):
- tool-gateway
- image-gen-mcp

**Fields:**
```typescript
{
  operation: string;            // 'llm_request'
  parameters: {
    hasTools: boolean;
  };
  expectedDurationMs?: number;
}
```

---

### prompt
**Architecture Reference:** Technical Architecture Appendix A

**Created by:**
- TASK-377-027: Feedback middleware using prompt templates (TASK-377-018 to TASK-377-020)

**Used by:**
- Existing llm-bot code (no changes needed)

**Key Innovation:** Prompts instruct LLM to reference original user message, enabling contextual progress messages.

**Example:**
```typescript
{
  kind: 'prompt',
  value: 'Generate a brief, encouraging progress message (max 100 chars) that you\'re working on the user\'s request. Read their original message and reference their specific intent if possible. Use an emoji. Be friendly.',
  source: 'feedback-middleware'
}
```

---

## Data Flow Validation

### 3.3.1. Happy Path (Template Messages - Phase 1)
**Architecture Reference:** Technical Architecture §3.3.1

**Validated by:**
- TASK-377-014: Integration test - Template messages
- TASK-377-017: Phase 1 validation

---

### 3.3.1. Happy Path (LLM Messages - Phase 2+)
**Architecture Reference:** Technical Architecture §3.3.1 (updated flow)

**Validated by:**
- TASK-377-030: Integration test - full progress flow
- TASK-377-032: Manual test - llm-bot progress feedback
- TASK-377-034: Staging smoke tests

**Key Validation:** Progress messages reference original user intent (e.g., "🎨 Creating your sunset over mountains image...")

---

### 3.3.2. Timeout Path
**Architecture Reference:** Technical Architecture §3.3.2

**Validated by:**
- TASK-377-009: Stage determination (timeout stage at 60s)
- TASK-377-034: Staging smoke tests (timeout scenario)

---

### 3.3.3. Template-Based Progress (Fallback)
**Architecture Reference:** Technical Architecture §3.3.3

**Validated by:**
- TASK-377-011: Template message generation
- TASK-377-014: Integration test - Template messages
- TASK-377-037: Error handling (LLM timeout → template fallback)

---

## Removed Features (Deferred to Future Sprints)

### User Preferences System (Sprint 378+)
**Original Phase 4 tasks removed:** TASK-377-038 to TASK-377-044 (7 tasks, ~15 hours)

**Rationale:** User preferences should be handled holistically across the platform:
- Progress message preferences
- Notification preferences
- Personality preferences
- Platform-specific preferences
- Admin preferences

**Current State in Sprint 377:**
- QoS fields defined (TASK-377-005, TASK-377-006)
- Fields NOT enforced (all requests get progress)
- Preference storage and enforcement deferred

---

### Nested Progress Detection (Sprint 379+)
**Prepared but not implemented in Sprint 377**

**Foundation Laid:**
- TASK-377-004: `isNestedOperation()` helper implemented
- execution-plan.md: Complete strategy documented
- Code examples provided

**Why Deferred:**
- Sprint 377 uses single-level tracking (llm-bot only)
- Avoids nested timeout complexity
- Simpler to implement and test
- Can be added later without breaking changes

---

### Service-Specific Integration (Removed)
**Original tasks removed:** TASK-377-032 to TASK-377-033 (image-gen-mcp integration)

**Why Removed:**
- Nested progress complexity (llm-bot → tool-gateway → image-gen-mcp)
- Already experiencing nested timeout issues
- Sprint 377 simplified to llm-bot only
- Can be added in Sprint 379+ with smart nested detection

---

## Critical Path Summary

**Shortest path to working feature:**

```
DAY 1: Foundation
TASK-377-001 → TASK-377-002 → TASK-377-003 (Derived events)
  ↓
DAY 2: Middleware
TASK-377-007 → TASK-377-008 → TASK-377-009 (Threshold + stage detection)
  ↓
DAY 3: Integration
TASK-377-012 → TASK-377-013 → TASK-377-014 (Inject into Bit.next())
  ↓
DAY 4: Prompts + Router
TASK-377-018 → TASK-377-019 → TASK-377-021 → TASK-377-022 (LLM prompts + routing)
  ↓
DAY 5: LLM Flow
TASK-377-027 → TASK-377-025 → TASK-377-030 (Publish + seed + integration test)
  ↓
DAY 6: Service Integration
TASK-377-031 → TASK-377-032 (llm-bot only)
  ↓
DAY 7: Deployment
TASK-377-033 → TASK-377-034 (Staging deployment + smoke tests)
  ↓
DAY 7-8: Monitoring
TASK-377-035 → TASK-377-036 → TASK-377-037 → TASK-377-038 (Logging, metrics, errors, docs)
  ↓
DAY 8: Production
TASK-377-039 (Production validation and deployment)
```

**Total Critical Path Estimate:** ~40 hours (core features only)

**Total Sprint Estimate:** ~68 hours (all tasks including tests, docs, monitoring)

---

## Revised Scope Summary

### Original Plan
- **Tasks:** 49
- **Duration:** 10 days
- **Estimate:** 88 hours
- **Phases:** 5 (Foundation, LLM Progress, Service Integration, User Preferences, Monitoring)

### Revised Plan
- **Tasks:** 43
- **Duration:** 7-8 days
- **Estimate:** 74 hours
- **Phases:** 4 (Foundation, LLM Progress, LLM-Bot Integration, Monitoring)

### Key Changes
1. **Removed Phase 4 (User Preferences):** 7 tasks, ~15 hours
   - Deferred to Sprint 378+ for holistic user settings system
   - QoS fields defined but not enforced

2. **Simplified Phase 3 (Service Integration):** 2 tasks removed, ~4 hours saved
   - Only llm-bot integration (TASK-377-031, TASK-377-032)
   - Removed image-gen-mcp integration (nested complexity)
   - Removed tool-gateway integration (nested complexity)

3. **Added llm-bot Annotation Handling:** 3 tasks, ~6 hours (CRITICAL)
   - TASK-377-020a: Review annotation handling logic
   - TASK-377-020b: Handle new annotation types (prompt, progress_context, derived_from)
   - TASK-377-020c: Update prompt assembly for progress events
   - **Essential** for llm-bot to process progress events correctly

4. **Documented Future Features:**
   - Smart nested progress detection (Sprint 379+)
   - Foundation laid with `isNestedOperation()` helper
   - Complete implementation strategy documented

5. **Enhanced LLM Context:**
   - Prompts leverage original user message
   - Progress messages contextual to user intent
   - Example: "🎨 Creating your sunset over mountains image..."

---

**End of Mapping Document**
