# Sprint 371: Debug Mode - Real-Time Event Tracing

**Status:** Architecture Phase
**Created:** 2026-07-28
**Sprint Goal:** Enable privileged users to receive real-time debug feedback as events flow through the BitBrat platform

---

## Overview

This sprint implements a `!debug` command that allows authorized users to trace events through the 5-stage agent flow in real-time, receiving progress updates at each stage transition.

**Example:**

```
User: !debug @bitbrat_the_ai What time is it?

Bot: 🔍 Debug mode ON
     Correlation ID: 7f3a1b2c-9d4e-5f6a-7b8c-9d0e1f2a3b4c

Bot: [Contextualization] auth: User matched (user_123)
Bot: [Analysis] llm-bot: Tool selected (get_current_time)
Bot: [Reaction] Tool executed: {"time": "2026-07-28T10:15:00Z"}

Bot: ✅ Event complete (4.2s)
```

---

## Documents

### 1. [execution-plan.md](./execution-plan.md)

**Implementation execution plan with phases, dependencies, and timeline.**

Breaks down the sprint into **4 phases** with **16 trackable tasks**:
- Phase 1: Foundation (configuration, types, test utilities)
- Phase 2: Slack Connector (detection, RBAC, envelope builder)
- Phase 3: Base Server (progress updates, completion summary)
- Phase 4: Polish (error handling, documentation)

**Key sections:**
- §1-4: Phase breakdowns with goals and task lists
- §5: Task dependency graph (Mermaid diagram)
- §6: Implementation order and rationale
- §7: Risk mitigation strategies
- §8: Testing strategy (unit, integration, manual)
- §9: Rollback plan
- §10: Timeline (day-by-day breakdown)

---

### 2. [backlog.yaml](./backlog.yaml)

**Trackable YAML backlog with 16 prioritized tasks.**

Standard BitBrat sprint backlog format:
- Priority: P0 (must have), P1 (should have)
- Effort: S (small, <4h), M (medium, 4-8h), L (large, >8h)
- Status: todo, in_progress, blocked, done
- Dependencies: Explicit task IDs
- Acceptance criteria: Testable deliverables

**Total Estimated Effort:** 40 hours (5-7 days)

**Critical Path:** DBG-001 → DBG-002 → DBG-005 → DBG-006 → DBG-009 → DBG-010 → DBG-011 → DBG-013

---

### 3. [technical-architecture.md](./technical-architecture.md)

**Primary implementation plan for Sprint 371.**

Describes the tactical approach to get debug mode working for Slack integration:
- RBAC enforcement at ingress (before auth service)
- `qos.tracer` flag to enable platform-wide debug behavior
- Real-time feedback via egress channel
- Configuration via `DEBUG_USERS_SLACK` environment variable

**Key sections:**
- §2: Core Concepts (debug activation, authorization, metadata)
- §3: Architecture Components (connector, base server, persistence)
- §4: Implementation Details (code changes to Slack connector, base server)
- §5: Configuration (environment variables, IConfig extension)
- §6: Security Considerations (RBAC, sensitive data redaction)

---

### 4. [connector-debug-interface.md](./connector-debug-interface.md)

**Future-facing standardized connector architecture.**

Describes the strategic direction for making debug mode a first-class connector capability with standardized interfaces:
- `DebugCapableConnector` interface with 4 standard hooks
- `BaseDebugConnector` abstract class (80% of logic pre-implemented)
- Platform-specific mixins (Slack, Twitch, Discord, etc.)
- Compliance test suite for all implementations

**Key sections:**
- §2: Connector Debug Contract (interfaces, types)
- §3: Base Connector Class (reusable debug logic)
- §4: Platform Implementations (Slack, Twitch examples)
- §5: Integration with Base Server (connector-aware debug)
- §6: Connector Validation (compliance tests)

---

## Sprint Phases

### Phase 1: Core Implementation (Sprint 371)
**Goal:** Debug mode working for Slack Socket Mode

**Deliverables:**
- [ ] Ingress connector changes (detect `!debug`, RBAC, strip prefix)
- [ ] Envelope builder changes (pass debug metadata)
- [ ] Base server `next()` changes (send progress updates)
- [ ] Base server `complete()` changes (send completion summary)
- [ ] IConfig extension (debug user fields)
- [ ] Unit tests (Slack connector)
- [ ] Integration tests (end-to-end debug flow)
- [ ] User documentation

---

### Phase 2: Connector Interface (Sprint 372)
**Goal:** Extract debug logic into standardized connector interface

**Deliverables:**
- [ ] Define `DebugCapableConnector` interface
- [ ] Create `BaseDebugConnector` abstract class
- [ ] Refactor Slack connector to use `SlackDebugMixin`
- [ ] Update base server to use `connector.sendDebugUpdate()`
- [ ] Create connector compliance test suite
- [ ] Migration guide for existing connectors

---

### Phase 3: Multi-Platform (Sprint 373+)
**Goal:** Roll out debug support to all platforms

**Deliverables:**
- [ ] Implement `TwitchDebugMixin`
- [ ] Implement `DiscordDebugMixin`
- [ ] Implement `TwilioDebugMixin`
- [ ] DLQ/retry notifications
- [ ] Error detail enrichment
- [ ] Stage-level metrics

---

## Key Design Decisions

### 1. RBAC at Ingress (Not Auth Service)

**Decision:** Enforce debug authorization at ingress connector level, before auth service enrichment.

**Rationale:**
- Must observe auth service failures (chicken-and-egg problem)
- Early rejection prevents unauthorized debug events from entering message bus
- Platform-specific user identity resolution (Slack User ID vs. Twitch username)

**Trade-off:** Debug user allowlists must be configured per-platform (no centralized RBAC).

---

### 2. Connector-Based Architecture

**Decision:** Make debug mode a standardized connector capability, not a platform-specific feature.

**Rationale:**
- New platforms get debug support "for free" by extending `BaseDebugConnector`
- Compliance tests ensure consistent behavior across all platforms
- Platform-specific formatting (Slack Blocks, Discord Embeds) via `formatDebugUpdate()` override

**Trade-off:** Requires refactoring existing Slack implementation in Phase 2.

---

### 3. QoS Tracer Flag

**Decision:** Use existing `event.qos.tracer` field instead of new `event.debug.*` field.

**Rationale:**
- `qos.tracer` already exists in `QOSV1` interface (Sprint 152)
- Original purpose: "enables high-verbosity tracing and logging"
- No schema changes required

**Trade-off:** Debug mode shares flag with other tracing mechanisms (potential conflicts).

---

## Security & Privacy

### RBAC Enforcement

- **Allowlist-based:** `DEBUG_USERS_SLACK=U0123,U9876` (comma-separated user IDs)
- **Per-platform:** Each connector has its own allowlist
- **Audit logging:** All debug activations logged with `userId`, `channel`, `correlationId`

### Sensitive Data Redaction

- Auto-redact: `event.identity.auth`, `event.metadata.secrets`
- No debug feedback to public channels (must be DM or authorized private channel)
- Debug history persistence includes redacted snapshots only

---

## Open Questions

1. **Debug timeout:** Should debug mode auto-disable after N seconds?
   - **Recommendation:** No timeout in Phase 1; add optional `DEBUG_TIMEOUT_MS` in Phase 2 if needed

2. **Rich formatting fallback:** What if Slack Blocks API fails?
   - **Recommendation:** Automatic fallback to plain text (already implemented in `BaseDebugConnector`)

3. **Connector discovery:** How does `Bit.next()` find the connector instance?
   - **Recommendation:** Add `connectorManager` to resource managers (consistent with `publisher`, `firestore`)

---

## Success Criteria

**Functional:**
- [ ] Slack users in `DEBUG_USERS_SLACK` can activate debug mode
- [ ] Unauthorized users receive no feedback (silently ignored)
- [ ] Debug events show progress at each stage transition
- [ ] Completion summary includes duration, stages, final status

**Non-Functional:**
- [ ] Debug feedback arrives within 500ms of stage transition
- [ ] No impact on non-debug event latency (<5ms overhead)
- [ ] No sensitive data exposed in debug messages

**Documentation:**
- [ ] User guide: How to enable debug mode
- [ ] Operator guide: How to authorize debug users
- [ ] Developer guide: Adding debug to new connector

---

## References

### Codebase
- `src/services/ingress/slack/slack-ingress-client.ts` - Slack connector
- `src/services/ingress/core/interfaces.ts` - Connector interfaces
- `src/common/base-server.ts` - Base server (`next()`, `complete()`)
- `src/types/events.ts` - InternalEventV2, QOSV1

### Documentation
- `documentation/concepts/agent-flow-stages.md` - 5-stage agent flow
- `CLAUDE.md` - Ingress/Egress Framework patterns

### Related Sprints
- Sprint 348: Slack Integration
- Sprint 342: Connector Interfaces
- Sprint 341: 5-Stage Agent Flow Model
- Sprint 152: QoS (tracer flag)
