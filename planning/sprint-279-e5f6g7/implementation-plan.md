# Implementation Plan – sprint-279-e5f6g7

## Objective
- Update both Twitch and Discord egress processes to recognize the "accountType" metadata property (either "bot" or "broadcaster") and use it to identify the correct egress path.

## Scope
- `IngressEgressServer.processEgress` logic.
- Twitch egress path (e.g., `TwitchIrcClient`).
- Discord egress path (e.g., `DiscordIngressClient`).
- Logging errors when `accountType` is invalid or not found.
- Finalizing event persistence with the appropriate status.

## Deliverables
- Updated `src/apps/ingress-egress-service.ts`.
- Updated Twitch and Discord connectors.
- Integration/unit tests for the new logic.
- `validate_deliverable.sh` updated if necessary.

## Acceptance Criteria
- Twitch egress uses "broadcaster" account if `accountType` is "broadcaster".
- Twitch egress uses "bot" account if `accountType` is "bot" (or by default if not specified).
- Discord egress uses the appropriate account type similarly.
- If `accountType` is specified but no matching credentials/path is found, log an error and finalize with `ERROR` status.
- Existing egress flows continue to work without breaking.

## Testing Strategy
- Unit tests for `processEgress` with various `accountType` values.
- Mocking the connectors to verify they receive the correct configuration.
- Verifying the error logging and persistence finalization.

## Deployment Approach
- Standard Cloud Run deployment.
- No changes to infrastructure required (assuming credentials for both account types exist or are configurable).

## Dependencies
- Twitch credentials for both bot and broadcaster accounts.
- Discord credentials for both bot and broadcaster accounts.

## Definition of Done
- Code adheres to project constraints.
- No TODOs in production code.
- `npm test` passes with new tests.
- `validate_deliverable.sh` succeeds.
- GitHub PR created for `feature/sprint-279-e5f6g7-egress-account-type`.
