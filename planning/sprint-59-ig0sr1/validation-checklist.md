# Sprint 59: Validation Checklist
## ToolObserver + Loki Integration

**Sprint Goal**: Observability into tool invocations via Loki event stream

**Status**: ⚠️ Awaiting tool-orchestrator integration into live event path

---

## Pre-Integration Validation (Completed ✅)

These checks can be performed before tool-orchestrator is in the live path:

### 1. Build & Tests
- ✅ TypeScript compilation successful
- ✅ All 4649 tests passing (445 test suites)
- ✅ No new test failures introduced

### 2. Module Integration
- ✅ ToolObserver module initialized in tool-orchestrator
- ✅ HealthUpdater module initialized and started
- ✅ ToolRegistry updateHealth() accepts new timestamp fields
- ✅ 9 MCP tools registered (4 existing + 4 observability + 1 health refresh)

### 3. Configuration
- ✅ Loki configuration in architecture.yaml
- ✅ Health tracking configuration in architecture.yaml
- ✅ Default values in env/local/infra.yaml
- ✅ Default values in env/staging/infra.yaml
- ✅ Environment variables loaded correctly

### 4. Grafana Dashboards
- ✅ 4 dashboard JSON files created
- ✅ README with installation instructions
- ✅ LogQL queries syntactically valid
- ✅ Dashboard schema v38 (Grafana 10.x compatible)

### 5. Fail-Open Design
- ✅ ToolObserver returns empty metrics on Loki unavailability
- ✅ HealthUpdater continues on individual tool failures
- ✅ No exceptions thrown on missing data

---

## Post-Integration Validation (Pending ⏳)

These checks require tool-orchestrator to be integrated into the live event path:

### 6. Event Logging
- ⏳ Tool invocations logged to console with correct JSON structure
- ⏳ All required labels present (service, eventType, toolId, modelId, status, correlationId, level)
- ⏳ Promtail scrapes tool-orchestrator logs
- ⏳ Events appear in Loki within 30 seconds
- ⏳ New labels indexed in Loki (`eventType`, `toolId`, `modelId`, `status`)

**Validation script**:
```bash
# 1. Check Loki for tool invocation events
curl -G http://bitbrat.lan:3100/loki/api/v1/query \
  --data-urlencode 'query={service="tool-orchestrator", eventType="tool.invocation"}' \
  | jq '.data.result[0].values[0]'

# 2. Verify label cardinality
curl http://bitbrat.lan:3100/loki/api/v1/labels | jq '.data'

# Expected labels: eventType, toolId, modelId, status
```

### 7. ToolObserver Metrics Queries
- ⏳ `tool.get_metrics` returns accurate invocation counts
- ⏳ Error rates match actual failures
- ⏳ Latency percentiles (P50, P95, P99) calculated correctly
- ⏳ `lastInvocationAt`, `lastSuccessAt`, `lastErrorAt` timestamps accurate

**Test MCP tool**:
```bash
# Query metrics for a specific tool (last hour)
tool.get_metrics({
  toolId: "get_weather",
  timeRange: {
    start: "2026-11-10T00:00:00Z",
    end: "2026-11-10T01:00:00Z"
  }
})
```

### 8. Model Metrics Queries
- ⏳ `model.get_metrics` returns accurate invocation counts by model
- ⏳ Unique tools used count correct
- ⏳ Estimated cost calculations accurate (based on token counts)
- ⏳ Top tools by invocation count correct

**Test MCP tool**:
```bash
# Query metrics for a specific model (last hour)
model.get_metrics({
  modelId: "gpt-4",
  timeRange: {
    start: "2026-11-10T00:00:00Z",
    end: "2026-11-10T01:00:00Z"
  }
})
```

### 9. Correlation Tracing
- ⏳ `tool.trace_request` returns chronological list of all tool invocations
- ⏳ Events sorted by timestamp (oldest first)
- ⏳ Correlation ID correctly links multi-tool compositions

**Test MCP tool**:
```bash
# Trace a request by correlationId
tool.trace_request({
  correlationId: "abc-123-def"
})
```

### 10. Health Status Derivation
- ⏳ `tool.get_health` returns correct status based on recent metrics
- ⏳ Healthy tools show status='healthy', error rate < 5%
- ⏳ Degraded tools show status='degraded', error rate 5-20%
- ⏳ Unhealthy tools show status='unhealthy', error rate > 20% or no invocations >1hr

**Test MCP tool**:
```bash
# Check health for a specific tool
tool.get_health({
  toolId: "get_weather",
  windowMs: 3600000  # Last 1 hour
})
```

### 11. Health Tracking Background Job
- ⏳ HealthUpdater runs every 5 minutes (default)
- ⏳ All registered tools have health status updated
- ⏳ Tool timestamps (lastInvocationAt, lastSuccessAt, lastErrorAt) updated in ToolRegistry
- ⏳ Manual refresh via `tool.refresh_health` works

**Validation**:
```bash
# 1. Verify background job is running
fleet.logs({ bit: "tool-orchestrator", context: "staging", limit: 20 })
# Look for: "health_updater.started", "health_updater.update_complete"

# 2. Manual refresh test
tool.refresh_health({})
# Should return: { success: true, message: "Health status updated for all tools" }

# 3. Check tool health in registry
tool.get({ toolId: "get_weather" })
# Verify health.lastInvocationAt, health.lastSuccessAt, health.status are populated
```

### 12. Grafana Dashboard Rendering
- ⏳ Dashboard 1: Tool Invocation Rate shows data
- ⏳ Dashboard 2: Error Rate & Latency shows error rates and latency percentiles
- ⏳ Dashboard 3: RBAC Denials shows denial counts and reasons
- ⏳ Dashboard 4: Cost Tracking shows estimated costs by model
- ⏳ All panels render without errors
- ⏳ Auto-refresh (30s) works correctly
- ⏳ Time range selector changes query results

**Manual validation**:
1. Import dashboards to Grafana (http://bitbrat.lan:3000)
2. Verify all 4 dashboards render
3. Check that panels show data (not "No data")
4. Test time range selector (Last 1h, Last 6h, Last 24h)
5. Test auto-refresh toggle

### 13. Loki Infrastructure Stability
- ⏳ No increase in Loki CPU/memory usage
- ⏳ Query latency < 5 seconds for all dashboards
- ⏳ Label cardinality within limits (< 1M combinations)
- ⏳ No Loki errors in logs

**Check Loki health**:
```bash
# Loki readiness
curl http://bitbrat.lan:3100/ready

# Loki metrics (label cardinality)
curl http://bitbrat.lan:3100/metrics | grep loki_cardinality

# Expected: < 1M label combinations
```

---

## Known Limitations

### Before Integration
- ❌ No real tool invocation events (tool-orchestrator not in live path)
- ❌ Labels not indexed in Loki (`eventType`, `toolId`, `modelId`, `status`)
- ❌ MCP tools return empty/degraded results (fail-open behavior)
- ❌ Dashboards show "No data"
- ❌ Health status defaults to 'healthy' (no metrics to derive from)

### After Integration
- ⚠️ Cost estimates are approximate (based on token counts and ModelRegistry pricing)
- ⚠️ RBAC denial reasons may be truncated if too long
- ⚠️ High-cardinality labels (correlationId) may impact Loki performance at scale

---

## Integration Steps

When tool-orchestrator is ready to be integrated into the live event path:

1. **Route tool invocations through tool-orchestrator**:
   - Update event-router to send tool-related events to tool-orchestrator
   - OR: Update llm-bot to delegate tool execution to tool-orchestrator

2. **Deploy to staging**:
   ```bash
   brat bit deploy tool-orchestrator --context staging
   ```

3. **Send test messages** (10-20 messages with tool usage):
   ```bash
   message.send({
     text: "What's the weather in San Francisco?",
     context: "staging",
     waitForResponse: true
   })
   ```

4. **Validate events in Loki** (30 seconds after messages):
   ```bash
   # Check for events
   curl -G http://bitbrat.lan:3100/loki/api/v1/query \
     --data-urlencode 'query={service="tool-orchestrator", eventType="tool.invocation"}' \
     | jq '.data.result | length'

   # Expected: > 0 (at least one event per tool invocation)
   ```

5. **Test MCP tools**:
   ```bash
   # Test metrics query
   tool.get_metrics({
     toolId: "get_weather",
     timeRange: {
       start: "2026-11-10T00:00:00Z",
       end: "2026-11-10T23:59:59Z"
     }
   })

   # Test health status
   tool.get_health({ toolId: "get_weather" })
   ```

6. **Import Grafana dashboards**:
   ```bash
   # Option 1: UI import (recommended)
   # Log in to Grafana → Dashboards → Import → Upload JSON file

   # Option 2: API import
   for dashboard in infrastructure/docker-compose/observability/grafana/dashboards/*.json; do
     curl -X POST \
       -H "Content-Type: application/json" \
       -H "Authorization: Bearer YOUR_API_KEY" \
       -d @"$dashboard" \
       http://bitbrat.lan:3000/api/dashboards/db
   done
   ```

7. **Verify dashboards render**:
   - Dashboard 1: Tool Invocation Rate → Should show invocation trends
   - Dashboard 2: Error Rate & Latency → Should show error rates and latencies
   - Dashboard 3: RBAC Denials → May show 0 if no denials
   - Dashboard 4: Cost Tracking → Should show estimated costs

8. **Monitor for 1 hour**:
   - Check HealthUpdater logs every 5 minutes
   - Verify tool health status updates in ToolRegistry
   - Ensure no Loki errors or performance degradation

---

## Rollback Plan

If issues are detected during integration:

1. **Stop tool-orchestrator**:
   ```bash
   fleet.stop({ bit: "tool-orchestrator", context: "staging" })
   ```

2. **Revert event routing**:
   - Remove tool-orchestrator from event-router configuration
   - OR: Revert llm-bot to direct tool execution

3. **Redeploy previous version**:
   ```bash
   brat bit deploy tool-orchestrator --context staging --tag <previous-version>
   ```

4. **Verify system restored**:
   - Check tool execution still works via llm-bot
   - Verify no tool invocation failures
   - Check Loki is stable

---

## Success Criteria

Integration is successful when:

- ✅ All tool invocations logged to Loki (100% coverage)
- ✅ MCP tools return accurate metrics (verified manually)
- ✅ Grafana dashboards render correctly (all 4 dashboards)
- ✅ Health tracking background job runs without errors
- ✅ Tool health status updated every 5 minutes
- ✅ No Loki performance degradation (< 5s query latency)
- ✅ No increase in tool invocation failures (< 1% error rate delta)

---

## Next Steps

1. **Wait for tool-orchestrator integration** into live event path
2. **Run post-integration validation** (steps 6-13 above)
3. **Deploy to production** if staging validation passes
4. **Monitor for 24 hours** before marking sprint complete

---

**Last Updated**: 2026-11-10
**Status**: Awaiting integration (Tasks 1-6 complete, Task 7 partially complete)
