# Technical Architecture: Tool Gateway Service (sprint-257-a1b2c3)

## 1. Objectives & Scope
The Tool Gateway is a centralized, multi-tenant MCP server for the BitBrat Platform. It:
- Manages the lifecycle and registry of all upstream MCP servers in the platform (authoritative owner of the `mcp_servers` Firestore collection).
- Serves as the default MCP endpoint pre-configured for all LLM agents.
- Dynamically exposes tools, resources, and prompts to agents based on the current event user’s roles and the requesting agent’s identity.
- Maintains observability metrics for discovery, tool invocations, latency, and errors across all upstream MCP servers and the gateway itself.
- Exposes a simple HTTP proxy for non-agent consumers to invoke registered tools and read resources without speaking MCP directly (RBAC enforced).

Out of scope for this sprint:
- UI/console for MCP server administration.
- Full refactor/migration of existing services (we’ll integrate incrementally).

## 2. Architecture Overview

High-level design:
- Agents connect to the Tool Gateway via MCP SSE (`/sse` + `/message`).
- The Tool Gateway watches the Firestore `mcp_servers` collection for server definitions and health status and maintains internal MCP client connections to each active upstream server (stdio or SSE), discovering available tools/resources/prompts.
- For each upstream tool/resource/prompt, the gateway registers a "virtual" counterpart under its own MCP server namespace with RBAC metadata and routing affinity to the source server.
- When an agent calls a tool, the gateway proxies the call to the correct upstream MCP server (via its internal MCP client) and streams the result back to the agent.
- For non-agent consumers, the gateway offers REST-style proxy endpoints to call tools and read resources, applying the same RBAC policies.

Key properties:
- Centralized policy enforcement and observability.
- Hot-pluggable/multi-tenant: new MCP servers appear immediately via Firestore watch.
- Session-aware filtering: exposed capabilities are filtered per connection by user role and agent identity.

## 3. Service Composition & Reuse

Base classes and existing components:
- Inherit from `McpServer` (which extends `BaseServer`) to leverage established MCP SSE routing (`/sse`, `/message`) and request tracing (`traceMcpOperation`).
- Reuse and adapt `McpClientManager` and `McpBridge` (currently used by `llm-bot`) to manage upstream client connections and translate tools/resources/prompts into the gateway’s internal registry.
  - If needed, extract `McpClientManager` and `McpBridge` into `src/common/` for shared use.

Resulting class sketch:
```ts
// src/apps/tool-gateway.ts
class ToolGatewayServer extends McpServer {
  private readonly registryWatcher: RegistryWatcher;
  private readonly rbac: RbacEvaluator;
  private readonly proxy: ProxyInvoker; // wraps internal MCP client calls
  private readonly sessions: SessionDirectory; // per-connection metadata (user, roles, agent)

  constructor() {
    super({ serviceName: 'tool-gateway' });
    this.setupIdentityAndSessionHooks();
    this.registryWatcher = new RegistryWatcher(this, this.proxy, this.rbac);
    this.registryWatcher.start();
    this.setupNonAgentHttpProxy();
  }
}
```

## 4. Identity, AuthN/Z, and Session Scoping

### 4.1 Authentication (Inbound to Gateway)
- MCP SSE endpoints continue to accept `MCP_AUTH_TOKEN` via `x-mcp-token` or `?token=` for platform-internal automation.
- For agent connections and non-agent HTTP proxy calls, support JWT/OIDC via `Authorization: Bearer` headers validated against the platform Auth service.
- Capture `x-agent-name` and optional `x-session-id` headers to enrich session context.

### 4.2 Session Context
- On `/sse` connection, derive a `sessionId` (transport-provided). Bind this to:
  - userId, tenantId, roles[] (from JWT)
  - agentName (from header)
  - allowed tool/resource sets computed via RBAC at connect time and updated on changes (role changes or registry updates).

### 4.3 Authorization / RBAC
- RBAC policy sources:
  - `requiredRoles` from upstream MCP server config
  - Optional tool-level metadata (via upstream tags or Firestore overrides)
  - Agent allow/deny lists per server/tool (e.g., `agentAllowlist`)
  - Tenant scoping rules
- Evaluation points:
  - Discovery time: only register tools/resources into a session’s view if the session satisfies RBAC
  - Invocation time: re-check RBAC (defense-in-depth) before proxying the tool/resource call
- Policy engine: start with a simple role/agentName predicate set. Optionally leverage existing JsonLogic capabilities in the platform for complex policies.

## 5. Firestore Data Model (`mcp_servers` owner: tool-gateway)

Collection: `mcp_servers` (document ID = server name or UUID)
```json
{
  "name": "obs-mcp",                      // human-readable/server id
  "transport": "sse" | "stdio",         
  "url": "https://obs.example/sse",      // for SSE servers
  "command": "node",                      // for stdio servers
  "args": ["dist/apps/obs-mcp.js"],
  "env": { "x-mcp-token": "${SECRET}" }, // propagated as headers/env to upstream
  "status": "active" | "inactive",
  "requiredRoles": ["obs:control"],       // server-wide requirement
  "agentAllowlist": ["llm-bot", "ops-bot"],
  "toolPrefix": "obs:",                   // optional namespacing at gateway
  "resourceScopes": {                      // optional per-resource RBAC overrides
    "obs://scene/current": { "roles": ["obs:read"] }
  },
  "tags": ["prod", "critical"],
  "lastSeen": 1730000000000,
  "health": { "state": "ok", "message": "..." },
  "metrics": { "avgLatencyMs": 20 },
  "error": { "code": "ECONN", "at": 1730000000001 }
}
```
Indexes:
- Composite on `status + name`
- Filters by `tags` (array-contains) if used for environments

Additional collections for observability:
- `tool_usage` (append-only)
  - fields: `ts`, `userId`, `agent`, `tool`, `server`, `durationMs`, `status`, `errorCode?`
- `tool_errors` (append-only)

## 6. Discovery, Registry, and Proxying

### 6.1 Upstream Discovery
- `RegistryWatcher` subscribes to `mcp_servers` snapshot changes and calls `McpClientManager.connectServer()` / `.disconnectServer()` accordingly.
- On connection success, perform `client.listTools`, `client.listResources`, `client.listPrompts` and translate them into gateway-registered items via `McpBridge`.
  - Add gateway-specific metadata (origin server, RBAC hints, tool prefix) to the internal registry entries.

### 6.2 Session-Scoped Exposure
- For MCP discovery responses (listTools/resources/prompts), the gateway must present a filtered view per session.
- Implementation approach A (recommended for simplicity): one `Server` instance per active SSE connection scoped to that session’s allowed registry view. The base `McpServer` class will be extended to support per-connection `Server` instantiation.
- Implementation approach B: maintain a global `Server` but inject session context into handlers (requires SDK support or custom transport hooks). This is more complex and brittle.

### 6.3 Invocation Proxy
- When a tool is invoked, look up `originServer` and `originName` in the registry entry and delegate to the internal `Client` via `ProxyInvoker`.
- Enforce a per-tool timeout and circuit breaker (e.g., retry policy, backoff) to protect the gateway.
- Record metrics and structured logs around each call.

## 7. Non-Agent HTTP Proxy

Exposed endpoints (all RBAC+Auth enforced; rate-limited):
- `POST /v1/tools/{toolId}` — body: `{ args: any }` → result: MCP `CallToolResult`
- `GET /v1/resources?uri={encodedUri}` → result: MCP `ReadResourceResult`
- `GET /v1/tools` → filtered list matching caller’s RBAC

Header conventions:
- `Authorization: Bearer <JWT>`
- `x-agent-name: <consumer-id>` (if applicable for policy)

## 8. Observability & Telemetry

Metrics (OpenTelemetry + Cloud Monitoring):
- `mcp.gateway.sessions_active`
- `mcp.gateway.upstream_servers_active`
- `mcp.gateway.discovery_duration_ms` (per server)
- `mcp.gateway.tool_calls_total{tool,server,status}`
- `mcp.gateway.tool_call_duration_ms{tool,server}` (histogram)
- `mcp.gateway.errors_total{code}`
- `mcp.gateway.upstream_latency_ms{server}`
- `mcp.gateway.registry_count{server}`

Logs (structured, via BaseServer logger):
- `mcp_gateway.sse_connection`, `mcp_gateway.list_tools`, `mcp_gateway.tool_invocation`, `mcp_gateway.proxy_error`, `mcp_gateway.upstream_connect`.

Traces:
- Wrap discovery and each tool/resource invocation with `traceMcpOperation` spans.

## 9. Security Considerations
- Strict validation of JWTs; short-lived tokens preferred.
- Do not store upstream secrets in Firestore directly; store references (e.g., Secret Manager) or encrypted blobs.
- Propagate only necessary headers to upstream servers.
- Enforce rate limiting and per-tenant quotas on proxy endpoints.
- Audit: write an immutable `tool_usage` record for every invocation (user, agent, tool, server, latency, status).

## 10. Scaling & Resilience
- Stateless compute (Cloud Run) with Firestore watch for registry changes. Multiple instances can run concurrently; deduplicate via idempotent registry updates.
- SSE requires connection stickiness per instance; Cloud Run will maintain long-lived responses, but the gateway must tolerate disconnects and resume.
- Backpressure and circuit breakers to protect upstream servers.
- Health endpoints and readiness checks (fail open for discovery, fail closed for invocation if RBAC/identity missing).

## 11. Deployment & Ingress
- `architecture.yaml` already registers `tool-gateway` with entry `src/apps/tool-gateway.ts`.
- Expose MCP SSE and proxy endpoints via the internal load balancer/service mesh; optionally surface proxy routes through the main external load balancer under `/tools/*` with Auth enforced.
- Environment variables:
  - `MCP_AUTH_TOKEN` (for internal automation)
  - `AUTH_JWKS_URL` / `AUTH_ISSUER`
  - `PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`

## 12. Migration Plan
1. Transfer formal ownership of `mcp_servers` collection to Tool Gateway. Update any writers to call the gateway’s admin API.
2. Update agent configuration to point MCP client connections to the Tool Gateway SSE endpoint.
3. Incrementally register existing servers (e.g., `obs-mcp`) in `mcp_servers`.
4. Validate RBAC filters with a test matrix (roles × agents × tools).
5. Enable non-agent HTTP proxy gradually per consumer team.

## 13. Open Questions & Risks
- Session-scoped `Server` instances vs global: choose A for near-term simplicity.
- Upstream server secrets handling: adopt Secret Manager references.
- Tool ID namespacing collisions: recommend `toolPrefix` enforcement and validation.
- Per-tenant segregation: require tenantId in JWT and scope registry accordingly.

## 14. Acceptance Criteria Traceability
- Central registry ownership: Section 5.
- Agent pre-configuration: Sections 2, 11, 12.
- Role- and agent-scoped exposure: Sections 4, 6.
- Observability: Section 8.
- Non-agent proxy: Section 7.

## 15. Appendices
### A. Example Server Registration (Firestore)
```json
{
  "name": "obs-mcp",
  "transport": "sse",
  "url": "https://tool-gateway.internal/obs/sse",
  "env": { "x-mcp-token": "${OBS_MCP_TOKEN}" },
  "status": "active",
  "requiredRoles": ["obs:read", "obs:control"],
  "agentAllowlist": ["llm-bot"],
  "toolPrefix": "obs:"
}
```

### B. Example Non-Agent Tool Call
```
POST /v1/tools/obs:list_scenes
Authorization: Bearer eyJ...
{
  "args": {}
}
```
