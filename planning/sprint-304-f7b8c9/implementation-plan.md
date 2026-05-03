# Implementation Plan – sprint-304-f7b8c9

## Objective
- Allow `api-gateway` WebSocket connections without an API token when a specific environment variable is enabled.

## Scope
- Modify `src/apps/api-gateway.ts` to check for `API_GATEWAY_ALLOW_ANONYMOUS_WS` environment variable.
- Update the WebSocket upgrade logic to bypass token validation if the environment variable is set to `true`.

## Deliverables
- Modified `src/apps/api-gateway.ts`.
- Documentation of the new environment variable in `architecture.yaml`.
- A test case or script to verify the unauthenticated connection.

## Acceptance Criteria
- When `API_GATEWAY_ALLOW_ANONYMOUS_WS` is `true`, a WebSocket connection to `/ws/v1` can be established without an `Authorization` header.
- When `API_GATEWAY_ALLOW_ANONYMOUS_WS` is `false` or unset, an `Authorization` header is still required and validated.
- The `userId` for anonymous connections should be set to a default value (e.g., `anonymous`).

## Testing Strategy
- Manual verification using a simple WebSocket client script.
- Automated test case if feasible within the existing test framework.

## Deployment Approach
- Update `architecture.yaml` to include the new environment variable.
- Deployment to Cloud Run (not part of this task, but environment variable must be available).

## Dependencies
- None.

## Definition of Done
- Code changes implemented.
- `validate_deliverable.sh` passed.
- PR created.
