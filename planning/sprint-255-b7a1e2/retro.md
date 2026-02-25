# Sprint Retro – sprint-255-b7a1e2

## What Worked
- **Targeted Discovery Expansion**: Allowing `llm-bot` to see all tools while keeping per-request enforcement proved to be an elegant solution to the "only 4 tools" issue.
- **Improved Schemas**: Fixing the Zod-to-JSON-Schema conversion improved the quality of tools registered by the LLM.
- **Observability**: Adding debug logs for tool invocations provides much-needed visibility into the dynamic RBAC flow.

## What Didn't
- **SDK Meta Handling**: Passing `_meta` through the MCP SDK required some manual `(client as any).request` calls in tests because the high-level `callTool` helper doesn't always expose `_meta`.

## Improvements for Next Sprint
- Consider a higher-level MCP client wrapper that natively supports per-request context propagation to reduce boilerplate in the bridge.
