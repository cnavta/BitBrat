# Implementation Plan – sprint-301-c7d8e9

## Objective
- Enable single-user, on-demand Choose Your Own Adventure (CYOA) stories on the BitBrat platform using a new `story-engine-mcp` and `llm-bot` orchestration.

## Scope
### In Scope
- Development of `story-engine-mcp` service with tools: `start_story`, `get_current_scene`, `process_action`, `update_world_state`.
- Firestore schema implementation for `stories`, `snapshots`, and `user` story pointers.
- `llm-bot` integration to act as Narrator, handling command-driven adventure flow.
- Support for both numbered choices and free-form text input.
- Basic "Story Mode" routing in `event-router`.

### Out of Scope
- Collaborative voting (Phase 2).
- Twitch Channel Point integrations (Phase 3).
- Image generation for scenes (Phase 4+).
- Multi-user "Collective Choice" mechanics.

## Deliverables
- `story-engine-mcp` service code.
- Firestore configuration/rules updates.
- `llm-bot` Narrator prompt and logic updates.
- `event-router` configuration for story commands.
- `validate_deliverable.sh` for Phase 1 verification.

## Acceptance Criteria
- User can start a story with `!adventure <theme>`.
- `llm-bot` provides a narrative scene and 3-4 options.
- User can progress by typing a number or free-text action.
- Story state (inventory, health, location) persists in Firestore between actions.
- Narrative history is maintained for context-aware continuation.

## Testing Strategy
- Unit tests for `story-engine-mcp` tools.
- Integration tests for `llm-bot` calling MCP tools.
- Mocking Firestore for logic tests; manual verification with emulator.

## Deployment Approach
- Deploy `story-engine-mcp` as a new Cloud Run service.
- Update `llm-bot` and `event-router` deployments.

## Dependencies
- `llm-bot`
- `event-router`
- `ingress-egress`
- `state-engine` (for user metadata)
- Firestore

## Definition of Done
- Code adheres to project standards.
- Tests pass.
- `validate_deliverable.sh` executes successfully.
- PR created and linked in `publication.yaml`.
