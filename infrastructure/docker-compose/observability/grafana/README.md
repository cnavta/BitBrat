# Grafana Dashboards - Tool Orchestrator Observability

**Sprint 59**: ToolObserver + Loki Integration

This directory contains 4 Grafana dashboards for monitoring tool-orchestrator service metrics via Loki.

## Dashboards

### 1. Tool Invocation Rate (`tool-invocation-rate.json`)
**Purpose**: Monitor tool usage patterns and invocation frequency

**Panels**:
- Tool Invocation Rate (by Tool) - Line graph showing invocations/min per toolId
- Tool Invocation Rate (by Model) - Line graph showing invocations/min per modelId
- Total Invocations (Current Range) - Gauge showing total count
- Tool Usage Distribution - Pie chart showing relative usage by tool

**Use Cases**:
- Identify most frequently used tools
- Detect usage spikes or anomalies
- Track adoption of new tools
- Compare model usage patterns

---

### 2. Error Rate & Latency (`error-rate-latency.json`)
**Purpose**: Monitor tool health and performance

**Panels**:
- Error Rate by Tool - Line graph with 5% (yellow) and 20% (red) thresholds
- Tool Latency (P50 and P95) - Dual-axis latency percentiles
- Invocations by Status - Stacked bar chart (success vs error)

**Use Cases**:
- Identify unhealthy tools (error rate > 5%)
- Monitor latency degradation
- Detect performance regressions
- Correlate errors with deployments

**Thresholds**:
- **Healthy**: Error rate < 5% (green)
- **Degraded**: Error rate 5-20% (yellow)
- **Unhealthy**: Error rate > 20% (red)

---

### 3. RBAC Denials (`rbac-denials.json`)
**Purpose**: Monitor access control and security

**Panels**:
- Total RBAC Denials - Gauge showing denial count
- Denial Rate - Percentage of denied invocations
- RBAC Denials Over Time - Line graph of denial rate
- Top 10 Denied Tools - Horizontal bar chart
- Denials by Model - Bar chart showing which models are denied
- Denial Reasons (Detailed) - Table showing specific denial reasons

**Use Cases**:
- Detect misconfigured RBAC policies
- Identify tools requiring tier upgrades
- Monitor security posture
- Debug access control issues

---

### 4. Cost Tracking (`cost-tracking.json`)
**Purpose**: Monitor estimated costs and token usage

**Panels**:
- Total Estimated Cost - Gauge showing current range cost
- Total Tokens Used - Gauge showing token count
- Estimated Cost Over Time - Stacked area chart by model
- Cost Distribution by Model - Donut chart
- Top 15 Most Expensive Tools - Horizontal bar chart
- Cost Summary by Model - Table with cost/token/invocation details

**Use Cases**:
- Track spending trends
- Identify cost-heavy tools
- Budget forecasting
- Optimize model selection

**Note**: Costs are estimated based on token counts and model pricing from ModelRegistry. Actual costs may vary.

---

## Installation

### Option 1: Grafana UI Import
1. Log in to Grafana (http://bitbrat.lan:3000)
2. Navigate to **Dashboards** > **Import**
3. Click **Upload JSON file**
4. Select one of the dashboard JSON files
5. Configure data source (select Loki)
6. Click **Import**

### Option 2: Provisioning (Auto-Import)
If Grafana is configured with dashboard provisioning:

1. Copy dashboard JSON files to Grafana provisioning directory:
   ```bash
   cp dashboards/*.json /path/to/grafana/provisioning/dashboards/
   ```

2. Restart Grafana to auto-import:
   ```bash
   docker-compose restart grafana
   ```

### Option 3: API Import
```bash
# For each dashboard
for dashboard in dashboards/*.json; do
  curl -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer YOUR_API_KEY" \
    -d @"$dashboard" \
    http://bitbrat.lan:3000/api/dashboards/db
done
```

---

## Configuration

### Data Source
All dashboards use the Loki data source with variable `${DS_LOKI}`.

**Setup**:
1. Ensure Loki data source is configured in Grafana
2. Data source name: `Loki` (or update dashboard JSON)
3. URL: `http://loki:3100` (or `http://bitbrat.lan:3100`)

### Refresh Rate
Default: **30 seconds**

To change:
1. Open dashboard
2. Click settings (gear icon)
3. Update **Auto refresh** setting

### Time Range
Default: **Last 6 hours**

Common ranges:
- Last 1 hour - Real-time monitoring
- Last 6 hours - Active debugging
- Last 24 hours - Daily patterns
- Last 7 days - Weekly trends

---

## LogQL Queries

### Sample Queries Used

**Tool invocations**:
```logql
{service="tool-orchestrator", eventType="tool.invocation"}
```

**Error rate by tool**:
```logql
sum by(toolId) (rate({service="tool-orchestrator", eventType="tool.invocation", status="error"} [5m]))
  /
sum by(toolId) (rate({service="tool-orchestrator", eventType="tool.invocation"} [5m]))
```

**P95 latency**:
```logql
quantile_over_time(0.95,
  {service="tool-orchestrator", eventType="tool.invocation"}
  | json
  | unwrap durationMs [5m]
) by (toolId)
```

**Cost by model**:
```logql
sum by(modelId) (
  sum_over_time({service="tool-orchestrator", eventType="tool.invocation"}
    | json
    | unwrap estimatedCost_costUsd [6h]
  )
)
```

---

## Labels

Dashboards rely on these Loki labels (indexed by Promtail):

| Label | Description | Cardinality |
|-------|-------------|-------------|
| `service` | Always "tool-orchestrator" | 1 |
| `eventType` | Always "tool.invocation" | 1 |
| `toolId` | Tool identifier | ~50-200 |
| `modelId` | Model identifier | ~10-20 |
| `status` | "success", "error", "denied" | 3 |
| `correlationId` | Request correlation ID | HIGH |
| `level` | Log level ("info" or "error") | 2 |

**Total label combinations**: ~900K with 7-day retention (within Loki limits)

---

## Troubleshooting

### No Data Showing
1. **Check tool-orchestrator is in live path**: Verify events are being logged
2. **Verify Loki connectivity**: `curl http://bitbrat.lan:3100/ready`
3. **Check labels exist**: Query `/loki/api/v1/labels` for `eventType`, `toolId`, etc.
4. **Verify time range**: Ensure dashboard time range includes recent events
5. **Check Promtail**: Verify Promtail is scraping tool-orchestrator logs

### Queries Timing Out
1. **Reduce time range**: Use shorter intervals (e.g., 1h instead of 7d)
2. **Increase Loki timeout**: Update Loki config `query_timeout`
3. **Use aggregated queries**: Avoid high-cardinality grouping

### Labels Not Indexed
Labels appear after first matching event is logged. To trigger:
1. Ensure tool-orchestrator is integrated into event flow
2. Invoke a tool to generate an event
3. Wait 10-30 seconds for Promtail to scrape
4. Check `/loki/api/v1/labels` API

### Dashboard Import Fails
1. **Check Grafana version**: Dashboards use schema v38 (Grafana 10.x)
2. **Verify data source**: Ensure Loki data source exists
3. **Check JSON syntax**: Validate JSON is well-formed
4. **Manual edit**: Remove `"id": null` from JSON if import fails

---

## Maintenance

### Dashboard Updates
To update an existing dashboard:
1. Export updated JSON from Grafana UI
2. Replace file in `dashboards/` directory
3. Commit to version control
4. Re-import or wait for provisioning

### Adding New Panels
1. Edit dashboard in Grafana UI
2. Add new panel with LogQL query
3. Export dashboard JSON
4. Update file in repository

### Version Control
All dashboards are version controlled. Changes should:
1. Be tested in staging Grafana first
2. Include description in commit message
3. Update this README if adding new dashboards

---

## Related Documentation

- [Loki Configuration](../loki-config.yaml)
- [Promtail Configuration](../promtail-config.yaml)
- [ToolObserver Module](../../../../src/apps/tool-orchestrator-service/modules/observer/)
- [Tool Invocation Event Schema](../../../../src/apps/tool-orchestrator-service/types/tool-invocation-event.ts)
- [Sprint 59 Execution Plan](../../../../planning/sprint-59-ig0sr1/execution-plan.md)

---

## Support

For issues or questions:
1. Check [Grafana Documentation](https://grafana.com/docs/grafana/latest/)
2. Check [Loki LogQL Documentation](https://grafana.com/docs/loki/latest/logql/)
3. Review sprint planning docs in `planning/sprint-59-ig0sr1/`
4. Check tool-orchestrator logs: `docker logs tool-orchestrator`
