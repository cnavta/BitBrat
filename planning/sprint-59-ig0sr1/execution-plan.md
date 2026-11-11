# Sprint 59 Execution Plan: Observability - ToolObserver + Loki Integration

**Sprint ID**: sprint-59-ig0sr1
**Owner**: christophernavta
**Duration**: 1.5-2 weeks
**Status**: Planning
**Created**: 2026-11-11

---

## Executive Summary

Sprint 59 implements comprehensive observability for the tool-orchestrator service by integrating with the existing Loki infrastructure. This sprint focuses on enabling per-tool and per-model metrics, distributed tracing, and health monitoring WITHOUT disrupting the existing logging infrastructure.

**Key Insight**: Loki and Promtail are already deployed and operational in the BitBrat platform. This sprint builds on existing infrastructure rather than deploying new services, saving approximately 1 week from the original timeline estimate.

---

## Goals

### Primary Goals
1. ✅ Implement ToolObserver module for querying Loki metrics
2. ✅ Add structured event logging to ToolGateway for all tool invocations
3. ✅ Create 4 Grafana dashboards for tool/model observability
4. ✅ Implement MCP tools for metrics queries and health monitoring
5. ✅ Enable correlation tracing by correlationId
6. ✅ Verify zero disruption to existing Loki/Promtail infrastructure

### Success Criteria
- ✅ ToolObserver successfully queries existing Loki instance
- ✅ All tool invocations logged with structured events
- ✅ Grafana dashboards render tool/model metrics
- ✅ Correlation tracing works (follow request by correlationId)
- ✅ Tool health derived from Loki event stream
- ✅ No disruption to existing Loki/Promtail infrastructure
- ✅ Integration test: 100 messages → 100+ events in Loki
- ✅ Query tool.get_metrics returns accurate counts

---

## Architecture Context

### Current State (Pre-Sprint 59)
- ✅ **tool-orchestrator Bit** deployed (Sprint 57)
- ✅ **ToolRegistry module** persisting tools to PostgreSQL (Sprint 57)
- ✅ **ModelRegistry module** managing model catalog (Sprint 57)
- ✅ **ToolGateway module** executing tools with dual-layer RBAC (Sprint 58)
- ✅ **Loki + Promtail** deployed and operational (existing infrastructure)
- ❌ **No tool-specific metrics** (only server-level logs)
- ❌ **No ToolObserver module** (metrics/health queries not implemented)
- ❌ **No structured tool invocation events** (no observability data)

### Target State (Post-Sprint 59)
- ✅ **ToolObserver module** queries Loki for metrics/traces
- ✅ **Structured event logging** in ToolGateway (tool.invocation events)
- ✅ **4 Grafana dashboards** visualizing tool/model performance
- ✅ **MCP tools** for programmatic metrics access
- ✅ **Health tracking** derived from Loki event stream
- ✅ **Correlation tracing** enables end-to-end request debugging

---

## Implementation Tasks

### Task 1: Verify Loki Configuration (0.5 days)
**Priority**: P0 (Critical Path)
**Dependencies**: None
**Deliverables**:
- ✅ Document existing Loki endpoint configuration
- ✅ Verify Promtail is scraping JSON logs from all Bits
- ✅ Validate log ingestion is working
- ✅ Document current retention policy (7 days local, 30 days production)
- ✅ Confirm existing label configuration

**Acceptance Criteria**:
- [ ] Loki endpoint accessible from tool-orchestrator
- [ ] Promtail actively shipping logs
- [ ] Current label schema documented
- [ ] Retention policy verified

**Files**:
- `documentation/reference/loki-configuration.md` (NEW)

---

### Task 2: Implement ToolObserver Module (4 days)
**Priority**: P0 (Critical Path)
**Dependencies**: Task 1
**Deliverables**:
- ✅ ToolObserver module implementation
- ✅ Loki client with LogQL queries
- ✅ Metric aggregation (invocations, errors, latencies)
- ✅ Health status derivation from event stream
- ✅ Unit tests (70%+ coverage)

**Acceptance Criteria**:
- [ ] ToolObserver module created at `src/apps/tool-orchestrator-service/modules/observer/tool-observer.ts`
- [ ] Implements `IToolObserver` interface
- [ ] Successfully queries Loki via LogQL
- [ ] Aggregates metrics: total invocations, error rate, P95 latency
- [ ] Derives health status: healthy/degraded/unhealthy
- [ ] Unit tests passing

**Interface**:
```typescript
export interface IToolObserver {
  // Metrics queries (Loki/LogQL)
  queryToolMetrics(toolId: string, timeRange: TimeRange): Promise<ToolMetrics>;
  queryModelMetrics(modelId: string, timeRange: TimeRange): Promise<ModelMetrics>;

  // Trace queries
  traceToolInvocation(correlationId: string): Promise<InvocationEvent[]>;

  // Health monitoring
  getToolHealth(toolId: string): Promise<ToolHealthStatus>;
  detectAnomalies(toolId: string, timeRange: TimeRange): Promise<Anomaly[]>;
}
```

**Files**:
- `src/apps/tool-orchestrator-service/modules/observer/tool-observer.ts` (NEW)
- `src/apps/tool-orchestrator-service/modules/observer/tool-observer.interface.ts` (NEW)
- `src/apps/tool-orchestrator-service/modules/observer/__tests__/tool-observer.test.ts` (NEW)
- `src/apps/tool-orchestrator-service/types/tool-metrics.ts` (NEW)

---

### Task 3: Add Event Logging to ToolGateway (3 days)
**Priority**: P0 (Critical Path)
**Dependencies**: Task 1
**Deliverables**:
- ✅ Structured event logging for all tool invocations
- ✅ Event type: `tool.invocation` (new log event type)
- ✅ Loki labels configured: service, toolId, modelId, status, correlationId, level
- ✅ Event schema includes: timestamp, durationMs, inputPreview, outputPreview, rbacDecision
- ✅ Fire-and-forget logging (non-blocking)

**Acceptance Criteria**:
- [ ] ToolGateway logs all tool invocations to stdout (structured JSON)
- [ ] Promtail picks up new event types
- [ ] Event schema matches specification (see Event Schema section below)
- [ ] Logging is asynchronous (does not block tool execution)
- [ ] RBAC denials logged with full context

**Event Schema** (see Section 3A of implementation-plan.md):
```typescript
{
  // Loki Labels (indexed)
  service: 'tool-orchestrator',
  level: 'info' | 'error',
  eventType: 'tool.invocation',
  toolId: string,
  modelId: string,
  status: 'success' | 'error' | 'denied',
  correlationId: string,

  // Log Message Fields (JSON body)
  timestamp: string,  // ISO 8601
  message: string,
  durationMs: number,
  toolName: string,
  modelName: string,
  userId?: string,
  sessionId?: string,
  inputPreview?: string,   // Max 500 chars
  outputPreview?: string,  // Max 500 chars
  errorMessage?: string,
  errorStack?: string,     // Only in dev/staging
  rbacDecision: {
    allowed: boolean,
    reason?: string,
    userRoles?: string[],
    modelTier?: string,
    requiredRoles?: string[],
    deniedRoles?: string[]
  },
  estimatedCost?: {
    tokens?: number,
    costUsd?: number
  }
}
```

**Files**:
- `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts` (MODIFIED)
- `src/apps/tool-orchestrator-service/types/tool-invocation-event.ts` (NEW)

---

### Task 4: Implement Tool Metrics MCP Tools (2 days)
**Priority**: P1
**Dependencies**: Task 2, Task 3
**Deliverables**:
- ✅ 4 MCP tools for metrics queries
- ✅ Tools delegate to ToolObserver module (in-process calls)
- ✅ Error handling for Loki unavailability (fail-open)

**Acceptance Criteria**:
- [ ] `tool.get_metrics` - Query Loki for tool metrics
- [ ] `model.get_metrics` - Query Loki for model metrics
- [ ] `tool.trace_request` - Trace by correlationId
- [ ] `tool.get_health` - Get tool health status
- [ ] All tools registered in tool-orchestrator MCP server
- [ ] Graceful degradation if Loki unavailable

**MCP Tool Signatures**:
```typescript
// tool.get_metrics
{
  toolId: string,
  timeRange: { start: string, end: string },  // ISO 8601
}

// model.get_metrics
{
  modelId: string,
  timeRange: { start: string, end: string }
}

// tool.trace_request
{
  correlationId: string
}

// tool.get_health
{
  toolId: string
}
```

**Files**:
- `src/apps/tool-orchestrator-service/index.ts` (MODIFIED - register MCP tools)

---

### Task 5: Create Grafana Dashboards (3 days)
**Priority**: P1
**Dependencies**: Task 3
**Deliverables**:
- ✅ 4 Grafana dashboards imported to existing Grafana instance
- ✅ Dashboard JSON definitions stored in repository

**Acceptance Criteria**:
- [ ] Dashboard 1: Tool Invocation Rate (by toolId, modelId)
- [ ] Dashboard 2: Error Rate & P95 Latency (by toolId)
- [ ] Dashboard 3: RBAC Denials (by reason, modelId)
- [ ] Dashboard 4: Cost Tracking (by modelId, estimated)
- [ ] All dashboards rendering correctly
- [ ] Dashboards use existing Loki data source

**Grafana Dashboards**:
1. **Tool Invocation Rate**: Line graph showing invocations/min by toolId and modelId
2. **Error Rate & Latency**: Dual-axis graph with error percentage + P95 latency
3. **RBAC Denials**: Bar chart showing denial reasons and affected models
4. **Cost Tracking**: Stacked area chart showing estimated costs by model

**LogQL Queries** (examples):
```logql
# Tool invocations for gpt-4
{service="tool-orchestrator", eventType="tool.invocation", modelId="gpt-4"}

# Error rate by tool
sum by (toolId) (rate({service="tool-orchestrator", eventType="tool.invocation", status="error"}[5m]))

# RBAC denials in last hour
{service="tool-orchestrator", eventType="tool.invocation", status="denied"} |= "denied" | json

# P95 latency for specific tool
quantile_over_time(0.95, {service="tool-orchestrator", eventType="tool.invocation", toolId="get_weather"} | json | unwrap durationMs [5m])
```

**Files**:
- `infrastructure/grafana/dashboards/tool-invocation-rate.json` (NEW)
- `infrastructure/grafana/dashboards/error-rate-latency.json` (NEW)
- `infrastructure/grafana/dashboards/rbac-denials.json` (NEW)
- `infrastructure/grafana/dashboards/cost-tracking.json` (NEW)

---

### Task 6: Update Health Tracking (2 days)
**Priority**: P2
**Dependencies**: Task 2, Task 3
**Deliverables**:
- ✅ ToolRegistry stores lightweight health status
- ✅ Health status updated from ToolObserver queries (every 5 min)
- ✅ Background job for health updates

**Acceptance Criteria**:
- [ ] ToolRegistry.health field populated from ToolObserver
- [ ] Background job runs every 5 minutes
- [ ] Health status: healthy, degraded, unhealthy
- [ ] Timestamps: lastInvocationAt, lastSuccessAt, lastErrorAt
- [ ] Health updates are non-blocking

**Health Status Logic**:
- **healthy**: Recent invocations (< 1 hour), error rate < 5%
- **degraded**: Recent invocations, error rate 5-20%
- **unhealthy**: No recent invocations (> 1 hour) OR error rate > 20%

**Files**:
- `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts` (MODIFIED)
- `src/apps/tool-orchestrator-service/modules/observer/health-updater.ts` (NEW)

---

## Risk Mitigation

### Risk 1: Loki Cardinality Explosion
**Impact**: Medium (Loki becomes slow/unstable)
**Mitigation**:
- Limit labels to 6: service, toolId, modelId, status, correlationId, level
- NO high-cardinality labels: userId, messageText, timestamps
- Test cardinality in agent-dev before production
- Monitor Loki cardinality metrics

**Rollback**:
- Remove correlationId from labels (move to log body)
- Reduce to 4 labels: service, toolId, status, level

### Risk 2: Promtail Incompatibility
**Impact**: Medium (Events not ingested)
**Mitigation**:
- Verify Promtail picks up new event types (Task 1)
- Test in agent-dev first
- Monitor Promtail logs for errors

**Rollback**:
- Disable tool invocation logging temporarily
- Investigate Promtail configuration

---

## Testing Strategy

### Unit Tests
- ToolObserver module (70%+ coverage)
- Event logging logic in ToolGateway
- Health status derivation

### Integration Tests
1. **Loki Integration**: Deploy to agent-dev, send 100 messages, verify 100+ events in Loki
2. **Metrics Query**: Call tool.get_metrics, verify counts match expected
3. **Correlation Tracing**: Trace request by correlationId, verify full event timeline
4. **Dashboard Rendering**: Import Grafana dashboards, verify all 4 render correctly

### Validation Checklist
- [ ] ToolObserver queries return accurate metrics
- [ ] All tool invocations logged
- [ ] Grafana dashboards render
- [ ] Correlation tracing works
- [ ] Tool health derived from events
- [ ] No disruption to existing Loki infrastructure

---

## Deployment Plan

### Phase 1: Agent-Dev Testing
1. Deploy tool-orchestrator to agent-dev
2. Send 100 test messages
3. Verify events in Loki
4. Query metrics via MCP tools
5. Validate dashboards

### Phase 2: Staging Deployment
1. Deploy to staging environment
2. Monitor for 24 hours
3. Validate metrics accuracy
4. Check dashboard performance

### Phase 3: Production Rollout
1. Deploy to production
2. Monitor Loki cardinality
3. Validate no performance degradation
4. Enable Grafana dashboards

---

## Acceptance Criteria Summary

### Sprint-Level Acceptance Criteria
- [x] Existing Loki configuration verified and documented
- [ ] ToolObserver module successfully integrates with existing Loki instance
- [ ] ToolObserver module queries Loki via LogQL
- [ ] Tool invocations logged with: toolId, modelId, status, durationMs, correlationId
- [ ] Grafana dashboards created and imported: Tool Invocation, Error Rate, RBAC Denials, Cost
- [ ] tool.get_metrics MCP tool returns accurate metrics
- [ ] Correlation tracing works (tool.trace_request by correlationId)
- [ ] Tool health derived from Loki event stream
- [ ] Integration test: 100 messages → 100+ events in Loki
- [ ] Dashboard smoke test: All 4 Grafana dashboards render
- [ ] No disruption to existing Loki/Promtail infrastructure

---

## Documentation

### New Documentation
- `documentation/reference/loki-configuration.md` - Existing Loki config
- `documentation/guides/tool-observability.md` - Using tool metrics
- `documentation/reference/tool-invocation-event-schema.md` - Event schema reference

### Updated Documentation
- `planning/sprint-56-rqadsk/implementation-plan.md` - Progress tracking (Section 3A)

---

## Dependencies

### External Dependencies
- ✅ **Loki** (already deployed)
- ✅ **Promtail** (already deployed)
- ✅ **Grafana** (already deployed)

### Internal Dependencies
- ✅ **tool-orchestrator** (Sprint 57)
- ✅ **ToolRegistry module** (Sprint 57)
- ✅ **ModelRegistry module** (Sprint 57)
- ✅ **ToolGateway module** (Sprint 58)
- ✅ **PostgreSQL** (existing infrastructure)

---

## Timeline

**Total Duration**: 1.5-2 weeks (reduced from 2-3 weeks due to existing Loki infrastructure)

| Task | Duration | Dependencies | Status |
|------|----------|--------------|--------|
| Task 1: Verify Loki Config | 0.5 days | None | Pending |
| Task 2: ToolObserver Module | 4 days | Task 1 | Pending |
| Task 3: Event Logging | 3 days | Task 1 | Pending |
| Task 4: MCP Tools | 2 days | Task 2, Task 3 | Pending |
| Task 5: Grafana Dashboards | 3 days | Task 3 | Pending |
| Task 6: Health Tracking | 2 days | Task 2, Task 3 | Pending |

**Critical Path**: Task 1 → Task 2 → Task 4 → Integration Testing

---

## References

- [Sprint 56 Implementation Plan](../../sprint-56-rqadsk/implementation-plan.md)
- [Sprint 55 Technical Architecture](../../sprint-55-h17jpp/technical-architecture.md)
- [Tool Invocation Event Schema](../../sprint-56-rqadsk/implementation-plan.md#section-3a-event-schema---tool-invocation-logging)
