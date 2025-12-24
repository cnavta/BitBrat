# Sprint Retro – sprint-160-a1b2c3

## What Worked Well
- Vercel AI SDK's `generateText` and `stepCountIs` made the tool loop implementation significantly simpler than the previous LangGraph attempt.
- The `McpBridge` effectively decouples MCP-specific logic from the core processor.
- Mocking MCP clients with `events` and `listTools`/`callTool` made testing the integration straightforward.

## What Didn't Work Well
- `PromptAssembler` output format changes caused several regressions in existing tests that relied on specific string matches (e.g., "Recent exchanges").
- Mapping MCP's JSON Schema to AI SDK tools was slightly tricky, but `jsonSchema()` helper from AI SDK saved the day.

## Lessons Learned
- When updating a core component like the LLM processor, always check for tests that might be sensitive to the *exact* format of the generated prompt.
- Vercel AI SDK is a powerful replacement for complex orchestration libraries when the flow is primarily linear tool-calling.
