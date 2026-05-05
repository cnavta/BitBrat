# Implementation Plan – sprint-303-d4e5f6

## Objective
- Implement the Adventure Context Enrichment & Persistence Flow to transition from a standalone MCP toolset to an integrated enrichment step within the BitBrat event flow.

## Scope
- `src/types/events.ts`: Define new event topics and constants.
- `src/services/story-engine-mcp/`: Implement Pub/Sub enrichment logic and new/updated tools.
- Infrastructure: Ensure Pub/Sub topics are configured (via code/config).

## Out of Scope
- `configs/routingRules/rules`: Firestore routing rules (will be added separately).

## Deliverables
- Updated `src/types/events.ts`.
- Enhanced `StoryEngineMcpServer` with enrichment consumer.
- New `commit_scene` tool.
- Refactored `get_current_scene` and `start_story` tools.
- `validate_deliverable.sh` script.

## Acceptance Criteria
1. Events starting with `!adventure` are routed through `internal.story.enrich.v1`.
2. `StoryEngineMcpServer` successfully injects `adventure_context` annotations into routed events.
3. `llm-bot` receives events with full adventure context, allowing stateless resumption.
4. `commit_scene` correctly persists narrative scenes and updates world state.
5. `get_current_scene` reliably returns the last narrative scene, ignoring intermediate user actions.
6. Full story snapshots are published to `internal.persistence.snapshot.v1` on every state change.

## Testing Strategy
- **Unit Tests**:
    - Test enrichment logic in `StoryEngineMcpServer` (mocking Firestore and event advancing).
    - Test `commit_scene` and `get_current_scene` logic.
- **Integration Tests**:
    - End-to-end flow: Publish a `!adventure` message and verify it arrives at `internal.llm-bot.v1` with the correct annotation.

## Deployment Approach
- Deployed via Cloud Build to Cloud Run (for the story-engine-mcp service).
- Firestore updates applied via script or manual config update as specified in architecture.

## Definition of Done
- Code follows PascalCase/camelCase conventions and project standards.
- All tests pass (Jest).
- `validate_deliverable.sh` passes.
- PR created and linked in `publication.yaml`.
- Retro and Key Learnings documented.
