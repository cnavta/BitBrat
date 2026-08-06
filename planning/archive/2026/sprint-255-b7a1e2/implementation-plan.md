# Implementation Plan - sprint-255-b7a1e2

## Objective
Resolve the issue where `llm-bot` only discovers a limited subset of tools (4) from the `tool-gateway`, preventing users with sufficient roles from accessing tools they should be able to use.

## Root Cause Analysis
The `tool-gateway` filters its discovery responses (`listTools`, `listResources`, `listPrompts`) based on the **session context** (the credentials used by the `llm-bot` to connect). Since the `llm-bot` connects with service-level credentials that don't have all user roles, it only "sees" and registers a few default tools.

While `callTool` was made dynamic in sprint-254, discovery remains static and restricted to the session.

## Proposed Changes

### 1. `src/apps/tool-gateway.ts`
Modify the discovery handlers (`ListToolsRequestSchema`, `ListResourcesRequestSchema`, `ListPromptsRequestSchema`) to allow listing all tools if the requesting agent is a trusted service (e.g., `llm-bot`) or has a specific `discovery` role.

Logic:
```typescript
const isDiscoveryAuthorized = context.roles.includes('discovery') || context.agentName === 'llm-bot';
const tools = Object.values(this.registry.getTools())
  .filter((t) => isDiscoveryAuthorized || this.rbac.isAllowedTool(t, ..., context))
```

### 2. `src/common/mcp/rbac.ts`
(Optional) Add a dedicated `isAllowedDiscovery` method to `RbacEvaluator` for cleaner logic.

## Deliverables
- `src/apps/tool-gateway.ts`: Updated discovery logic.
- `tests/apps/tool-gateway-discovery.spec.ts`: New test verifying that a session with 'discovery' role can see all tools, but still needs specific roles to call them.

## Acceptance Criteria
- `llm-bot` discovers all tools from the gateway upon connection.
- `llm-bot` successfully filters tools per-request based on the user's roles (already implemented in `processor.ts`).
- `tool-gateway` successfully enforces RBAC per-call (already implemented in sprint-254).

## Testing Strategy
- **Unit Test**: Mock a session with `agentName: 'llm-bot'` and verify it receives all tools in `listTools`.
- **Integration Test**: Verify that a tool not visible to default roles IS visible during discovery but remains uncallable unless `_meta` with correct roles is provided.
