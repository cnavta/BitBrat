# Implementation Plan – sprint-238-g1h2i3

## Objective
- Resolve `api_gateway.auth.invalid_token` error by aligning `AuthService` with the Firestore token document schema.

## Scope
- `src/services/api-gateway/auth.ts`: Update field access from `user_id` to `uid`.
- `tools/brat/src/cli/setup.ts`: Verify it uses `uid` (it should, as per sprint-237).

## Deliverables
- Fix in `AuthService.ts`.
- Updated unit tests if applicable.

## Acceptance Criteria
- `AuthService` correctly extracts user ID from the `uid` field in Firestore.
- No `auth.token_not_found` or `auth.invalid_token` warnings when a valid token is used.

## Testing Strategy
- Unit tests for `AuthService` (if exists).
- Verification via `validate_deliverable.sh`.
