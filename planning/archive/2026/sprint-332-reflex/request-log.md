# Request Log – Sprint 332

## REQ-001: Sprint Initiation
**Timestamp**: 2026-07-03T21:30:00Z
**Role**: Architect
**Prompt Summary**: User initiated sprint to develop Reflex bit for deterministic event orchestration

**User Requirements**:
- **Goal**: Reflex bit handles repeated deterministic behavior in low-cost manner
- **Reference Use Case**: `!fail` chat message → OBS source visibility toggle
- **Positioning**: Immediately after auth bit in analysis stage (before query-analyzer, llm-bot)
- **Rationale**: Simple deterministic processes shouldn't require expensive LLM calls
- **Matching**: Fast and accurate (regex mentioned from prior projects, open to alternatives)
- **Orchestration**:
  - Phase 1: Single MCP tool with templated input from event
  - Future: Multi-tool chains, possibly DSL/scripting
  - Keep simple for discovery
- **Management**: MCP tooling for LLM to create/manage reflexes

**Interpretation**:
1. **Performance Critical**: Must be faster than query-analyzer (target <150ms vs. seconds)
2. **Cost Optimization**: Avoid LLM API calls for deterministic patterns
3. **Authorization Aware**: Position after auth to respect user roles/permissions
4. **Flexible Matching**: Support multiple pattern types (not just regex)
5. **Simple Start**: Single tool invocation, expand based on learning
6. **LLM-Managed**: Reflexes should be creatable/editable via MCP tools

**Commands Executed**:
```bash
git checkout -b feature/sprint-332-reflex-deterministic-orchestration
mkdir -p planning/sprint-332-reflex
```

**Analysis Completed**:
1. **Current Reflex State**:
   - Skeleton service created in sprint-331
   - Registered in architecture.yaml (active: false, stage: analyze)
   - Profile: mcp-domain, exposure: platform+domain
   - Entry: src/apps/reflex-service.ts (only has example echo tool)

2. **Platform Event Flow**:
   - Ingest → Router → Auth → **[REFLEX HERE]** → Query-Analyzer → LLM-Bot → React → Egress
   - Current analysis stage: query-analyzer (fast LLM), llm-bot (full LLM), disposition-service
   - Routing via routing slips attached by event-router

3. **Related Systems**:
   - Event-router: JsonLogic rules in Firestore, orchestrates via routing slips
   - Tool-gateway: Proxies MCP tool calls with auth
   - Auth service: Validates permissions, enriches with auth context
   - Query-analyzer: Fast pre-analysis using LLM (reference for positioning)

4. **Messaging Patterns**:
   - Topics follow `internal.<domain>.<verb>.v1` convention
   - Services publish to `internal.enriched.v1` to return to router
   - At-least-once delivery requires idempotency

**Design Decisions**:

1. **Matching Engine**:
   - 5 match types: exact, contains, regex, prefix, suffix
   - ReDoS protection using safe-regex library
   - JSONPath-like field access (e.g., `message.text`, `identity.user.id`)
   - AND-only conditions (eventTypes, channels, platforms, userRoles, minAuthLevel)

2. **Orchestration Engine**:
   - Template interpolation: `{{field.path}}` syntax
   - Single MCP tool invocation per reflex (Phase 1)
   - Timeout protection (default 5000ms)
   - Via tool-gateway with MCP_AUTH_TOKEN

3. **Storage**:
   - Firestore collection: `reflexes`
   - Real-time sync via onSnapshot listener
   - In-memory cache for fast matching
   - Indexes on active + priority

4. **Integration**:
   - New topic: `internal.reflex.v1`
   - Subscribe: internal.reflex.v1 (from event-router)
   - Publish: internal.enriched.v1 (back to event-router)
   - Event-router routing slip update required

5. **MCP Tools**:
   - reflex.create (create new reflex)
   - reflex.list (list/filter reflexes)
   - reflex.update (update existing)
   - reflex.delete (delete reflex)
   - reflex.test (test pattern against input)

6. **Error Handling**:
   - **Critical**: Never block event flow
   - Degraded mode: pass through event on error
   - Comprehensive logging at every step
   - Update reflex statistics (match/success/error counts)

7. **Performance**:
   - Target: <10ms p99 pattern matching
   - Target: <150ms p99 end-to-end (match + execute, excluding tool time)
   - In-memory cache for all rules
   - Early exit on first match (Phase 1)
   - Pre-compiled regex patterns

**Deliverable Created**:
- `planning/sprint-332-reflex/technical-architecture.md` (40+ pages, comprehensive)

**Document Sections**:
1. Executive Summary
2. Current State Analysis
3. Goals and Non-Goals
4. System Architecture (component & sequence diagrams)
5. Data Model (Reflex schema with example)
6. Matching Engine Design (5 types + conditions)
7. Orchestration Engine Design (template interpolation + MCP invocation)
8. Integration with Event Flow (topics, routing slip)
9. MCP Tool Interface (5 management tools)
10. Storage and Persistence (Firestore + real-time sync)
11. Performance Considerations (latency targets, optimization)
12. Error Handling and Observability (structured logging, metrics)
13. Security Considerations (auth, validation, ReDoS protection)
14. Future Extensibility (Phases 2-4: chains, scripting, state)
15. Implementation Phases
16. Testing Strategy (unit, integration, manual)
17. Success Criteria (functional, non-functional, operational)
18. Decision Log (4 key decisions with rationale)
19. Appendices (example rules, MCP calls, event flow)

**Key Architectural Elements**:
- Firestore-backed rule storage with real-time cache
- 5 pattern match types with ReDoS protection
- Template-based parameter interpolation
- Tool-gateway integration for MCP calls
- Degraded mode pass-through on errors
- Priority-based rule ordering

**Next Steps** (for Lead Implementor):
1. Review and approve Technical Architecture document
2. Address review questions (if any):
   - Single-tool limitation acceptable?
   - OR logic for conditions needed?
   - Command prefix pattern support?
   - Synchronous vs async execution?
3. Create implementation-plan.md with detailed task breakdown
4. Create backlog.yaml with trackable tasks
5. Get user approval to start implementation

---

## REQ-002: Architecture Review and Implementation Planning

**Timestamp**: 2026-07-04T00:00:00Z
**Role**: Lead Implementor
**Prompt Summary**: Technical architecture implicitly approved by user requesting continuation with implementation

**User Request**:
- User requested to "continue the conversation from where we left it off"
- User indicated "continue with the last task that you were asked to work on"
- Interpreted as implicit approval of technical architecture document
- Authorization to proceed with implementation planning

**Actions Taken**:

1. **Implementation Plan Created** (`planning/sprint-332-reflex/implementation-plan.md`)
   - 7 implementation phases with detailed task groups
   - 56 total tasks organized by dependency
   - Comprehensive acceptance criteria for each task
   - Risk mitigation strategies
   - Estimated 94 hours / 12-14 work days

2. **Backlog Created** (`planning/sprint-332-reflex/backlog.yaml`)
   - 56 trackable tasks with unique IDs (BL-332-001 to BL-332-145)
   - Status tracking (todo/in-progress/blocked/done)
   - Priority classification (critical/high/medium/low)
   - Dependencies mapped between tasks
   - Estimated hours per task
   - Acceptance criteria defined
   - Tags for categorization

3. **Sprint Manifest Updated**
   - Status changed: "planning" → "in-progress"
   - Owner changed: "Architect" → "Lead Implementor"
   - Added startedAt: 2026-07-04
   - Added implementation planning completion notes
   - Identified next task: BL-332-001

**Implementation Structure**:

**Phase 1: Core Foundation** (14 tasks, 29 hours)
- Task Group 1.1: Data Model & Types (3 tasks)
- Task Group 1.2: Matching Engine (5 tasks)
- Task Group 1.3: Orchestration Engine (4 tasks)

**Phase 2: Storage & Caching** (3 tasks, 6 hours)
- Task Group 2.1: Firestore Integration

**Phase 3: Event Flow Integration** (6 tasks, 9 hours)
- Task Group 3.1: Message Handling
- Task Group 3.2: Topic Configuration

**Phase 4: MCP Management Tools** (6 tasks, 8 hours)
- Task Group 4.1: MCP Tool Implementation (5 tools + registration)

**Phase 5: Error Handling & Observability** (7 tasks, 9.5 hours)
- Task Group 5.1: Structured Logging
- Task Group 5.2: Metrics & Monitoring

**Phase 6: Testing & Validation** (13 tasks, 19 hours)
- Task Group 6.1: Unit Tests (>80% coverage)
- Task Group 6.2: Integration Tests
- Task Group 6.3: Manual Testing

**Phase 7: Documentation & Deployment** (13 tasks, 13.25 hours)
- Task Group 7.1: Documentation
- Task Group 7.2: Deployment Preparation
- Task Group 7.3: Production Deployment

**Critical Path**:
1. Data Model → Matching Engine → Orchestration Engine
2. Firestore Integration → Cache
3. Message Handler → Event Publishing → Topic Configuration
4. Unit Tests → Integration Tests → Manual Tests
5. Staging Deployment → Production Deployment

**Priority Breakdown**:
- Critical: 28 tasks (50%)
- High: 20 tasks (36%)
- Medium: 7 tasks (12%)
- Low: 1 task (2%)

**Key Design Decisions Preserved**:
1. complete() vs next() pattern for event routing
2. Execution event publishing (internal.reflex.executed.v1, internal.reflex.failed.v1)
3. Degraded mode: Always pass through events on error
4. Phase 1 limitations: Single tool, AND conditions only, no state
5. Performance targets: <10ms matching, <150ms end-to-end

**Next Steps**:
1. Begin Phase 1 implementation
2. Start with BL-332-001: Define Reflex TypeScript interfaces
3. Follow critical path to avoid blocking downstream work
4. Track progress in backlog.yaml
5. Update request-log.md with implementation progress

**Status**: Implementation planning complete, ready to begin coding

---

## REQ-003: Candidate Template Scope Addition

**Timestamp**: 2026-07-04T01:00:00Z
**Role**: Lead Implementor
**Prompt Summary**: User requested candidate template feature addition before implementation begins

**User Request**:
> One more small add to the scope of the sprint before starting:
> - A Reflex should have an optional property to define a Candidate template that will be added to the event if completed. The template should have access to both the values in the event AND the results of the MCP tool calls.

**Interpretation**:
1. **Optional candidateTemplate field**: Add to Reflex data model for response generation
2. **Dual-context templating**: Template has access to:
   - `{{event.field.path}}` - Event data (existing functionality)
   - `{{result.field.path}}` - MCP tool call results (new capability)
3. **Candidate generation**: Build InternalCandidate from template after successful tool execution
4. **Event enrichment**: Add generated candidate to event.candidates array before calling complete()
5. **Use cases**:
   - User feedback for actions ("Fail overlay activated!")
   - Confirm command execution ("Timer set for 60 seconds")
   - Return data from tool results ("Current status: {{result.status}}")

**Design Decisions**:
1. **Optional field**: candidateTemplate is optional - reflexes can execute tools without responses
2. **Template syntax**: Reuse existing `{{field}}` syntax, differentiate with `event.` and `result.` prefixes
3. **Candidate object**: Use existing InternalCandidate type (source: 'reflex', text, confidence: 1.0, metadata)
4. **Error handling**: If template interpolation fails, log warning but still complete event (degraded mode)

**Files Updated**:

1. **technical-architecture.md**:
   - Added `candidateTemplate?: string` to Reflex interface
   - Added "Candidate Template Building" subsection in Orchestration Engine
   - Updated execution flow to include candidate building step
   - Updated event enrichment to add candidates to event
   - Updated Phase 1 scope to include candidate template building
   - Updated success criteria with candidate generation requirements
   - Updated example reflex with candidateTemplate field

2. **implementation-plan.md**:
   - Updated Task Group 1.1 (Data Model) to include candidateTemplate field
   - Added new task: "Create candidate builder" in Task Group 1.3
   - Updated "Create reflex executor" task to include candidate building
   - Updated "Implement event enrichment" task to add candidates to events
   - Added candidate builder unit tests to testing section
   - Added integration test for candidate generation

3. **backlog.yaml**:
   - Updated BL-332-001: Include candidateTemplate in Reflex interface
   - Added BL-332-022: Implement candidate builder (1.5 hours, critical)
   - Renumbered BL-332-022 → BL-332-023 (tool executor)
   - Renumbered BL-332-023 → BL-332-024 (reflex executor, updated for candidate building)
   - Updated BL-332-041: Event enrichment adds candidates to event
   - Added BL-332-093A: Candidate builder unit tests (1 hour, high)
   - Updated BL-332-094: Executor tests include candidate building scenarios
   - Updated BL-332-097: Coverage task depends on BL-332-093A
   - Updated summary: 58 total tasks (was 56), 96.25 hours (was 93.75)

**Impact Analysis**:
- **Additional work**: +2.5 hours (1.5 for implementation, 1 for tests)
- **New tasks**: 2 (BL-332-022, BL-332-093A)
- **Dependencies**: Candidate builder depends on field accessor and template interpolator
- **Critical path**: Not affected - candidate building is parallel to other orchestration work
- **Risk**: Low - leverages existing template interpolation patterns

**Technical Approach**:
```typescript
// Example implementation signature
function buildCandidate(
  template: string,
  event: InternalEventV2,
  toolResult: any
): InternalCandidate {
  // 1. Interpolate {{event.path}} placeholders
  // 2. Interpolate {{result.path}} placeholders
  // 3. Build InternalCandidate object
  // 4. Return candidate
}
```

**Example Usage**:
```json
{
  "id": "obs-fail-toggle",
  "match": { "type": "exact", "pattern": "!fail", "field": "message.text" },
  "action": {
    "tool": "obs.set_source_visibility",
    "parameters": { "sourceName": "FailOverlay", "visible": true }
  },
  "candidateTemplate": "Fail overlay activated by {{event.identity.user.displayName}}! Status: {{result.visible}}"
}
```

**Next Steps**:
1. Implementation proceeds as planned with updated scope
2. First task: BL-332-001 (Define Reflex TypeScript interfaces with candidateTemplate)
3. Candidate builder implementation: BL-332-022
4. Unit tests for candidate builder: BL-332-093A

**Status**: Scope addition complete, all documents updated, ready to begin implementation

---
