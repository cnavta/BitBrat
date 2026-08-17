# Sprint 336: Loki + Promtail Centralized Logging

**Sprint ID:** sprint-336-4b1f5a8-loki-observability
**Sprint Number:** 336
**Start Date:** 2026-07-11
**Target End Date:** 2026-07-15
**Branch:** `feature/sprint-336-4b1f5a8-loki-observability`

---

## Executive Summary

Implement Grafana Loki + Promtail as an optional centralized logging backend for Docker Compose deployments to solve fundamental log buffer limitations and enable reliable distributed tracing across the BitBrat fleet.

**Current Problem:**
- Docker logs limited to tail buffer (2000 lines ≈ 34 events)
- Correlation ID traces fail for older events
- No log persistence across container restarts
- Log spam from one Bit affects trace completeness
- Performance issues querying 14 Bits sequentially

**Proposed Solution:**
- Deploy Loki + Promtail as optional Docker Compose services
- Index logs by correlationId, traceId, service, level
- Enable unlimited log retention with time-based queries
- Maintain backward compatibility (falls back to Docker logs)
- Achieve <100ms trace queries across entire fleet

---

## Goals & Success Criteria

### Primary Goals
1. **Enable unlimited log retention** - No more 2000-line buffer limits
2. **Instant correlation ID lookups** - <100ms to retrieve full trace
3. **Persist logs across restarts** - Survive container restarts
4. **Optional deployment** - Works without Loki (degraded mode)

### Success Criteria

**Must Have:**
- [ ] Loki + Promtail docker-compose configuration
- [ ] Promtail parses JSON logs and extracts labels (correlationId, traceId, service, level)
- [ ] LogRetriever supports Loki queries with auto-fallback to Docker
- [ ] `fleet.trace` completes in <100ms for indexed events
- [ ] Log retention survives container restarts
- [ ] Zero breaking changes to existing services
- [ ] Documentation for setup and usage

**Nice to Have:**
- [ ] Grafana dashboard for platform observability
- [ ] Alert rules for error patterns
- [ ] Log volume metrics per service
- [ ] Automatic cleanup of old logs (retention policy)

---

## Architecture Overview

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                     BitBrat Services                        │
│  (event-router, llm-bot, ingress-egress, etc.)             │
│              ↓ JSON logs via Docker                         │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                      Promtail                               │
│  - Reads Docker container logs                             │
│  - Parses JSON structure                                    │
│  - Extracts labels: correlationId, traceId, service, level  │
│  - Ships to Loki                                            │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                        Loki                                 │
│  - Indexes by labels (not full-text)                       │
│  - Stores log streams with timestamps                       │
│  - Provides LogQL query API                                 │
│  - Retention: 7 days (configurable)                         │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                    LogRetriever                             │
│  - Detects if Loki available                               │
│  - Queries Loki via HTTP API (if available)                │
│  - Falls back to Docker logs (if Loki unavailable)         │
└─────────────────────────────────────────────────────────────┘
```

### Query Flow

**With Loki:**
```
fleet.trace(correlationId)
  → LogRetriever.getLogs() detects Loki
  → Single query: {correlationId="xxx"}
  → Returns logs from ALL services in <100ms
  → Response: Complete trace timeline
```

**Without Loki (fallback):**
```
fleet.trace(correlationId)
  → LogRetriever.getLogs() no Loki detected
  → 14 sequential Docker log queries (current behavior)
  → Returns last 2000 lines per service
  → Response: Potentially incomplete trace
```

---

## Implementation Phases

### Phase 1: Loki + Promtail Setup (Epic 1)
**Duration:** 1 day
**Goal:** Deploy Loki + Promtail as optional Docker Compose services

**Tasks:**
1. Create `docker-compose.observability.yaml`
2. Configure Loki with local storage and retention policy
3. Configure Promtail to scrape Docker container logs
4. Configure Promtail pipeline to parse JSON and extract labels
5. Test local deployment and log ingestion

**Deliverables:**
- `infrastructure/docker-compose/observability/loki-config.yaml`
- `infrastructure/docker-compose/observability/promtail-config.yaml`
- `infrastructure/docker-compose/observability/docker-compose.observability.yaml`
- `infrastructure/docker-compose/observability/.gitignore` (exclude data volumes)

---

### Phase 2: LogRetriever Loki Client (Epic 2)
**Duration:** 1.5 days
**Goal:** Add Loki query support to LogRetriever with automatic fallback

**Tasks:**
1. Add Loki HTTP client to LogRetriever
2. Implement Loki availability detection
3. Implement LogQL query builder
4. Parse Loki response format to LogEntry[]
5. Add fallback logic (Loki → Docker logs)
6. Add error handling and logging

**Deliverables:**
- Updated `tools/brat/src/dev-mcp/log-retriever.ts`
- New `tools/brat/src/dev-mcp/loki-client.ts`
- Unit tests for Loki client
- Integration tests with live Loki instance

---

### Phase 3: fleet.trace Performance Optimization (Epic 3)
**Duration:** 0.5 days
**Goal:** Optimize trace queries to use Loki's parallel capabilities

**Tasks:**
1. Update fleet.trace to use single Loki query (not per-Bit)
2. Remove hardcoded limit: 1000 for Loki queries
3. Add query performance metrics/logging
4. Test with multi-event traces

**Deliverables:**
- Updated `tools/brat/src/dev-mcp/tools/fleet.ts`
- Performance benchmarks (before/after)

---

### Phase 4: Documentation & Testing (Epic 4)
**Duration:** 1 day
**Goal:** Comprehensive documentation and validation

**Tasks:**
1. Write setup guide for local dev with Loki
2. Write troubleshooting guide
3. Create validation script for Loki deployment
4. Add LogRetriever unit tests (Loki + fallback)
5. End-to-end trace test with Loki
6. Update README with optional Loki setup

**Deliverables:**
- `documentation/guides/loki-setup.md`
- `documentation/guides/loki-troubleshooting.md`
- `planning/sprint-336-4b1f5a8-loki-observability/validate-loki.sh`
- Updated README.md

---

## Technical Implementation Details

### Loki Configuration

**Retention Policy:**
```yaml
# loki-config.yaml
limits_config:
  retention_period: 168h  # 7 days

table_manager:
  retention_deletes_enabled: true
  retention_period: 168h
```

**Storage:**
```yaml
# Local filesystem storage (development)
storage_config:
  filesystem:
    directory: /loki/chunks

# Index
schema_config:
  configs:
    - from: 2026-07-11
      store: boltdb-shipper
      object_store: filesystem
      schema: v11
      index:
        prefix: index_
        period: 24h
```

---

### Promtail Configuration

**Label Extraction Pipeline:**
```yaml
# promtail-config.yaml
scrape_configs:
  - job_name: bitbrat-services
    docker_sd_configs:
      - host: unix:///var/run/docker.sock

    relabel_configs:
      # Only scrape BitBrat containers
      - source_labels: ['__meta_docker_container_label_com_docker_compose_project']
        regex: 'bitbrat.*'
        action: keep

      # Extract service name
      - source_labels: ['__meta_docker_container_name']
        target_label: 'service'
        regex: '/(.+)-\d+'
        replacement: '${1}'

    pipeline_stages:
      # Parse JSON logs
      - json:
          expressions:
            correlationId: correlationId
            traceId: traceId
            level: level
            severity: severity
            msg: msg
            ts: ts

      # Extract as labels (for indexing)
      - labels:
          correlationId:
          traceId:
          level:
          service:

      # Set timestamp from log entry
      - timestamp:
          source: ts
          format: RFC3339Nano
```

---

### LogRetriever Loki Integration

**Detection Strategy:**
```typescript
// tools/brat/src/dev-mcp/log-retriever.ts
private async isLokiAvailable(): Promise<boolean> {
  try {
    const lokiUrl = process.env.LOKI_URL || 'http://localhost:3100';
    const response = await fetch(`${lokiUrl}/ready`, { timeout: 1000 });
    return response.ok;
  } catch {
    return false;
  }
}
```

**Query Builder:**
```typescript
private buildLokiQuery(request: LogRequest): string {
  const filters: string[] = [];

  // Service filter
  if (request.bit) {
    filters.push(`service="${request.bit}"`);
  }

  // Correlation ID filter
  if (request.correlationId) {
    filters.push(`correlationId="${request.correlationId}"`);
  }

  // Level filter
  if (request.level && request.level.length > 0) {
    const levels = request.level.map(l => `"${l}"`).join('|');
    filters.push(`level=~"${levels}"`);
  }

  return `{${filters.join(',')}}`;
}
```

**Query Execution:**
```typescript
private async getLokiLogs(request: LogRequest): Promise<LogEntry[]> {
  const lokiUrl = process.env.LOKI_URL || 'http://localhost:3100';
  const query = this.buildLokiQuery(request);

  const params = new URLSearchParams({
    query,
    limit: String(request.limit || 5000),
    direction: 'backward'  // Most recent first
  });

  if (request.since) {
    const sinceNs = parseTimeDuration(request.since) * 1e6;  // Convert to nanoseconds
    params.set('start', String(sinceNs));
  }

  if (request.until) {
    const untilNs = new Date(request.until).getTime() * 1e6;
    params.set('end', String(untilNs));
  }

  const response = await fetch(`${lokiUrl}/loki/api/v1/query_range?${params}`);
  const data = await response.json();

  return this.parseLokiResponse(data);
}
```

---

## Resource Requirements

### Infrastructure

**Local Development:**
```
Loki:     ~50MB RAM, ~100MB disk per day
Promtail: ~20MB RAM, negligible disk
Total:    ~70MB RAM, ~700MB disk per week
```

**Docker Compose:**
```yaml
# Resource limits
services:
  loki:
    deploy:
      resources:
        limits:
          memory: 128M
        reservations:
          memory: 64M

  promtail:
    deploy:
      resources:
        limits:
          memory: 64M
        reservations:
          memory: 32M
```

---

## Migration & Rollout Strategy

### Phase 1: Optional Deployment (Week 1)
- Deploy to local dev environments only
- Opt-in via `docker compose -f ... -f docker-compose.observability.yaml up`
- LogRetriever auto-detects and uses Loki if available
- Validate with test events

### Phase 2: Staging Deployment (Week 2)
- Deploy to staging environment
- Enable for all developers
- Monitor performance and stability
- Collect feedback

### Phase 3: Production Consideration (Future Sprint)
- Evaluate hosted Loki options (Grafana Cloud)
- OR deploy self-hosted Loki to GCP
- Integrate with existing Cloud Run logging

---

## Testing Strategy

### Unit Tests
- [ ] Loki client query builder
- [ ] Loki response parser
- [ ] LogRetriever.isLokiAvailable()
- [ ] LogRetriever fallback logic
- [ ] Error handling for Loki unavailable

### Integration Tests
- [ ] Deploy Loki + Promtail locally
- [ ] Generate test events with known correlationId
- [ ] Query logs via LogRetriever
- [ ] Verify complete trace retrieval
- [ ] Test with Loki stopped (fallback)

### Performance Tests
- [ ] Measure trace query time (Loki vs Docker)
- [ ] Measure Promtail ingestion latency
- [ ] Measure Loki query latency vs log volume
- [ ] Verify <100ms trace queries

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Loki fails to start | Low | Medium | Auto-fallback to Docker logs |
| Promtail misses logs | Low | High | Validation script checks coverage |
| Label cardinality explosion | Medium | Medium | Limit labels to 4 fields only |
| Disk space exhaustion | Low | Medium | 7-day retention + volume monitoring |
| Performance degradation | Low | Low | Resource limits + benchmarking |

---

## Dependencies

### External
- Grafana Loki 2.9.0+ Docker image
- Grafana Promtail 2.9.0+ Docker image
- Docker Compose 2.0+

### Internal
- Existing JSON structured logging (✅ already implemented)
- LogRetriever architecture (✅ already implemented)
- Fleet client infrastructure (✅ already implemented)

---

## Timeline

```
Day 1 (2026-07-11):
  ✓ Sprint planning
  □ Epic 1: Loki + Promtail setup

Day 2 (2026-07-12):
  □ Epic 2: LogRetriever integration (part 1)

Day 3 (2026-07-13):
  □ Epic 2: LogRetriever integration (part 2)
  □ Epic 3: fleet.trace optimization

Day 4 (2026-07-14):
  □ Epic 4: Testing & validation

Day 5 (2026-07-15):
  □ Epic 4: Documentation
  □ Sprint review & close-out
```

---

## Success Metrics

**Before (Current State):**
- Trace query time: ~2-5 seconds (14 sequential Docker queries)
- Log retention: ~34 events (2000 lines ÷ 58 lines/event)
- Trace completeness: ~60% (buffer overflow)
- Survives restart: ❌

**After (With Loki):**
- Trace query time: <100ms (single indexed query)
- Log retention: 7 days (configurable)
- Trace completeness: 100% (indexed persistence)
- Survives restart: ✅

---

## Post-Sprint

### Immediate Next Steps
- Monitor Loki performance in staging
- Collect developer feedback
- Identify optimization opportunities

### Future Enhancements (Separate Sprint)
- Grafana dashboards for platform health
- Alert rules for error patterns
- Production Loki deployment strategy
- Integration with OpenTelemetry (traces)
- Log-based metrics (e.g., event throughput)

---

## References

- [Grafana Loki Documentation](https://grafana.com/docs/loki/latest/)
- [Promtail Configuration](https://grafana.com/docs/loki/latest/clients/promtail/configuration/)
- [LogQL Query Language](https://grafana.com/docs/loki/latest/logql/)
- BitBrat Architecture: `architecture.yaml`
- Logging Architecture: `src/common/logging.ts`
