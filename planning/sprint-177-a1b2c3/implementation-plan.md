# Implementation Plan – sprint-177-a1b2c3

## Objective
Implement an internal MCP toolset for the `llm-bot` to report on its own status and tool usage, enabling it as a core administrative UX.

## Scope
- What is in scope:
  - Definition of `ToolExecutionContext`.
  - Updating `BitBratTool` and `processor.ts` to support execution context.
  - Implementation of `get_bot_status` and `list_available_tools` internal tools.
  - Integration of these tools into `LlmBotServer`.
- What is out of scope:
  - New external MCP servers.
  - Modifying existing external tools.
  - Complex administrative actions like restarting services or changing configs.

## Deliverables
- `src/types/tools.ts`: Updated `BitBratTool` interface and new `ToolExecutionContext`.
- `src/services/llm-bot/processor.ts`: Updated to pass context to tool execution.
- `src/services/llm-bot/tools/internal-tools.ts`: New file with status and discovery tools.
- `src/apps/llm-bot-service.ts`: Updated to register internal tools.
- `src/services/llm-bot/tools/__tests__/internal-tools.test.ts`: Unit tests for new tools.

## Acceptance Criteria
- Bot can successfully respond to "What is your status?" with a summary of MCP servers and tool usage stats.
- Bot can successfully respond to "What tools can I use?" with a list filtered by the requester's role.
- Internal tools are not leaked to users who don't have the required roles (if we set roles on them).
- System passes all existing tests.

## Testing Strategy
- Unit tests for `get_bot_status` and `list_available_tools` using mocks.
- Integration test in `llm-bot-service.test.ts` or a new test file to verify the full flow from message to internal tool call.

## Deployment Approach
- Standard Cloud Run deployment as part of the `llm-bot` service.

## Dependencies
- `@modelcontextprotocol/sdk` (already present)
- Firebase/Firestore for `McpServerConfig` (already present)

## Definition of Done
- Code adheres to project constraints.
- `npm test` passes.
- `validate_deliverable.sh` is passable.
- Documentation updated (Technical Architecture).
- PR created and linked.
