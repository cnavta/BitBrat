# Technical Architecture: Development MCP Server for BitBrat Platform

**Sprint ID:** 333
**Document Type:** Technical Architecture
**Status:** Draft - Awaiting Approval
**Created:** 2026-07-07
**Author:** Architect (LLM Agent)

---

## Executive Summary

This document proposes a technical architecture for a **local development MCP server** integrated into the `brat` CLI. This MCP server will act as a **unified proxy/router** enabling coding agents to access BitBrat platform development tooling regardless of where the platform is running (local Docker, remote Docker, or GCP).

The architecture addresses three key development challenges:

1. **Connection Inconsistency**: No standardized way for agents to connect to BitBrat during development
2. **Persistence Abstraction**: Firebase-specific tooling makes cross-platform development difficult
3. **Development vs Platform Separation**: Need clean separation between dev tooling and runtime platform tooling

---

## 1. Current State Analysis

### 1.1 Existing MCP Infrastructure

BitBrat has a mature MCP implementation:

**Bit Base Class** (`src/common/base-server.ts`):
- Every Bit exposes a mandatory `bit.*` control plane via SSE transport
- Support for `platform-only` and `platform+domain` exposure levels
- Universal tools: `bit.info`, `bit.health`, `bit.config.*`, `bit.flags.*`, `bit.log.level`

**Fleet Control** (`tools/brat/src/fleet/`):
- MCP **client** implementation (not server)
- Transport abstraction: `GatewayTransport` (default) and `DirectTransport` (break-glass)
- Firestore-based service registry (`mcp_servers` collection)
- Identity/RBAC with fail-closed posture

**Tool Gateway** (`src/apps/tool-gateway.ts`):
- Central MCP server aggregating all platform Bits
- Dynamic discovery via Firestore registry
- RBAC enforcement (`bit:read`, `bit:operate` scopes)

### 1.2 Target Infrastructure

**Deployment Targets** (defined in `architecture.yaml`):
```yaml
deploymentTargets:
  local:
    type: docker-engine
    host: unix:///var/run/docker.sock
    env: local
  staging:
    type: docker-engine
    host: ssh://root@bitbrat.lan
    env: staging
    remoteDir: /opt/BitBratPlatform
```

**Current --target Usage**:
- Docker commands: `brat docker up/down/logs --target <name>`
- Backup/Firestore: `brat backup export/import --target <name>`
- Fleet operations: `brat fleet list --target <name>`

**Connection Resolution** (`tools/brat/src/backup/connection.ts`):
- Maps targets to Firestore connection options
- Handles SSH tunneling for remote Docker targets
- Emulator detection and fallback logic

### 1.3 Firestore Access Patterns

**Collections in Use**:
- `events`, `events/{id}/snapshots` - Event sourcing
- `users`, `users/{userId}/routerState/{ruleId}` - User state
- `reflexes` - Reactive rules
- `configs/routingRules/rules` - Event router configuration
- `mcp_servers` - MCP service registry
- `oauth/{provider}/{identity}/token` - OAuth tokens
- `gateways/api/tokens` - API tokens (hashed)
- `tool_usage` - MCP observability logs

**Access Patterns**:
- Direct SDK usage: `getFirestore().collection('users').doc(id).get()`
- Repository pattern: Domain-specific abstractions (ReflexRepository, FirestoreUserRepo)
- Real-time: `onSnapshot` for live updates
- Transactions: Atomic read-modify-write operations

---

## 2. Proposed Architecture

### 2.1 High-Level Design

```
┌─────────────────────────────────────────────────────────────┐
│                      Coding Agent                           │
│                   (Claude Code, etc.)                       │
└─────────────────┬───────────────────────────────────────────┘
                  │ MCP stdio/SSE
                  ▼
┌─────────────────────────────────────────────────────────────┐
│           brat dev-mcp (Local MCP Server)                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │            Tool Router & Orchestrator                │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌───────────────┬──────────────┬──────────────────────┐   │
│  │  Config Tools │ Fleet Tools  │  Persistence Tools   │   │
│  │               │              │                      │   │
│  │ • config.show │ • fleet.list │ • db.collections     │   │
│  │ • validate    │ • fleet.info │ • db.query           │   │
│  │ • doctor      │ • fleet.call │ • db.get             │   │
│  │ • schema.read │ • fleet.logs │ • db.watch           │   │
│  │               │ • fleet.trace│                      │   │
│  └───────────────┴──────────────┴──────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Log Retriever (Multi-Target)              │   │
│  │  • Cloud Run: Google Cloud Logging API              │   │
│  │  • Docker: docker compose logs parsing              │   │
│  │  • Filtering, streaming, correlation lookup         │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Target Connection Manager                 │   │
│  │  • Resolves --target to connection details          │   │
│  │  • Manages SSH tunnels, port forwarding             │   │
│  │  • Connection pooling & health checks               │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────┬──────────────────┬──────────────────────────┘
                │                  │
    ┌───────────┘                  └────────────┐
    ▼                                           ▼
┌──────────────────┐                  ┌──────────────────────┐
│  Local Docker    │                  │   Remote/GCP         │
│                  │                  │                      │
│ • NATS/PubSub    │                  │ • Cloud Run          │
│ • Firestore      │                  │ • Firestore          │
│ • tool-gateway   │                  │ • Cloud Logging      │
│ • Services       │                  │ • tool-gateway       │
│ • Docker logs    │                  │ • Services           │
└──────────────────┘                  └──────────────────────┘
```

### 2.2 Core Components

#### 2.2.1 MCP Server (`tools/brat/src/dev-mcp/server.ts`)

**Responsibilities**:
- Expose MCP server via stdio (primary) and SSE (optional) transports
- Register development-focused tools organized by capability
- Route tool calls to appropriate handlers
- Manage lifecycle (startup, shutdown, connection health)

**Transport Options**:
```typescript
interface DevMcpServerOptions {
  transport: 'stdio' | 'sse';
  port?: number;              // For SSE transport
  authToken?: string;         // Optional authentication
  target?: string;            // Default deployment target
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
}
```

**CLI Integration**:
```bash
# Start stdio MCP server (for agent integration)
brat dev-mcp start

# Start SSE server (for HTTP clients)
brat dev-mcp start --transport sse --port 3100

# With explicit target
brat dev-mcp start --target staging
```

#### 2.2.2 Target Connection Manager (`tools/brat/src/dev-mcp/target-manager.ts`)

**Responsibilities**:
- Abstract connection details for different deployment targets
- Reuse existing `resolveBackupConnection()` and `DockerOrchestrator` logic
- Manage connection lifecycle (establish, health check, teardown)
- Pool connections for efficiency

**Interface**:
```typescript
interface TargetConnection {
  name: string;
  type: 'local' | 'remote-ssh' | 'gcp';
  firestore: FirestoreConnectOptions;
  gateway?: {
    url: string;
    authToken?: string;
  };
  cleanup: () => Promise<void>;
}

class TargetConnectionManager {
  async connect(targetName?: string): Promise<TargetConnection>;
  async healthCheck(connection: TargetConnection): Promise<boolean>;
  async disconnect(connection: TargetConnection): Promise<void>;
  getActive(): TargetConnection | null;
}
```

**Connection Resolution Flow**:
1. Read `architecture.yaml` `deploymentTargets`
2. Load environment config from `env/<env>/infra.yaml`
3. For SSH targets: establish tunnel, sync credentials
4. Resolve Firestore connection (emulator or production)
5. Resolve tool-gateway URL (port remapping for local Docker)
6. Return unified connection object

#### 2.2.3 Tool Categories

**A. Config & Validation Tools** (`tools/brat/src/dev-mcp/tools/config.ts`)

Expose repository structure and configuration:

```typescript
// Read architecture.yaml with resolved overlays
{
  name: "config.show",
  description: "Get resolved platform configuration including env overlays",
  inputSchema: z.object({
    target: z.string().optional(),
    redact: z.boolean().default(true)
  })
}

// Validate architecture.yaml against schema
{
  name: "config.validate",
  description: "Validate architecture.yaml against schema",
  inputSchema: z.object({
    showErrors: z.boolean().default(true)
  })
}

// Get environment prerequisites
{
  name: "config.doctor",
  description: "Check development environment prerequisites",
  inputSchema: z.object({
    checks: z.array(z.enum(['docker', 'gcloud', 'terraform', 'node'])).optional()
  })
}

// Read schema files
{
  name: "schema.read",
  description: "Read JSON schema definitions",
  inputSchema: z.object({
    schema: z.enum(['architecture', 'envelope', 'routing-rule', 'reflex'])
  })
}
```

**B. Fleet Management Tools** (`tools/brat/src/dev-mcp/tools/fleet.ts`)

Proxy to the existing fleet client:

```typescript
// List all Bits in fleet
{
  name: "fleet.list",
  description: "Enumerate all live Bits with metadata",
  inputSchema: z.object({
    target: z.string().optional()
  })
}

// Get Bit information
{
  name: "fleet.info",
  description: "Get detailed info for specific Bit(s)",
  inputSchema: z.object({
    bit: z.string().optional(), // Omit for all
    target: z.string().optional()
  })
}

// Call any bit:read scoped tool
{
  name: "fleet.call",
  description: "Invoke a bit.* control plane tool",
  inputSchema: z.object({
    bit: z.string(),
    tool: z.string(),
    args: z.record(z.any()).default({}),
    target: z.string().optional()
  })
}

// Get logs (structured query with multi-target support)
{
  name: "fleet.logs",
  description: "Retrieve logs from specific Bit(s) - supports Cloud Run (Cloud Logging) and Docker targets",
  inputSchema: z.object({
    bit: z.string().optional(),              // Omit for --all
    level: z.array(z.enum(['error', 'warn', 'info', 'debug', 'trace'])).optional(),
    since: z.string().optional(),            // ISO timestamp or duration (e.g., "1h", "30m")
    until: z.string().optional(),            // ISO timestamp (for time range queries)
    limit: z.number().default(100),
    follow: z.boolean().default(false),      // Stream logs in real-time
    correlationId: z.string().optional(),    // Filter by correlation ID (traces across services)
    target: z.string().optional(),
    format: z.enum(['json', 'text', 'raw']).default('text')
  })
}
```

**C. Persistence Tools** (`tools/brat/src/dev-mcp/tools/persistence.ts`)

Abstract Firestore operations as generic document queries:

```typescript
// List collections
{
  name: "db.collections",
  description: "List all Firestore collections",
  inputSchema: z.object({
    target: z.string().optional()
  })
}

// Query documents
{
  name: "db.query",
  description: "Query Firestore with filters",
  inputSchema: z.object({
    collection: z.string(),
    filters: z.array(z.object({
      field: z.string(),
      op: z.enum(['==', '!=', '<', '<=', '>', '>=', 'in', 'array-contains']),
      value: z.any()
    })).optional(),
    orderBy: z.array(z.object({
      field: z.string(),
      direction: z.enum(['asc', 'desc']).default('asc')
    })).optional(),
    limit: z.number().default(50),
    offset: z.number().default(0),
    target: z.string().optional()
  })
}

// Get document by ID
{
  name: "db.get",
  description: "Get a specific document",
  inputSchema: z.object({
    collection: z.string(),
    id: z.string(),
    target: z.string().optional()
  })
}

// Watch collection for changes (returns subscription ID)
{
  name: "db.watch",
  description: "Subscribe to collection changes",
  inputSchema: z.object({
    collection: z.string(),
    filters: z.array(z.object({
      field: z.string(),
      op: z.enum(['==', '!=', '<', '<=', '>', '>=', 'in', 'array-contains']),
      value: z.any()
    })).optional(),
    target: z.string().optional()
  })
}

// Unwatch subscription
{
  name: "db.unwatch",
  description: "Unsubscribe from collection changes",
  inputSchema: z.object({
    subscriptionId: z.string()
  })
}
```

**D. Development Utilities** (`tools/brat/src/dev-mcp/tools/dev-utils.ts`)

```typescript
// Read local file (within repo)
{
  name: "repo.read",
  description: "Read file from repository",
  inputSchema: z.object({
    path: z.string(),
    lines: z.object({
      start: z.number().optional(),
      end: z.number().optional()
    }).optional()
  })
}

// Search codebase
{
  name: "repo.search",
  description: "Search repository for pattern",
  inputSchema: z.object({
    pattern: z.string(),
    filePattern: z.string().optional(),
    contextLines: z.number().default(2)
  })
}

// Dry-run deployment planning
{
  name: "deploy.plan",
  description: "Preview deployment changes without applying",
  inputSchema: z.object({
    service: z.string().optional(), // Omit for all
    target: z.string().optional()
  })
}

// Version bump preview
{
  name: "release.preview",
  description: "Preview version bump without committing",
  inputSchema: z.object({
    bump: z.enum(['patch', 'minor', 'major'])
  })
}
```

### 2.3 Security & RBAC Model

**Authentication**:
- Inherit fail-closed posture from fleet client
- Token resolution order:
  1. `MCP_DEV_TOKEN` environment variable
  2. `MCP_AUTH_TOKEN` environment variable (fallback)
  3. `.secure.local` file
  4. `.env.brat` file

**Authorization**:
- All dev-mcp tools are **read-only** or **dry-run** (idempotent)
- No `bit:operate` tools exposed (no `flags.set`, `log.level`, `drain`, `shutdown`)
- Fleet calls restricted to `bit:read` scope
- Firestore queries are read-only (no writes, updates, or deletes)

**Secret Redaction**:
- Inherit server-side redaction from `bit.config.*` tools
- Never return raw `MCP_AUTH_TOKEN`, API keys, or provider secrets
- OAuth tokens returned as hashes only
- `config.show` redacts by default (opt-in `redact: false` for debugging)

**Audit Logging**:
- Log all tool invocations with:
  - Tool name and arguments
  - Target connection
  - Agent identity (if available)
  - Timestamp and duration
- Write to local log file: `.brat/dev-mcp-audit.log`

### 2.4 Fleet Logs Implementation Deep Dive

The `fleet.logs` tool is a critical observability feature that unifies log access across deployment targets. Here's the detailed implementation approach:

#### 2.4.1 Current State of Logging in BitBrat

**Log Storage**:
- All services write **structured JSON logs** to stdout/stderr
- Logs include: `ts` (timestamp), `service`, `level`, `severity`, `msg`, custom context fields
- **Cloud Run**: Logs automatically ingested by Google Cloud Logging
- **Docker**: Logs captured by Docker daemon, accessible via `docker compose logs`
- **Not stored in Firestore** (explicitly excluded from persistence)

**Existing Log Access**:
- `brat docker logs [--target] [--service] [--follow]` - Docker targets only
- `brat fleet log <bit> --level <level>` - Changes runtime log level (not retrieval)
- Manual `gcloud logging read` - Cloud Run targets (no CLI integration)

**Gaps**:
- No unified log retrieval across Cloud Run and Docker
- No correlation-ID-based trace lookup
- No fleet-wide aggregation (`--all`)
- No structured filtering by level, time range, or custom fields

#### 2.4.2 Target-Aware Log Retrieval

**Architecture**:
```typescript
class LogRetriever {
  async getLogs(request: LogRequest): Promise<LogResponse> {
    const connection = await this.targetManager.connect(request.target);

    // Determine deployment type per Bit
    const bitDeployment = await this.resolveBitDeployment(request.bit, connection);

    if (bitDeployment.type === 'cloud-run') {
      return await this.getCloudRunLogs(request, connection);
    } else if (bitDeployment.type === 'docker') {
      return await this.getDockerLogs(request, connection);
    }
  }

  private async resolveBitDeployment(bit: string, connection: TargetConnection) {
    // Query Firestore registry for Bit URL
    // Cloud Run URLs: https://*.run.app or custom domain
    // Docker URLs: http://localhost:* or http://*.bitbrat.local:*
  }
}
```

**Cloud Run Log Retrieval** (via Google Cloud Logging API):
```typescript
import { Logging } from '@google-cloud/logging';

async function getCloudRunLogs(request: LogRequest, connection: TargetConnection) {
  const logging = new Logging({ projectId: connection.projectId });

  // Build Cloud Logging filter
  const filter = [
    `resource.type="cloud_run_revision"`,
    `resource.labels.service_name="${request.bit}"`,
    request.level ? `severity>=${mapLevelToSeverity(request.level)}` : null,
    request.since ? `timestamp>="${parseSince(request.since)}"` : null,
    request.until ? `timestamp<="${request.until}"` : null,
    request.correlationId ? `jsonPayload.correlationId="${request.correlationId}"` : null
  ].filter(Boolean).join(' AND ');

  const [entries] = await logging.getEntries({
    filter,
    orderBy: 'timestamp desc',
    pageSize: request.limit
  });

  return formatLogEntries(entries, request.format);
}
```

**Docker Log Retrieval** (via Docker Compose):
```typescript
async function getDockerLogs(request: LogRequest, connection: TargetConnection) {
  const orchestrator = new DockerOrchestrator({
    target: connection.name,
    service: request.bit
  });

  const args = ['--tail', request.limit.toString()];
  if (request.follow) args.push('--follow');
  if (request.since) args.push('--since', request.since);
  if (request.until) args.push('--until', request.until);

  // Execute docker compose logs
  const output = await orchestrator.logs(request.follow, args);

  // Parse structured JSON logs
  const logs = parseDockerLogs(output);

  // Apply filters (level, correlationId)
  return filterAndFormat(logs, request);
}
```

#### 2.4.3 Correlation-Based Trace Lookup

**Purpose**: Follow a request across multiple services using `correlationId`.

```typescript
{
  name: "fleet.trace",
  description: "Trace a request across all services by correlation ID",
  inputSchema: z.object({
    correlationId: z.string(),
    target: z.string().optional(),
    format: z.enum(['json', 'text', 'timeline']).default('timeline')
  })
}
```

**Implementation**:
```typescript
async function traceByCorrelationId(correlationId: string, connection: TargetConnection) {
  // Get all Bits in fleet
  const bits = await this.fleetClient.list();

  // Query logs from each Bit in parallel
  const traces = await Promise.all(
    bits.map(bit => this.getLogs({
      bit: bit.name,
      correlationId,
      limit: 1000,
      target: connection.name
    }))
  );

  // Merge and sort by timestamp
  const allLogs = traces.flatMap(t => t.logs)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Build timeline
  return formatTimeline(allLogs);
}
```

**Example Timeline Output**:
```
Correlation ID: evt-123-456-789
Duration: 234ms

00:00:000 [ingress-egress] INFO  Event received from Twitch
00:00:012 [event-router]   INFO  Matched rule: default-llm-routing
00:00:015 [event-router]   DEBUG Attached routing slip with 3 steps
00:00:023 [llm-bot]        INFO  Processing chat message
00:00:187 [llm-bot]        DEBUG OpenAI completion took 164ms
00:00:201 [disposition]    INFO  Applied mutation: increment_message_count
00:00:234 [ingress-egress] INFO  Response sent to Twitch
```

#### 2.4.4 Real-Time Streaming

**Approach**:
- **Docker**: Use `docker compose logs --follow` with stdout parsing
- **Cloud Run**: Poll Cloud Logging API with cursor (no native streaming API)

```typescript
async function* streamLogs(request: LogRequest) {
  if (deploymentType === 'docker') {
    // Native streaming via Docker
    const stream = await orchestrator.logsStream({ follow: true });
    for await (const line of stream) {
      yield parseLogLine(line);
    }
  } else {
    // Polling-based streaming for Cloud Run
    let lastTimestamp = new Date();
    while (true) {
      const logs = await getCloudRunLogs({
        ...request,
        since: lastTimestamp.toISOString(),
        limit: 100
      });

      for (const log of logs) {
        yield log;
        lastTimestamp = new Date(log.timestamp);
      }

      await sleep(1000); // Poll every 1 second
    }
  }
}
```

#### 2.4.5 Secret Redaction in Logs

**Inherit Platform Redaction**:
- BitBrat's Logger already redacts secrets before writing to stdout
- `fleet.logs` returns logs as-is (already redacted)
- No additional redaction needed in dev-mcp layer

**Redacted Fields** (from `src/common/logging.ts`):
- Keys matching: `key|token|secret|password|authorization|cookie|auth`
- Values matching: `sk-*`, `ya29.*`, Bearer tokens, long opaque strings
- Preserved: Prefix + last 4 chars for debugging

#### 2.4.6 Performance Considerations

**Pagination**:
- Default limit: 100 logs
- Max limit: 1000 logs (configurable)
- Cursor-based pagination for large result sets

**Caching**:
- Cache log queries for 5 seconds (configurable)
- Invalidate on `follow` mode
- Per-target cache isolation

**Parallel Queries**:
- `--all` mode: Query all Bits in parallel with concurrency limit (default: 5)
- Timeout per Bit: 10 seconds
- Partial failure tolerance: Return successful results, report failures

#### 2.4.7 MCP Tool Response Format

**Text Format** (default, human-readable):
```json
{
  "content": [
    {
      "type": "text",
      "text": "Retrieved 47 log entries from llm-bot (last 1 hour)\n\n2026-07-07 12:34:56 [ERROR] Failed to connect to OpenAI: timeout\n2026-07-07 12:35:01 [INFO]  Retrying with backoff...\n2026-07-07 12:35:03 [INFO]  OpenAI connection restored\n..."
    }
  ]
}
```

**JSON Format** (structured):
```json
{
  "content": [
    {
      "type": "resource",
      "resource": {
        "uri": "logs://llm-bot?since=1h&level=error,warn",
        "mimeType": "application/json",
        "text": "[{\"timestamp\":\"2026-07-07T12:34:56Z\",\"level\":\"error\",\"service\":\"llm-bot\",\"msg\":\"Failed to connect\",\"error\":{...}}, ...]"
      }
    }
  ]
}
```

**Timeline Format** (correlation trace):
```json
{
  "content": [
    {
      "type": "text",
      "text": "Correlation ID: evt-123\nDuration: 234ms\nServices: 4\n\n00:00:000 [ingress-egress] Event received\n00:00:012 [event-router] Matched rule\n..."
    }
  ]
}
```

---

## 3. Implementation Strategy

### 3.1 File Structure

```
tools/brat/src/
├── dev-mcp/
│   ├── server.ts                    # Main MCP server
│   ├── target-manager.ts            # Target connection abstraction
│   ├── tool-router.ts               # Tool registration & dispatch
│   ├── audit-logger.ts              # Audit logging
│   ├── log-retriever.ts             # Multi-target log retrieval (Cloud Logging + Docker)
│   ├── types.ts                     # Shared types
│   ├── tools/
│   │   ├── config.ts                # Config & validation tools
│   │   ├── fleet.ts                 # Fleet management tools (includes fleet.logs, fleet.trace)
│   │   ├── persistence.ts           # Firestore abstraction tools
│   │   └── dev-utils.ts             # Development utilities
│   └── __tests__/
│       ├── server.test.ts
│       ├── target-manager.test.ts
│       ├── log-retriever.test.ts
│       └── tools/
│           ├── config.test.ts
│           ├── fleet.test.ts
│           ├── persistence.test.ts
│           └── dev-utils.test.ts
└── cli/
    └── dev-mcp.ts                   # CLI command handler
```

### 3.2 Reuse Strategy

**Maximize Code Reuse**:

1. **Fleet Client** (`tools/brat/src/fleet/fleet-client.ts`):
   - Reuse `FleetClient` for all fleet operations
   - Reuse `GatewayTransport` and `DirectTransport`
   - Reuse `resolveIdentity()` for RBAC

2. **Connection Resolution** (`tools/brat/src/backup/connection.ts`):
   - Reuse `resolveBackupConnection()` for Firestore
   - Reuse SSH tunnel logic for remote targets

3. **Configuration** (`tools/brat/src/config/loader.ts`):
   - Reuse `loadArchitecture()`, `resolveConfig()`
   - Reuse validation logic from `cmdConfig()`

4. **Docker Orchestration** (`tools/brat/src/orchestration/docker/orchestrator.ts`):
   - Reuse port remapping logic (`rewriteToLocalHostPort()`)
   - Reuse target resolution

**New Components**:
- MCP server wrapper (stdio/SSE transport setup)
- Tool registration and routing
- Persistence abstraction layer
- Audit logging

### 3.3 MCP SDK Integration

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

class DevMcpServer {
  private server: Server;
  private targetManager: TargetConnectionManager;
  private toolRouter: ToolRouter;

  constructor(options: DevMcpServerOptions) {
    this.server = new Server(
      { name: 'brat-dev-mcp', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    this.targetManager = new TargetConnectionManager(options.target);
    this.toolRouter = new ToolRouter(this.targetManager);

    this.registerHandlers();
  }

  private registerHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: this.toolRouter.listTools() };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return await this.toolRouter.callTool(
        request.params.name,
        request.params.arguments || {}
      );
    });
  }

  async start() {
    const transport = this.options.transport === 'sse'
      ? new SSEServerTransport('/message', response)
      : new StdioServerTransport();

    await this.server.connect(transport);
  }
}
```

### 3.4 Persistence Abstraction Design

**Philosophy**: Expose Firestore as generic JSON document storage, not Firebase-specific API.

**Benefits**:
- Agent doesn't need Firebase SDK knowledge
- Simpler prompts and tool calls
- Future-proof (could swap backends)
- Natural fit for LLM reasoning (JSON documents)

**Example Tool Call**:
```json
{
  "tool": "db.query",
  "arguments": {
    "collection": "reflexes",
    "filters": [
      { "field": "active", "op": "==", "value": true }
    ],
    "orderBy": [
      { "field": "priority", "direction": "asc" }
    ],
    "limit": 10
  }
}
```

**Example Response**:
```json
{
  "content": [
    {
      "type": "text",
      "text": "Found 3 documents in reflexes collection"
    },
    {
      "type": "resource",
      "resource": {
        "uri": "firestore://local/reflexes",
        "mimeType": "application/json",
        "text": "[{\"id\":\"...\",\"active\":true,\"priority\":1,...}, ...]"
      }
    }
  ]
}
```

**Implementation**:
```typescript
async function handleDbQuery(args: DbQueryArgs, connection: TargetConnection) {
  const { firestore } = connection;

  let query: FirebaseFirestore.Query = firestore.collection(args.collection);

  // Apply filters
  for (const filter of args.filters || []) {
    query = query.where(filter.field, filter.op, filter.value);
  }

  // Apply ordering
  for (const order of args.orderBy || []) {
    query = query.orderBy(order.field, order.direction);
  }

  // Apply pagination
  query = query.limit(args.limit).offset(args.offset);

  const snapshot = await query.get();
  const docs = snapshot.docs.map(doc => ({
    id: doc.id,
    ...stripUndefinedDeep(doc.data())
  }));

  return {
    content: [
      { type: 'text', text: `Found ${docs.length} documents in ${args.collection} collection` },
      {
        type: 'resource',
        resource: {
          uri: `firestore://${connection.name}/${args.collection}`,
          mimeType: 'application/json',
          text: JSON.stringify(docs, null, 2)
        }
      }
    ]
  };
}
```

---

## 4. Agent Integration Patterns

### 4.1 Claude Code Integration

**MCP Configuration** (`.claude/mcp.json` or global config):
```json
{
  "mcpServers": {
    "bitbrat-dev": {
      "command": "npm",
      "args": ["run", "brat", "--", "dev-mcp", "start"],
      "env": {
        "MCP_DEV_TOKEN": "${MCP_AUTH_TOKEN}",
        "BITBRAT_TARGET": "local"
      }
    }
  }
}
```

**Alternative: Explicit Target**:
```json
{
  "mcpServers": {
    "bitbrat-staging": {
      "command": "npm",
      "args": ["run", "brat", "--", "dev-mcp", "start", "--target", "staging"]
    }
  }
}
```

### 4.2 Example Agent Workflows

**Workflow 1: Debugging a Service**
```
Agent: "Check if llm-bot is healthy"
→ fleet.list
→ fleet.info { bit: "llm-bot" }
→ fleet.call { bit: "llm-bot", tool: "bit.health" }

Agent: "Check its configuration"
→ fleet.call { bit: "llm-bot", tool: "bit.config.get" }

Agent: "See recent errors"
→ fleet.logs { bit: "llm-bot", level: "error", limit: 50 }
```

**Workflow 2: Understanding Event Flow**
```
Agent: "Show me recent events for user xyz"
→ db.query {
    collection: "events",
    filters: [{ field: "identity.external.id", op: "==", value: "xyz" }],
    orderBy: [{ field: "ingress.ingressAt", direction: "desc" }],
    limit: 10
  }

Agent: "Get the full event aggregate"
→ db.get { collection: "events", id: "<correlationId>" }
→ db.query {
    collection: "events/<correlationId>/snapshots",
    orderBy: [{ field: "snapshotId", direction: "asc" }]
  }
```

**Workflow 3: Validating a Configuration Change**
```
Agent: "I want to add a new service. Let me validate first."
→ schema.read { schema: "architecture" }
→ config.validate

Agent: "What's the current structure?"
→ config.show

Agent: "Looks good. What would deployment look like?"
→ deploy.plan { service: "new-service" }
```

**Workflow 4: Investigating Routing Rules**
```
Agent: "Show me all active routing rules"
→ db.query {
    collection: "configs/routingRules/rules",
    filters: [{ field: "enabled", op: "==", value: true }],
    orderBy: [{ field: "priority", direction: "asc" }]
  }

Agent: "Get the details of rule X"
→ db.get { collection: "configs/routingRules/rules", id: "X" }
```

---

## 5. Comparison with Existing Plan

The existing execution plan (`planning/mcp-dev-tooling/execution-plan.md`) focuses on:
- Wrapping individual `brat` CLI commands as MCP tools
- Exposing tools through the platform's `tool-gateway`
- Agent consumes tools via the platform's MCP infrastructure

**Key Differences in This Proposal**:

| Aspect | Existing Plan | This Proposal |
|--------|---------------|---------------|
| **Architecture** | Platform-hosted tools via tool-gateway | Standalone local MCP server in brat CLI |
| **Transport** | Agent → tool-gateway SSE | Agent → brat MCP stdio/SSE |
| **Target Flexibility** | Single target per gateway | Multi-target via --target flag |
| **Connection Model** | Always via platform fabric | Direct connection (bypasses message bus) |
| **Persistence Access** | Limited (via specific tools) | Full abstract query layer |
| **Deployment** | Requires platform running | Works offline (reads repo/config) |
| **Use Case** | Platform introspection | Development workflow support |

**Complementary Approaches**:
Both approaches have value:
- **Existing plan**: Runtime observability, production diagnostics
- **This proposal**: Development workflow, local testing, multi-environment management

**Recommendation**: Implement both, but phase this proposal first as it:
1. Doesn't require platform changes (pure CLI tooling)
2. Works offline (crucial for local dev)
3. Provides foundation for the gateway-based approach
4. Lower complexity (no platform coordination)

---

## 6. Advantages & Trade-offs

### 6.1 Advantages

**1. Environment Flexibility**
- Single agent configuration works across all deployment targets
- Switch environments with `--target` flag or environment variable
- No need to reconfigure agent per environment

**2. Offline Capability**
- Many tools work without platform running (config, schema, repo access)
- Essential for early development and troubleshooting

**3. Simplified Agent Integration**
- Standard MCP stdio transport (no SSE complexity)
- Single server, all tools in one namespace
- Natural fit for coding agents like Claude Code

**4. Development Velocity**
- Abstract Firestore queries (no Firebase SDK knowledge)
- Unified access to fleet, config, and data
- Dry-run planning built-in

**5. Future-Proof Abstraction**
- Persistence layer could swap backends
- Target types can expand (k8s, etc.)
- Tool categories can grow organically

**6. Security by Design**
- Read-only by default
- Fail-closed authentication
- Audit logging built-in
- Server-side redaction inherited

### 6.2 Trade-offs

**1. Code Duplication Risk**
- Some tools overlap with existing `brat` commands
- **Mitigation**: Reuse existing implementations, wrap don't rewrite

**2. Maintenance Burden**
- Another MCP server to maintain
- **Mitigation**: Leverage existing fleet/connection infrastructure

**3. Consistency Challenge**
- Tools must behave identically across targets
- **Mitigation**: Comprehensive integration tests, target parity assertions

**4. Limited Write Operations**
- Intentionally read-only, no state mutations
- **Mitigation**: This is by design for safety; mutations stay human-initiated

**5. Not Real-Time**
- Polling-based for most operations (vs. platform's message bus)
- **Mitigation**: `db.watch` provides subscriptions where needed

### 6.3 Future Enhancements

**Phase 2 Additions**:
1. **Structured Log Queries**: `logs.query` with correlation ID tracing
2. **Message Bus Inspection**: Read-only pub/sub topic inspection
3. **Resource Provisioning**: Dry-run for infrastructure changes
4. **Performance Profiling**: Aggregate timing/stats from tool_usage collection
5. **Reflex/Rule Testing**: Evaluate JsonLogic rules against test events

**Integration Opportunities**:
- Bridge to existing `tool-gateway` for runtime tools
- Hybrid mode: static tools local, runtime tools via gateway
- MCP-to-MCP proxy for advanced routing

---

## 7. Success Criteria

**Must Have (P0)**:
- [ ] MCP server starts successfully via `brat dev-mcp start`
- [ ] All config tools work offline (no platform required)
- [ ] Fleet tools connect to local, remote SSH, and GCP targets
- [ ] Persistence tools provide read-only Firestore access
- [ ] All tools fail closed without authentication
- [ ] Secrets are redacted in all tool responses
- [ ] Comprehensive test coverage (>80%)

**Should Have (P1)**:
- [ ] Audit logging captures all tool invocations
- [ ] SSE transport option for HTTP clients
- [ ] Connection pooling for efficiency
- [ ] Health checks for target connections
- [ ] Multi-target log retrieval (fleet.logs)
  - [ ] Cloud Run logs via Cloud Logging API
  - [ ] Docker logs via docker compose
  - [ ] Log filtering, streaming, correlation lookup
- [ ] Correlation-based tracing (fleet.trace)
- [ ] Dry-run planning tools (deploy, release)
- [ ] Repository search and read tools

**Could Have (P2)**:
- [ ] Real-time Firestore subscriptions (`db.watch`)
- [ ] Log aggregation and search
- [ ] MCP prompts for common workflows
- [ ] Configuration templates via prompts

**Quality Gates**:
1. All tools tested against all three target types
2. No tool can mutate platform state (asserted)
3. Redaction tests pass (no secret leaks)
4. Fail-closed tests pass (no anonymous access)
5. Documentation complete (tool reference, integration guide)

---

## 8. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Connection complexity for SSH targets | Medium | Medium | Reuse proven `resolveBackupConnection()` logic; comprehensive integration tests |
| Firestore query performance | Low | Medium | Implement query limits, pagination; add caching layer if needed |
| Tool API instability (MCP SDK) | Low | High | Pin MCP SDK version; abstract transport layer |
| Security: accidental write operations | Low | High | Comprehensive read-only assertions; code review focus |
| Port conflicts (SSE mode) | Medium | Low | Configurable port; error message guidance |
| Agent timeout on slow queries | Medium | Medium | Implement timeouts; streaming responses for large results |
| Cloud Logging API quota limits | Medium | Medium | Implement rate limiting, caching; use batch queries where possible |
| Log parsing inconsistency (Docker vs Cloud Run) | Low | Medium | Normalize log format in retriever layer; comprehensive test coverage |
| Real-time streaming performance | Medium | Low | Use polling with configurable intervals; document limitations |

---

## 9. Open Questions & Decisions Needed

**Q1: Should we support write operations in persistence tools?**
- **Recommendation**: No. Keep strictly read-only for safety. Mutations via existing `brat` commands.

**Q2: How to handle long-running operations (e.g., large Firestore queries)?**
- **Recommendation**: Streaming responses (multiple `content` blocks), implement timeouts, add pagination.

**Q3: Should we bridge to the platform's `tool-gateway` for runtime tools?**
- **Recommendation**: Phase 2. Start standalone, add gateway bridging later for hybrid mode.

**Q4: Authentication: separate token for dev-mcp or reuse MCP_AUTH_TOKEN?**
- **Recommendation**: Reuse `MCP_AUTH_TOKEN` by default, allow override with `MCP_DEV_TOKEN` for isolation.

**Q5: How to handle target switching during a session?**
- **Recommendation**: Make `target` a parameter on all tools; connection manager caches per target.

**Q6: Should tools expose raw Firestore paths or collection aliases?**
- **Recommendation**: Support both. Aliases for common collections (`events`, `users`), raw paths for flexibility.

---

## 10. Recommendations

### 10.1 Phased Approach

**Phase 1: Foundation** (Sprint 333)
- Implement MCP server with stdio transport
- Build target connection manager (reuse existing code)
- Implement config tools (config.show, config.validate, doctor, schema.read)
- Basic fleet tools (fleet.list, fleet.info)
- Simple persistence tools (db.collections, db.get, db.query)
- Comprehensive testing and documentation

**Phase 2: Enhanced Capabilities** (Sprint 334)
- Add SSE transport option
- Implement fleet.call for dynamic tool invocation
- **Add fleet.logs for multi-target log retrieval**
  - Cloud Run integration via Google Cloud Logging API
  - Docker integration via docker compose logs
  - Support for filtering, streaming, correlation-based lookup
- **Add fleet.trace for correlation-based tracing**
  - Cross-service request tracking
  - Timeline visualization
- Implement db.watch for real-time subscriptions
- Add dev utilities (repo.read, repo.search)

**Phase 3: Planning & Analysis** (Sprint 335)
- Implement deploy.plan and release.preview
- Add structured log queries
- Performance profiling tools
- Integration with existing tool-gateway (hybrid mode)

### 10.2 Technical Decisions

**Decision 1: Transport Priority**
- **Primary**: stdio (standard MCP agent integration)
- **Secondary**: SSE (for browser/HTTP clients)

**Decision 2: Code Reuse Strategy**
- Maximize reuse of `fleet/`, `backup/`, `config/` modules
- Wrap, don't rewrite, existing CLI implementations
- Extract shared connection logic to `dev-mcp/target-manager.ts`

**Decision 3: Persistence Abstraction**
- Expose generic document query interface (not Firebase-specific)
- Support both simple (get by ID) and complex (filter, order, paginate) queries
- Return JSON documents with metadata (collection, ID, timestamps)

**Decision 4: Security Posture**
- All tools read-only by default
- Fail-closed authentication (no token = refuse)
- Inherit server-side redaction from platform
- Comprehensive audit logging

**Decision 5: Testing Strategy**
- Unit tests for each tool category
- Integration tests for target connection (mock SSH, Firestore)
- End-to-end tests with real local Docker target
- Assertion suite for read-only, fail-closed, redaction

### 10.3 Expansion Opportunities

**Beyond BitBrat Development**:
1. **Generic MCP Dev Server Pattern**: Extract reusable framework for other projects
2. **Multi-Platform Support**: Adapt for Kubernetes, Docker Swarm, bare metal
3. **Enhanced Observability**: Distributed tracing, metrics aggregation
4. **AI-Assisted Debugging**: Correlation analysis, anomaly detection
5. **Configuration Management**: Template generation, validation, diff tools

---

## 11. Conclusion

This technical architecture proposes a **local development MCP server** integrated into the `brat` CLI that provides:

✅ **Unified Access**: Single MCP server for all development tooling
✅ **Multi-Environment**: Works across local Docker, remote Docker, and GCP
✅ **Persistence Abstraction**: Generic document queries, not Firebase-specific
✅ **Security by Design**: Read-only, fail-closed, audited
✅ **Agent-Friendly**: Standard stdio transport, rich tool set
✅ **Code Reuse**: Leverages existing fleet, config, and connection infrastructure

The architecture complements the existing plan (`planning/mcp-dev-tooling/execution-plan.md`) by focusing on **local development workflow** rather than **platform runtime observability**. Both approaches have merit and can coexist.

**Recommendation**: Proceed with **Phase 1** implementation (Sprint 333) to validate the architecture and deliver immediate value to development workflows.

---

## Appendix A: Tool Reference Summary

### Config & Validation (6 tools)
- `config.show` - Resolved configuration with overlays
- `config.validate` - Schema validation
- `config.doctor` - Environment prerequisites
- `schema.read` - Read schema definitions

### Fleet Management (5 tools)
- `fleet.list` - Enumerate all Bits
- `fleet.info` - Detailed Bit metadata
- `fleet.call` - Invoke bit.* control plane tools
- `fleet.logs` - Retrieve/stream logs from Bit(s) with filtering (Cloud Run + Docker)
- `fleet.trace` - Trace request across services by correlation ID

### Persistence (5 tools)
- `db.collections` - List Firestore collections
- `db.query` - Query with filters, ordering, pagination
- `db.get` - Get document by ID
- `db.watch` - Subscribe to changes
- `db.unwatch` - Unsubscribe

### Development Utilities (4 tools)
- `repo.read` - Read repository files
- `repo.search` - Search codebase
- `deploy.plan` - Preview deployment
- `release.preview` - Preview version bump

**Total: 20 tools** (Phase 1: 13, Phase 2: 7)

**Note**: `fleet.logs` and `fleet.trace` are marked for Phase 2 due to the complexity of multi-target log retrieval and Cloud Logging API integration. Phase 1 will focus on config, basic fleet management, and persistence tools.

---

## Appendix B: Related Documentation

- `CLAUDE.md` - Project instructions and development guidelines
- `AGENTS.md` - LLM collaboration protocol
- `architecture.yaml` - System configuration (single source of truth)
- `documentation/concepts/bit-model.md` - Bit abstraction
- `documentation/reference/bit-control-plane.md` - Universal bit.* tools
- `documentation/guides/brat-fleet.md` - Fleet administration
- `tools/brat/README.md` - Brat CLI documentation
- `planning/mcp-dev-tooling/execution-plan.md` - Existing MCP tooling plan
