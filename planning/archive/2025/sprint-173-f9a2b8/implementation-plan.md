# Implementation Plan – sprint-173-f9a2b8

## Objective
Implement a dynamic, Firestore-backed MCP server registry for the `llm-bot` with role-based access control (RBAC) for tools.

## Scope
- `llm-bot` service updates for Firestore integration.
- `McpClientManager` refactoring to support real-time updates.
- `ToolRegistry` and `BitBratTool` updates for RBAC.
- RBAC filtering logic in `processor.ts`.

## Deliverables
- Code changes in `src/types/tools.ts`, `src/services/llm-bot/mcp/client-manager.ts`, `src/services/llm-bot/mcp/bridge.ts`, and `src/services/llm-bot/processor.ts`.
- Firestore security rules update for `mcp_servers` collection (if applicable, though usually handled via service accounts in Cloud Run).
- Documentation updates in `architecture.yaml` (removing env var).

## Acceptance Criteria
- `llm-bot` successfully discovers MCP servers from Firestore `mcp_servers` collection.
- Adding/removing a server in Firestore is reflected in the `llm-bot` without restart.
- Users without required roles cannot see or use restricted MCP tools.
- Users with at least one required role can see and use restricted MCP tools.
- Existing internal tools remain functional and accessible (default RBAC allows everyone).

## Testing Strategy
- **Unit Tests**:
    - `McpClientManager` reconciliation logic.
    - RBAC filtering logic in `processor`.
- **Integration Tests**:
    - Mock Firestore snapshots to verify `McpClientManager` responds correctly.
    - Test `processEvent` with different user roles and verify tool availability.

## Deployment Approach
- Cloud Run deployment of `llm-bot`.
- Manual/Scripted seeding of `mcp_servers` in Firestore for dev environment.

## Dependencies
- Google Cloud Firestore.
- Existing MCP servers (e.g., `obs-mcp`).

## Definition of Done
- All code changes implemented and reviewed.
- `npm test` passes.
- `validate_deliverable.sh` succeeds.
- PR created and linked in `publication.yaml`.
- `verification-report.md`, `retro.md`, and `key-learnings.md` created.
