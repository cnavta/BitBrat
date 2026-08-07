# Implementation Plan – sprint-229-a1b2c3

## Objective
Enhance `brat chat` CLI tool with color coding and dynamic user name prompting. Update `api-gateway` to support dynamic user ID for `brat-chat` sessions and handle `dm` egress requests.

## Scope
- `tools/brat/src/cli/chat.ts`: Terminal UI and connection logic.
- `src/apps/api-gateway.ts`: WebSocket upgrade and session management.
- `src/services/api-gateway/egress.ts`: Egress event routing logic.

## Deliverables
- Updated `brat chat` CLI with name prompting and color coding.
- Updated `api-gateway` with `brat-chat:*` user ID support.
- Updated `api-gateway` egress logic for `dm` support.
- Validation script `validate_deliverable.sh`.

## Acceptance Criteria
1. When starting `npm run brat -- chat`, the user is prompted for a name.
2. The user ID for the session is `brat-chat:{{name}}`.
3. Messages in the chat are color-coded:
   - User messages (sent): Cyan (for label/source)
   - Platform responses: Green (for label/source)
   - Errors: Red
4. `api-gateway` correctly routes egress events with type `dm.message.v1` as `chat.message.received` to the client.

## Testing Strategy
- Unit tests for `EgressManager` to verify `dm` support.
- Manual verification of the CLI tool.
- Integration test for the dynamic user ID.

## Deployment Approach
- Standard `npm run build` and local deployment via `infrastructure/deploy-local.sh`.

## Dependencies
- None.

## Definition of Done
- Code matches architecture.yaml.
- `validate_deliverable.sh` passes.
- PR created.
