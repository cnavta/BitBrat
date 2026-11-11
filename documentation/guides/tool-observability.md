# Tool Observability Guide
## ToolObserver + Loki Integration

**Sprint 59**: Observability into tool invocations via Loki event stream

**Purpose**: Query tool and model metrics, trace requests, and monitor health status via MCP tools backed by Loki log aggregation.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [MCP Tools](#mcp-tools)
4. [Health Tracking](#health-tracking)
5. [Configuration](#configuration)
6. [Grafana Dashboards](#grafana-dashboards)
7. [Troubleshooting](#troubleshooting)

---

## Overview

The Tool Observability system provides real-time and historical visibility into tool invocations across the BitBrat platform. All tool executions are logged as structured JSON events to Loki, enabling:

- **Metrics Queries**: Invocation counts, error rates, latency percentiles
- **Correlation Tracing**: Track multi-tool compositions by correlationId
- **Health Monitoring**: Automated health status derivation from error rates
- **Cost Tracking**: Estimated costs by model and tool
- **RBAC Auditing**: Denial reasons and access patterns

### Key Features

- **Fail-Open Design**: All queries degrade gracefully if Loki is unavailable
- **Platform-Only Exposure**: MCP tools available only to platform services (not domain models)
- **Background Health Updates**: Automated health status updates every 5 minutes
- **Grafana Integration**: Pre-built dashboards for visualization

---

## Architecture

```
┌─────────────────┐
│  tool-gateway   │ (or any tool execution context)
│  ToolGateway    │
└────────┬────────┘
         │ Invokes tool
         ▼
┌─────────────────┐
│ tool-orchestr...│
│  ToolGateway    │───► Log tool.invocation event (JSON)
└────────┬────────┘         │
         │                  │
         │                  ▼
         │           ┌──────────────┐
         │           │   Promtail   │ (scrapes logs)
         │           └──────┬───────┘
         │                  │
         │                  ▼
         │           ┌──────────────┐
         │           │     Loki     │ (stores events)
         │           └──────┬───────┘
         │                  │
         │                  │ Query via LogQL
         │                  ▼
         │           ┌──────────────┐
         │           │ ToolObserver │ (in tool-orchestrator)
         │           └──────┬───────┘
         │                  │
         │                  ▼
         │           ┌──────────────┐
         │           │HealthUpdater │ (background job)
         │           └──────┬───────┘
         │                  │
         │                  ▼ Update health status
         │           ┌──────────────┐
         └──────────►│ ToolRegistry │
                     └──────────────┘
```

### Event Flow

1. **Tool Execution**: ToolGateway executes tool and logs invocation event
2. **Event Logging**: Structured JSON logged to console with Loki labels
3. **Log Scraping**: Promtail scrapes logs and sends to Loki
4. **Indexing**: Loki indexes by labels (service, eventType, toolId, modelId, status, correlationId, level)
5. **Metrics Queries**: ToolObserver queries Loki via LogQL
6. **Health Updates**: HealthUpdater runs every 5 minutes, updates ToolRegistry

---

## MCP Tools

The tool-orchestrator service exposes **9 MCP tools** for querying tool and model metrics:

### 1. `tool.get_metrics`
Query aggregated metrics for a specific tool.

**Parameters**:
```typescript
{
  toolId: string,           // Tool identifier (e.g., "get_weather")
  timeRange: {
    start: string,          // ISO 8601 timestamp (e.g., "2026-11-10T00:00:00Z")
    end: string             // ISO 8601 timestamp (e.g., "2026-11-10T23:59:59Z")
  }
}
```

**Returns**:
```typescript
{
  toolId: string,
  toolName: string,
  totalInvocations: number,
  successCount: number,
  errorCount: number,
  deniedCount: number,
  errorRate: number,            // 0.0 - 1.0
  latency: {
    p50: number,                // Median latency (ms)
    p95: number,                // 95th percentile (ms)
    p99: number,                // 99th percentile (ms)
    avg: number,
    min: number,
    max: number
  },
  lastInvocationAt?: string,    // ISO 8601
  lastSuccessAt?: string,       // ISO 8601
  lastErrorAt?: string,         // ISO 8601
  timeRange: { start, end },
  topModels?: [...],            // Top 5 models using this tool
  topErrors?: [...]             // Top 5 error messages
}
```

**Example**:
```bash
tool.get_metrics({
  toolId: "get_weather",
  timeRange: {
    start: "2026-11-10T00:00:00Z",
    end: "2026-11-10T23:59:59Z"
  }
})
```

**Use Cases**:
- Monitor tool performance over time
- Identify high-error tools
- Track latency degradation
- Audit tool usage by model

---

### 2. `model.get_metrics`
Query aggregated metrics for a specific model.

**Parameters**:
```typescript
{
  modelId: string,          // Model identifier (e.g., "gpt-4", "claude-3-opus")
  timeRange: {
    start: string,          // ISO 8601
    end: string
  }
}
```

**Returns**:
```typescript
{
  modelId: string,
  modelName: string,
  totalInvocations: number,
  uniqueToolsUsed: number,
  successCount: number,
  errorCount: number,
  deniedCount: number,
  errorRate: number,
  estimatedCost?: {
    totalUsd: number,
    totalTokens: number
  },
  timeRange: { start, end },
  topTools?: [...],         // Top 5 tools used
  lastInvocationAt?: string
}
```

**Example**:
```bash
model.get_metrics({
  modelId: "gpt-4",
  timeRange: {
    start: "2026-11-10T00:00:00Z",
    end: "2026-11-10T23:59:59Z"
  }
})
```

**Use Cases**:
- Track model usage patterns
- Estimate costs by model
- Identify most frequently used tools
- Monitor model-specific error rates

---

### 3. `tool.trace_request`
Trace all tool invocations for a specific request by correlationId.

**Parameters**:
```typescript
{
  correlationId: string     // Correlation ID from request
}
```

**Returns**:
```typescript
{
  correlationId: string,
  events: [
    {
      timestamp: string,            // ISO 8601
      correlationId: string,
      toolId: string,
      toolName: string,
      modelId: string,
      modelName: string,
      status: "success" | "error" | "denied",
      durationMs: number,
      inputPreview?: string,        // Max 500 chars
      outputPreview?: string,
      errorMessage?: string,
      rbacDecision: {
        allowed: boolean,
        reason?: string,
        userRoles?: string[],
        modelTier?: string
      },
      estimatedCost?: {
        tokens?: number,
        costUsd?: number
      }
    }
  ],
  count: number
}
```

**Example**:
```bash
tool.trace_request({
  correlationId: "abc-123-def"
})
```

**Use Cases**:
- Debug multi-tool compositions
- Trace request lifecycle
- Identify bottlenecks in tool chains
- Audit tool usage for specific requests

---

### 4. `tool.get_health`
Get current health status for a tool based on recent invocations.

**Parameters**:
```typescript
{
  toolId: string,
  windowMs?: number         // Time window in ms (default: 3600000 = 1 hour)
}
```

**Returns**:
```typescript
{
  toolId: string,
  toolName: string,
  status: "healthy" | "degraded" | "unhealthy" | "unknown",
  reason: string,               // Human-readable reason
  errorRate: number,            // 0.0 - 1.0
  recentInvocations: number,
  lastInvocationAt?: string,
  lastSuccessAt?: string,
  lastErrorAt?: string,
  avgLatency: number,           // ms
  windowMs: number,
  checkedAt: string             // ISO 8601
}
```

**Health Status Logic**:
- **healthy**: Recent invocations (< 1 hour), error rate < 5%
- **degraded**: Recent invocations, error rate 5-20%
- **unhealthy**: No recent invocations (> 1 hour) OR error rate > 20%
- **unknown**: Insufficient data

**Example**:
```bash
tool.get_health({
  toolId: "get_weather",
  windowMs: 3600000  # Last 1 hour
})
```

**Use Cases**:
- Monitor tool health in real-time
- Detect degraded tools before failures
- Automated alerting on unhealthy tools
- Health checks for critical tools

---

### 5. `tool.refresh_health`
Manually trigger health status update for all registered tools.

**Parameters**: None (`{}`)

**Returns**:
```typescript
{
  success: true,
  message: "Health status updated for all tools"
}
```

**Example**:
```bash
tool.refresh_health({})
```

**Use Cases**:
- Force immediate health update after deployment
- Verify health tracking is working
- Manual health refresh on demand

---

## Health Tracking

The Health Tracking system automatically monitors tool health based on Loki event metrics.

### Background Job

**HealthUpdater** runs as a background job in tool-orchestrator:

- **Interval**: Every 5 minutes (default, configurable via `HEALTH_UPDATE_INTERVAL_MS`)
- **Query Window**: Last 1 hour (default, configurable via `HEALTH_STALE_THRESHOLD_MS`)
- **Process**:
  1. Query all registered tools from ToolRegistry
  2. For each tool, query ToolObserver for metrics (last 1 hour)
  3. Derive health status from error rate and invocation timestamps
  4. Update ToolRegistry with new health status and timestamps

### Health Status Derivation

```typescript
function deriveHealthStatus(metrics, nowMs): HealthStatus {
  // No recent invocations → unhealthy
  if (metrics.totalInvocations === 0 ||
      timeSinceLastInvocation > HEALTH_STALE_THRESHOLD_MS) {
    return { status: 'unhealthy', lastError: 'No recent invocations' };
  }

  // Error rate > 20% → unhealthy
  if (metrics.errorRate > 0.20) {
    return { status: 'unhealthy', lastError: `High error rate: ${errorRate * 100}%` };
  }

  // Error rate 5-20% → degraded
  if (metrics.errorRate > 0.05) {
    return { status: 'degraded', lastError: `Elevated error rate: ${errorRate * 100}%` };
  }

  // Recent invocations, error rate < 5% → healthy
  return { status: 'healthy' };
}
```

### ToolRegistry Health Fields

Each tool in ToolRegistry stores:

```typescript
{
  health: {
    status: "healthy" | "degraded" | "unhealthy",
    lastError?: string,
    lastErrorAt?: Date,
    lastInvocationAt?: Date,
    lastSuccessAt?: Date,
    consecutiveFailures?: number
  },
  lastHealthCheckAt?: Date
}
```

### Monitoring Health Updates

Check HealthUpdater logs:

```bash
fleet.logs({ bit: "tool-orchestrator", context: "staging", limit: 50 })
```

Look for:
- `health_updater.started` - Background job started
- `health_updater.update_complete` - Health update cycle completed
- `health_updater.tool_updated` - Individual tool health updated

---

## Configuration

### Environment Variables

Configure Loki connection and health tracking via environment variables:

#### Loki Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `LOKI_URL` | Loki API endpoint | `http://localhost:3100` | Yes |
| `LOKI_TIMEOUT_MS` | Query timeout in milliseconds | `10000` | No |
| `HEALTHY_ERROR_THRESHOLD` | Error rate threshold for healthy status | `0.05` (5%) | No |
| `DEGRADED_ERROR_THRESHOLD` | Error rate threshold for degraded status | `0.20` (20%) | No |

#### Health Tracking Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `HEALTH_UPDATE_INTERVAL_MS` | How often to update health status | `300000` (5 min) | No |
| `HEALTH_STALE_THRESHOLD_MS` | How long ago last invocation can be before marking unhealthy | `3600000` (1 hour) | No |

### Configuration Files

**Local environment** (`env/local/infra.yaml`):
```yaml
LOKI_URL: http://bitbrat.lan:3100
LOKI_TIMEOUT_MS: 10000
HEALTHY_ERROR_THRESHOLD: 0.05
DEGRADED_ERROR_THRESHOLD: 0.20
HEALTH_UPDATE_INTERVAL_MS: 300000
HEALTH_STALE_THRESHOLD_MS: 3600000
```

**Staging environment** (`env/staging/infra.yaml`):
```yaml
LOKI_URL: http://bitbrat.lan:3100
LOKI_TIMEOUT_MS: 10000
HEALTHY_ERROR_THRESHOLD: 0.05
DEGRADED_ERROR_THRESHOLD: 0.20
HEALTH_UPDATE_INTERVAL_MS: 300000
HEALTH_STALE_THRESHOLD_MS: 3600000
```

### Adjusting Configuration

**More frequent health updates** (every 1 minute):
```yaml
HEALTH_UPDATE_INTERVAL_MS: 60000
```

**Stricter health thresholds**:
```yaml
HEALTHY_ERROR_THRESHOLD: 0.01   # 1% (was 5%)
DEGRADED_ERROR_THRESHOLD: 0.05  # 5% (was 20%)
```

**Longer stale threshold** (4 hours):
```yaml
HEALTH_STALE_THRESHOLD_MS: 14400000
```

---

## Grafana Dashboards

Four pre-built Grafana dashboards provide visualization for tool observability metrics.

### Installation

See [Grafana README](../../infrastructure/docker-compose/observability/grafana/README.md) for detailed installation instructions.

**Quick Start** (Grafana UI Import):
1. Log in to Grafana: `http://bitbrat.lan:3000`
2. Navigate to **Dashboards** → **Import**
3. Click **Upload JSON file**
4. Select dashboard from `infrastructure/docker-compose/observability/grafana/dashboards/`
5. Configure data source: `Loki`
6. Click **Import**

### Dashboard 1: Tool Invocation Rate

**File**: `tool-invocation-rate.json`

**Panels**:
- Tool Invocation Rate (by Tool) - Line graph
- Tool Invocation Rate (by Model) - Line graph
- Total Invocations - Gauge
- Tool Usage Distribution - Pie chart

**Use Cases**:
- Monitor tool usage trends
- Identify most popular tools
- Track adoption of new tools
- Compare model usage patterns

---

### Dashboard 2: Error Rate & Latency

**File**: `error-rate-latency.json`

**Panels**:
- Error Rate by Tool - Line graph (5% yellow, 20% red thresholds)
- Tool Latency (P50 and P95) - Dual-axis latency
- Invocations by Status - Stacked bar chart (success vs error)

**Use Cases**:
- Detect unhealthy tools
- Monitor latency degradation
- Correlate errors with deployments
- Track performance regressions

---

### Dashboard 3: RBAC Denials

**File**: `rbac-denials.json`

**Panels**:
- Total RBAC Denials - Gauge
- Denial Rate - Percentage
- RBAC Denials Over Time - Line graph
- Top 10 Denied Tools - Bar chart
- Denials by Model - Bar chart
- Denial Reasons (Detailed) - Table

**Use Cases**:
- Detect misconfigured RBAC policies
- Identify tools requiring tier upgrades
- Monitor security posture
- Debug access control issues

---

### Dashboard 4: Cost Tracking

**File**: `cost-tracking.json`

**Panels**:
- Total Estimated Cost - Gauge
- Total Tokens Used - Gauge
- Estimated Cost Over Time - Stacked area chart
- Cost Distribution by Model - Donut chart
- Top 15 Most Expensive Tools - Bar chart
- Cost Summary by Model - Table (with avg cost per invocation)

**Use Cases**:
- Track spending trends
- Identify cost-heavy tools
- Budget forecasting
- Optimize model selection

**Note**: Costs are estimated based on token counts and ModelRegistry pricing. Actual costs may vary.

---

## Troubleshooting

### No Data in Grafana Dashboards

**Symptom**: Dashboards show "No data"

**Causes & Fixes**:

1. **tool-orchestrator not in live path**:
   - **Check**: Are tool invocations routed through tool-orchestrator?
   - **Fix**: Integrate tool-orchestrator into event routing

2. **Loki not receiving events**:
   - **Check**: `curl http://bitbrat.lan:3100/ready` (should return "ready")
   - **Check**: `curl http://bitbrat.lan:3100/loki/api/v1/labels` (should include `eventType`)
   - **Fix**: Verify Promtail is scraping tool-orchestrator logs

3. **Time range too narrow**:
   - **Check**: Dashboard time range (top-right corner)
   - **Fix**: Expand time range to "Last 6 hours" or "Last 24 hours"

4. **Labels not indexed**:
   - **Check**: `curl http://bitbrat.lan:3100/loki/api/v1/labels | jq '.data'`
   - **Expected**: `eventType`, `toolId`, `modelId`, `status`
   - **Fix**: Wait 30 seconds after first event, labels auto-index on first match

---

### MCP Tools Return Empty Results

**Symptom**: `tool.get_metrics` returns `totalInvocations: 0`

**Causes & Fixes**:

1. **No events in Loki**:
   - **Check**: Query Loki directly:
     ```bash
     curl -G http://bitbrat.lan:3100/loki/api/v1/query \
       --data-urlencode 'query={service="tool-orchestrator", eventType="tool.invocation"}' \
       | jq '.data.result | length'
     ```
   - **Expected**: > 0
   - **Fix**: Ensure tool invocations are being logged

2. **Time range too narrow**:
   - **Check**: Query time range in MCP tool call
   - **Fix**: Expand time range to last 24 hours

3. **Loki unavailable** (fail-open behavior):
   - **Check**: `curl http://bitbrat.lan:3100/ready`
   - **Fix**: Restart Loki or check Loki logs

---

### Health Status Not Updating

**Symptom**: Tool health always shows 'healthy' or timestamps are stale

**Causes & Fixes**:

1. **HealthUpdater not running**:
   - **Check**: `fleet.logs({ bit: "tool-orchestrator", limit: 50 })`
   - **Expected**: `health_updater.started`, `health_updater.update_complete`
   - **Fix**: Restart tool-orchestrator

2. **No metrics to derive from**:
   - **Check**: Query tool metrics manually:
     ```bash
     tool.get_metrics({
       toolId: "get_weather",
       timeRange: { start: "2026-11-09T00:00:00Z", end: "2026-11-10T23:59:59Z" }
     })
     ```
   - **Expected**: `totalInvocations > 0`
   - **Fix**: Ensure tool invocations are being logged

3. **Background job interval too long**:
   - **Check**: `HEALTH_UPDATE_INTERVAL_MS` environment variable
   - **Fix**: Reduce interval (e.g., 60000 for 1 minute)

---

### High Loki Query Latency

**Symptom**: Dashboard queries timeout or take >10 seconds

**Causes & Fixes**:

1. **Time range too wide**:
   - **Fix**: Reduce dashboard time range to "Last 1 hour" or "Last 6 hours"

2. **Label cardinality explosion**:
   - **Check**: `curl http://bitbrat.lan:3100/metrics | grep loki_cardinality`
   - **Expected**: < 1M label combinations
   - **Fix**: Reduce label cardinality (remove correlationId from labels)

3. **Loki resource limits**:
   - **Check**: Loki CPU/memory usage
   - **Fix**: Increase Loki resources or optimize queries

---

### Logging Pattern Errors

**Symptom**: TypeScript compilation errors for logging

**Fix**: Use correct logging pattern (object first, message second):

```typescript
// ✅ Correct
this.logger.error({
  error: err.message,
  toolId: 'get_weather'
}, 'tool_invocation_failed');

// ❌ Incorrect
this.logger.error('tool_invocation_failed', {
  error: err.message
});
```

---

## Related Documentation

- [Grafana Dashboards README](../../infrastructure/docker-compose/observability/grafana/README.md)
- [Execution Plan](../../planning/sprint-59-ig0sr1/execution-plan.md)
- [Validation Checklist](../../planning/sprint-59-ig0sr1/validation-checklist.md)
- [Loki LogQL Documentation](https://grafana.com/docs/loki/latest/logql/)
- [Grafana Dashboard Documentation](https://grafana.com/docs/grafana/latest/dashboards/)

---

## Support

For issues or questions:
1. Check [Validation Checklist](../../planning/sprint-59-ig0sr1/validation-checklist.md) for common issues
2. Review sprint planning docs in `planning/sprint-59-ig0sr1/`
3. Check tool-orchestrator logs: `fleet.logs({ bit: "tool-orchestrator" })`
4. Check Loki health: `curl http://bitbrat.lan:3100/ready`
