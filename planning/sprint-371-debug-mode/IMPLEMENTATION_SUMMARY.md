# Sprint 371: Debug Mode - Implementation Summary

**Role:** Lead Implementor
**Created:** 2026-07-28
**Status:** Ready for Implementation

---

## Quick Start

### For Developers Starting Implementation:

1. **Read:** [execution-plan.md](./execution-plan.md) - Understand phases and dependencies
2. **Track:** [backlog.yaml](./backlog.yaml) - Use this for day-to-day task tracking
3. **Reference:** [technical-architecture.md](./technical-architecture.md) - Technical details and code examples
4. **Future:** [connector-debug-interface.md](./connector-debug-interface.md) - Long-term vision (Sprint 372+)

### Starting the Sprint:

```bash
# 1. Update backlog status
vim planning/sprint-371-debug-mode/backlog.yaml
# Set DBG-001 status: in_progress

# 2. Create feature branch
git checkout -b feat/debug-queries

# 3. Start with Phase 1, Task 1
# File: src/types/config.ts
# Task: Add debugUsersSlack, debugUsersTwitch, debugUsersDiscord fields
```

---

## Sprint Overview

### Goal
Enable authorized users to trace events through the BitBrat platform in real-time by sending `!debug <message>` in Slack.

### Scope
- **Platform:** Slack Socket Mode (Sprint 348 framework)
- **User Experience:** Real-time progress updates at each stage transition
- **RBAC:** Ingress-level authorization (before auth service)
- **Deliverable:** Working prototype with tests and documentation

### Out of Scope (Future Sprints)
- Multi-platform support (Twitch, Discord, Twilio) - Sprint 373+
- Connector interface standardization - Sprint 372
- DLQ/retry notifications - Sprint 372
- Sensitive data redaction - Sprint 372

---

## Implementation Approach

### Why This Approach?

**Tactical (Sprint 371):** Get it working for Slack with minimal changes
- Embed debug logic directly in SlackIngressClient
- Use existing `qos.tracer` flag (no schema changes)
- Send debug updates via generic egress events

**Strategic (Sprint 372+):** Standardize across all connectors
- Extract debug logic into `DebugCapableConnector` interface
- Create `BaseDebugConnector` abstract class
- Platform-specific mixins (SlackDebugMixin, TwitchDebugMixin, etc.)

**Rationale:** Ship fast, refactor later. Prove value before over-engineering.

---

## Task Breakdown

### Phase 1: Foundation (1-2 days)
**Goal:** Configuration, types, test infrastructure

| ID | Task | Effort | Owner |
|----|------|--------|-------|
| DBG-001 | Add debug config to IConfig | S (1h) | Agent |
| DBG-002 | Define debug event metadata types | S (2h) | Agent |
| DBG-003 | Create debug test utilities | S (2h) | Agent |
| DBG-004 | Update environment config files | S (1h) | Agent |

**Deliverable:** Can load debug user lists from environment, create test debug events

---

### Phase 2: Slack Connector (2-3 days)
**Goal:** Debug detection, RBAC, activation message

| ID | Task | Effort | Owner |
|----|------|--------|-------|
| DBG-005 | Implement debug detection | M (3h) | Agent |
| DBG-006 | Add RBAC authorization check | M (2h) | Agent |
| DBG-007 | Update envelope builder | S (2h) | Agent |
| DBG-008 | Implement activation confirmation | S (2h) | Agent |
| DBG-009 | Unit tests for Slack debug | M (4h) | Agent |

**Deliverable:** Users can send `!debug` command and receive "Debug mode ON" confirmation

---

### Phase 3: Base Server (2-3 days)
**Goal:** Real-time progress updates and completion summary

| ID | Task | Effort | Owner |
|----|------|--------|-------|
| DBG-010 | Implement sendDebugUpdate helper | M (3h) | Agent |
| DBG-011 | Add progress logging to Bit.next() | M (3h) | Agent |
| DBG-012 | Add completion summary to Bit.complete() | S (2h) | Agent |
| DBG-013 | Integration tests for end-to-end flow | L (4h) | Agent |

**Deliverable:** Debug events show real-time progress at each stage transition

---

### Phase 4: Polish (1-2 days)
**Goal:** Production readiness and documentation

| ID | Task | Effort | Owner |
|----|------|--------|-------|
| DBG-014 | Add error handling and graceful degradation | M (3h) | Agent |
| DBG-015 | Write user documentation | M (3h) | Agent |
| DBG-016 | Write developer documentation | S (2h) | Agent |

**Deliverable:** Production-ready debug mode with comprehensive docs

---

## Critical Path

```
DBG-001 (Config)
   ↓
DBG-002 (Types)
   ↓
DBG-005 (Detection) → DBG-006 (RBAC) → DBG-007 (Envelope)
   ↓
DBG-009 (Tests)
   ↓
DBG-010 (Helper) → DBG-011 (Progress) → DBG-012 (Completion)
   ↓
DBG-013 (Integration Tests)
   ↓
DONE
```

**Parallel Opportunities:**
- DBG-004 can run parallel with DBG-002
- DBG-008 can run parallel with DBG-007
- DBG-014, DBG-015, DBG-016 can all run parallel

---

## Key Technical Decisions

### 1. RBAC at Ingress (Not Auth Service)

**Decision:** Check `DEBUG_USERS_SLACK` allowlist in SlackIngressClient, before envelope creation.

**Rationale:**
- Must observe auth service failures (chicken-and-egg problem)
- Early rejection prevents unauthorized events from entering message bus
- Platform-specific user ID resolution (Slack User ID vs. Twitch username)

**Implementation:** `slack-ingress-client.ts:218` (handleMessage)

---

### 2. Use Existing `qos.tracer` Flag

**Decision:** Leverage `event.qos.tracer = true` instead of new `event.debug.*` field.

**Rationale:**
- `qos.tracer` already exists in `QOSV1` interface (Sprint 152)
- Original purpose: "enables high-verbosity tracing and logging"
- No schema changes required (faster implementation)

**Trade-off:** Debug mode shares flag with other tracing mechanisms.

---

### 3. Generic Egress for Feedback

**Decision:** Send debug updates by creating minimal egress events and publishing to `INTERNAL_EGRESS_V1`.

**Rationale:**
- Reuses existing egress infrastructure
- No connector-specific feedback code in base server
- Works with any platform (Slack, Twitch, Discord)

**Trade-off:** No rich formatting (Slack Blocks) in Sprint 371. Deferred to connector interface (Sprint 372).

---

### 4. Fire-and-Forget Feedback

**Decision:** Debug updates are async (no blocking, no error propagation).

**Rationale:**
- Debug is a nice-to-have - must not break core routing
- Egress failures should not crash base server
- Performance: <5ms overhead for non-debug events

**Implementation:** `sendDebugUpdate()` wrapped in try/catch, logs warnings only.

---

## Risk Management

### Risk 1: Performance Impact
**Mitigation:** Early-exit if `qos.tracer !== true` (<1ms overhead)

### Risk 2: Feedback Loops
**Mitigation:** Debug feedback events have `qos.tracer = false` (no recursion)

### Risk 3: RBAC Bypass
**Mitigation:** Use platform-provided user ID (trusted source), audit logging

### Risk 4: Sensitive Data Exposure
**Mitigation:** Document redaction requirements (future sprint), no auto-redaction in Sprint 371

---

## Testing Strategy

### Unit Tests (90% Coverage Target)
- **Location:** `src/services/ingress/slack/*.test.ts`, `src/common/base-server.test.ts`
- **Scenarios:**
  - Debug pattern detection (positive/negative)
  - RBAC authorization (authorized/unauthorized)
  - Envelope builder with/without debug metadata
  - sendDebugUpdate happy path and error cases

### Integration Tests
- **Location:** `src/apps/ingress-egress-service.test.ts`
- **Scenarios:**
  - Authorized user receives all updates (activation → progress → completion)
  - Unauthorized user receives no updates
  - Non-debug events unaffected (regression check)

### Manual Testing
- **Environment:** Local Docker Compose
- **Platform:** Slack Socket Mode
- **Checklist:**
  - [ ] Send `!debug @bot test` as authorized user
  - [ ] Verify activation confirmation received
  - [ ] Observe progress updates in Slack channel
  - [ ] Verify completion summary with duration
  - [ ] Send `!debug @bot test` as unauthorized user
  - [ ] Verify no debug feedback received

---

## Success Criteria

### Functional ✅
- [ ] Authorized Slack users can activate debug mode
- [ ] Unauthorized users receive no debug feedback
- [ ] Debug events show progress at each stage
- [ ] Completion summary includes duration and stages
- [ ] Works end-to-end in local environment

### Non-Functional ✅
- [ ] Debug feedback arrives within 500ms
- [ ] Non-debug events have <5ms overhead
- [ ] Unit test coverage ≥90%
- [ ] Integration tests pass
- [ ] Documentation complete

### Quality ✅
- [ ] No regressions in existing tests
- [ ] Linting and TypeScript pass
- [ ] Code review approved

---

## Daily Checklist

### Day 1: Foundation
- [ ] DBG-001: IConfig extension
- [ ] DBG-002: Type definitions
- [ ] DBG-003: Test utilities
- [ ] DBG-004: Environment config
- [ ] **Checkpoint:** Can create test debug events with metadata

### Day 2-3: Slack Connector
- [ ] DBG-005: Debug detection
- [ ] DBG-006: RBAC check
- [ ] DBG-007: Envelope builder
- [ ] DBG-008: Activation message
- [ ] DBG-009: Unit tests
- [ ] **Checkpoint:** Users receive "Debug mode ON" confirmation

### Day 4-5: Base Server
- [ ] DBG-010: sendDebugUpdate helper
- [ ] DBG-011: Bit.next() integration
- [ ] DBG-012: Bit.complete() integration
- [ ] DBG-013: Integration tests
- [ ] **Checkpoint:** End-to-end debug flow working

### Day 6-7: Polish
- [ ] DBG-014: Error handling
- [ ] DBG-015: User docs
- [ ] DBG-016: Dev docs
- [ ] **Final Checkpoint:** Production-ready, documented

---

## Rollback Plan

### If Debug Mode Breaks Production

**Quick Disable:**
```bash
# Set empty debug users list (disables feature)
export DEBUG_USERS_SLACK=""
docker restart bitbrat-ingress-egress-1
```

**Full Rollback:**
```bash
# Revert to previous git commit
git revert feat/debug-queries
git push origin main
brat deploy service ingress-egress --context staging
```

---

## Post-Sprint Activities

### After Sprint 371 Completes:

1. **Retrospective:**
   - What went well? (capture in retro.md)
   - What could be improved?
   - Lessons learned about connector integration

2. **Planning Sprint 372:**
   - Extract debug logic into connector interface
   - Implement `DebugCapableConnector` and `BaseDebugConnector`
   - Refactor Slack connector to use mixin pattern

3. **Documentation Updates:**
   - Update CLAUDE.md with debug mode patterns
   - Add debug mode to platform overview docs
   - Create troubleshooting guide

---

## Questions & Clarifications

### If You Need Help:

**Architecture Questions:**
- Read: [technical-architecture.md](./technical-architecture.md)
- Search: "Why RBAC at ingress?" (see §6.1)

**Implementation Questions:**
- Read: [execution-plan.md](./execution-plan.md)
- Check: Task dependencies in backlog.yaml

**Scope Questions:**
- Check: "Out of Scope" section above
- If unclear, ask before implementing

---

## Final Reminders

✅ **Commit frequently** - Push after each task completion

✅ **Update backlog.yaml** - Mark tasks as in_progress/done

✅ **Run tests before PR** - `npm test`, `npm run lint`, `npm run build`

✅ **Test in local Docker** - Verify end-to-end flow before merging

✅ **Document decisions** - Add notes to backlog.yaml log field

✅ **Ask if blocked** - Don't spend >30min stuck on one issue

---

**Ready to implement? Start with [backlog.yaml](./backlog.yaml) → DBG-001**

Good luck! 🚀
