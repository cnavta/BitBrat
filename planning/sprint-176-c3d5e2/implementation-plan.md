# Implementation Plan – sprint-176-c3d5e2

## Objective
Resolve the `type: "None"` schema error when calling MCP tools and ensure compatibility with AI SDK 6.x.

## Scope
- Fix tool field mapping in `processor.ts`.
- Add defensive schema sanitization in `McpBridge.ts`.

## Deliverables
- `src/services/llm-bot/processor.ts`: Use `inputSchema` instead of `parameters`.
- `src/services/llm-bot/mcp/bridge.ts`: Sanitize schemas with `type: "None"`.
- `tests/services/llm-bot/mcp/bridge.spec.ts`: Added test for sanitization.
- `tests/services/llm-bot/processor-tools.spec.ts`: Updated test for `inputSchema`.

## Acceptance Criteria
- No `AI_APICallError` related to invalid schemas for `mcp_search_web`.
- All MCP tools are correctly passed to the AI SDK with `inputSchema`.
- Schemas with `type: "None"` are automatically converted to `type: "object"`.

## Testing Strategy
- Unit tests for `McpBridge` sanitization.
- Unit tests for `processor` tool mapping.
- Full validation via `validate_deliverable.sh`.
