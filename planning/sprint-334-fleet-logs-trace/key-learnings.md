# Sprint 334 Key Learnings

**Sprint ID:** 334
**Sprint Name:** Fleet Logs and Trace Tools
**Date:** 2026-07-10

---

## Overview

This document captures technical insights, architectural decisions, and reusable patterns discovered during Sprint 334. These learnings are valuable for future sprints and provide guidance for similar implementations.

---

## Technical Insights

### 1. Multi-Target Log Retrieval Architecture

**Challenge:** Need to retrieve logs from different deployment targets (Cloud Run, Docker) with different APIs and formats.

**Solution:** Implement deployment type auto-detection by querying service registry.

**Implementation:**
```typescript
async resolveBitDeployment(bitName: string): Promise<DeploymentType> {
  const servers = await this.registry.listServers();
  const server = servers.find(s => s.name === bitName);
  const url = server.url.toLowerCase();

  if (url.includes('.run.app')) return 'cloud-run';
  if (url.includes('localhost') || url.includes('.bitbrat.local')) return 'docker';

  throw new Error(`Unable to determine deployment type`);
}
```

**Key Learning:** Query-based deployment detection is more maintainable than configuration files. Changes to deployment infrastructure don't require config updates.

**Reusable Pattern:** Use registry/metadata lookups to avoid hardcoded configuration.

---

### 2. Client-Side vs Server-Side Filtering

**Challenge:** Cloud Run (Cloud Logging API) supports server-side filtering, but Docker (docker compose logs) has limited filter support.

**Solution:** Hybrid approach:
- Cloud Run: Build filter strings for API (server-side filtering)
- Docker: Retrieve logs then apply filters (client-side filtering)

**Implementation:**
```typescript
// Cloud Run: Server-side filter
const filters = [
  `resource.type="cloud_run_revision"`,
  `severity>=${minSeverity}`,
  `jsonPayload.correlationId="${correlationId}"`
];

// Docker: Client-side filter
let logs = parseDockerLogs(output);
if (request.level) logs = filterByLevel(logs, request.level);
if (request.correlationId) logs = filterByCorrelation(logs, request.correlationId);
```

**Key Learning:** Don't force all backends to support same features. Implement feature parity through different mechanisms (server-side vs client-side).

**Reusable Pattern:** Adapter pattern with backend-specific implementations that present unified interface.

---

### 3. Duration String Parsing for User Convenience

**Challenge:** Users want to query "logs from the last hour" without calculating ISO timestamps.

**Solution:** Support both ISO timestamps and duration strings (1h, 30m, 5s).

**Implementation:**
```typescript
function parseTimeDuration(duration: string): string {
  if (duration.includes('T') || duration.includes('Z')) return duration; // ISO

  const match = duration.match(/^(\d+)(ms|s|m|h)$/);
  const value = parseInt(match[1]);
  const unit = match[2];

  const ms = { 'ms': value, 's': value * 1000, 'm': value * 60000, 'h': value * 3600000 }[unit];
  return new Date(Date.now() - ms).toISOString();
}
```

**Key Learning:** Small usability enhancements (duration strings) significantly improve DX. Implementation cost is low (~20 lines) but value is high.

**Reusable Pattern:** Accept multiple input formats and normalize internally.

---

### 4. Partial Failure Tolerance in Distributed Queries

**Challenge:** When querying 10 services for logs, 1-2 may fail (service down, permissions issue, timeout). Should entire query fail?

**Solution:** Collect successful results and report failures separately.

**Implementation:**
```typescript
const results = await Promise.all(
  bits.map(bit =>
    getLogs({ bit: bit.name, ...request })
      .catch(err => ({ bit: bit.name, error: err.message, logs: [] }))
  )
);

const successful = results.filter(r => !r.error);
const failed = results.filter(r => r.error);

return {
  logs: successful.flatMap(r => r.logs),
  errors: failed.map(r => `${r.bit}: ${r.error}`)
};
```

**Key Learning:** Fail-fast is appropriate for critical operations, but graceful degradation is better for observability/debugging tools. Users want partial data over no data.

**Reusable Pattern:** Promise.all with .catch on each promise, then filter success/failure.

---

### 5. Timeline Visualization with Relative Timestamps

**Challenge:** Distributed traces span multiple services with different timestamps. Absolute timestamps don't show flow clearly.

**Solution:** Calculate relative timestamps from first log entry.

**Implementation:**
```typescript
const allLogs = traces.flatMap(t => t.logs).sort(byTimestamp);
const firstTimestamp = new Date(allLogs[0].timestamp).getTime();

const timeline = allLogs.map(log => ({
  relativeMs: new Date(log.timestamp).getTime() - firstTimestamp,
  service: log.service,
  level: log.level,
  message: log.message
}));

// Format: "00:00:234 [service] LEVEL message"
```

**Key Learning:** Relative timestamps (HH:MM:SS.mmm) make temporal relationships obvious. Users can instantly see "service B started 12ms after service A."

**Reusable Pattern:** Anchor timeline to first event; display all subsequent events relative to that anchor.

---

### 6. Zod Schemas for Tool Parameter Validation

**Challenge:** Tool parameters need type safety, validation, and defaults.

**Solution:** Use Zod schemas for MCP tool definitions.

**Implementation:**
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

**Key Learning:** Zod provides excellent DX:
- Type inference (TypeScript types auto-generated)
- Runtime validation (catch invalid params early)
- Default values (simplifies handler code)
- Self-documenting (schema serves as API spec)

**Reusable Pattern:** Define Zod schema, infer TypeScript type, validate in handler.

---

### 7. Formatter Abstraction for Multiple Output Formats

**Challenge:** Different users prefer different formats (text for humans, JSON for scripts, raw for debugging).

**Solution:** Separate formatter functions with consistent interface.

**Implementation:**
```typescript
// log-formatter.ts
export function formatText(logs: LogEntry[]): string { /* ... */ }
export function formatJson(logs: LogEntry[]): string { /* ... */ }
export function formatRaw(logs: LogEntry[]): string { /* ... */ }
export function formatTimeline(trace: TraceTimeline): string { /* ... */ }

// tool handler
const formatters = { text: formatText, json: formatJson, raw: formatRaw };
const output = formatters[request.format](logs);
```

**Key Learning:** Don't inline formatting logic in tool handlers. Extract to pure functions for:
- Testability (formatters tested independently)
- Reusability (same formatters for logs and traces)
- Maintainability (add formats without touching handlers)

**Reusable Pattern:** Strategy pattern with formatter functions selected by format parameter.

---

## Architectural Decisions

### Decision 1: Auto-Detect Deployment Type vs Configuration

**Options Considered:**
1. Manual configuration (user specifies deployment type per Bit)
2. Environment-based detection (look for GCP creds → Cloud Run, else Docker)
3. Registry-based detection (query mcp_servers to see Bit URL)

**Decision:** Option 3 (Registry-based detection)

**Rationale:**
- No manual configuration (better UX)
- Accurate (URL definitively indicates deployment)
- Maintainable (no config files to keep in sync)

**Trade-offs:**
- Requires registry query (adds latency)
- Assumes URL patterns stable (*.run.app, localhost)

**Outcome:** Excellent UX, no issues in testing.

---

### Decision 2: Client-Side Filtering for Docker vs API Enhancement

**Options Considered:**
1. Enhance docker compose logs to support all filters (requires forking/wrapping Docker)
2. Client-side filtering after retrieval
3. Require users to manually filter output

**Decision:** Option 2 (Client-side filtering)

**Rationale:**
- No Docker modifications needed
- Simple implementation (~50 lines)
- Acceptable performance (filtering 1000 logs ~1ms)

**Trade-offs:**
- Retrieves more data than needed (network/CPU overhead)
- Doesn't scale to huge log volumes (mitigated by --tail limit)

**Outcome:** Works well for typical use cases (100-1000 logs).

---

### Decision 3: Partial Failure Tolerance vs Fail-Fast

**Options Considered:**
1. Fail-fast: Entire query fails if any Bit unavailable
2. Partial success: Return successful results + error list
3. Best-effort: Silently ignore failures

**Decision:** Option 2 (Partial success)

**Rationale:**
- Observability tools should be available even when fleet is partially down
- Users want partial data over no data
- Error list informs user which Bits failed

**Trade-offs:**
- More complex error handling
- Users might miss failed queries if not checking error list

**Outcome:** Excellent for debugging (get logs from healthy services even when some are down).

---

### Decision 4: Streaming Deferred to Future Sprint

**Options Considered:**
1. Implement streaming now (Phase 4, 6 tasks, ~1 day)
2. Defer streaming (mark P1, implement later)
3. Skip streaming entirely

**Decision:** Option 2 (Defer streaming)

**Rationale:**
- Core functionality (P0) delivered successfully without streaming
- Streaming adds complexity (timeouts, resource cleanup, buffering)
- Users can poll with --since parameter as workaround

**Trade-offs:**
- Users wanting real-time logs must poll manually
- Potential need for future sprint

**Outcome:** Good decision for delivering P0 quickly; monitor user feedback.

---

## Reusable Patterns

### Pattern 1: Type-Safe Tool Definition with Zod

```typescript
// 1. Define Zod schema
const toolSchema = z.object({
  requiredParam: z.string(),
  optionalParam: z.number().optional(),
  paramWithDefault: z.enum(['a', 'b']).default('a')
});

// 2. Infer TypeScript type
type ToolArgs = z.infer<typeof toolSchema>;

// 3. Validate in handler
async function toolHandler(args: unknown): Promise<ToolResponse> {
  const validatedArgs = toolSchema.parse(args); // throws if invalid
  // validatedArgs is now ToolArgs type
}
```

**When to Use:** All MCP tool definitions.

---

### Pattern 2: Adapter Pattern for Multi-Backend Support

```typescript
interface LogRetriever {
  getLogs(request: LogRequest): Promise<LogEntry[]>;
}

class CloudRunRetriever implements LogRetriever {
  async getLogs(request: LogRequest): Promise<LogEntry[]> {
    // Cloud Logging API implementation
  }
}

class DockerRetriever implements LogRetriever {
  async getLogs(request: LogRequest): Promise<LogEntry[]> {
    // docker compose logs implementation
  }
}

class LogRetrieverFactory {
  create(deploymentType: DeploymentType): LogRetriever {
    return deploymentType === 'cloud-run'
      ? new CloudRunRetriever()
      : new DockerRetriever();
  }
}
```

**When to Use:** Any feature with multiple backend implementations (databases, APIs, storage).

---

### Pattern 3: Parser/Formatter Separation

```typescript
// Parsing: External format → Internal model
function parseExternalFormat(input: string): InternalModel { /* ... */ }

// Formatting: Internal model → External format
function formatInternalModel(model: InternalModel, format: string): string { /* ... */ }

// Handler: Orchestrate
async function handler(args: Args): Promise<Response> {
  const externalData = await fetchData();
  const internalModel = parseExternalFormat(externalData);
  const output = formatInternalModel(internalModel, args.format);
  return { content: output };
}
```

**When to Use:** Any I/O operation (APIs, files, databases).

---

### Pattern 4: Graceful Degradation in Distributed Operations

```typescript
async function queryFleet(bits: Bit[], query: Query): Promise<Result> {
  const results = await Promise.all(
    bits.map(bit =>
      queryBit(bit, query)
        .catch(err => ({ bit: bit.name, error: err, data: null }))
    )
  );

  return {
    data: results.filter(r => r.data).flatMap(r => r.data),
    errors: results.filter(r => r.error).map(r => ({ bit: r.bit, error: r.error }))
  };
}
```

**When to Use:** Operations on multiple independent resources (services, files, databases).

---

## Best Practices Discovered

### 1. Validation Scripts Are Essential
**Practice:** Create validation script early in sprint; run frequently.

**Benefits:**
- Continuous quality feedback
- Catches issues immediately (TypeScript errors, missing files, test failures)
- Serves as checklist for deliverables

**Template:** See `validate_deliverable.sh` for reusable structure.

---

### 2. Test Parsers and Formatters Independently
**Practice:** Create parser/formatter utilities with comprehensive tests before integrating into tools.

**Benefits:**
- Pure functions are easy to test (no mocks needed)
- High test coverage with minimal setup
- Formatters reusable across tools

**Example:** log-parser.test.ts (36 tests) and log-formatter.test.ts (29 tests) gave high confidence before integration.

---

### 3. Duration Strings Improve UX
**Practice:** Accept both absolute timestamps (ISO) and relative durations (1h, 30m).

**Benefits:**
- Reduced cognitive load (no manual timestamp calculation)
- Faster debugging ("show me logs from last 5 minutes")

**Implementation Cost:** ~20 lines of code, high value-to-effort ratio.

---

### 4. Partial Failure Tolerance in Observability
**Practice:** For debugging/observability tools, return partial results + error list rather than failing entirely.

**Benefits:**
- Tools work even when some services are down
- Users get actionable data (logs from healthy services)

**Anti-Pattern:** Fail-fast is wrong for observability (you need logs most when things are broken).

---

### 5. Self-Documenting Tools via MCP Schemas
**Practice:** Use Zod schemas with descriptive field names and descriptions; rely on MCP introspection rather than separate API docs.

**Benefits:**
- Documentation never out of sync (schema IS the spec)
- Agents discover tools automatically
- Less maintenance burden

**Trade-off:** Detailed human-friendly docs may still be valuable for complex workflows.

---

## Anti-Patterns to Avoid

### 1. ❌ Hardcoded Deployment Configuration
**Problem:** Requiring manual configuration for deployment type (cloud-run vs docker).

**Why Bad:** Configuration drift, maintenance burden, user error.

**Better:** Auto-detect via registry/metadata query.

---

### 2. ❌ Inline Formatting in Tool Handlers
**Problem:** Embedding formatting logic directly in tool handler code.

**Why Bad:** Untestable, unreusable, violates SRP.

**Better:** Extract formatters to pure functions; select via strategy pattern.

---

### 3. ❌ Fail-Fast for Observability Tools
**Problem:** Entire fleet-wide query fails if one service is unavailable.

**Why Bad:** Need logs most when things are broken; fail-fast prevents debugging.

**Better:** Partial failure tolerance with error reporting.

---

### 4. ❌ Absolute Timestamps in Traces
**Problem:** Displaying absolute timestamps in distributed traces.

**Why Bad:** Temporal relationships unclear; hard to see "service B started 12ms after A."

**Better:** Relative timestamps from first event (00:00:000, 00:00:012, etc.).

---

### 5. ❌ No Validation Script
**Problem:** Manual testing of deliverables before commit/PR.

**Why Bad:** Error-prone, time-consuming, inconsistent.

**Better:** Automated validation script with 30+ checks.

---

## Future Recommendations

### For Similar Sprints (Observability/Tooling)

1. **Start with Validation Script:** Create validation script in Phase 1; iterate as sprint progresses.

2. **Test Utilities First:** Build parser/formatter utilities with comprehensive tests before integrating into tools.

3. **Plan for Partial Failures:** Observability tools should gracefully handle unavailable services.

4. **Consider Streaming Early:** Evaluate if real-time streaming is P0 or P1; defer intentionally with user input.

5. **Performance Benchmarks:** Add simple performance tests (even if not comprehensive) to catch regressions.

### For Sprint Process

1. **Conservative Estimates Work:** This sprint finished 7-9x faster than estimated but having buffer is better than pressure.

2. **Phased Approach Is Excellent:** Infrastructure → Tool 1 → Tool 2 → Testing → Publication keeps work organized.

3. **Backlog YAML Is Valuable:** Detailed task tracking (56 tasks with dependencies) ensured nothing was missed.

4. **Deferred Features Need User Input:** Before deferring P1 features, consult with user on priority.

---

## Conclusion

Sprint 334 validated several architectural patterns and best practices:

**Technical:**
- Auto-detection via registry queries (eliminates configuration)
- Hybrid filtering (server-side + client-side for feature parity)
- Parser/formatter separation (testability + reusability)
- Graceful degradation (partial success better than fail-fast)

**Process:**
- Validation scripts provide continuous quality feedback
- Phased implementation keeps work organized
- Detailed backlog ensures comprehensive delivery

**Tools:**
- Zod schemas for type-safe, self-documenting APIs
- Duration strings for improved UX
- Timeline visualization for distributed traces

These patterns are reusable for future sprints involving multi-backend support, observability tooling, and MCP tool development.

---

**Document Status:** ✅ Complete
**Reusable Patterns Documented:** 4
**Best Practices Documented:** 5
**Anti-Patterns Documented:** 5
