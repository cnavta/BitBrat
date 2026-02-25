# Request Log - sprint-255-b7a1e2

## [2026-02-24T22:50:47Z] Sprint Start
- **Prompt Summary:** Investigating why only 4 tools are available.
- **Interpretation:** User reported a bug where tool discovery/filtering seems too restrictive.
- **Actions:**
    - Created sprint directory `planning/sprint-255-b7a1e2/`
    - Created feature branch `feature/sprint-255-b7a1e2-fix-tool-discovery`
    - Created `sprint-manifest.yaml`

## [2026-02-24T22:56:00Z] Tool Invocation Logging
- **Prompt Summary:** Add tool invocation debug logging to the tool-gateway.
- **Interpretation:** The user wants detailed start/success/error logs for tool, resource, and prompt calls in the gateway.
- **Actions:**
    - Modified `src/apps/tool-gateway.ts` to add debug logs with timing and context for REST and MCP handlers.
    - Verified logs appear with `LOG_LEVEL=debug` during tests.
