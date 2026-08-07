# Implementation Plan – sprint-186-a7b8c9

## Objective
Add the ability for BitBrat to send scheduled events to itself using Firestore and MCP tools.

## Scope
- Firestore collection `schedules` schema and indexing.
- `scheduler-service` implementation:
    - Firestore integration for CRUD operations.
    - MCP tools: `list_schedules`, `create_schedule`, `update_schedule`, `delete_schedule`, `get_schedule`.
    - Event execution logic (triggered by a "tick" event).
    - Cron expression parsing for repeatable events.
- GCP infrastructure: Define Cloud Scheduler job for the "tick" (in documentation/architecture).

## Deliverables
- Updated `architecture.yaml` (if needed for topics).
- `src/apps/scheduler-service.ts` updated with MCP tools and logic.
- Tests for scheduler logic.
- Documentation for the new features.

## Acceptance Criteria
- [ ] LLM-bot can list, create, and update scheduled events via MCP tools.
- [ ] Events are stored in Firestore with the correct schema.
- [ ] A "tick" (simulated or real) triggers due events.
- [ ] Triggered events are published to `internal.ingress.v1` as `InternalEventV2`.
- [ ] Next run time is correctly updated for repeatable events.

## Testing Strategy
- **Unit Tests**: Test cron parsing and `nextRun` calculation.
- **Integration Tests**: 
    - Test MCP tools against a mock/local Firestore.
    - Test the "tick" handler to ensure it correctly identifies due events and publishes them.

## Deployment Approach
- Cloud Run deployment of `scheduler-service`.
- Manual or Terraform setup of Cloud Scheduler (as it's a one-time setup).

## Dependencies
- `firebase-admin` for Firestore access.
- `cron-parser` or similar for cron expressions.
- `uuid` for correlation IDs.

## Definition of Done
- Follows project-wide DoD in AGENTS.md.
- `validate_deliverable.sh` passes.
- PR created.
