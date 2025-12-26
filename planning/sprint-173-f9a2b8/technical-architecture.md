# Technical Architecture – Dynamic Firestore MCP Registry & RBAC

## Objective
Transition MCP server configurations from static environment variables to a dynamic Firestore-backed registry. Implement role-based access control (RBAC) for MCP tools to ensure only authorized users can trigger specific capabilities.

## High-Level Design

1.  **Registry Source of Truth**: Move `LLM_BOT_MCP_SERVERS` JSON from environment variables to a Firestore collection named `mcp_servers`.
2.  **Dynamic Discovery**: `llm-bot` will subscribe to real-time updates from this Firestore collection.
3.  **Client Management**: `McpClientManager` will manage the lifecycle of MCP clients (`Stdio` or `SSE`) based on the Firestore state.
4.  **RBAC**: MCP server configurations will include an optional `requiredRoles` array. Tools discovered from these servers will only be available to users possessing at least one of the required roles.

## Detailed Components

### 1. Firestore Schema (`mcp_servers`)
Each document in the `mcp_servers` collection represents an MCP server configuration.

- `id`: string (Auto-generated or descriptive ID)
- `name`: string (e.g., "obs-mcp")
- `transport`: "stdio" | "sse" (Optional, defaults to "stdio")
- `url`: string (Required for "sse" transport)
- `command`: string (Required for "stdio" transport, e.g., "node")
- `args`: string[] (Optional, for "stdio")
- `env`: Record<string, string> (Optional, used for shell env in stdio, and HTTP headers in sse)
- `requiredRoles`: string[] (Optional, e.g., ["broadcaster", "moderator"])
- `status`: "active" | "inactive"
- `updatedAt`: Timestamp

### 2. `McpClientManager` Updates
- **`init()`**: Instead of reading `LLM_BOT_MCP_SERVERS` once, it will initialize a Firestore listener.
- **`watchRegistry()`**: Uses `onSnapshot` to listen for changes in the `mcp_servers` collection where `status == 'active'`.
- **State Reconciliation**:
    - **Added/Modified**: Start or restart the MCP client with the new configuration. Supports both `StdioClientTransport` and `SseClientTransport`.
    - **Removed/Inactive**: Stop and remove the MCP client and its associated tools from the registry.

### 3. Tool Registry & RBAC
- **`BitBratTool` Interface**: Add `requiredRoles?: string[]`.
- **`McpBridge`**: Update `translateTool` to accept `requiredRoles` and attach it to the generated `BitBratTool`.
- **Filtering in `processEvent`**:
    - Retrieve user roles from `evt.user.roles`.
    - Filter tools from the registry before passing them to the AI SDK `generateText` function.
    - Logic: A tool is included if `!tool.requiredRoles` OR `tool.requiredRoles.some(role => userRoles.includes(role))`.

## Implementation Steps

1.  **Type Updates**: Update `BitBratTool` and `McpServerConfig` interfaces.
2.  **McpBridge Update**: Pass `requiredRoles` during translation.
3.  **McpClientManager Rewrite**:
    - Add Firestore listener logic.
    - Implement `connectServer` and `disconnectServer` (shutdown existing client if it exists).
    - Ensure tool registry is updated correctly on change.
4.  **Processor Update**: Implement RBAC filtering logic in `processEvent`.
5.  **Clean up**: Remove `LLM_BOT_MCP_SERVERS` from `architecture.yaml` and deployment configs once verified.

## Constraints & Considerations
- **Security**: The `llm-bot` service account must have read access to the `mcp_servers` collection.
- **Performance**: Firestore snapshots provide near real-time updates. The number of MCP servers is expected to be small (< 10), so reconciliation should be fast.
- **Stability**: Errors in connecting to one MCP server should not prevent others from working or crash the `llm-bot`.
