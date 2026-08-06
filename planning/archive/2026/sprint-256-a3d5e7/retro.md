# Retro – sprint-256-a3d5e7

## What Worked
- Extending `McpServer` was straightforward as it already handles SSE and basic routes.
- Decoupling rule construction into `RuleMapper` made testing much easier.
- Using Zod in `registerTool` provided automatic input validation for the LLM-called tools.

## Challenges
- Mocking the MCP SDK `Server` class for integration tests was difficult because it doesn't expose a simple `executeTool` method for direct testing without a full network/SSE stack.
- Module resolution in nested service directories required careful relative path management.

## Next Steps
- Implement more granular validation for JsonLogic in `RuleMapper`.
- Add support for more service mappings as the platform grows.
