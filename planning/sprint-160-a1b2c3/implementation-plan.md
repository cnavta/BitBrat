# Implementation Plan – sprint-160-a1b2c3

## Objective
Implement basic MCP tool registration and Vercel AI SDK integration for the `llm-bot` service to establish a provider-agnostic tool-use foundation.

## Scope
- Integration of Vercel AI SDK (`ai` package) and `@ai-sdk/openai`.
- Removal of `@langchain/langgraph` and `@langchain/openai` dependencies.
- Creation of `ToolRegistry` and `McpBridge` abstractions.
- Refactoring `llm-bot` event processor to support tool calling and replace LangGraph.
- Supporting basic tool registration from external MCP servers.

## Deliverables
- **Documentation**: `planning/sprint-160-a1b2c3/technical-architecture.md`
- **Infrastructure**: Updated `package.json` with `ai`, `@ai-sdk/openai`, `zod`, and `@modelcontextprotocol/sdk`.
- **Code**:
    - `src/services/llm-bot/tools/registry.ts`: Centralized tool management.
    - `src/services/llm-bot/mcp/bridge.ts`: MCP to AI SDK bridge.
    - `src/services/llm-bot/processor.ts`: Refactored to use Vercel AI SDK.
- **Tests**:
    - Unit tests for `ToolRegistry`.
    - Unit tests for `McpBridge`.
    - Integration test for `llm-bot` tool use.

## Acceptance Criteria
1. `llm-bot` service uses Vercel AI SDK for generating responses.
2. LangGraph dependency is removed and `processor.ts` is refactored to use AI SDK patterns.
3. Tools can be registered from local definitions and external MCP servers.
4. LLM can successfully select and execute an MCP tool based on prompt context.
5. Abstractions allow for easy addition of other LLM providers (Anthropic, Google).
6. `validate_deliverable.sh` successfully builds and tests the changes.

## Testing Strategy
- **Unit Testing**: Use Jest to test `ToolRegistry` logic and MCP mapping.
- **Mocking**: Use `MockMcpServer` to simulate MCP tools during tests.
- **Verification**: Verify that `generateText` is called with the correct tool definitions.

## Deployment Approach
- Deploy to Cloud Run using existing CI/CD pipelines.
- Add environment variables for MCP server configurations if needed.

## Dependencies
- `@modelcontextprotocol/sdk`
- `ai` (Vercel AI SDK)
- `@ai-sdk/openai`

## Definition of Done
- Code adheres to project style rules (PascalCase, kebab-case, etc.).
- `validate_deliverable.sh` passes.
- `verification-report.md` confirms all criteria met.
- PR created and URL recorded in `publication.yaml`.
