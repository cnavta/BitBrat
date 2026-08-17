# Execution Plan – Tool Gateway Service (sprint-257-a1b2c3)

This execution plan breaks down the Technical Architecture into actionable implementation phases.

## Phase 1: Foundation & Shared Components
*Goal: Prepare the codebase for reuse and establish the basic service shell.*
- **1.1 Refactor MCP Common**: Extract `McpClientManager` and `McpBridge` from `src/services/llm-bot/mcp/` to `src/common/mcp/` to enable sharing between `llm-bot` and `tool-gateway`.
- **1.2 Tool Gateway Shell**: Initialize `src/apps/tool-gateway.ts` extending `McpServer`.
- **1.3 Identity & Auth Middleware**: Implement JWT validation and `x-agent-name` extraction for the gateway.

## Phase 2: Registry Watcher & Discovery
*Goal: Enable the gateway to discover and connect to upstream MCP servers.*
- **2.1 Firestore Watcher**: Implement `RegistryWatcher` using Firestore snapshots on the `mcp_servers` collection.
- **2.2 Connection Management**: Integrate `McpClientManager` with `RegistryWatcher` to maintain active connections to upstream servers.
- **2.3 Tool/Resource Mapping**: Adapt `McpBridge` to handle namespacing (prefixes) and metadata enrichment for the gateway's internal registry.

## Phase 3: Session-Scoped MCP Server
*Goal: Implement the dynamic, filtered view of tools for agents.*
- **3.1 Session Directory**: Implement a way to track per-connection metadata (user, roles, agent).
- **3.2 RBAC Evaluator**: Implement the logic to filter tools/resources based on `requiredRoles` and `agentAllowlist`.
- **3.3 Per-Connection Server Instances**: Extend `McpServer` to support spawning and managing a unique `Server` instance per SSE connection, filtered by the session's RBAC.

## Phase 4: Invocation Proxy
*Goal: Route agent requests to the correct upstream servers.*
- **4.1 Proxy Invoker**: Implement the logic to look up the origin server for an incoming tool call and delegate it to the corresponding internal `Client`.
- **4.2 Timeout & Circuit Breaking**: Add resilience patterns to the proxy calls.
- **4.3 Result Streaming**: Ensure tool results and resource contents are correctly passed back through the gateway.

## Phase 5: Non-Agent HTTP Proxy
*Goal: Expose tools to non-MCP consumers via REST.*
- **5.1 Tool Listing Endpoint**: `GET /v1/tools` with RBAC filtering.
- **5.2 Tool Invocation Endpoint**: `POST /v1/tools/{toolId}`.
- **5.3 Resource Access Endpoint**: `GET /v1/resources?uri={uri}`.

## Phase 6: Observability & Hardening
*Goal: Add production-grade monitoring and audit trails.*
- **6.1 Metrics Integration**: Add OTel histograms for tool latency and counters for calls/errors.
- **6.2 Audit Logging**: Implement immutable `tool_usage` writes to Firestore.
- **6.3 Secret Propagation**: Securely propagate `env` secrets from `mcp_servers` to upstream clients using Secret Manager references.

## Phase 7: Validation & Rollout
*Goal: Ensure everything works as expected and migrate users.*
- **7.1 Integration Test Suite**: End-to-end test with a mock upstream server.
- **7.2 Load Testing**: Verify the gateway handles multiple concurrent SSE sessions and proxy calls.
- **7.3 Migration Execution**: Update `llm-bot` to point to the Tool Gateway.
