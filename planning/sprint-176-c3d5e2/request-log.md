# Request Log – sprint-176-c3d5e2

- **2025-12-26T21:05:00Z**: Investigated `type: "None"` error in `mcp_search_web`.
- **Interpretation**: Found that AI SDK 6.x expects `inputSchema` field on tools, and I was passing `parameters`. Also identified that some MCP tool schemas might be invalid or have non-standard types.
- **Actions**:
    - Modified `src/services/llm-bot/processor.ts` to rename `parameters` to `inputSchema`.
    - Modified `src/services/llm-bot/mcp/bridge.ts` to sanitize `type: "None"` and missing schemas.
    - Updated tests.
- **Verification**: Ran `validate_deliverable.sh` and specific unit tests. All passed.
