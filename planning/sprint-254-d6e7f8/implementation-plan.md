# Implementation Plan – sprint-254-d6e7f8 (Technical Architecture)

## Objective
Enable `tool-gateway` to perform dynamic user-based RBAC checks for each tool/resource invocation within a shared MCP session, rather than relying on session-level credentials.

## Current Architecture Problem
1. **Session-Scoped RBAC:** `tool-gateway` extracts user roles once during the SSE connection handshake.
2. **Fixed Context:** These roles are captured in closure-based request handlers for `listTools`, `callTool`, etc.
3. **Shared Sessions:** The `llm-bot-service` uses a single long-lived session for all user requests, causing the gateway to only see the bot's own service roles.
4. **Information Gap:** The MCP standard doesn't natively carry "per-request user context" in its basic request schemas.

## Proposed Technical Architecture

### 1. Enhanced `tool-gateway` Request Handling
The `tool-gateway` will be modified to support dynamic context extraction.

- **Dynamic RBAC Evaluation:** The `RbacEvaluator` will be invoked with a context derived from the specific MCP request if available, falling back to the session context.
- **Context Injection via MCP `_meta`:** Since standard MCP requests (like `callTool`) don't have a `userId` or `roles` field, we will utilize the `_meta` field or standardized parameter wrappers to pass user context from the `llm-bot`.
- **Stateless Verification:** The gateway should verify the passed context (e.g., via a signed JWT or internal service token) to prevent escalation if possible, though for internal trusted traffic, header-based propagation is the baseline.

### 2. `llm-bot` Context Propagation
The `llm-bot` is the source of truth for the *current user* of a specific event.

- **Processor Update:** In `src/services/llm-bot/processor.ts`, when calling tools through the `tool-gateway` (via `McpBridge`), it must pass the `userRoles` and `userId` from the `InternalEventV2`.
- **Bridge Enhancement:** `McpBridge` currently receives a `context` object in its `execute` function. We need to ensure this context is properly forwarded to the MCP server.

### 3. Protocol Evolution
- **Option A (Metadata):** Pass user context in the `_meta` field of the MCP request.
- **Option B (Parameter Wrapping):** Include `_userContext` as an argument to tool calls.
- **Option C (Header Injection):** (SSE specific) Inject headers into the `POST /message` requests. Note: `tool-gateway` needs to associate these headers with the specific request being processed.

**Recommendation:** Use **Option A (Metadata)** for general MCP requests and **Option C (Headers)** for SSE messages where the SDK allows.

## Deliverables
- `src/apps/tool-gateway.ts`: Updated to check `_meta` or headers for per-request roles.
- `src/common/mcp/bridge.ts`: Updated to forward user context from `BitBratTool` execution context into the MCP request.
- `src/services/llm-bot/processor.ts`: Ensure user roles from the event are passed into the tool execution context.

## Acceptance Criteria
- `tool-gateway` correctly denies tool calls if the *user's* roles (passed in the request) don't match the tool's `requiredRoles`, even if the *bot's* session has those roles.
- `tool-gateway` allows tool calls if the *user's* roles match, even if the session was established with minimal roles.
- `listTools` still shows tools based on the session (as listTools is usually call-once at startup), but `callTool` enforces dynamic RBAC.

## Testing Strategy
1. **Unit Tests:** Mock `InternalEventV2` with various roles and verify `llm-bot` passes them to the gateway.
2. **Integration Test:** Spin up `tool-gateway` and a mock MCP server. Use a client to call a tool twice with different `_meta` roles and verify RBAC enforcement.

## Definition of Done
- All changes implemented and verified.
- `validate_deliverable.sh` passes.
- PR created.
