# Implementation Plan – sprint-291-b4f2a7

## Objective
- Fix Twitch newline rendering in egress messages.
- Ensure egress events with no candidates do not send a response and are ignored gracefully.

## Scope
- `src/services/ingress/twitch/twitch-irc-client.ts`: Twitch message sending logic.
- `src/common/events/selection.ts`: Candidate selection and text extraction logic.
- `src/apps/ingress-egress-service.ts`: Egress processing orchestration.

## Deliverables
- Code changes in the above files.
- Unit tests for Twitch message splitting.
- Integration/unit tests for egress skip logic.
- Updated `validate_deliverable.sh`.

## Acceptance Criteria
- Twitch messages with `\n` are sent as multiple IRC messages (one per line) to ensure proper rendering.
- Events sent to `processEgress` that have no candidates (empty array or no matching candidate) return `IGNORED` and do not result in any message being sent to the connector.
- No fallback to original message when an egress connector is explicitly requested but no candidates are present.

## Testing Strategy
- **Unit Tests**:
  - Test `TwitchIrcClient.sendText` with multiline strings.
  - Test `extractEgressTextFromEvent` with various candidate scenarios.
- **Integration Tests**:
  - Test `IngressEgressServer.processEgress` with an event having no candidates.

## Deployment Approach
- Standard Cloud Run deployment via Cloud Build (mocked/dry-run in validation).

## Dependencies
- None.

## Definition of Done
- All code changes implemented.
- Tests passing.
- `validate_deliverable.sh` successful.
- PR created.
