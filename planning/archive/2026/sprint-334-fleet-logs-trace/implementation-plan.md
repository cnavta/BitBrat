# Implementation Plan – Fleet Logs and Trace Tools

**Sprint ID:** 334
**Role:** Lead Implementor
**Date:** 2026-07-10
**Source of Truth:** `planning/sprint-333-dev-mcp-server/technical-architecture.md` (Sections 2.4, 2.2.3.B)
**Status:** Pre-sprint planning artifact – **plan drafted, awaiting "Start sprint" approval**

---

## 1. Executive Summary

Implement two critical observability tools for the BitBrat Dev MCP Server:

1. **fleet.logs** - Multi-target log retrieval with filtering, streaming, and correlation lookup
2. **fleet.trace** - Correlation-based request tracing across all services

These tools extend the Phase 1 foundation (Sprint 333) with comprehensive log access across Docker and Cloud Run deployment targets, enabling agents to debug issues, trace requests, and analyze system behavior.

**Core Value:**
- Unified log access regardless of deployment target (local Docker, remote Docker, GCP Cloud Run)
- Correlation-ID-based distributed tracing across the entire fleet
- Structured filtering by level, time range, service, and custom fields
- Real-time log streaming for live debugging

---

## 2. Technical Context

### 2.1 Current State (Post Sprint-333)

**What Exists:**
- ✅ MCP server with stdio transport (`tools/brat/src/dev-mcp/server.ts`)
- ✅ Target connection manager supporting local, SSH, and GCP (`target-manager.ts`)
- ✅ Tool router with Zod validation (`tool-router.ts`)
- ✅ Fleet tools: `fleet.list`, `fleet.info` (`tools/fleet.ts`)
- ✅ Config and persistence tools operational

**What's Missing:**
- ❌ Log retrieval infrastructure (Cloud Logging API + Docker logs)
- ❌ Correlation-based trace aggregation
- ❌ Log streaming capabilities
- ❌ Timeline visualization for traces

### 2.2 Log Storage Architecture

**Cloud Run (Production/Staging):**
- Logs → Google Cloud Logging (structured JSON)
- Query via `@google-cloud/logging` SDK
- Filter syntax: Cloud Logging filter language
- Access: Requires GCP credentials

**Docker (Local/Remote SSH):**
- Logs → Docker daemon (stdout/stderr capture)
- Query via `docker compose logs` command
- Output: Text format with timestamps
- Access: Docker socket or SSH

**Firestore:**
- Logs are **NOT** stored in Firestore (by design)
- Only event aggregates and state persist

### 2.3 Correlation ID Flow

Every event in BitBrat carries a `correlationId` that flows through:

1. **Ingress** → `ingress-egress` receives event, assigns correlationId
2. **Routing** → `event-router` attaches routing slip
3. **Processing** → Services log with correlationId context
4. **State Mutation** → `disposition-service` applies mutations
5. **Egress** → `ingress-egress` sends response

All services log with `correlationId` field, enabling distributed tracing.

---

## 3. Architecture Design

### 3.1 Component Overview

```
┌─────────────────────────────────────────────────────┐
│         fleet.logs / fleet.trace Tools              │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│            LogRetriever (New Component)             │
│  ┌───────────────────────────────────────────────┐ │
│  │  Deployment Type Resolver                     │ │
│  │  - Query mcp_servers registry                 │ │
│  │  - Determine: cloud-run vs docker             │ │
│  └───────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────┐ │
│  │  Cloud Run Log Retriever                      │ │
│  │  - Google Cloud Logging API client            │ │
│  │  - Filter builder (severity, timestamp, etc.) │ │
│  │  - Result formatter (JSON/text/raw)           │ │
│  └───────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────┐ │
│  │  Docker Log Retriever                         │ │
│  │  - DockerOrchestrator integration             │ │
│  │  - JSON log parser                            │ │
│  │  - Client-side filtering (level, correlation) │ │
│  └───────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────┐ │
│  │  Log Aggregator (for fleet.trace)             │ │
│  │  - Parallel queries across all Bits           │ │
│  │  - Merge and sort by timestamp                │ │
│  │  - Timeline formatter                         │ │
│  └───────────────────────────────────────────────┘ │
└──────────────────┬──────────────────────────────────┘
                   │
      ┌────────────┴─────────────┐
      ▼                          ▼
┌─────────────┐          ┌──────────────┐
│ Cloud       │          │  Docker      │
│ Logging API │          │  Compose     │
└─────────────┘          └──────────────┘
```

### 3.2 Key Algorithms

#### Deployment Type Resolution

```typescript
async function resolveBitDeployment(bit: string, connection: TargetConnection): Promise<DeploymentType> {
  // Query mcp_servers registry for Bit URL
  const registry = new FirestoreRegistryReader({
    projectId: connection.firestore.projectId,
    databaseId: connection.firestore.databaseId
  });

  const server = await registry.getServer(bit);
  if (!server) throw new Error(`Bit '${bit}' not found in registry`);

  const url = server.url;

  // Cloud Run: https://*.run.app or https://*.a.run.app
  if (url.includes('.run.app')) return 'cloud-run';

  // Docker: http://localhost:* or http://*.bitbrat.local:*
  if (url.includes('localhost') || url.includes('.bitbrat.local')) return 'docker';

  throw new Error(`Unable to determine deployment type for URL: ${url}`);
}
```

#### Cloud Run Log Query

```typescript
import { Logging } from '@google-cloud/logging';

async function getCloudRunLogs(request: LogRequest, connection: TargetConnection) {
  const logging = new Logging({
    projectId: connection.firestore.projectId
  });

  // Build Cloud Logging filter
  const filters = [
    `resource.type="cloud_run_revision"`,
    `resource.labels.service_name="${request.bit}"`,
  ];

  if (request.level && request.level.length > 0) {
    const minSeverity = mapLevelToSeverity(request.level);
    filters.push(`severity>=${minSeverity}`);
  }

  if (request.since) {
    filters.push(`timestamp>="${parseSince(request.since)}"`);
  }

  if (request.until) {
    filters.push(`timestamp<="${request.until}"`);
  }

  if (request.correlationId) {
    filters.push(`jsonPayload.correlationId="${request.correlationId}"`);
  }

  const filter = filters.join(' AND ');

  const [entries] = await logging.getEntries({
    filter,
    orderBy: 'timestamp desc',
    pageSize: request.limit || 100
  });

  return formatLogEntries(entries, request.format);
}

function mapLevelToSeverity(levels: string[]): string {
  // Map to Cloud Logging severity levels
  const severityMap = {
    'trace': 'DEBUG',
    'debug': 'DEBUG',
    'info': 'INFO',
    'warn': 'WARNING',
    'error': 'ERROR'
  };

  const minLevel = levels[0]; // Assume sorted
  return severityMap[minLevel] || 'INFO';
}
```

#### Docker Log Query

```typescript
import { DockerOrchestrator } from '../../orchestration/docker/orchestrator.js';

async function getDockerLogs(request: LogRequest, connection: TargetConnection) {
  const orchestrator = new DockerOrchestrator({
    target: connection.name,
    service: request.bit
  });

  const args = ['--tail', (request.limit || 100).toString()];

  if (request.since) {
    args.push('--since', request.since);
  }

  if (request.until) {
    args.push('--until', request.until);
  }

  // Execute docker compose logs
  const output = await orchestrator.logs(false, args);

  // Parse JSON logs (BitBrat services emit structured JSON)
  const logs = parseDockerLogs(output);

  // Apply client-side filters
  let filtered = logs;

  if (request.level && request.level.length > 0) {
    filtered = filtered.filter(log => request.level.includes(log.level));
  }

  if (request.correlationId) {
    filtered = filtered.filter(log => log.correlationId === request.correlationId);
  }

  return formatLogEntries(filtered, request.format);
}

function parseDockerLogs(output: string): LogEntry[] {
  return output
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      try {
        // Extract JSON from docker compose log format: "service-name | {...}"
        const match = line.match(/\|\s*(\{.*\})/);
        if (match) {
          return JSON.parse(match[1]);
        }
        // Fallback: treat as plain text
        return { message: line, level: 'info', timestamp: new Date().toISOString() };
      } catch {
        return { message: line, level: 'info', timestamp: new Date().toISOString() };
      }
    });
}
```

#### Correlation-Based Trace Aggregation

```typescript
async function traceByCorrelationId(
  correlationId: string,
  connection: TargetConnection
): Promise<TraceTimeline> {
  // Get all Bits in fleet
  const bits = await fleetClient.list();

  // Query logs from each Bit in parallel (with concurrency limit)
  const concurrency = 5;
  const traces = [];

  for (let i = 0; i < bits.length; i += concurrency) {
    const batch = bits.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(bit =>
        getLogs({
          bit: bit.name,
          correlationId,
          limit: 1000,
          target: connection.name
        }).catch(err => ({ bit: bit.name, error: err, logs: [] }))
      )
    );
    traces.push(...results);
  }

  // Merge all logs and sort by timestamp
  const allLogs = traces
    .flatMap(t => t.logs || [])
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Calculate duration
  if (allLogs.length === 0) {
    return {
      correlationId,
      duration: 0,
      services: [],
      timeline: []
    };
  }

  const firstTimestamp = new Date(allLogs[0].timestamp);
  const lastTimestamp = new Date(allLogs[allLogs.length - 1].timestamp);
  const duration = lastTimestamp.getTime() - firstTimestamp.getTime();

  // Build timeline with relative timestamps
  const timeline = allLogs.map(log => ({
    relativeMs: new Date(log.timestamp).getTime() - firstTimestamp.getTime(),
    service: log.service || 'unknown',
    level: log.level,
    message: log.message || log.msg
  }));

  return {
    correlationId,
    duration,
    services: [...new Set(timeline.map(t => t.service))],
    timeline
  };
}
```

---

## 4. Implementation Phases

### Phase 1: Log Retrieval Infrastructure (P0)

**Goal:** Build core log retrieval components for Cloud Run and Docker.

**Tasks:**
1. Create `LogRetriever` class in `tools/brat/src/dev-mcp/log-retriever.ts`
2. Implement deployment type resolver (query registry, parse URL)
3. Implement Cloud Run log retriever using `@google-cloud/logging`
4. Implement Docker log retriever using `DockerOrchestrator`
5. Create log parser utilities (JSON parsing, filtering)
6. Implement log formatters (text, json, raw)
7. Write unit tests for each component

**Deliverables:**
- `log-retriever.ts` with full implementation
- `log-parser.ts` with parsing utilities
- `log-formatter.ts` with output formatters
- Unit tests with >80% coverage

**Acceptance Criteria:**
- [ ] LogRetriever can determine deployment type for any Bit
- [ ] Cloud Run logs can be queried with filtering
- [ ] Docker logs can be queried and parsed
- [ ] All formatters produce correct output
- [ ] Tests pass for both deployment types

**Gate P1-1:** Log retrieval infrastructure operational

---

### Phase 2: fleet.logs Tool (P0)

**Goal:** Implement the `fleet.logs` MCP tool with full filtering capabilities.

**Tasks:**
1. Define `fleet.logs` tool schema with Zod
2. Implement tool handler in `tools/fleet.ts`
3. Integrate LogRetriever for single-bit queries
4. Implement `--all` mode for fleet-wide log retrieval
5. Add time range parsing (ISO timestamps + durations like "1h", "30m")
6. Add level filtering (multiple levels supported)
7. Add correlation ID filtering
8. Implement result formatting (text, json, raw)
9. Add error handling and partial failure tolerance
10. Write integration tests with mocked Cloud Logging and Docker

**Tool Schema:**
```typescript
const fleetLogsSchema = z.object({
  bit: z.string().optional(),
  level: z.array(z.enum(['error', 'warn', 'info', 'debug', 'trace'])).optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.number().default(100),
  correlationId: z.string().optional(),
  format: z.enum(['json', 'text', 'raw']).default('text')
});
```

**Deliverables:**
- `fleet.logs` tool registered and functional
- Comprehensive integration tests
- Documentation with examples

**Acceptance Criteria:**
- [ ] Tool can retrieve logs from Cloud Run services
- [ ] Tool can retrieve logs from Docker services
- [ ] All filters work correctly (level, time, correlation)
- [ ] `--all` mode queries entire fleet
- [ ] Partial failures handled gracefully
- [ ] Output formats (text, json, raw) all work
- [ ] Integration tests pass

**Gate P2-1:** fleet.logs tool production-ready

---

### Phase 3: fleet.trace Tool (P0)

**Goal:** Implement correlation-based distributed tracing.

**Tasks:**
1. Define `fleet.trace` tool schema with Zod
2. Implement trace aggregator (parallel log queries)
3. Implement timeline builder (merge, sort, format)
4. Add timeline output formatter (human-readable)
5. Add JSON output formatter (structured data)
6. Implement duration calculation
7. Add service list in trace summary
8. Write integration tests with multi-service scenarios
9. Document example traces

**Tool Schema:**
```typescript
const fleetTraceSchema = z.object({
  correlationId: z.string(),
  format: z.enum(['json', 'text', 'timeline']).default('timeline')
});
```

**Timeline Format:**
```
Correlation ID: evt-123-456-789
Duration: 234ms
Services: ingress-egress, event-router, llm-bot, disposition, ingress-egress

00:00:000 [ingress-egress] INFO  Event received from Twitch
00:00:012 [event-router]   INFO  Matched rule: default-llm-routing
00:00:015 [event-router]   DEBUG Attached routing slip with 3 steps
00:00:023 [llm-bot]        INFO  Processing chat message
00:00:187 [llm-bot]        DEBUG OpenAI completion took 164ms
00:00:201 [disposition]    INFO  Applied mutation: increment_message_count
00:00:234 [ingress-egress] INFO  Response sent to Twitch
```

**Deliverables:**
- `fleet.trace` tool registered and functional
- Timeline formatter with human-readable output
- Integration tests with multi-service traces
- Documentation with example traces

**Acceptance Criteria:**
- [ ] Tool queries all services for correlation ID
- [ ] Logs merged and sorted by timestamp
- [ ] Timeline shows relative timestamps
- [ ] Duration calculated correctly
- [ ] Service list accurate
- [ ] Both text and JSON formats work
- [ ] Handles missing or partial traces gracefully
- [ ] Integration tests pass

**Gate P3-1:** fleet.trace tool production-ready

---

### Phase 4: Real-Time Streaming (P1)

**Goal:** Add real-time log streaming support (optional, nice-to-have).

**Tasks:**
1. Add `follow: boolean` parameter to `fleet.logs`
2. Implement streaming for Docker logs (`docker compose logs --follow`)
3. Implement polling-based streaming for Cloud Run (1-second intervals)
4. Handle stream termination gracefully
5. Add stream timeout (configurable, default 5 minutes)
6. Write integration tests for streaming

**Note:** Streaming may require MCP protocol extensions or buffering strategies.

**Deliverables:**
- Streaming support for `fleet.logs`
- Tests for streaming behavior

**Acceptance Criteria:**
- [ ] `follow: true` streams Docker logs in real-time
- [ ] Cloud Run logs poll every 1 second
- [ ] Stream terminates gracefully on error or timeout
- [ ] Tests verify streaming behavior

**Gate P4-1:** Streaming operational (optional)

---

### Phase 5: Testing & Documentation (P0)

**Goal:** Comprehensive testing, validation script, and documentation.

**Tasks:**
1. End-to-end tests simulating agent workflows
2. Target parity tests (Cloud Run vs Docker)
3. Performance tests (query latency, large result sets)
4. Update validation script (`validate_deliverable.sh`)
5. Write tool reference documentation
6. Update MCP setup guide with log access examples
7. Create troubleshooting guide for common log issues
8. Document example agent workflows (debugging, tracing)

**Deliverables:**
- Comprehensive test suite (>80% coverage)
- Updated documentation (3+ guides)
- Validation script

**Acceptance Criteria:**
- [ ] All tests pass (unit + integration + E2E)
- [ ] Target parity verified (Cloud Run + Docker)
- [ ] Performance meets targets (<5s p95)
- [ ] Documentation complete and reviewed
- [ ] Validation script passes

**Gate P5-1:** System production-ready

---

### Phase 6: Publication & Close-Out (P0)

**Goal:** Commit code, create PR, complete sprint artifacts.

**Tasks:**
1. Commit all code with descriptive commit message
2. Update `CHANGELOG.md`
3. Create feature branch PR to `main`
4. Generate `verification-report.md`
5. Generate `retro.md`
6. Generate `key-learnings.md`

**Deliverables:**
- PR ready for review
- Sprint artifacts complete

**Acceptance Criteria:**
- [ ] All code committed
- [ ] PR created with full description
- [ ] CHANGELOG updated
- [ ] Sprint artifacts complete

**Gate P6-1:** Sprint complete

---

## 5. Dependencies & Constraints

### 5.1 External Dependencies

**New NPM Packages:**
- `@google-cloud/logging` (^11.0.0) - Cloud Logging API client
- Already have: `@modelcontextprotocol/sdk`, `zod`, `firebase-admin`

**Existing Modules (Reuse):**
- `FleetClient` - For fleet discovery
- `FirestoreRegistryReader` - For registry queries
- `DockerOrchestrator` - For Docker log access
- `TargetConnectionManager` - For connection resolution

### 5.2 Constraints

**Read-Only Posture:**
- All log operations are read-only (no log deletion or mutation)
- No write operations to Cloud Logging or Docker

**Performance:**
- Default log limit: 100 entries
- Max log limit: 1000 entries
- Query timeout: 30 seconds
- Streaming timeout: 5 minutes (configurable)

**Security:**
- Logs already redacted by platform (no additional redaction needed)
- Fail-closed: no token → refuse operation
- Audit all log queries

**Target Awareness:**
- Must work identically on local Docker, remote SSH Docker, and GCP Cloud Run
- Deployment type auto-detected per Bit

---

## 6. Testing Strategy

### 6.1 Unit Tests

**Log Retriever:**
- Deployment type resolution (cloud-run vs docker)
- Cloud Logging filter building
- Docker log parsing (JSON and plain text)
- Time range parsing (ISO + duration strings)
- Level filtering
- Correlation filtering

**Formatters:**
- Text format (human-readable)
- JSON format (structured)
- Raw format (unmodified)
- Timeline format (distributed trace)

**Error Handling:**
- Missing Bit in registry
- Unavailable Cloud Logging API
- Docker command failures
- Malformed log entries

### 6.2 Integration Tests

**fleet.logs:**
- Query Cloud Run service (mocked Cloud Logging API)
- Query Docker service (mocked docker compose logs)
- Filter by level (single and multiple)
- Filter by time range (since/until)
- Filter by correlation ID
- `--all` mode (fan-out to entire fleet)
- Partial failure tolerance
- Output formats

**fleet.trace:**
- Multi-service trace aggregation
- Timeline building and sorting
- Duration calculation
- Service list accuracy
- Handles missing logs gracefully
- Output formats

### 6.3 End-to-End Tests

**Agent Workflows:**
1. Debug service error: `fleet.logs { bit: "llm-bot", level: ["error"], since: "1h" }`
2. Trace request: `fleet.trace { correlationId: "evt-123" }`
3. Live debugging: `fleet.logs { bit: "event-router", follow: true }` (Phase 4)

**Target Parity:**
- Verify identical behavior on local and Cloud Run targets
- Test SSH tunnel connectivity (mocked)

### 6.4 Performance Tests

**Scenarios:**
- Query 100 logs from single service: <1s
- Query 1000 logs from single service: <3s
- `--all` mode (5 services, 100 logs each): <5s
- Trace aggregation (5 services): <5s
- Streaming (1 minute): stable memory usage

---

## 7. Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Cloud Logging API quota limits | Medium | Medium | Implement rate limiting, caching; document quota considerations |
| Docker log parsing inconsistency | Low | Medium | Normalize log format in parser; comprehensive test coverage with various log formats |
| Large result sets cause timeouts | Medium | Medium | Enforce pagination limits; implement timeouts; return partial results on timeout |
| SSH tunnel instability for remote logs | Medium | Low | Reuse proven connection manager; add retry logic |
| Correlation ID not present in all logs | Low | Medium | Handle gracefully; document that trace requires correlation ID |
| Streaming performance issues | Medium | Low | Use polling with configurable intervals; document limitations |
| GCP credentials not configured | High | Medium | Clear error messages; document setup requirements |

---

## 8. Out of Scope (Future Sprints)

**Deferred to Sprint 335+:**
- Log aggregation/search indexing
- Real-time log subscriptions (WebSocket-based)
- Log export functionality
- Custom log filters (regex, advanced queries)
- Performance profiling based on logs
- Anomaly detection
- SSE transport (remains stdio only)

---

## 9. Success Metrics

**Functional:**
- [ ] `fleet.logs` retrieves logs from Cloud Run and Docker
- [ ] `fleet.trace` aggregates distributed traces
- [ ] All filters work correctly (level, time, correlation)
- [ ] `--all` mode queries entire fleet

**Quality:**
- [ ] Test coverage >80%
- [ ] All tests pass
- [ ] No security vulnerabilities
- [ ] Documentation complete

**Performance:**
- [ ] Single-service log query <1s (p50)
- [ ] Fleet-wide query <5s (p95)
- [ ] Trace aggregation <5s (p95)

**Usability:**
- [ ] Clear error messages
- [ ] Example workflows documented
- [ ] Agent integration examples provided

---

## 10. Timeline Estimate

**Phase 1 (Infrastructure):** 2 days
- LogRetriever implementation
- Cloud Logging and Docker integrations
- Parsers and formatters

**Phase 2 (fleet.logs):** 2 days
- Tool implementation
- Filtering and formatting
- Integration tests

**Phase 3 (fleet.trace):** 1-2 days
- Trace aggregation
- Timeline formatting
- Integration tests

**Phase 4 (Streaming):** 1 day (optional)
- Real-time streaming
- Tests

**Phase 5 (Testing & Docs):** 1 day
- E2E tests
- Documentation
- Validation script

**Phase 6 (Publication):** 0.5 day
- Commit, PR, artifacts

**Total:** 7-9 days

---

## 11. Definition of Done

Every task must satisfy:
1. **Implementation:** Code complete, follows existing patterns
2. **Testing:** Unit tests + integration tests green
3. **Documentation:** Inline comments, tool description, examples
4. **Security:** Read-only verified, fail-closed verified
5. **Target Parity:** Tested on both Cloud Run and Docker (mocked or real)
6. **Performance:** Meets latency targets
7. **Code Review:** Self-review checklist complete

---

## 12. Next Steps

**Upon "Start sprint" approval:**
1. Create feature branch: `feature/sprint-334-fleet-logs-trace`
2. Begin Phase 1: Log retrieval infrastructure
3. Track progress in `request-log.md`
4. Update backlog YAML as tasks complete

**Blocked by:** Explicit "Start sprint" instruction (AGENTS.md Rule S1)

---

## Appendix A: Tool Schemas

### fleet.logs

```typescript
{
  name: "fleet.logs",
  description: "Retrieve logs from specific Bit(s) - supports Cloud Run and Docker targets",
  inputSchema: z.object({
    bit: z.string().optional(),
    level: z.array(z.enum(['error', 'warn', 'info', 'debug', 'trace'])).optional(),
    since: z.string().optional(),
    until: z.string().optional(),
    limit: z.number().default(100),
    correlationId: z.string().optional(),
    format: z.enum(['json', 'text', 'raw']).default('text')
  })
}
```

### fleet.trace

```typescript
{
  name: "fleet.trace",
  description: "Trace a request across all services by correlation ID",
  inputSchema: z.object({
    correlationId: z.string(),
    format: z.enum(['json', 'text', 'timeline']).default('timeline')
  })
}
```

---

## Appendix B: File Structure

```
tools/brat/src/dev-mcp/
├── log-retriever.ts              # NEW: Core log retrieval logic
├── log-parser.ts                 # NEW: JSON and text log parsing
├── log-formatter.ts              # NEW: Output formatters
├── tools/
│   └── fleet.ts                  # MODIFIED: Add fleet.logs and fleet.trace
└── __tests__/
    ├── log-retriever.test.ts     # NEW: LogRetriever tests
    ├── log-parser.test.ts        # NEW: Parser tests
    ├── log-formatter.test.ts     # NEW: Formatter tests
    └── tools/
        └── fleet.test.ts         # MODIFIED: Add logs/trace tests
```

---

**End of Implementation Plan**
