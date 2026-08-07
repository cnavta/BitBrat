# Implementation Plan – sprint-253-a2b3c4

## Objective
- Realign event flow destinations by updating topic consumption and publication for `auth` and `event-router` services as specified in the updated `architecture.yaml`.

## Scope
- `src/types/events.ts`: Add new topic constants.
- `src/apps/auth-service.ts`: Update to consume `internal.auth.v1` and use `BaseServer.next()` to move to the next routing step.
- `src/apps/event-router-service.ts`: Update to consume `internal.ingress.v1` and `internal.enriched.v1`.
- `architecture.yaml`: Verify alignment (already updated in repo, but ensure code matches).

## Deliverables
- Updated `src/types/events.ts` with `INTERNAL_AUTH_V1` and `INTERNAL_ENRICHED_V1`.
- Refactored `src/apps/auth-service.ts` using `this.next()`.
- Refactored `src/apps/event-router-service.ts`.
- Validation report ensuring services correctly subscribe to new topics.

## Acceptance Criteria
- `auth` service subscribes to `internal.auth.v1`.
- `auth` service uses `this.next(event)` to publish to the next destination in the routing slip.
- `event-router` service subscribes to both `internal.ingress.v1` and `internal.enriched.v1`.
- All tests pass.
- `validate_deliverable.sh` passes.

## Testing Strategy
- Update existing unit tests for `auth` and `event-router` to reflect new topic names.
- Verify subscription logic in both services.

## Deployment Approach
- Standard Cloud Run deployment (simulated via `validate_deliverable.sh`).

## Dependencies
- None.

## Definition of Done
- Code matches `architecture.yaml` specifications.
- Tests pass.
- PR created.
