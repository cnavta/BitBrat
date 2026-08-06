# Implementation Plan – sprint-290-a1b2c3

## Objective
- Allow per-MCP server resilience settings (`timeoutMs`, `failureThreshold`, `resetTimeoutMs`) to be specified in the MCP server's Firestore document.

## Scope
- `McpServerConfig` interface update.
- `ProxyInvoker` update to support per-call option overrides.
- `McpBridge` update to pass server-specific options from its configuration to `ProxyInvoker`.
- `RegistryWatcher` naturally supports new fields as it spreads Firestore data into `McpServerConfig`.

## Deliverables
- Code changes in `src/common/mcp/types.ts`
- Code changes in `src/common/mcp/proxy-invoker.ts`
- Code changes in `src/common/mcp/bridge.ts`
- Unit tests verifying the override behavior.
- `validate_deliverable.sh` script.

## Acceptance Criteria
- `ProxyInvoker` uses values from Firestore if present in the `mcp_servers` collection.
- `ProxyInvoker` falls back to global defaults if Firestore values are missing.
- Circuit breaker state is tracked correctly using the server-specific `failureThreshold` and `resetTimeoutMs`.
- Tool/Resource/Prompt calls honor the server-specific `timeoutMs`.

## Testing Strategy
- Mock `Client` and `ProxyInvokerOptions`.
- Unit tests for `ProxyInvoker` verifying that passing `ProxyInvokerOptions` to `invoke`, `invokeResource`, and `invokePrompt` overrides constructor defaults.
- Integration-level unit test (mocked) for `McpBridge` verifying it correctly extracts options from its internal state and passes them to `invoker`.

## Deployment Approach
- Standard Cloud Run deployment via Cloud Build.
- Configuration is driven by Firestore, so no environment variable changes are needed for the tool-gateway itself.

## Dependencies
- Firebase Firestore (existing).
- `@modelcontextprotocol/sdk` (existing).

## Definition of Done
- Code adheres to project standards.
- Tests pass (`npm test`).
- `validate_deliverable.sh` passes.
- PR created.
