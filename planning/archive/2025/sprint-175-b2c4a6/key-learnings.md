# Key Learnings – sprint-175-b2c4a6

- **Tool Interface Mapping**: The AI SDK expects a `parameters` field for tool definitions. The BitBrat `BitBratTool` interface uses `inputSchema`. These must be explicitly mapped in the `processor.ts` before calling `generateText`.
- **AI SDK Multi-step Pattern**: In the current project configuration, multi-turn tool calling is controlled by `stopWhen: stepCountIs(N)`. `maxSteps` is not currently available in the environment's `ai` package version.
- **Regression Risk**: Any change to the `processor.ts` tool filtering or wrapping logic must be carefully verified for naming collisions or omissions, especially when the interfaces don't align perfectly.
