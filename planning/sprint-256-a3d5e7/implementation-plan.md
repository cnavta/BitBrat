# Implementation Plan – sprint-256-a3d5e7

## Objective
Add MCP administrative capabilities to the `event-router` service, enabling LLM agents to manage routing rules.

## Scope
- Refactor `EventRouterServer` to extend `McpServer`.
- Implement `list_rules`, `get_rule`, and `create_rule` MCP tools.
- Implement rule creation logic (JsonLogic validation, routing slip generation, enrichment construction).
- Integration with Firestore for rule persistence.

## Deliverables
- `src/apps/event-router-service.ts`: Refactored server with MCP tools.
- `src/services/router/rule-mapper.ts`: (New) Helper for mapping service names to topics and creating rules.
- `tests/apps/event-router-mcp.test.ts`: Integration tests for MCP tools.
- `planning/sprint-256-a3d5e7/technical-architecture.md`: Technical documentation.

## Acceptance Criteria
- `event-router` service starts and exposes MCP `/sse` and `/message` endpoints.
- `list_rules` returns all active rules from Firestore.
- `get_rule` returns a specific rule by ID.
- `create_rule` successfully creates a rule with:
    - JsonLogic logic.
    - Routing slip from service names.
    - Optional prompt annotation.
    - Optional text candidate.
    - Optional custom annotation.
- A rule created via MCP is immediately loaded and used by the `RouterEngine`.

## Testing Strategy
- **Unit Tests**: Test `rule-mapper.ts` for correct service-to-topic mapping and rule construction.
- **Integration Tests**: Start a mock Express app with `EventRouterServer` and call MCP tools via HTTP.
- **Manual Verification**: Use `curl` to interact with the SSE endpoint if needed.

## Deployment Approach
- Standard Cloud Run deployment via Cloud Build.
- Ensure `MCP_AUTH_TOKEN` is configured in secrets.

## Dependencies
- Firestore (for rule persistence).
- MCP SDK.

## Definition of Done
- Code quality adheres to project standards.
- Tests cover new behavior and pass.
- Documentation (Architecture and Plan) is complete.
- PR is created and branch pushed.
