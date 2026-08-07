# Implementation Plan – sprint-305-e4d5f6

## Objective
- Implement Metadata-Driven Contextual Tool Filtering to improve LLM tool selection and reduce hallucinations, specifically targeting the "Story Engine" use case.

## Scope
- **In-Scope**:
  - Updating `BitBratTool` type definition to support `scopes`.
  - Tagging `story-engine-mcp` tools and `llm-bot` adventure tools with the `story` scope.
  - Updating `story-engine-mcp`'s enrichment logic to inject `scope: 'story'` into event metadata.
  - Modifying `llm-bot` processor to filter tools based on the requested scope in event metadata.
- **Out-of-Scope**:
  - Semantic Vector Selection (Tier 3 from architecture brief).
  - Broad tagging of all existing tools beyond adventure-related ones.

## Deliverables
- Code changes in:
  - `src/types/tools.ts`: Type update.
  - `src/apps/story-engine-mcp.ts`: Metadata injection.
  - `src/services/llm-bot/processor.ts`: Filtering logic.
  - `src/services/llm-bot/tools/*.ts`: Tool tagging.
- New/Updated Tests.
- `validate_deliverable.sh`.

## Acceptance Criteria
- `BitBratTool` supports an optional `scopes: string[]` property.
- When an event has `metadata.scope = 'story'`, only tools with the `story` scope OR no scope (global) are available to the LLM.
- `story-engine-mcp` correctly identifies active adventures and stamps the event metadata with `scope: 'story'`.
- All existing RBAC and behavioral filtering remains active and correct.

## Testing Strategy
- **Unit Tests**:
  - Test tool filtering logic in isolation (mock tools and events).
- **Integration Tests**:
  - Verify `story-engine-mcp` enrichment correctly updates the event.
  - Verify `llm-bot` processor uses the scope from metadata for filtering.

## Deployment Approach
- Standard Cloud Build / Cloud Run deployment.
- No new infrastructure required.

## Definition of Done
- Implementation matches the objective and modification requirement (metadata vs annotation).
- All acceptance criteria met.
- `validate_deliverable.sh` passes.
- PR created and linked in `publication.yaml`.
