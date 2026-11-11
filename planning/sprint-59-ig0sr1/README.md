# Sprint 59: Observability - ToolObserver + Loki Integration

**Sprint ID**: sprint-59-ig0sr1
**Owner**: christophernavta
**Status**: Planning
**Created**: 2026-11-11
**Duration**: 1.5-2 weeks

---

## Quick Start

### Sprint Context
- **Worktree**: `.worktrees/sprint-59-ig0sr1/`
- **Branch**: `feature/sprint-59-ig0sr1-observability-toolobserver-lok`
- **Planning Dir**: `planning/sprint-59-ig0sr1/`

### Key Documents
1. **[execution-plan.md](./execution-plan.md)** - Comprehensive sprint execution plan with tasks, acceptance criteria, and timeline
2. **[backlog.yaml](./backlog.yaml)** - Trackable YAML backlog with 43 subtasks across 8 major tasks
3. **[sprint-manifest.yaml](./sprint-manifest.yaml)** - Sprint metadata and status

---

## Sprint Goal

Integrate with existing Loki infrastructure for tool-centric metrics and tracing, enabling per-tool and per-model observability without disrupting existing logging infrastructure.

**Key Achievement**: Build on already-deployed Loki/Promtail infrastructure (saves ~1 week vs original timeline).

---

## What We're Building

### Core Deliverables
1. **ToolObserver Module** - Queries Loki for metrics, traces, and health monitoring
2. **Event Logging** - Structured `tool.invocation` events in ToolGateway
3. **4 MCP Tools** - Programmatic metrics access (tool.get_metrics, model.get_metrics, tool.trace_request, tool.get_health)
4. **4 Grafana Dashboards** - Visual observability (Invocation Rate, Error Rate/Latency, RBAC Denials, Cost Tracking)
5. **Health Tracking** - Automated health status updates in ToolRegistry

---

## Sprint Breakdown

### Timeline (1.5-2 weeks, ~128 hours)

| Task | Duration | Status | Dependencies |
|------|----------|--------|--------------|
| **T1: Verify Loki Config** | 0.5 days | Pending | None |
| **T2: ToolObserver Module** | 4 days | Pending | T1 |
| **T3: Event Logging** | 3 days | Pending | T1 |
| **T4: MCP Tools** | 2 days | Pending | T2, T3 |
| **T5: Grafana Dashboards** | 3 days | Pending | T3 |
| **T6: Health Tracking** | 2 days | Pending | T2, T3 |
| **T7: Integration Testing** | 1 day | Pending | All above |
| **T8: Documentation** | 0.5 days | Pending | T7 |

**Critical Path**: T1 → T2 → T4 → T7

---

## Key Technical Decisions

### 1. Event Logging via Stdout (NOT NATS)
- Tool invocations logged as structured JSON to stdout
- Promtail picks up logs → forwards to Loki
- NO new NATS topics (observability via logs, not message bus)

### 2. Loki Label Strategy
Limited to 6 labels to prevent cardinality explosion:
- `service` (tool-orchestrator)
- `level` (info, error)
- `eventType` (tool.invocation)
- `toolId` (e.g., get_weather)
- `modelId` (e.g., gpt-4, claude-sonnet-3.5)
- `status` (success, error, denied)
- `correlationId` (for tracing)

**Estimated cardinality**: ~500 tools × ~10 models × 3 statuses = ~15,000 combinations (well within Loki limits)

### 3. Health Status Logic
- **Healthy**: Error rate < 5%, recent invocations (< 1 hour)
- **Degraded**: Error rate 5-20%, recent invocations
- **Unhealthy**: Error rate > 20% OR no invocations > 1 hour

### 4. Metrics Storage
- **NOT stored in PostgreSQL** (wrong data model, expensive queries)
- **Derived from Loki event stream** (query-time aggregation)
- **Lightweight health cache** in ToolRegistry (timestamps only)

---

## Acceptance Criteria

### Sprint-Level Success
- [ ] ToolObserver queries Loki successfully
- [ ] All tool invocations logged with structured events
- [ ] 4 Grafana dashboards rendering correctly
- [ ] MCP tools return accurate metrics
- [ ] Correlation tracing works (end-to-end request debugging)
- [ ] Tool health derived from Loki event stream
- [ ] Integration test: 100 messages → 100+ events in Loki
- [ ] Zero disruption to existing Loki/Promtail infrastructure

---

## Testing Strategy

### Unit Tests
- ToolObserver module (≥70% coverage)
- Event logging logic in ToolGateway
- Health status derivation

### Integration Tests
1. Deploy to agent-dev
2. Send 100 test messages (mix of tools/models)
3. Verify 100+ events in Loki
4. Query metrics via MCP tools (verify accuracy)
5. Validate Grafana dashboards render
6. Test correlation tracing

### Validation
- No Loki cardinality spikes
- No Promtail errors
- Existing Loki queries still work
- Dashboard query performance acceptable

---

## Risks & Mitigations

### Risk 1: Loki Cardinality Explosion
- **Mitigation**: Limit labels to 6, test in agent-dev first
- **Rollback**: Remove correlationId from labels, reduce to 4 labels

### Risk 2: Promtail Incompatibility
- **Mitigation**: Verify Promtail picks up events (Task 3.6)
- **Rollback**: Disable tool invocation logging temporarily

---

## Documentation Deliverables

1. **[loki-configuration.md](../../documentation/reference/loki-configuration.md)** - Existing Loki infrastructure docs
2. **[tool-observability.md](../../documentation/guides/tool-observability.md)** - Using tool metrics and dashboards
3. **[tool-invocation-event-schema.md](../../documentation/reference/tool-invocation-event-schema.md)** - Event schema reference
4. **[verification-report.md](./verification-report.md)** - Sprint verification results

---

## Dependencies

### External (Already Deployed)
- ✅ Loki (log aggregation)
- ✅ Promtail (log shipping)
- ✅ Grafana (visualization)

### Internal (From Previous Sprints)
- ✅ tool-orchestrator Bit (Sprint 57)
- ✅ ToolRegistry module (Sprint 57)
- ✅ ModelRegistry module (Sprint 57)
- ✅ ToolGateway module (Sprint 58)
- ✅ PostgreSQL (existing infrastructure)

---

## Next Steps

1. **Review execution-plan.md** - Understand task breakdown and acceptance criteria
2. **Review backlog.yaml** - See all 43 subtasks with detailed requirements
3. **Get user approval** - Confirm plan before implementation
4. **Update sprint status** - Change to 'in-progress' when ready to code
5. **Start with T1** - Verify Loki configuration (critical path)

---

## References

- [Sprint 56 Implementation Plan](../../sprint-56-rqadsk/implementation-plan.md) - Overall roadmap
- [Sprint 55 Technical Architecture](../../sprint-55-h17jpp/technical-architecture.md) - Architecture details
- [Tool Invocation Event Schema](../../sprint-56-rqadsk/implementation-plan.md#section-3a-event-schema---tool-invocation-logging) - Event specification

---

**Status**: Ready for implementation. Awaiting user approval to proceed.
