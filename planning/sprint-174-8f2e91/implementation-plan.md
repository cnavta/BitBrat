# Implementation Plan – sprint-174-8f2e91

## Objective
Add usage statistics, error tracking, and a debug visibility endpoint for MCP integrations within the `llm-bot` service.

## Scope
- In-memory statistics collection for MCP servers and tools.
- HTTP `GET /_debug/mcp` endpoint in `LlmBotServer`.
- Integration of MCP/LLM errors into `InternalEventV2.errors`.
- **Out of Scope**: Persistent storage for stats (Firestore/Cloud Monitoring) in this iteration.

## Deliverables
- `src/services/llm-bot/mcp/stats-collector.ts`: Central metrics collector.
- Modified `src/services/llm-bot/mcp/bridge.ts`: Wrapped execution for stats.
- Modified `src/services/llm-bot/mcp/client-manager.ts`: Lifecycle stats management.
- Modified `src/apps/llm-bot-service.ts`: Debug endpoint implementation.
- Modified `src/services/llm-bot/processor.ts`: Error tracking logic.
- `tests/services/llm-bot/mcp/stats-collector.spec.ts`: Unit tests.

## Acceptance Criteria
- `GET /_debug/mcp` returns the current state of all MCP connections and tool stats.
- Usage stats (invocations, errors, latency, last used) are updated correctly.
- Discovery stats (count, time) are recorded.
- MCP/LLM errors are appended to `InternalEventV2.errors`.
- No memory leaks from stats collection.

## Testing Strategy
- **Unit Tests**: Test `McpStatsCollector` logic independently.
- **Integration Tests**: Verify `McpBridge` updates stats on success and failure.
- **Manual Verification**: Use `curl` to check the `/_debug/mcp` endpoint after running simulated tool calls.

## Deployment Approach
- Standard Cloud Run deployment for `llm-bot` service.
- Use `validate_deliverable.sh` to ensure build and tests pass.

## Dependencies
- `@modelcontextprotocol/sdk` (already present).
- `InternalEventV2` schema in `src/types/events.ts`.

## Definition of Done
- All code changes trace back to a request ID in `request-log.md`.
- `validate_deliverable.sh` passes.
- PR created and URL recorded.
