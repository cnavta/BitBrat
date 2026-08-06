# Execution Plan – sprint-254-d6e7f8

## Summary
Implement dynamic, request-based RBAC in `tool-gateway` by propagating user context from the `llm-bot` for each MCP tool and resource call.

## Phased Implementation

### Phase 1: Gateway Resilience & Context Extraction (Target: `src/apps/tool-gateway.ts`)
- **Action:** Refactor `getMcpServerForConnection` to use a context-aware helper for `isAllowedTool` and `isAllowedResource`.
- **Logic:** For each request (`callTool`, `readResource`, `getPrompt`), extract context from:
    1.  The `_meta` field of the MCP request (if present).
    2.  Custom headers from the incoming `POST /message` (if the SDK exposes them to the handler).
    3.  Fallback: The established session context.
- **Verification:** Ensure list-based discovery still works with session context, but execution is blocked if the request-level context lacks roles.

### Phase 2: Bridge Context Forwarding (Target: `src/common/mcp/bridge.ts`)
- **Action:** Update `translateTool`, `translateResource`, and `translatePrompt` handlers.
- **Logic:** The `execute` (or `read`/`get`) function already receives a `context` argument from the `registry`. Forward this context (specifically `userRoles`, `userId`, `agentName`) into the `_meta` field of the MCP call made to the gateway.
- **Challenge:** Check if the MCP SDK `Client.callTool` allows passing `_meta`. If not, we might need a custom wrapper or use the `arguments` (Option B from architecture).

### Phase 3: Bot Processor Alignment (Target: `src/services/llm-bot/processor.ts`)
- **Action:** Ensure `InternalEventV2.identity` roles are always passed to the `toolRegistry.execute` call.
- **Logic:** The `processor.ts` already extracts `userRoles` from the event. We must confirm these are correctly passed into the `toolContext`.

### Phase 4: Validation & Hardening
- **Action:** Create a reproduction/validation script that simulates a bot session established with "bot-role" but attempting to call a tool requiring "user-role" on behalf of a user.
- **Logic:**
    1.  Call without `_meta` -> Forbidden.
    2.  Call with `_meta` containing "user-role" -> Success.

## Testing Strategy
- **Mock Gateway Tests:** Verify RBAC logic in isolation.
- **End-to-End Simulation:** Run `llm-bot` and `tool-gateway` together.

## Risks
- **SDK Limitations:** If `@modelcontextprotocol/sdk` strictly validates `CallToolRequest`, adding `_meta` might fail validation unless it's handled properly by the SDK's internal schema.
- **Performance:** Dynamic RBAC check on every call adds negligible overhead but must be efficient.
