# Execution Plan – sprint-256-a3d5e7

## Objective
Implement MCP administrative capabilities in the `event-router` service. This allows programmatic rule management (listing, retrieving, and creating rules) by LLM agents via an MCP-compatible interface.

## Implementation Phases

### Phase 1: Foundation & Refactoring
- **Goal**: Refactor `EventRouterServer` to inherit from `McpServer`.
- **Tasks**:
  - Modify `src/apps/event-router-service.ts` to extend `McpServer`.
  - Ensure SSE and message-posting routes are active.
  - Verify that existing routing functionality remains intact.

### Phase 2: Core Logic — Rule Mapping & Construction
- **Goal**: Create a robust mapping between service names and internal topics, and a builder for rule objects.
- **Tasks**:
  - Implement a `rule-mapper.ts` service (or helper) to:
    - Map service names (e.g., `llm-bot`, `auth`) to internal topics (e.g., `internal.llmbot.v1`).
    - Validate JsonLogic expressions.
    - Construct `AnnotationV1` and `CandidateV1` objects from templates.
    - Assemble complete `RuleDoc` objects.

### Phase 3: MCP Tool Integration
- **Goal**: Register the administrative tools with the MCP server.
- **Tasks**:
  - Implement and register the `list_rules` tool.
  - Implement and register the `get_rule` tool.
  - Implement and register the `create_rule` tool using the `rule-mapper`.

### Phase 4: Persistence & Verification
- **Goal**: Ensure rules are correctly saved and the system reacts to changes.
- **Tasks**:
  - Integrate `create_rule` with Firestore (`configs/routingRules/rules`).
  - Write unit tests for the rule mapping and construction logic.
  - Write integration tests using a simulated MCP/SSE client to verify the tools end-to-end.
  - Update `validate_deliverable.sh` to include building and testing.

## Deliverables
- **Refactored `EventRouterServer`**: Exposing MCP endpoints.
- **Rule Construction Service**: Logic for mapping and creating rule documents.
- **MCP Toolset**: `list_rules`, `get_rule`, `create_rule`.
- **Test Suite**: Covering unit and integration scenarios.
- **Validation Script**: For automated build/test verification.

## Definition of Done
- `event-router` service successfully boots and serves MCP endpoints.
- All MCP tools function as specified in the Technical Architecture.
- Rules created via MCP are persisted to Firestore and picked up by the routing engine.
- All tests pass, and `validate_deliverable.sh` executes successfully.
