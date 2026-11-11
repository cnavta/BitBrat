# Loki Configuration Reference

**Last Updated**: 2026-11-10
**Sprint**: 59 (sprint-59-ig0sr1)
**Status**: Active

## Overview

BitBrat uses **Grafana Loki** as its centralized log aggregation and observability backend. Loki provides label-based indexing for sub-100ms distributed trace queries, unlimited log retention (within configured limits), and correlation ID-based event retrieval.

**Key Features:**
- Label-based indexing (not full-text search)
- 7-day retention (local/staging), 30-day retention (production)
- <100ms correlation ID trace queries vs 2-5s with Docker logs
- ~70MB RAM footprint (Loki: 50MB, Promtail: 20MB)
- ~100MB disk per day with default retention

## Deployment Architecture

### Local Development

**Loki Instance:**
- **Endpoint**: `http://localhost:3100` (external) or `http://loki.bitbrat.local:3100` (Docker network)
- **HTTP Port**: 3100
- **gRPC Port**: 9096
- **Image**: `grafana/loki:2.9.3`
- **Memory**: 64MB reserved, 128MB limit
- **Storage**: Docker volume `loki-data` → `/loki` (boltdb-shipper + filesystem)

**Promtail Instance:**
- **Endpoint**: `http://localhost:9080`
- **Image**: `grafana/promtail:2.9.3`
- **Memory**: 32MB reserved, 64MB limit
- **Loki Push URL**: `http://loki.bitbrat.local:3100/loki/api/v1/push`
- **Scrape Target**: Docker containers with `com.docker.compose.project` label matching `.*bitbrat.*`

**Docker Compose:**
```yaml
services:
  loki:
    image: grafana/loki:2.9.3
    ports:
      - "3100:3100"  # HTTP API
      - "9096:9096"  # gRPC
    volumes:
      - ./loki-config.yaml:/etc/loki/local-config.yaml:ro
      - loki-data:/loki

  promtail:
    image: grafana/promtail:2.9.3
    volumes:
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
    depends_on:
      loki:
        condition: service_healthy
```

**Activation:**
```bash
# Start Loki + Promtail with BitBrat stack
docker compose -f docker-compose.yaml \
  -f infrastructure/docker-compose/observability/docker-compose.observability.yaml \
  up -d
```

### Staging Environment

**Loki Instance:**
- **Endpoint**: `http://bitbrat.lan:3100` (external) or `http://loki.bitbrat.local:3100` (Docker network)
- **Deployment**: Remote Docker Compose via SSH
- **Location**: `/opt/bitbrat-staging` on `bitbrat.lan`

**Configuration in architecture.yaml:**
```yaml
executionContexts:
  staging:
    runtime:
      loki:
        url: http://bitbrat.lan:3100
```

### Production Environment

**Status**: Not yet deployed
**Planned Retention**: 720h (30 days)

## Retention Policy

| Environment | Retention Period | Configuration File | Setting |
|-------------|------------------|-------------------|---------|
| **Local** | 7 days (168h) | `loki-config.yaml` | `limits_config.retention_period: 168h` |
| **Staging** | 7 days (168h) | `loki-config.yaml` | `limits_config.retention_period: 168h` |
| **Production** | 30 days (720h) | TBD | `limits_config.retention_period: 720h` |

**Retention Enforcement:**
- **Compaction Interval**: 10 minutes
- **Deletion Delay**: 2 hours after compaction
- **Worker Count**: 150 concurrent deletion workers
- **Table Manager**: `retention_deletes_enabled: true`

**Configuration:**
```yaml
# loki-config.yaml
limits_config:
  retention_period: 168h  # 7 days
  reject_old_samples: true
  reject_old_samples_max_age: 168h

table_manager:
  retention_deletes_enabled: true
  retention_period: 168h
```

## Label Configuration

### Current Labels (7 indexed labels)

Loki indexes the following labels for fast queries. **Label cardinality MUST be kept low** to avoid performance degradation.

| Label | Source | Cardinality | Purpose |
|-------|--------|-------------|---------|
| `service` | Docker Compose service name | ~30-50 | Identify which Bit logged the event |
| `compose_service` | Docker Compose metadata | ~30-50 | Same as `service` (debugging) |
| `container_id` | Docker metadata | ~30-50 | Container instance identification |
| `image` | Docker image tag | ~30-50 | Track image versions |
| `correlationId` | JSON log field | HIGH (millions) | Trace individual requests end-to-end |
| `traceId` | JSON log field | HIGH (millions) | Distributed tracing identifier |
| `level` | JSON log field | ~5 | Filter by log level (error, warn, info, debug) |

**⚠️ WARNING - High Cardinality Labels:**
- `correlationId` and `traceId` have VERY high cardinality (one per request)
- These labels are essential for observability but can cause Loki performance issues if cardinality grows too large
- **Retention policy (7-30 days) mitigates this by capping max unique label combinations**

### Proposed Additional Labels (Sprint 59)

Sprint 59 adds structured event logging for tool invocations. The following labels will be added:

| Label | Source | Cardinality | Purpose |
|-------|--------|-------------|---------|
| `eventType` | JSON log field (`eventType: 'tool.invocation'`) | ~5-10 | Filter by event type |
| `toolId` | JSON log field (tool identifier) | ~50-200 | Query metrics by specific tool |
| `modelId` | JSON log field (LLM model ID) | ~10-20 | Query metrics by LLM model |
| `status` | JSON log field (`success`, `error`, `denied`) | 3 | Filter by invocation status |

**Total Labels (Post-Sprint 59): 11 indexed labels**

**Cardinality Calculation:**
```
Max label combinations = service * eventType * toolId * modelId * status * level
~30 services * 10 eventTypes * 200 tools * 20 models * 3 statuses * 5 levels
= ~18,000,000 theoretical max combinations

ACTUAL max (with retention):
~30 services * 5 active eventTypes * 50 active tools * 10 active models * 3 statuses * 4 levels
= ~900,000 combinations (within Loki limits)
```

**Cardinality Limits (from loki-config.yaml):**
- `max_label_names_per_series: 30` (we're using 11, well within limit)
- `max_label_name_length: 1024` (longest: `compose_service` = 15 chars)
- `max_label_value_length: 2048` (longest: `correlationId` = 36 chars UUID)

### Label Extraction Pipeline (Promtail)

**Source**: `infrastructure/docker-compose/observability/promtail-config.yaml`

**Pipeline Stages:**

1. **Docker JSON Parsing**: Parse Docker container log format
   ```yaml
   - docker: {}
   ```

2. **BitBrat JSON Parsing**: Extract fields from structured JSON logs
   ```yaml
   - json:
       expressions:
         correlationId: correlationId
         traceId: traceId
         level: level
         msg: msg
         message: message
         ts: ts
         # ... (other fields)
   ```

3. **Label Promotion**: Promote specific fields to indexed labels
   ```yaml
   - labels:
       correlationId:
       traceId:
       level:
       # service already set by relabel_configs
   ```

4. **Timestamp Parsing**: Use log timestamp (not ingestion time)
   ```yaml
   - timestamp:
       source: ts
       format: RFC3339Nano
   ```

**Relabeling (Docker Metadata → Labels):**
```yaml
relabel_configs:
  # Extract service name from Docker Compose service label
  - source_labels: ['__meta_docker_container_label_com_docker_compose_service']
    target_label: 'service'

  # Add container ID for debugging
  - source_labels: ['__meta_docker_container_id']
    target_label: 'container_id'
```

## Storage Configuration

**Type**: boltdb-shipper + filesystem (single-node deployment)

**Schema:**
```yaml
schema_config:
  configs:
    - from: 2020-01-01
      store: boltdb-shipper
      object_store: filesystem
      schema: v11
      index:
        prefix: index_
        period: 24h
```

**Storage Locations (container paths):**
- **Chunks**: `/loki/chunks`
- **Active Index**: `/loki/boltdb-shipper-active`
- **Index Cache**: `/loki/boltdb-shipper-cache` (TTL: 24h)
- **Compactor Working Dir**: `/loki/boltdb-shipper-compactor`
- **Write-Ahead Log**: `/loki/wal`

**Docker Volume (local):**
```bash
docker volume inspect bitbrat-observability_loki-data
```

## Ingestion Limits

**Rate Limits:**
- **Ingestion Rate**: 4 MB/s
- **Ingestion Burst**: 6 MB/s
- **Per-Stream Rate**: 3 MB/s
- **Per-Stream Burst**: 15 MB/s

**Sample Age:**
- **Reject Old Samples**: Enabled
- **Max Age**: 168h (must match retention period)

**Configuration:**
```yaml
limits_config:
  ingestion_rate_mb: 4
  ingestion_burst_size_mb: 6
  per_stream_rate_limit: 3MB
  per_stream_rate_limit_burst: 15MB
  reject_old_samples: true
  reject_old_samples_max_age: 168h
```

## Query Configuration

**Query Range:**
- **Align Queries**: Enabled (align with step interval)
- **Max Retries**: 5
- **Cache Results**: Enabled
- **Cache Size**: 100 MB (embedded in-memory cache)

**Chunk Store:**
- **Max Look-Back Period**: 168h (match retention)
- **Cache Lookups Older Than**: 0s (cache all lookups)

**Frontend:**
- **Log Slow Queries**: >5s
- **Compress Responses**: Enabled
- **Max Outstanding Per Tenant**: 200

```yaml
query_range:
  align_queries_with_step: true
  max_retries: 5
  cache_results: true
  results_cache:
    cache:
      embedded_cache:
        enabled: true
        max_size_mb: 100

chunk_store_config:
  max_look_back_period: 168h
  cache_lookups_older_than: 0s

frontend:
  log_queries_longer_than: 5s
  compress_responses: true
  max_outstanding_per_tenant: 200
```

## API Endpoints

### Health & Status

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/ready` | GET | Health check (returns 200 when ready) |
| `/metrics` | GET | Prometheus metrics |
| `/config` | GET | Current Loki configuration |

### Query Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/loki/api/v1/query` | GET | Instant query (single timestamp) |
| `/loki/api/v1/query_range` | GET | Range query (time range) |
| `/loki/api/v1/labels` | GET | List all label names |
| `/loki/api/v1/label/{name}/values` | GET | List values for specific label |

### Ingestion Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/loki/api/v1/push` | POST | Push log entries (used by Promtail) |

### Example Queries

**Query all logs from tool-orchestrator service:**
```bash
curl -G 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={service="tool-orchestrator"}' \
  --data-urlencode 'start=1699900000000000000' \
  --data-urlencode 'end=1699986400000000000'
```

**Trace request by correlationId:**
```bash
curl -G 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={correlationId="abc-123-def"}' \
  --data-urlencode 'start=1699900000000000000' \
  --data-urlencode 'end=1699986400000000000'
```

**Get all available labels:**
```bash
curl 'http://localhost:3100/loki/api/v1/labels'
```

**Get all service names:**
```bash
curl 'http://localhost:3100/loki/api/v1/label/service/values'
```

## LogQL Query Examples

LogQL is Loki's query language, similar to PromQL. **Key difference**: Loki queries LABELS first, then filters/parses the log content.

### Basic Label Selectors

```logql
# All logs from tool-orchestrator
{service="tool-orchestrator"}

# All error logs
{level="error"}

# Specific correlation ID
{correlationId="abc-123-def"}

# Combine labels (AND)
{service="tool-orchestrator", level="error"}

# Multiple services (OR)
{service=~"tool-orchestrator|llm-bot"}
```

### Log Line Filtering (Post-Sprint 59)

```logql
# All tool invocations
{service="tool-orchestrator"} |= "tool.invocation"

# Tool invocations with errors
{service="tool-orchestrator", status="error"} |= "tool.invocation"

# RBAC denials
{service="tool-orchestrator", status="denied"} |= "rbacDecision"
```

### JSON Parsing & Metric Extraction

```logql
# Count tool invocations per tool
sum by (toolId) (count_over_time({service="tool-orchestrator", eventType="tool.invocation"}[5m]))

# Average latency by tool (P50)
avg by (toolId) (
  quantile_over_time(0.5,
    {service="tool-orchestrator", eventType="tool.invocation"}
    | json
    | unwrap durationMs [5m]
  )
)

# P95 latency
quantile_over_time(0.95,
  {service="tool-orchestrator", eventType="tool.invocation"}
  | json
  | unwrap durationMs [5m]
)

# Error rate
sum(rate({service="tool-orchestrator", status="error"}[5m]))
/
sum(rate({service="tool-orchestrator", eventType="tool.invocation"}[5m]))
```

## Verification Commands

### Check Loki Health

```bash
# Local
curl http://localhost:3100/ready

# Staging
curl http://bitbrat.lan:3100/ready
```

**Expected Response:** `200 OK` with no body

### Check Promtail Scraping

```bash
# Check Promtail metrics endpoint
curl http://localhost:9080/metrics | grep promtail_targets_active

# Expected output:
# promtail_targets_active{host="..."} 15.0
```

### Verify Log Ingestion

```bash
# Query recent logs (last 5 minutes)
curl -G 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={service=~".+"}' \
  --data-urlencode "start=$(date -u -v-5M +%s)000000000" \
  --data-urlencode "end=$(date -u +%s)000000000" \
  --data-urlencode 'limit=10'
```

### Check Label Cardinality

```bash
# Get all labels
curl http://localhost:3100/loki/api/v1/labels | jq

# Count unique values per label
for label in service level correlationId; do
  count=$(curl -s "http://localhost:3100/loki/api/v1/label/${label}/values" | jq '.data | length')
  echo "${label}: ${count} unique values"
done
```

## Network Accessibility

### Local Development

**From Host Machine:**
- Loki: `http://localhost:3100`
- Promtail: `http://localhost:9080`

**From Docker Containers (BitBrat services):**
- Loki: `http://loki.bitbrat.local:3100`
- Promtail: `http://promtail.bitbrat.local:9080`

**Network**: `bitbrat-network` (Docker bridge)

### Staging Environment

**From External (developer machine):**
- Loki: `http://bitbrat.lan:3100`
- SSH Tunnel: `ssh -L 3100:localhost:3100 root@bitbrat.lan`

**From Docker Containers (on bitbrat.lan):**
- Loki: `http://loki.bitbrat.local:3100`

## Configuration Files

| File | Location | Purpose |
|------|----------|---------|
| **Loki Config** | `infrastructure/docker-compose/observability/loki-config.yaml` | Loki server configuration |
| **Promtail Config** | `infrastructure/docker-compose/observability/promtail-config.yaml` | Log scraping and parsing |
| **Docker Compose** | `infrastructure/docker-compose/observability/docker-compose.observability.yaml` | Service definitions |
| **Architecture** | `architecture.yaml` (lines 1121-1122) | Execution context Loki URLs |

## Integration with BitBrat

### Current Integration (Pre-Sprint 59)

**Log Format**: All Bits emit structured JSON logs to stdout:
```json
{
  "level": "info",
  "ts": "2026-11-10T12:34:56.789Z",
  "msg": "Message text",
  "correlationId": "abc-123-def",
  "traceId": "trace-456-ghi",
  "service": "tool-orchestrator",
  "sessionId": "session-xyz",
  "userId": "user-123"
}
```

**Log Ingestion Flow:**
1. Bit writes JSON to stdout
2. Docker captures stdout → `/var/lib/docker/containers/{id}/{id}-json.log`
3. Promtail scrapes Docker log file
4. Promtail parses JSON and promotes labels
5. Promtail pushes to Loki
6. Loki indexes labels and stores log content

**Query Capability:**
- Query by `correlationId` → <100ms (indexed)
- Query by `service` → <100ms (indexed)
- Query by log content → slower (full scan)

### Planned Integration (Sprint 59)

**New Event Type**: `tool.invocation`

**Event Schema**:
```json
{
  "level": "info",
  "ts": "2026-11-10T12:34:56.789Z",
  "eventType": "tool.invocation",
  "toolId": "get_weather",
  "modelId": "gpt-4",
  "status": "success",
  "correlationId": "abc-123-def",
  "durationMs": 1234,
  "message": "Tool invocation completed",
  "rbacDecision": {
    "allowed": true,
    "userRoles": ["user"],
    "modelTier": "tier-1"
  }
}
```

**Additional Labels**:
- `eventType` (enables filtering: `{eventType="tool.invocation"}`)
- `toolId` (enables per-tool metrics)
- `modelId` (enables per-model metrics)
- `status` (enables error filtering: `{status="error"}`)

**ToolObserver Module**: New module in tool-orchestrator that queries Loki via LogQL to provide:
- Tool metrics (invocations, errors, latency)
- Model metrics (usage, cost)
- Health status (derived from event stream)
- Correlation tracing (follow request lifecycle)

## Performance Characteristics

**Query Performance (measured):**
- Correlation ID trace: <100ms (vs 2-5s with `docker logs`)
- Service logs (last 5 min): <200ms
- Label value enumeration: <50ms

**Resource Usage (measured on bitbrat.lan staging):**
- Loki RAM: ~50-70MB (idle)
- Promtail RAM: ~20-30MB (idle)
- Disk I/O: <1MB/s (normal load)
- CPU: <1% (both services)

**Ingestion Lag:**
- Promtail batch interval: 1s
- End-to-end lag: <5s (log written → queryable in Loki)

**Disk Usage Estimation:**
```
Assumptions:
- 100 tool invocations/hour
- 500 bytes/event
- 24/7 operation

Daily ingestion:
100 events/hour * 24 hours * 500 bytes = 1.2 MB/day

7-day retention:
1.2 MB/day * 7 days = 8.4 MB (negligible)

30-day retention:
1.2 MB/day * 30 days = 36 MB (negligible)

With 10x load (1000 invocations/hour):
- 7-day: 84 MB
- 30-day: 360 MB
```

## Troubleshooting

### Loki Not Starting

**Symptom**: `docker compose up` fails, Loki container exits

**Checks:**
1. Verify configuration syntax:
   ```bash
   docker run --rm -v $(pwd)/infrastructure/docker-compose/observability/loki-config.yaml:/etc/loki/config.yaml grafana/loki:2.9.3 -config.file=/etc/loki/config.yaml -verify-config
   ```

2. Check volume permissions:
   ```bash
   docker volume inspect bitbrat-observability_loki-data
   ```

3. Check logs:
   ```bash
   docker logs $(docker ps -aqf "name=loki")
   ```

### Promtail Not Shipping Logs

**Symptom**: Loki running but no logs appear

**Checks:**
1. Verify Promtail is scraping:
   ```bash
   curl http://localhost:9080/metrics | grep promtail_targets_active
   # Should show active targets (number of containers)
   ```

2. Check Promtail logs for errors:
   ```bash
   docker logs $(docker ps -aqf "name=promtail") | grep -i error
   ```

3. Verify Docker socket access:
   ```bash
   docker exec $(docker ps -aqf "name=promtail") ls -la /var/run/docker.sock
   ```

4. Test Loki connectivity from Promtail:
   ```bash
   docker exec $(docker ps -aqf "name=promtail") wget -O- http://loki.bitbrat.local:3100/ready
   ```

### High Cardinality Warning

**Symptom**: Loki logs show "cardinality limit exceeded"

**Resolution:**
1. Identify high-cardinality labels:
   ```bash
   for label in $(curl -s http://localhost:3100/loki/api/v1/labels | jq -r '.data[]'); do
     count=$(curl -s "http://localhost:3100/loki/api/v1/label/${label}/values" | jq '.data | length')
     echo "${label}: ${count}"
   done | sort -t: -k2 -rn
   ```

2. Remove high-cardinality labels from Promtail config (move to log body)

3. Increase retention to cap max combinations

### Query Timeout

**Symptom**: LogQL queries fail with "timeout exceeded"

**Resolutions:**
1. Reduce query time range
2. Add more specific label selectors
3. Increase query timeout in `loki-config.yaml`:
   ```yaml
   limits_config:
     query_timeout: 5m  # default: 1m
   ```

## References

- **Grafana Loki Documentation**: https://grafana.com/docs/loki/latest/
- **LogQL Reference**: https://grafana.com/docs/loki/latest/logql/
- **Promtail Documentation**: https://grafana.com/docs/loki/latest/clients/promtail/
- **BitBrat Planning**: `planning/sprint-59-ig0sr1/execution-plan.md`
- **Sprint 336 Archive** (original Loki deployment): `planning/archive/sprint-336-4b1f5a8-loki-observability/`

## Changelog

| Date | Sprint | Change |
|------|--------|--------|
| 2026-11-10 | 59 | Initial documentation (Task 1: Verify Loki Configuration) |
| TBD | 59 | Add tool invocation event schema and new labels |
| TBD | Future | Production deployment with 30-day retention |
