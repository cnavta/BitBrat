# Execution Plan – sprint-314-a9b8c7

## Objective
Enhance `McpServer` and `tool-gateway` to support MCP auto-discovery via Pub/Sub registration events, reducing manual configuration overhead and ensuring fleet consistency.

## Scope
- **Common Library:** `McpServer` class (`src/common/mcp-server.ts`)
- **Gateway Service:** `ToolGatewayServer` class (`src/apps/tool-gateway.ts`)
- **Shared Types:** `InternalEventType` (`src/types/events.ts`)

## Deliverables
- [ ] **Event Schema Update:** Add `internal.mcp.registration.v1` to the platform's internal event types.
- [ ] **Auto-Registration Logic:** Implementation in `McpServer` to auto-emit registration events post-startup.
- [ ] **Discovery Bridge:** Implementation in `tool-gateway` to bridge registration events to the Firestore registry.
- [ ] **Integration Test Suite:** Automated verification of the end-to-end discovery flow.
- [ ] **Sprint Validation:** `validate_deliverable.sh` script for logical and technical verification.

## Execution Details

### Phase 1: Contract Definition
1. Update `src/types/events.ts` to include the new topic constant and type definition.
2. Define the payload structure in accordance with the Technical Architecture.

### Phase 2: Producer Implementation (`McpServer`)
1. Add a `publishRegistration()` protected method to `McpServer`.
2. Ensure `MCP_EXTERNAL_URL` and `MCP_AUTH_TOKEN` are correctly read from environment.
3. Hook `publishRegistration()` into the `start()` lifecycle, ensuring it runs after the HTTP server is ready.

### Phase 3: Consumer Implementation (`tool-gateway`)
1. Implement `onMessage` subscription for `internal.mcp.registration.v1` in `ToolGatewayServer`.
2. Use a queue group to prevent duplicate processing.
3. Implement logic to upsert the payload into Firestore's `mcp_servers` collection, using the service name as the document ID.

### Phase 4: Validation
1. Write integration tests using mocked message bus and Firestore.
2. Verify that `RegistryWatcher` in `tool-gateway` picks up the changes as expected.

## Acceptance Criteria
- Starting a service that extends `McpServer` (with proper environment variables) automatically registers its MCP capabilities in the `tool-gateway`.
- Registration is persistent in Firestore and survives gateway restarts.
- `tool-gateway` successfully connects to the auto-registered server and proxies its tools.

## Testing Strategy
- **Unit Test:** Verify `McpServer` payload generation logic.
- **Integration Test:** `tests/integration/mcp-discovery.test.ts` (new) verifying the PubSub -> Firestore -> RegistryWatcher pipeline.
- **Manual Verification:** Deploy a dummy MCP server and verify its appearance in `tool-gateway`'s `/_debug/mcp` or `v1/tools` endpoints.

## Definition of Done
- Code follows project naming and style standards.
- Tests (Unit & Integration) pass with >80% coverage on new logic.
- Documentation in `documentation/technical-architecture/` is accurate.
- All tasks in `backlog.yaml` are moved to `done`.
- PR created and linked in `publication.yaml`.
