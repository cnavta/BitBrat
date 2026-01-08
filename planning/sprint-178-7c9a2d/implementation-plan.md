# Implementation Plan – sprint-178-7c9a2d

## Objective
Create a new `McpServer` subclass of `BaseServer` to enable services to offer MCP capabilities via SSE while retaining all `BaseServer` functionality.

## Scope
- Implementation of `McpServer` in `src/common/mcp-server.ts`.
- Integration with `@modelcontextprotocol/sdk`.
- Automated setup of `/sse` and `/message` endpoints.
- High-level registration methods for tools, resources, and prompts.

## Deliverables
- `src/common/mcp-server.ts`: The new subclass.
- `tests/common/mcp-server.spec.ts`: Unit tests for the new class.
- Documentation update in `documentation/services/mcp-server.md` (new).

## Acceptance Criteria
- [ ] `McpServer` inherits from `BaseServer`.
- [ ] Clients can establish SSE connections via `/sse`.
- [ ] Clients can send MCP messages via `POST /message?sessionId=...`.
- [ ] Registered tools can be listed and called by the client.
- [ ] Registered resources can be listed and read.
- [ ] `BaseServer` functionality (logging, config, resources) remains intact.
- [ ] Graceful shutdown closes all active transports.

## Testing Strategy
- **Unit Tests**: Using `jest` and `supertest` to verify HTTP endpoints.
- **MCP Protocol Tests**: Mocking `SSEServerTransport` and `Server` to verify correct integration with the SDK.
- **Integration Tests**: A mock service extending `McpServer` to verify end-to-end tool calling via a real MCP client (if possible) or simulated transport.

## Deployment Approach
- `McpServer` will be part of the `common` library, usable by any service.
- No immediate deployment change needed, but future services will use this as their base class.

## Dependencies
- `@modelcontextprotocol/sdk` (already present).
- `express` (already present).

## Definition of Done
- Code quality adheres to project standards.
- Tests pass (`npm test`).
- Documentation reflects the new capability.
- PR created and linked in `publication.yaml`.
