# Implementation Plan – sprint-222-b6c5d4

## Objective
- Add an MCP tool `create_api_token` to the admin service (Auth Service) to allow generating API tokens for users.
- Publish an event when a token is created.

## Scope
- **In Scope**:
  - `create_api_token` MCP tool implementation in `AuthServer`.
  - Logic to generate a secure random token, hash it (SHA-256), and store it in Firestore (`gateways/api/tokens`).
  - Logic to publish a `token.created.v1` event to the message bus.
  - Unit tests for the new tool and token creation logic.
- **Out Scope**:
  - Token revocation UI.
  - Changes to API Gateway's validation logic (it already supports this Firestore collection).

## Deliverables
- Code changes in `src/apps/auth-service.ts`.
- New tests in `src/services/auth/__tests__/admin-tools.spec.ts` (or similar).
- `validate_deliverable.sh` script.

## Acceptance Criteria
- `create_api_token` tool is registered and visible via MCP discovery.
- Calling the tool with a valid `userId` creates a document in `gateways/api/tokens` with hashed token.
- The tool returns the raw token to the caller (admin/LLM).
- A `token.created.v1` event is published with the raw token and document metadata.
- Validation script passes.

## Testing Strategy
- Mock Firestore and Publisher.
- Verify `create_api_token` handler:
  - Generates a non-empty raw token.
  - Stores the correct SHA-256 hash.
  - Publishes the expected event.
  - Returns the raw token in the MCP response.

## Deployment Approach
- Standard Cloud Run deployment via Cloud Build (triggered by PR merge).

## Dependencies
- Firebase Admin SDK (already in use).
- Pub/Sub (already in use).

## Definition of Done
- Code adheres to project style.
- Tests pass with high coverage for new logic.
- `validate_deliverable.sh` passes.
- PR created.
