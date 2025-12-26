# Execution Plan – sprint-173-f9a2b8

## Objective
Transition the MCP server registry from environment variables to a dynamic Firestore collection and implement Role-Based Access Control (RBAC) for tools.

## Execution Strategy
The implementation will follow a bottom-up approach, starting with type definitions and core bridge logic, moving to the dynamic client management, and finally integrating the RBAC filtering in the request processor.

### Phase 1: Foundation & Types
- Update `BitBratTool` and `McpServerConfig` to support `requiredRoles`.
- Modify `McpBridge` to carry these roles through to the registry.

### Phase 2: Dynamic Registry Implementation
- Refactor `McpClientManager` to use Firestore `onSnapshot`.
- Implement reconciliation logic to handle real-time configuration changes (upsert/delete).
- Ensure existing tool registration is handled atomically during server restarts.

### Phase 3: RBAC Enforcement
- Update the `llm-bot` processor to filter available tools based on the user's roles and the tool's `requiredRoles`.
- Implement fallback logic for tools without defined roles (default: permit all).

### Phase 4: Native SSE Support
- Update `McpServerConfig` types to include `transport` and `url`.
- Implement `SseClientTransport` logic in `McpClientManager`.
- Ensure environment variables are passed correctly to the SSE connection if needed.

### Phase 5: Verification & Cleanup
- Create a validation script that mocks Firestore state and verifies RBAC filtering.
- Remove legacy environment variable configurations from `architecture.yaml` and service defaults.
- Verify native SSE connectivity with a mock SSE server or real endpoint.

## Key Technical Risks
- **Firestore Connectivity**: Transient errors in Firestore subscription must be handled gracefully to avoid losing MCP capabilities.
- **Race Conditions**: Rapid updates to Firestore must not lead to multiple client instances or leaked resources.
- **RBAC Sensitivity**: Ensuring user roles are correctly retrieved and compared against restricted tools.

## Dependencies
- Access to Firestore `mcp_servers` collection.
- `firebase-admin` for Firestore interactions in `llm-bot`.
