# Implementation Plan – sprint-161-f4d2e1

## Objective
Integrate the `@guhcostan/web-search-mcp` tool into BitBrat to provide web search and content retrieval capabilities.

## Scope
- Dependency management (adding the package).
- Configuration of the `llm-bot` service to include the new MCP server.
- Documentation updates.
- Basic validation of tool registration and execution.

## Out of Scope
- Implementing a custom search MCP server.
- RAG-based tool discovery (Phase 2).
- Advanced UI for search results.

## Deliverables
- Modified `package.json` with `@guhcostan/web-search-mcp`.
- Updated `architecture.yaml` (Completed in planning).
- Technical Architecture document (Completed in planning).
- Validation script `validate_deliverable.sh`.
- Verification report.

## Acceptance Criteria
- `llm-bot` successfully connects to the `web-search-mcp` server on startup.
- `web-search-mcp` tools are registered in the `ToolRegistry`.
- `llm-bot` can invoke the search tool via the AI SDK tool loop.
- `validate_deliverable.sh` passes.

## Testing Strategy
- **Unit Testing**: Existing tests for `McpClientManager` and `McpBridge` should continue to pass.
- **Manual Verification**: Run `llm-bot` locally, trigger a search query, and observe the logs/response.
- **Integration Test**: Update or create a test in `tests/services/llm-bot/mcp/` that specifically verifies the discovery of tools from a real or mocked MCP server subprocess.

## Deployment Approach
- The dependency will be included in the Docker build.
- The `LLM_BOT_MCP_SERVERS` env var will be set in the deployment manifest (e.g., `env/dev/llm-bot.yaml`).

## Dependencies
- `@guhcostan/web-search-mcp` package.
- Outbound internet access for the `llm-bot` service.

## Definition of Done
- All deliverables completed.
- Acceptance criteria met.
- `validate_deliverable.sh` successful.
- PR created and linked.
