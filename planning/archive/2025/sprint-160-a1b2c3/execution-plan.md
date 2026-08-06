# Sprint Execution Plan – sprint-160-a1b2c3

## 1. Overview
This plan details the technical execution of the MCP Tool Registration and Vercel AI SDK integration for the `llm-bot` service. The primary goal is to establish a provider-agnostic tool-use foundation and remove the redundant LangGraph dependency.

## 2. Phased Roadmap

### Phase 1: Foundation & Cleanup (Day 1)
- **Objective**: Prepare the codebase and environment for the new architecture.
- **Key Tasks**:
    - Uninstall `@langchain/langgraph`, `@langchain/openai`, and legacy `openai` package.
    - Install `ai`, `@ai-sdk/openai`, `@modelcontextprotocol/sdk`, and `zod`.
    - Clean up `processor.ts` imports and remove LangGraph-specific types.

### Phase 2: Core Tooling Infrastructure (Day 2)
- **Objective**: Implement the abstractions defined in the Technical Architecture.
- **Key Tasks**:
    - Implement `src/services/llm-bot/tools/registry.ts` (`ToolRegistry`).
    - Define `BitBratTool` and related interfaces in `src/types/tools.ts`.
    - Create a basic "Hello World" internal tool for testing.

### Phase 3: MCP Translation & Bridge (Day 3)
- **Objective**: Bridge the gap between MCP and Vercel AI SDK.
- **Key Tasks**:
    - Implement `src/services/llm-bot/mcp/bridge.ts` (`McpBridge`).
    - Logic for JSON Schema to Zod translation (or raw schema passing if supported by AI SDK).
    - Execution forwarding logic to MCP client.

### Phase 4: Core Processor Migration (Day 4)
- **Objective**: Replace the LLM orchestration logic.
- **Key Tasks**:
    - Refactor `src/services/llm-bot/processor.ts` to use `generateText`.
    - Implement multi-step tool execution using `maxSteps`.
    - Migrate existing memory/context assembly logic to the new `messages` format.
    - Ensure compatibility with existing `CandidateV1` output.

### Phase 5: MCP Client Integration & Lifecycle (Day 5)
- **Objective**: Enable dynamic tool discovery.
- **Key Tasks**:
    - Implement `src/services/llm-bot/mcp/client.ts`.
    - Manage connection lifecycle (stdio/HTTP) in `llm-bot-service.ts`.
    - Auto-register discovered MCP tools into the `ToolRegistry`.

### Phase 6: Validation & Hardening (Day 6)
- **Objective**: Ensure stability and correctness.
- **Key Tasks**:
    - Finalize `validate_deliverable.sh`.
    - Run full test suite (unit + integration).
    - Perform manual verification with a mock MCP server.

## 3. Resource Allocation
- **Lead Implementor (Agent)**: Responsible for all code changes, refactoring, and test creation.
- **Architect (Reviewer)**: Review PRs and ensure alignment with `architecture.yaml`.

## 4. Risks & Mitigations
- **Risk**: MCP JSON Schema incompatibility with Zod.
    - **Mitigation**: Use AI SDK's ability to accept raw JSON Schema if Zod conversion is too complex for this sprint.
- **Risk**: LangGraph removal breaking existing personality/context logic.
    - **Mitigation**: Thoroughly test the `assemble` logic integration before and after refactoring.
- **Risk**: Connection stability for stdio-based MCP servers.
    - **Mitigation**: Implement robust error handling and reconnection logic in the `McpClient`.

## 5. Definition of Done
- All code changes reviewed and merged.
- `validate_deliverable.sh` passes 100%.
- Backlog items moved to `done`.
- Documentation updated.
