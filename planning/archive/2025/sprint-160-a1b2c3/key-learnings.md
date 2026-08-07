# Key Learnings – sprint-160-a1b2c3

## 1. Technical Insights
- **Vercel AI SDK vs LangGraph**: The transition to Vercel AI SDK significantly simplified the codebase. The `generateText` function with its `maxSteps` (now `stopWhen` with `stepCountIs`) logic handles multi-turn tool execution more transparently than manual state management in LangGraph.
- **MCP Protocol Maturity**: The Model Context Protocol (MCP) provides a clean separation between tool definitions and implementation. Using JSON Schema directly through the AI SDK's `jsonSchema` helper allowed for a very smooth bridge.
- **Environment Variable Parsing**: We learned (the hard way) that `BaseServer.getConfig` returns raw strings from the environment. Explicit numeric and boolean parsers are *mandatory* for any configuration used in runtime logic to avoid `TypeError`.

## 2. Process Improvements
- **Incremental Refactoring**: Breaking the LangGraph removal into its own initial phase helped isolate side effects before introducing new complex logic.
- **Mocking Strategy**: Using the `deps.callLLM` injection pattern in `processor.ts` proved highly effective for unit testing prompt assembly and memory reduction logic without needing a real LLM or complex library mocks.

## 3. Future Outlook
- The platform is now well-positioned for Phase 2 (RAG-based tool discovery). The `ToolRegistry` abstraction is clean and ready for a `FirestoreToolProvider`.
- Administrative tools (BitBrat for BitBrat) are the logical next step to empower the AI to manage its own personality and platform rules.
