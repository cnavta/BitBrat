# Deliverable Verification – sprint-304-f7b8c9

## Completed
- [x] Modified `src/apps/api-gateway.ts` to support `API_GATEWAY_ALLOW_ANONYMOUS_WS` environment variable.
- [x] Updated `architecture.yaml` to include the new environment variable.
- [x] Created `tests/apps/api-gateway-auth-debug.test.ts` to verify the new functionality.
- [x] Verified that authenticated connections still work.
- [x] Verified that anonymous connections are rejected when the flag is disabled.
- [x] Verified that anonymous connections are accepted when the flag is enabled.

## Partial
- None.

## Deferred
- None.

## Alignment Notes
- The `userId` for anonymous connections is set to `'anonymous'`.
- This is a debug feature and should be used with caution in production.
