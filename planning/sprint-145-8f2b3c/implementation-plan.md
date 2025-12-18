# Implementation Plan – sprint-145-8f2b3c

## Objective
- Fix the issue where responses to Discord messages are sent via Twitch.

## Scope
- `ingress-egress` service (ingress metadata and egress dispatching)
- `event-router` and `llm-bot` (routing slip and metadata preservation)
- `EnvelopeV1` and `InternalEventV2` types

## Deliverables
- Bug fix in routing/egress logic.
- Reproduction test case.
- Updated documentation if necessary.

## Acceptance Criteria
- A Discord message results in a response sent to the Discord egress connector.
- Twitch messages still receive responses on Twitch.
- All tests pass.

## Testing Strategy
- Unit tests for `DiscordIngressClient` and `TwitchIRCClient` to verify `source` and `platform` metadata.
- Integration test simulating an event flow from Discord ingress to egress.

## Deployment Approach
- Cloud Run deployment via Cloud Build (standard for this project).

## Dependencies
- None.

## Definition of Done
- Code quality adheres to standards.
- Tests for new behavior pass.
- `validate_deliverable.sh` passes.
- PR created.
