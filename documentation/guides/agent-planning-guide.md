# Agent Planning Guide

**Purpose:** Guide for creating implementation roadmaps in Technical Architecture documents when execution is by coding agents (not human teams)

**Author:** Architect
**Date:** 2026-08-21
**Status:** Authoritative v1

---

## Overview

When creating Technical Architecture documents with implementation roadmaps, **assume agent execution context** unless explicitly told otherwise. Coding agents have different constraints and capabilities than human teams, requiring a different planning model.

---

## Key Differences: Human vs Agent Planning

| Aspect | Human Team Planning | Agent Planning |
|--------|---------------------|----------------|
| **Time Unit** | Days, weeks, sprints (calendar time) | Sprints (logical goals, not time-bound) |
| **Interaction** | Daily standups, meetings | Turns (Human→Agent message exchanges) |
| **Effort Estimate** | Story points, hours, days | Context tokens (~30K-150K per sprint) |
| **Granularity** | User stories, tasks | Tasks (may require dialogue across turns) |
| **Coordination** | Team sync, handoffs | Conversational collaboration within sprint |
| **Velocity** | Team capacity over time | Context budget per session (~200K tokens) |
| **Parallelization** | Limited by team size | Unlimited (multiple agents simultaneously) |
| **Dependencies** | Team coordination overhead | File conflicts, merge dependencies |

---

## Sprint Protocol Integration

**Sprints ARE valid** in agent planning, but with different semantics:

- **Sprint** = A focused, self-contained goal with clear deliverables
- **NOT** time-boxed (1-2 weeks) — completed when deliverables are done
- **NOT** a single turn — a Sprint typically requires many Human→Agent interactions
- **NOT** team-based (daily standups) — but involves conversational collaboration
- **IS** checkpoint-gated (user approval before next sprint)
- **IS** context-budgeted (estimated total token consumption)

### Understanding Terms

| Term | Definition | Example |
|------|------------|---------|
| **Turn** | One Human→Agent message exchange | Human: "Deploy to agent-dev" → Agent: "Deployed, tests passing" |
| **Sprint** | Logical goal with deliverables | "Implement debug tool logging" (many turns until complete) |
| **Context Budget** | Total tokens estimated for sprint | ~40K tokens (across all conversation turns in the sprint) |
| **Checkpoint** | User review gate between sprints | User approves Sprint 1 results before starting Sprint 2 |

**Sprint as Conversation:**
A Sprint unfolds through multiple turns of dialogue:
1. Human: "Start Sprint 5: Add metrics instrumentation"
2. Agent: "I'll implement counters and histograms..." (Turn 1)
3. Human: "Good start, but add labels for service name"
4. Agent: "Updated with labels, here's the code..." (Turn 2)
5. Human: "Deploy to agent-dev and verify"
6. Agent: "Deployed, metrics visible in Prometheus..." (Turn 3)
7. Human: "Looks good, mark sprint complete"
8. Agent: "Sprint 5 complete, deliverables verified" (Turn 4)

**Sprint Lifecycle (from AGENTS.md):**
1. **Start Sprint**: User initiates via sprint-mcp or explicit request
2. **Agent Executes**: Creates backlog, implements tasks, validates (conversational back-and-forth)
3. **Validation**: Deploy to agent-dev, run tests, verify deliverables
4. **User Review**: Checkpoint for approval/feedback
5. **Complete Sprint**: Merge to main, close sprint, update index

**Example Sprint in Technical Architecture:**
```markdown
### Sprint 1: Foundation (~40K tokens)

**Goal:** Implement DebugToolLogger with unit tests

**Deliverables:**
- ✅ `src/services/llm-bot/debug-tool-logger.ts`
- ✅ `src/services/llm-bot/debug-tool-logger.test.ts`
- ✅ Unit tests passing (100% coverage)

**Validation:**
- Run: `npm test debug-tool-logger.test.ts`
- Verify: All tests pass, no regressions

**Context Budget:** ~40K tokens
**Risk:** Low (new isolated module)
**Checkpoint:** User reviews implementation before Sprint 2
```

---

## Estimation Model

### Context Budget Guidelines

| Complexity | Context Budget | Typical Scope | Example |
|------------|----------------|---------------|---------|
| **Trivial** | ~5-10K tokens | Single function, config change | Add environment variable |
| **Small** | ~20-30K tokens | Single file changes, minor additions | New utility function + tests |
| **Medium** | ~40-60K tokens | New module, integration with 2-3 files | Service integration, new middleware |
| **Large** | ~80-120K tokens | New service, database migration | Complete service with tests |
| **Complex** | ~150K+ tokens | Major refactor, breaking changes | Multi-service coordination |

**Note:** Context budget represents total estimated tokens for the sprint across all conversational turns (Human→Agent exchanges) required to complete the work.

### Context Budget Calculation

```typescript
// Estimation heuristics
const estimateTokens = (scope: Scope): number => {
  let base = 0;

  // File operations
  base += scope.filesCreated * 3000;      // New files: ~3K each
  base += scope.filesModified * 2000;     // Edits: ~2K each
  base += scope.filesRead * 500;          // Reads: ~500 each

  // Testing
  base += scope.testFiles * 4000;         // Test files: ~4K each
  base += scope.integrationTests * 8000;  // Integration: ~8K each

  // Complexity multipliers
  if (scope.breakingChanges) base *= 1.5;
  if (scope.crossService) base *= 1.3;
  if (scope.databaseMigration) base += 10000;

  return base;
};
```

### Sprint Sizing Recommendations

**Small Sprint (~40-80K tokens):**
- ✅ New isolated module
- ✅ Feature addition to existing service
- ✅ Database table addition
- ✅ Integration with 1-2 services

**Medium Sprint (~80-120K tokens):**
- ⚠️ New service with moderate complexity
- ⚠️ Database migration with repository updates
- ⚠️ Multi-file integration changes

**Large Sprint (~120-180K tokens):**
- ⚠️ Complex service integration
- ⚠️ Breaking changes requiring updates across services
- ⚠️ Extensive testing + agent-dev validation

**Multi-Sprint (2-3 sprints):**
- ⚠️ New service with full platform integration
- ⚠️ Breaking changes across multiple services
- ⚠️ Database schema refactor
- ⚠️ Major architectural changes

**Split Criteria:**
- Total estimate > 150K tokens → split into multiple sprints
- Natural validation checkpoints → sprint boundaries
- High risk changes → isolate in dedicated sprint
- Complex deliverables → break into phases

---

## Roadmap Structure Template

### Standard Format

```markdown
## Implementation Roadmap

### Sprint 1: [Phase Name] (~XXK tokens)

**Goal:** [Single sentence objective]

**Deliverables:**
- ✅ [File/module/feature 1]
- ✅ [File/module/feature 2]
- ✅ [Test coverage requirement]

**Tasks:**
1. [Atomic task 1] (~10K tokens)
   - Validation: [How to verify]
2. [Atomic task 2] (~15K tokens)
   - Validation: [How to verify]
3. Deploy to agent-dev (~5K tokens)
   - Validation: [E2E test scenario]

**Validation:**
- Build: `npm run build` (passes)
- Tests: `npm test` (all passing)
- Agent-dev: Deploy and verify [specific behavior]

**Risk:** [Low/Medium/High] - [Why]
**Dependencies:** [Sprint X must complete first, or "None"]
**Parallelization:** [Can run concurrently with Sprint Y, or "Sequential"]
**Checkpoint:** User reviews [specific deliverables] before Sprint 2

---

### Sprint 2: [Phase Name] (~YYK tokens)

[Same structure as Sprint 1]
```

### Example: Multi-Sprint Roadmap

```markdown
## Implementation Roadmap

Total Estimated Context: ~180K tokens across 3 sprints

---

### Sprint 1: Foundation (~40K tokens)

**Goal:** Create DebugToolLogger with unit tests and validation

**Deliverables:**
- ✅ `src/services/llm-bot/debug-tool-logger.ts`
- ✅ `src/services/llm-bot/debug-tool-logger.test.ts`
- ✅ `src/common/base-server.ts` (sendDebugTraceMessage helper)
- ✅ Unit tests (100% coverage)

**Tasks:**
1. Create DebugToolLogger class (~15K tokens)
   - Tool call start/complete logging
   - Sensitive data redaction
   - Validation: Unit tests for core methods
2. Add sendDebugTraceMessage() helper (~10K tokens)
   - Publish trace events to egress
   - Validation: Mock publisher test
3. Write comprehensive unit tests (~15K tokens)
   - Test all logger methods
   - Test redaction logic
   - Validation: `npm test debug-tool-logger.test.ts`

**Validation:**
- Build: TypeScript compilation clean
- Tests: 26/26 passing (100% coverage)
- Linter: No ESLint errors

**Risk:** Low (isolated new module, no integration)
**Dependencies:** None
**Parallelization:** Sequential (Sprint 2 depends on this)
**Checkpoint:** User reviews logger implementation and test coverage

---

### Sprint 2: Integration (~60K tokens)

**Goal:** Integrate tool logging into LLM bot processor

**Deliverables:**
- ✅ Updated `src/services/llm-bot/processor.ts` (tool wrapper)
- ✅ Integration tests for tool logging
- ✅ Agent-dev deployment validation
- ✅ Real-time trace message verification

**Tasks:**
1. Integrate DebugToolLogger into tool wrapper (~20K tokens)
   - Modify processor.ts:786-806
   - Add logger instantiation
   - Validation: Tool calls logged correctly
2. Add integration tests (~15K tokens)
   - Test with internal tools
   - Test with MCP tools
   - Validation: Integration test suite passes
3. Deploy to agent-dev (~10K tokens)
   - Provision agent-dev context
   - Deploy llm-bot service
   - Test debug mode end-to-end
   - Validation: Trace messages visible in Discord

**Validation:**
- Build: TypeScript compilation clean
- Tests: All unit + integration tests passing
- Agent-dev: Debug session shows tool calls/results
- Manual: Send `!debug search for weather in SF` → verify trace messages

**Risk:** Medium (modifies core processor logic)
**Dependencies:** Sprint 1 complete
**Parallelization:** Cannot parallelize (modifies same files)
**Checkpoint:** User tests debug mode in agent-dev, approves trace message format

---

### Sprint 3: Production Readiness (~80K tokens)

**Goal:** Add observability, documentation, and production validation

**Deliverables:**
- ✅ Prometheus metrics for tool interactions
- ✅ Updated documentation (debug mode guide)
- ✅ Full E2E test suite
- ✅ Production deployment checklist

**Tasks:**
1. Add metrics instrumentation (~15K tokens)
   - `debug_mode.tool_logged` counter
   - `debug_mode.tool_duration_ms` histogram
   - Validation: Metrics visible in Prometheus
2. Create debug mode user guide (~10K tokens)
   - Document tool interaction logging
   - Add troubleshooting section
   - Validation: Documentation review
3. Full E2E validation (~20K tokens)
   - Test all tool types (internal, MCP)
   - Test error scenarios
   - Test multi-tool sessions
   - Validation: All scenarios pass
4. Production deployment prep (~15K tokens)
   - Update CHANGELOG
   - Create migration notes
   - Validation: Checklist complete

**Validation:**
- Build: Clean compilation
- Tests: All tests passing (unit + integration + E2E)
- Agent-dev: Full production simulation
- Metrics: Dashboard shows tool interaction data
- Docs: Complete and accurate

**Risk:** Low (observability and documentation)
**Dependencies:** Sprint 2 complete
**Parallelization:** Tasks 1-2 can run in parallel (different agents)
**Final Checkpoint:** Production readiness review with user
```

---

## Validation Gates

Every sprint MUST include validation criteria:

### Required Validations

| Type | When | Example |
|------|------|---------|
| **Build** | After code changes | `npm run build` (no errors) |
| **Tests** | After implementation | `npm test` (all passing) |
| **Linter** | Before completion | `npm run lint` (no errors) |
| **Agent-dev** | Integration changes | Deploy + verify behavior |
| **Manual** | User-facing features | Test in real environment |

### Validation Checkpoint Template

```markdown
**Validation:**
- Build: `npm run build` ✅
- Tests: `npm test` (XX/XX passing) ✅
- Linter: `npm run lint` ✅
- Agent-dev: Deployed to `agent-dev-sprint-X-test`
  - Verified: [Specific behavior]
  - Logs: No errors in `fleet.logs()`
- Manual: [User tested scenario Y]

**Checkpoint Decision:**
- ✅ Proceed to next sprint
- ⚠️ Fix issues before proceeding
- ❌ Rollback and revise approach
```

---

## Risk Assessment

Label each sprint with risk level and mitigation:

### Risk Levels

| Level | Criteria | Mitigation |
|-------|----------|------------|
| **Low** | New isolated code, no breaking changes | Standard validation |
| **Medium** | Modifies existing code, affects 1-2 services | Extra testing, agent-dev validation |
| **High** | Breaking changes, multi-service impact | Staged rollout, extensive testing |
| **Critical** | Database migration, auth changes | Feature flag, rollback plan |

### Risk Documentation Template

```markdown
**Risk:** High

**Why:**
- Modifies core processor tool execution logic
- Affects all LLM tool calls (high traffic path)
- Potential for tool call failures if logging breaks

**Mitigation:**
- Fail-open: Logging errors don't block tool execution
- Feature flag: `DEBUG_TOOL_LOGGING_ENABLED` (default: true)
- Rollback plan: Revert processor.ts changes
- Monitoring: Alert on tool call error rate increase

**Rollback Procedure:**
1. Set `DEBUG_TOOL_LOGGING_ENABLED=false`
2. Redeploy llm-bot service
3. Verify tool calls working normally
4. If needed: `git revert <commit-hash>`
```

---

## Parallelization Opportunities

Identify when multiple agents can work concurrently:

### Parallelizable Patterns

**Safe to Parallelize:**
- ✅ Independent modules (no file overlap)
- ✅ Documentation + implementation (different files)
- ✅ Multiple new services (no shared dependencies)
- ✅ Tests for different modules

**Cannot Parallelize:**
- ❌ Same file modifications (merge conflicts)
- ❌ Sequential dependencies (B depends on A)
- ❌ Database migrations (schema conflicts)
- ❌ Breaking changes (coordination required)

### Parallelization Template

```markdown
**Parallelization:** Yes (2 agents)

**Agent A:**
- Task 1: Create DebugToolLogger class
- Task 2: Write unit tests
- Files: `debug-tool-logger.ts`, `debug-tool-logger.test.ts`

**Agent B:**
- Task 3: Add sendDebugTraceMessage() helper
- Task 4: Update base-server tests
- Files: `base-server.ts`, `base-server.test.ts`

**Merge Point:** After both complete
- Integration test: Verify logger + helper work together
- Resolve conflicts: Unlikely (different files)

**Context Efficiency:** ~50% reduction (40K → 20K per agent)
```

---

## Sprint Dependencies

Document dependencies between sprints:

### Dependency Types

| Type | Description | Example |
|------|-------------|---------|
| **Sequential** | Sprint B requires Sprint A complete | Integration requires foundation |
| **Optional** | Sprint B enhanced by Sprint A, not required | Monitoring enhances core feature |
| **Concurrent** | Sprint A and B can run in parallel | Documentation + implementation |
| **Conditional** | Sprint B only if Sprint A succeeds | Advanced features if core validates |

### Dependency Template

```markdown
### Sprint Dependencies

**Sprint 1** → **Sprint 2** (Sequential)
- Sprint 2 integrates DebugToolLogger created in Sprint 1
- Cannot start Sprint 2 until Sprint 1 checkpoint passed

**Sprint 2** → **Sprint 3** (Sequential)
- Sprint 3 adds observability to integration from Sprint 2
- Can start Sprint 3 after Sprint 2 validation in agent-dev

**Sprint 1** || **Documentation** (Concurrent)
- Documentation sprint can run in parallel with Sprint 1
- No file conflicts, independent deliverables
```

---

## Context Budget Management

### Budget Allocation

**Per-Session Context:** ~200K tokens available

**Typical Allocation per Agent Response:**
- **System Context:** ~20K (CLAUDE.md, AGENTS.md, architecture.yaml)
- **File Reads:** ~30K (reading existing code for context)
- **Task Execution:** ~120K (actual implementation work)
- **Validation:** ~20K (testing, agent-dev deployment)
- **Buffer:** ~10K (unexpected complexity)

**Sprint Budget:**
The sprint context budget estimates total tokens consumed across ALL conversational turns:
- **Small Sprint (~60K total):** May require 3-5 turns of dialogue
- **Medium Sprint (~100K total):** May require 5-10 turns of dialogue
- **Large Sprint (~150K total):** May require 10-15 turns of dialogue

Each turn consumes context for system, file reads, and generation. The sprint budget is cumulative across the conversation.

### Budget Tracking

```markdown
## Context Budget Summary

**Total Roadmap:** ~180K tokens (3 sprints)

**Sprint 1:** ~40K tokens
- Task execution: ~30K
- Validation: ~5K
- Documentation: ~5K

**Sprint 2:** ~60K tokens
- Task execution: ~45K
- Agent-dev deployment: ~10K
- Validation: ~5K

**Sprint 3:** ~80K tokens
- Task execution: ~50K
- E2E testing: ~20K
- Documentation: ~10K

**Utilization:** 90% (180K / 200K)
**Buffer:** 10% (20K remaining)
```

---

## Common Patterns

### Pattern 1: New Feature with Testing

```markdown
### Sprint X: [Feature Name] (~50K tokens)

**Tasks:**
1. Implement core logic (~20K)
2. Add unit tests (~15K)
3. Integration tests (~10K)
4. Deploy to agent-dev (~5K)

**Validation:** Tests pass, agent-dev E2E verified
**Risk:** Medium (new code path)
**Checkpoint:** User reviews feature in agent-dev
```

### Pattern 2: Database Migration

```markdown
### Sprint X: [Migration Name] (~80K tokens)

**Tasks:**
1. Create migration SQL (~10K)
2. Update repository code (~20K)
3. Update service code (~15K)
4. Backfill script (~10K)
5. Validation queries (~5K)
6. Deploy to agent-dev (~10K)
7. Production migration plan (~10K)

**Validation:** Agent-dev migration successful, data validated
**Risk:** High (database changes)
**Checkpoint:** User approves migration plan before production
```

### Pattern 3: Breaking Change

```markdown
### Sprint X: [Breaking Change] (~100K tokens)

**Tasks:**
1. Implement new interface (~25K)
2. Update all consumers (~40K)
3. Deprecation warnings (~10K)
4. Migration guide (~10K)
5. Full test suite (~15K)

**Validation:** All services updated, tests passing
**Risk:** Critical (breaks API contract)
**Checkpoint:** Staged rollout plan approval
```

---

## Anti-Patterns to Avoid

### ❌ Time-Based Estimates

```markdown
<!-- WRONG -->
### Sprint 1: Foundation (3-5 days)
**Effort:** 16-24 hours of development time

<!-- CORRECT -->
### Sprint 1: Foundation (~40K tokens)
**Scope:** DebugToolLogger + tests + integration
```

### ❌ Human Team Coordination

```markdown
<!-- WRONG -->
**Dependencies:**
- Wait for backend team to finish API
- Daily standup to sync progress
- Code review with 2 approvals

<!-- CORRECT -->
**Dependencies:**
- Sprint 1 must complete (API implementation)
- Checkpoint: User approves API design
- Validation: Automated tests verify integration
```

### ❌ Vague Validation

```markdown
<!-- WRONG -->
**Validation:** Make sure it works

<!-- CORRECT -->
**Validation:**
- Build: `npm run build` (no errors)
- Tests: `npm test debug-tool-logger` (26/26 passing)
- Agent-dev: Deploy, send `!debug test`, verify trace messages visible
```

### ❌ Missing Risk Assessment

```markdown
<!-- WRONG -->
### Sprint 2: Integration

**Tasks:**
- Modify core processor
- Add logging

<!-- CORRECT -->
### Sprint 2: Integration

**Risk:** High (modifies core processor)
**Mitigation:**
- Fail-open error handling
- Feature flag for rollback
- Extensive testing in agent-dev
```

---

## Checklist: Valid Agent Roadmap

Use this checklist when reviewing Technical Architecture roadmaps:

- [ ] **Sprints** are logical goals (not time-boxed, achieved through dialogue)
- [ ] **Context budget** estimated per sprint (~30K-150K total tokens)
- [ ] **Tasks** defined clearly (agent will collaborate with user to complete)
- [ ] **Validation criteria** specified for each sprint
- [ ] **Risk assessment** included (low/medium/high)
- [ ] **Dependencies** documented between sprints
- [ ] **Parallelization** opportunities identified
- [ ] **Checkpoints** defined (user review gates between sprints)
- [ ] **Agent-dev validation** included for integration changes
- [ ] **Deliverables** are concrete and testable
- [ ] **No time estimates** (no days, weeks, or hours mentioned)
- [ ] **Conversational tone** (acknowledges iterative dialogue)

**If all boxes checked:** ✅ Roadmap is agent-ready

**If missing items:** ⚠️ Revise before sprint execution

---

## Integration with Sprint Protocol

This guide complements the Sprint Protocol (AGENTS.md):

| Guide | Scope |
|-------|-------|
| **Agent Planning Guide** (this doc) | How to PLAN sprints in Technical Architecture docs |
| **Sprint Protocol** (AGENTS.md) | How to EXECUTE sprints once planned |

**Workflow:**
1. **Architect creates TA doc** → Uses this guide to plan sprints
2. **User approves TA doc** → Checkpoint: Roadmap looks good
3. **User starts sprint** → `sprint.start()` or explicit request
4. **Agent executes sprint** → Follows AGENTS.md protocol
5. **Agent validates** → Deploy to agent-dev, run tests
6. **User reviews checkpoint** → Approve/reject/revise
7. **Repeat for next sprint** → Until roadmap complete

---

## Examples from Platform

### Example 1: NATS Technical Architecture

**Before (Human Planning):**
```markdown
### Phase 1: Monitoring and Observability (Sprint 1-2)
**Tasks:** (1-2 days)
1. Add NATS Prometheus exporter to docker-compose
2. Create Grafana dashboards
```

**After (Agent Planning):**
```markdown
### Sprint 1: Monitoring Foundation (~35K tokens)

**Goal:** Add NATS observability stack with dashboards

**Deliverables:**
- ✅ Updated `docker-compose.observability.yaml`
- ✅ Prometheus NATS exporter configuration
- ✅ 3 Grafana dashboards (streams, consumers, throughput)
- ✅ Alert rules for stream depth and consumer lag

**Tasks:**
1. Add NATS exporter to docker-compose (~10K tokens)
   - Validation: Exporter starts, metrics visible
2. Create Grafana dashboards (~15K tokens)
   - Validation: Dashboards render correctly
3. Add Prometheus alert rules (~10K tokens)
   - Validation: Alerts fire on test conditions

**Validation:**
- Build: `docker-compose up observability` (stack starts)
- Metrics: `curl localhost:7777/metrics` (NATS metrics present)
- Agent-dev: Deploy stack, generate load, verify dashboards

**Risk:** Low (observability-only, no code changes)
**Dependencies:** None
**Parallelization:** Sequential (dashboard depends on exporter)
**Checkpoint:** User reviews dashboards before Sprint 2
```

### Example 2: Debug Mode Tool Logging

**Before (Human Planning):**
```markdown
### Phase 2: LLM Bot Integration (Sprint 2)
**Tasks:** (2-3 days)
- Integrate tool logger into processor
- Add integration tests
```

**After (Agent Planning):**
```markdown
### Sprint 2: LLM Bot Integration (~60K tokens)

**Goal:** Integrate tool logging into processor with full validation

**Deliverables:**
- ✅ Updated `processor.ts` (tool wrapper integration)
- ✅ Integration test suite (internal + MCP tools)
- ✅ Agent-dev deployment validation
- ✅ Real-time trace message verification

**Tasks:**
1. Integrate DebugToolLogger into tool wrapper (~20K tokens)
   - Modify processor.ts:786-806
   - Add logger instantiation and calls
   - Validation: Tool calls logged, no regressions
2. Add integration tests (~15K tokens)
   - Test internal tools (get_bot_status, list_tools)
   - Test MCP tools (tavily.search)
   - Validation: 13/13 integration tests passing
3. Deploy to agent-dev (~15K tokens)
   - Provision `agent-dev-debug-tool-test`
   - Deploy llm-bot service
   - Test debug mode E2E
   - Validation: Trace messages visible in Discord

**Validation:**
- Build: TypeScript clean, no errors
- Tests: All unit + integration tests passing (39/39)
- Agent-dev: `!debug search weather SF` → tool calls visible in trace
- Performance: No latency increase (debug disabled overhead <1ms)

**Risk:** Medium (modifies core processor logic)
**Mitigation:**
- Fail-open error handling (logging errors don't break tools)
- Early return when debug disabled (zero overhead)
- Extensive integration tests

**Dependencies:** Sprint 1 complete (DebugToolLogger exists)
**Parallelization:** Cannot parallelize (same file edits)
**Checkpoint:** User tests debug mode in agent-dev, approves trace format
```

---

## Summary

**Key Principles for Agent Planning:**

1. **Sprints are logical goals**, not time periods
2. **Turns are Human→Agent interactions**, not planning units
3. **Context budget** is the currency, not story points or hours
4. **Sprints involve dialogue** across many conversational turns
5. **Validation checkpoints** separate sprints (user review gates)
6. **Agent-dev deployment** is mandatory for integration changes
7. **Risk assessment** drives mitigation strategy
8. **Parallelization** is unlimited (unlike human teams)
9. **Tasks are collaborative** (refined through conversation)
10. **Checkpoint gates** ensure user oversight between sprints

**When creating Technical Architecture documents:**
- Estimate in **tokens** (~30K-150K total per sprint)
- Define **tasks** (agent will ask clarifying questions as needed)
- Specify **validation criteria** (build, test, agent-dev)
- Mark **checkpoints** (user review gates between sprints)
- Assess **risk** (low/medium/high/critical)
- Identify **dependencies** (sequential vs concurrent)
- Flag **parallelization** opportunities
- Acknowledge **iterative nature** (sprints unfold through conversation)

**Result:** Roadmaps that are **executable by coding agents** with clear validation gates and user checkpoints, designed for conversational collaboration.

---

## References

- **Sprint Protocol:** AGENTS.md (how to execute sprints)
- **Development Patterns:** CLAUDE.md (general coding guidance)
- **Agent-Dev Contexts:** documentation/guides/agent-dev-contexts.md
- **Example TA Docs:**
  - documentation/architecture/nats-technical-architecture.md
  - documentation/architecture/debug-mode-tool-interaction-logging.md

---

**Document Status:** ✅ Complete
**Last Updated:** 2026-08-21
**Owner:** Platform Architecture Team
