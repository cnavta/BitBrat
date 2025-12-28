# Implementation Plan – sprint-179-d2e3f4

## Objective
Add Twilio-node based SMS integration to the `ingress-egress` service using Twilio's Conversations WebSockets API, following patterns from Twitch and Discord.

## Scope
- Implementation of `TwilioIngressClient`, `TwilioEnvelopeBuilder`, and `TwilioConnectorAdapter`.
- Integration into `IngressEgressServer`.
- Configuration updates in `architecture.yaml` and `src/common/config.ts`.
- Unit and integration tests for the new components.

## Deliverables
- `src/services/ingress/twilio/twilio-ingress-client.ts`
- `src/services/ingress/twilio/twilio-envelope-builder.ts`
- `src/services/ingress/twilio/connector-adapter.ts`
- Updated `src/apps/ingress-egress-service.ts`
- Updated `architecture.yaml`
- Updated `src/common/config.ts`
- Tests for Twilio integration.
- `validate_deliverable.sh` updated for this sprint.

## Acceptance Criteria
- Incoming SMS messages are successfully published as `internal.ingress.v1` events.
- Egress events sent to the `twilio` connector are successfully delivered as SMS messages (or Twilio conversation messages).
- The `ingress-egress` service starts up correctly with Twilio enabled.
- `getSnapshot()` returns accurate state for the Twilio client.

## Testing Strategy
- **Unit Tests**: Test `TwilioEnvelopeBuilder` mapping logic. Test `TwilioIngressClient` event handling using mocks for `@twilio/conversations`.
- **Integration Tests**: Mock the message bus and verify that `TwilioIngressClient` publishes events correctly.
- **Manual Verification**: Observe logs and (if possible) test with a live Twilio sandbox or account.

## Deployment Approach
- Deploy via Cloud Build to Cloud Run as part of the `ingress-egress` service.
- Secrets will be managed via GCP Secret Manager and referenced in `architecture.yaml`.

## Dependencies
- `@twilio/conversations`
- `twilio`
- Existing `ingress-egress` infrastructure.

## Definition of Done
- All code changes trace back to this sprint.
- Tests for all new behavior pass.
- `validate_deliverable.sh` passes.
- PR created and linked in `publication.yaml`.
- Documentation updated.
