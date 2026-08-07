# Sprint Execution Plan – sprint-177-a1b2c3

## Overview
This plan outlines the implementation of internal MCP tools for the `llm-bot` to enable self-reporting and role-based tool discovery. This serves as the foundation for the bot's administrative capabilities.

## Phased Approach

### Phase 1: Core Types & Infrastructure (Foundation)
The goal is to provide the necessary context to all tools so they can make informed decisions based on the requester's identity and the current operation.
- **Task**: Update `src/types/tools.ts` to define `ToolExecutionContext`.
- **Task**: Update `BitBratTool` interface `execute` method signature.
- **Task**: Fix any immediate compilation errors in `registry.ts` or other consumers if necessary (though the signature change might be optional in some cases, it's better to be explicit).

### Phase 2: Processor Context Injection
The LLM processor needs to extract user roles and correlation IDs from incoming events and inject them into the tool execution flow.
- **Task**: Update `src/services/llm-bot/processor.ts`.
- **Logic**: Construct `ToolExecutionContext` from `evt.user.roles` and `evt.correlationId`.
- **Integration**: Pass this context to the tool's `execute` call within the `generateText` loop.

### Phase 3: Internal Tool Implementation
Developing the actual tools that will use the new context.
- **Task**: Create `src/services/llm-bot/tools/internal-tools.ts`.
- **Tool: `get_bot_status`**:
    - Access `McpClientManager` to retrieve stats.
    - Format a report including connected servers, uptime, and usage metrics.
- **Tool: `list_available_tools`**:
    - Access `ToolRegistry`.
    - Filter tools by comparing `requiredRoles` against `context.userRoles`.
    - Format a human-readable list for the LLM to present.

### Phase 4: Service Integration
Exposing the new tools to the `llm-bot` service.
- **Task**: Update `src/apps/llm-bot-service.ts`.
- **Action**: Instantiate internal tools and register them in the `ToolRegistry` during `setupApp` or `start`.

### Phase 5: Verification & Quality Assurance
Ensuring everything works as expected and no regressions are introduced.
- **Task**: Implement unit tests in `src/services/llm-bot/tools/__tests__/internal-tools.test.ts`.
- **Task**: Run `validate_deliverable.sh`.
- **Task**: Perform manual verification by simulating LLM calls (if possible in the test environment).

## Acceptance Criteria (Per Task)
- **BL-177-001**: `BitBratTool` interface supports `context`.
- **BL-177-002**: Processor correctly forwards user roles to tools.
- **BL-177-003**: `get_bot_status` returns accurate JSON/text stats.
- **BL-177-004**: `list_available_tools` correctly hides tools the user shouldn't see.
- **BL-177-005**: Bot can describe its own status when asked in plain English.
- **BL-177-006**: All tests pass.

## Risk & Mitigations
- **Breaking Changes**: Changing the `execute` signature might break existing mock tools in tests. 
    - *Mitigation*: Update all tool implementations and mocks simultaneously.
- **Data Leakage**: `get_bot_status` might expose sensitive info.
    - *Mitigation*: Use a strict filter on what stats are returned; avoid dumping full config objects.
