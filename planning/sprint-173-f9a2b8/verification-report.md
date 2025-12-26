# Deliverable Verification – sprint-173-f9a2b8

## Completed
- [x] **Update Type Definitions for RBAC**: `BitBratTool` and `McpServerConfig` now support `requiredRoles`.
- [x] **Update McpBridge and Tool Discovery**: `McpBridge` attaches `requiredRoles` to translated tools.
- [x] **Implement Firestore-backed McpClientManager**: `McpClientManager` now uses real-time Firestore snapshots for dynamic server management and reconciliation.
- [x] **Implement RBAC Filtering in Processor**: `processEvent` filters tools based on user roles and tool requirements.
- [x] **Validation and Cleanup**: Legacy `LLM_BOT_MCP_SERVERS` environment variable removed from all configurations and code. All tests passing.

## Partial
None.

## Deferred
None.

## Alignment Notes
- Updated `McpClientManager` to track tool IDs per server, ensuring that when a server is removed or deactivated, its tools are correctly unregistered from the `llm-bot`.
- Updated existing tests to mock Firestore integration, maintaining test suite health while transitioning to a dynamic registry.
