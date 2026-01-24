# Deliverable Verification – sprint-222-b6c5d4

## Completed
- [x] `create_api_token` MCP tool implemented in `AuthServer`.
- [x] Token persistence logic (SHA-256 hashing + Firestore storage in `gateways/api/tokens`).
- [x] Event publishing (`token.created.v1`) to `internal.ingress.v1`.
- [x] Unit tests for the new tool in `tests/apps/auth-service.spec.ts`.
- [x] `validate_deliverable.sh` script created and passed.

## Partial
- None

## Deferred
- None

## Alignment Notes
- Exported `AuthServer` class to facilitate unit testing.
- Added `token.created.v1` to `InternalEventType` in `src/types/events.ts`.
