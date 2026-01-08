# Technical Architecture – Internal MCP Toolset for Bot Status

## Objective
Provide the `llm-bot` with the ability to report on its own operational status and available capabilities (tools/MCP servers) through plain language interaction. This is a foundational step towards making the bot the core administrative interface for the BitBrat platform.

## Proposed Changes

### 1. Tool Execution Context
Currently, `BitBratTool.execute` only receives parameters defined by its Zod schema. To support role-based discovery and context-aware reporting, we will introduce a `ToolExecutionContext` and pass it to the `execute` function.

```typescript
export interface ToolExecutionContext {
  userRoles: string[];
  correlationId?: string;
}
```

Modified `BitBratTool`:
```typescript
export interface BitBratTool<PARAMETERS extends z.ZodTypeAny = any, RESULT = any> {
  // ...
  execute?: (args: z.infer<PARAMETERS>, context: ToolExecutionContext) => Promise<RESULT>;
}
```

The `processor.ts` will be updated to provide this context when calling tool execution.

### 2. Internal Tools Implementation
We will create a new file `src/services/llm-bot/tools/internal-tools.ts` containing the following tools:

#### `get_bot_status`
- **Description**: Returns the current status of the bot, including connected MCP servers and tool usage statistics.
- **Source**: `internal`
- **Data Source**: Interacts with `McpClientManager` to get `McpStatsCollector` data.
- **Output**:
  - List of active MCP servers and their status.
  - Usage stats: total invocations, errors, and average latency per server/tool.
  - General bot configuration (model name, memory limits).

#### `list_available_tools`
- **Description**: Lists all tools available to the requester based on their roles.
- **Source**: `internal`
- **Logic**:
  - Iterates through the `ToolRegistry`.
  - Filters tools based on `requiredRoles` matching the `userRoles` in the execution context.
  - Returns a summarized list (name, source, description, required roles).

### 3. Service Integration
The `LlmBotServer` in `llm-bot-service.ts` will be updated to:
- Instantiate these internal tools.
- Register them in its `ToolRegistry` during startup.

## Security Considerations
- **RBAC**: The `list_available_tools` tool itself might be accessible to all users, but it will only report tools the user is authorized to see/use.
- **Sensitive Info**: Status reports should be careful not to leak sensitive environment variables or secrets. Only operational stats and server names should be exposed.

## Testing Strategy
- **Unit Tests**: Test the internal tools in isolation by mocking `McpClientManager` and `ToolRegistry`.
- **Integration Tests**: Verify that `processor.ts` correctly passes context and that the LLM can successfully call these tools and report the results.

## Future Extensibility
This internal toolset can be expanded with more administrative tools, such as:
- `restart_mcp_server`
- `update_bot_config`
- `view_logs` (with appropriate role checks)
