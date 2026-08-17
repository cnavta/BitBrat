# Sprint Execution Plan – sprint-161-f4d2e1

## 1. Objective
Integrate the `@guhcostan/web-search-mcp` Model Context Protocol (MCP) server into the BitBrat Platform's `llm-bot` service. This will provide the bot with real-time web search (DuckDuckGo) and web content retrieval capabilities.

## 2. Tracked Tasks (Overview)
- **Task 1**: Dependency Management - Install `@guhcostan/web-search-mcp`.
- **Task 2**: Entry Point Verification - Confirm the correct path to the MCP server executable within `node_modules`.
- **Task 3**: Environment Configuration - Update development and production configurations for `llm-bot`.
- **Task 4**: Integration Testing - Verify tool discovery and registration in `llm-bot`.
- **Task 5**: End-to-End Validation - Confirm the LLM can successfully use the search tools.

## 3. Detailed Execution Steps

### Phase 1: Preparation & Installation
1. **Add Dependency**: Run `npm install @guhcostan/web-search-mcp`. This ensures the package is available for the `llm-bot` service.
2. **Path Discovery**: Inspect `node_modules/@guhcostan/web-search-mcp` to locate the main distribution file (expected at `dist/index.js`).

### Phase 2: Configuration
1. **Update `env/dev/llm-bot.yaml`**: Add the `LLM_BOT_MCP_SERVERS` configuration.
   ```json
   [
     {
       "name": "web-search",
       "command": "node",
       "args": ["./node_modules/@guhcostan/web-search-mcp/dist/index.js"]
     }
   ]
   ```
2. **Verify `architecture.yaml`**: Ensure `LLM_BOT_MCP_SERVERS` is listed in the `llm-bot` service environment variables (Completed).

### Phase 3: Implementation Verification
1. **Startup Logs**: Restart `llm-bot` and verify logs show "mcp.client_manager.connected" and successful tool registration.
2. **Integration Test**: Create `tests/services/llm-bot/mcp/web-search.test.ts` to verify that the tools `mcp_web_search_search` and `mcp_web_search_get_page` (or similar, depending on server output) are correctly registered in the `ToolRegistry`.

### Phase 4: Validation & DoD
1. **Manual Test**: Interact with BitBrat and ask a question requiring real-time info (e.g., "What is the current price of Bitcoin?").
2. **Check Logs**: Verify the tool execution loop in `llm-bot` processor.
3. **Run `validate_deliverable.sh`**: Ensure all tests pass and artifacts are consistent.

## 4. Dependencies & Risks
- **Dependency**: External internet access is required for the MCP server to reach DuckDuckGo.
- **Risk**: Changes in the MCP server's output schema or entry point could break integration. (Mitigation: Integration tests).
- **Risk**: Rate limiting from DuckDuckGo. (Mitigation: Use of search is typically light for bot interactions).

## 5. Definition of Done
- `@guhcostan/web-search-mcp` installed and tracked in `package.json`.
- `llm-bot` successfully discovers and registers search tools on startup.
- Integration tests for tool discovery and execution pass.
- `validate_deliverable.sh` passes successfully.
- Pull Request created with all changes.
